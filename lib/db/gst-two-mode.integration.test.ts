import { getGstFilters, gstLedgerCsv } from '@/lib/db/gst-reconciliation';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { priceCart } from '@/lib/cart-pricing';
import { computeQuoteTotals } from '@/lib/pricing';
import { syntheticGstin, SYNTHETIC_BUYER, SYNTHETIC_FSSAI, SYNTHETIC_SERVICE_SAC } from '@/lib/gst/test-fixtures';
import { addBillingDays, gstFinancialYearStart } from '@/lib/gst/onboarding';
import { localDateKey, RESTAURANT_TIME_ZONE } from '@/lib/db/time';
import { prepareEinvoicePayload } from '@/lib/gst/einvoice';
import { buildIrpPayload } from '@/lib/gst/irp/payload';
import { toValidatedInv01 } from '@/lib/gst/irp/inv01';
import { advanceIrpJob, documentKey, recoverAbandonedIrpJob, type Inv01ProviderAdapter, type ProviderJob } from '@/lib/gst/irp/provider';
import { postgresRehearsalStore } from '@/lib/gst/irp/postgres-rehearsal-store';
import { fingerprint } from '@/lib/gst/irp/fingerprint';
const URL_VALUE = process.env.READINESS_DB_URL || '';
// A test URL is not permission to mutate an arbitrary database.
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('GST tests require a locally-created disposable autodine_check_* database');
  }
}

// Each fixture restaurant is an independent legal entity, so each gets its
// own GSTIN (the cross-outlet shared-GSTIN consistency trigger rightly
// refuses two outlets under one GSTIN with different seller identities).
let gstinSeq = 0;
function nextGstin(): { gstin: string; pan: string } {
  const n = gstinSeq;
  gstinSeq += 1;
  const letters = Array.from({ length: 5 }, (_, i) => String.fromCharCode(65 + (Math.floor(n / 26 ** (4 - i)) % 26))).join('');
  const anchor = String.fromCharCode(65 + (n % 26));
  const pan = `${letters}0000${anchor}`;
  const gstin = syntheticGstin(`27${pan}1Z`);
  return { gstin, pan };
}

let db: Client;

async function makeRestaurant(slug: string, user: string, account: string | null = null): Promise<{ restaurant: string; item: string; gstin: string; pan: string }> {
  const { gstin, pan } = nextGstin();
  await db.query('insert into profiles(id) values ($1) on conflict do nothing', [user]);
  const restaurant = (await db.query(
    `insert into restaurants(slug,name,address,phone,tax_rate_bps,guest_verification_mode,account_id)
     values ($1,'GST Test Kitchen','Registered office, Test Lane','07120000000',0,'scan',$2) returning id`, [slug,account])).rows[0].id;
  await db.query(`insert into memberships(restaurant_id,user_id,role) values ($1,$2,'owner')`, [restaurant, user]);
  const menu = (await db.query(`insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id`,[restaurant])).rows[0].id;
  const category = (await db.query(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id`,[restaurant,menu])).rows[0].id;
  // ₹105.00 inclusive at 5% -> ₹100.00 taxable + ₹5.00 GST, exactly.
  const item = (await db.query(`insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Plate',10500,true) returning id`,[restaurant,category])).rows[0].id;
  const table = (await db.query(`insert into dining_tables(restaurant_id,label) values($1,'G1') returning id`,[restaurant])).rows[0].id;
  await db.query(`insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)`,[restaurant,table,randomUUID().replaceAll('-','') + randomUUID().replaceAll('-','')]);
  return { restaurant, item, gstin, pan };
}

async function placeOrder(slug: string, item: string, qty: number, options: { variantId?: string; addonIds?: string[]; tableToken?: string } = {}): Promise<{ code: string; order: string; sitting: string }> {
  const { rows } = await db.query('select public_token from table_qr_codes where restaurant_id = (select id from restaurants where slug = $1)', [slug]);
  const token: string = options.tableToken ?? rows[0]?.public_token;
  // Use the guest RPC and actual API role rather than calling the private
  // placement core with the database admin connection's privileges.
  const code = await asRole(null, async (c) => {
    const sessionToken = (await c.query('select * from open_table_session($1,$2)', [token, 'a'.repeat(64)])).rows[0].session_token;
    const { result } = (await c.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4::uuid,null) result',
      [slug, JSON.stringify([{ itemId: item, qty, ...options }]), sessionToken, randomUUID()])).rows[0];
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.code as string;
  }, 'anon');
  const order = (await db.query('select id,order_session_id from orders where restaurant_id=(select id from restaurants where slug=$1) and code=$2',[slug,code])).rows[0];
  return { code, order: order.id, sitting: order.order_session_id };
}

async function setGstConfig(restaurant: string, config: Record<string, unknown>) {
  const updateOnly = !config.mode;
  if (!updateOnly) config = {
    fssai_number: SYNTHETIC_FSSAI,
    ...(config.mode === 'regular' ? { business_type: 'standalone' } : {}),
    ...(config.mode === 'regular' || config.mode === 'composition' ? { service_sac: SYNTHETIC_SERVICE_SAC } : {}),
    ...config,
  };
  const cols = Object.keys(config);
  const values = Object.values(config);
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  await db.query(
    updateOnly ? `update public.restaurant_gst_config set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} where restaurant_id=$1` :
    `insert into public.restaurant_gst_config(restaurant_id,${cols.join(',')}) values ($1,${placeholders})
     on conflict (restaurant_id) do update set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}`,
    [restaurant, ...values]);
}

async function closeAndIssue(user: string, sitting: string, recipient: unknown = null): Promise<string> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query('select mark_order_session_paid($1)', [sitting]);
  try {
    return (await db.query('select close_order_session_and_issue_receipt($1,$2) id', [sitting,recipient])).rows[0].id;
  } finally {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

async function asRole<T>(actor: string | null, work: (conn: Client) => Promise<T>, role: 'anon' | 'authenticated' | 'service_role' = 'authenticated', conn = db): Promise<T> {
  await conn.query('begin');
  try {
    await conn.query("select set_config('request.jwt.claim.sub',$1,true)", [actor ?? '']);
    await conn.query(`set local role ${role}`);
    const result = await work(conn);
    await conn.query('commit');
    return result;
  } catch (error) {
    await conn.query('rollback');
    throw error;
  }
}

const OFF_DB_ROW = { mode: 'off', off_declared: true, fssai_number: SYNTHETIC_FSSAI, business_type: null, service_sac: null, premises_evidence: null };
const OFF = { ...OFF_DB_ROW, off_has_obligation: false };
const regular = (gstin: string) => ({
  mode: 'regular', registration_type: 'regular', regular_profile: 'other_than_specified_premises',
  gstin, legal_name: 'Synthetic GST Kitchen', address: '1 Disposable Test Lane',
  fssai_number: SYNTHETIC_FSSAI, business_type: 'standalone', service_sac: SYNTHETIC_SERVICE_SAC,
});
const composition = (gstin: string) => ({
  ...regular(gstin), mode: 'composition', registration_type: 'composition', regular_profile: null,
  composition_acknowledged: true, business_type: null,
});
const indiaToday = () => localDateKey(RESTAURANT_TIME_ZONE, new Date());
const currentFy = () => gstFinancialYearStart(indiaToday());
const premisesEvidence = () => ({
  basis: 'room_supply', reference: 'Synthetic signed CA review',
  treatment_fy_start: currentFy(), room_supply_fy_start: currentFy() - 1, room_value_paise: 750001,
});
const specified = (gstin: string, date = `${currentFy()}-04-01`) => ({
  ...regular(gstin), regular_profile: 'specified_premises', specified_premises_attested: true,
  specified_premises_effective_from: date, business_type: 'hotel', premises_evidence: premisesEvidence(),
});
const activation = (patch: Record<string, unknown> = {}) => ({
  confirm: true, series_confirmed: true, effective_from: indiaToday(), premises_address: '1 Synthetic Test Lane',
  premises_state_code: '27', invoice_phone: '07120000000', series: { INV:'INV', BOS:'BOS', RBL:'RBL', CN:'CN', DN:'DN' }, external_prefixes: [], ...patch,
});
const aatoReview = (highest: number) => activation({aato:{highest_prior_fy_paise:highest,
  reference:'Complete synthetic prior FY review',reporting_category:'under_10cr'}});
const CONSUMER = { recipient_type:'consumer', name:'Synthetic B2C buyer', address:'Synthetic buyer original billing address', state_code:'29' };
const BUYER = { gstin: SYNTHETIC_BUYER, name: 'Synthetic Buyer Kitchen', address: '1 Synthetic Registered Lane', location: 'Synthetic City', pincode: '560001', state_code: '29', email: 'accounts@buyer.example' };
const save = (conn: Client, outlet: string, version: number, settings: Record<string, unknown>) => conn.query(
  'select save_restaurant_gst_config($1,$2,$3) version', [outlet, version, { activation: activation({ premises_state_code: typeof settings.gstin === 'string' ? settings.gstin.slice(0,2) : '27' }), ...settings }],
).then(({ rows }) => rows[0].version as number);

describe.skipIf(!URL_VALUE)('GST two-mode (disposable PostgreSQL)', () => {
  const slugBase = 'gst-' + randomUUID().slice(0, 8);
  beforeAll(async () => { db = new Client({ connectionString: URL_VALUE }); await db.connect(); }, 30000);
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => { await db.query("select set_config('request.jwt.claim.sub','',false)"); });

  it('off mode (default) issues the historical non-GST receipt unchanged', async () => {
    const user = randomUUID(); const slug = `${slugBase}-off-${randomUUID().slice(0,4)}`;
    const { item } = await makeRestaurant(slug, user);
    const { sitting } = await placeOrder(slug, item, 2);
    const order = (await db.query('select total_paise, tax_paise, gst_mode_snapshot from orders where order_session_id=$1', [sitting])).rows[0];
    expect([Number(order.total_paise), Number(order.tax_paise)]).toEqual([21000, 0]);
    expect(order.gst_mode_snapshot).toBe('off');
    const invoiceId = await closeAndIssue(user, sitting);
    const inv = (await db.query('select document_type, gst_snapshot, totals_snapshot->>\'taxable_paise\' as taxable, totals_snapshot->>\'tax_paise\' as tax from restaurant_invoices where id=$1', [invoiceId])).rows[0];
    expect(inv.document_type).toBe('receipt');
    expect(inv.gst_snapshot).toBeNull();
    expect(inv.taxable).toBeNull();
    expect(Number(inv.tax)).toBe(0);
  }, 20000);

  it('regular 5% prices menu as tax-inclusive and issues a GST tax invoice with CGST/SGST split', async () => {
    const user = randomUUID(); const slug = `${slugBase}-reg-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'GST Test Kitchen LLP', trade_name: 'GST Test',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 2);
    const order = (await db.query('select subtotal_paise, tax_paise, total_paise, gst_mode_snapshot from orders where order_session_id=$1', [sitting])).rows[0];
    expect(Number(order.total_paise)).toBe(21000);      // the bill is the menu price
    expect(Number(order.tax_paise)).toBe(1000);          // ₹10.00 GST inside the ₹210
    expect(Number(order.subtotal_paise)).toBe(21000);
    expect(order.gst_mode_snapshot).toBe('regular');
    const invoiceId = await closeAndIssue(user, sitting);
    const inv = (await db.query(`select document_type, gst_snapshot, totals_snapshot, irp_status from restaurant_invoices where id=$1`, [invoiceId])).rows[0];
    expect(inv.document_type).toBe('gst_tax_invoice');
    const snap = inv.gst_snapshot;
    expect(Number(snap.rate_bps)).toBe(500);
    expect(Number(snap.cgst_paise)).toBe(500);
    expect(Number(snap.sgst_paise)).toBe(500);
    expect(Number(snap.igst_paise)).toBe(0);
    expect(Number(snap.taxable_paise)).toBe(20000);
    expect(snap.place_of_supply_state_code).toBe('27');
    expect(snap.config_version).toBeGreaterThanOrEqual(1);
    expect(snap.profile_notification).toContain('11/2017');
    expect(inv.irp_status).toBe('not_required'); // B2C — no buyer captured
    const totals = inv.totals_snapshot;
    expect(Number(totals.taxable_paise)).toBe(20000);
    expect(Number(totals.cgst_paise) + Number(totals.sgst_paise)).toBe(Number(totals.tax_paise));
    expect(Number(totals.total_paise)).toBe(21000);
  }, 20000);

  it('requires an explicit Composition SAC from the owner and freezes it without collecting GST', async () => {
    const owner=randomUUID(), slug=`${slugBase}-bos-particulars`;
    const {restaurant,gstin,item}=await makeRestaurant(slug,owner);
    for (const service_sac of [undefined,'','99633']) await expect(asRole(owner,c=>save(c,restaurant,0,
      {...composition(gstin),service_sac}))).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/service SAC/i)});
    const initial='996331', changed='996332'; // format-valid synthetic configuration; not a fallback
    await asRole(owner,c=>save(c,restaurant,0,{...composition(gstin),service_sac:initial}));
    const {sitting}=await placeOrder(slug,item,1);
    const id=await closeAndIssue(owner,sitting);
    await asRole(owner,c=>save(c,restaurant,1,{...composition(gstin),service_sac:changed}));
    expect((await db.query('select service_sac from restaurant_gst_config_history where restaurant_id=$1 order by config_version',[restaurant])).rows)
      .toEqual([{service_sac:initial},{service_sac:changed}]);
    const invoice=(await db.query('select document_type,gst_snapshot,totals_snapshot,irp_status from restaurant_invoices where id=$1',[id])).rows[0];
    expect(invoice).toMatchObject({document_type:'bill_of_supply',irp_status:'not_required',gst_snapshot:{service_sac:initial,rate_bps:0},
      totals_snapshot:{tax_paise:0,total_paise:10500,amount_paid_paise:10500}});
  });

  it('composition requires acknowledgment, then issues a tax-free Bill of Supply', async () => {
    const user = randomUUID(); const slug = `${slugBase}-cmp-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await expect(setGstConfig(restaurant, {
      mode: 'composition', gstin, legal_name: 'GST Test Kitchen LLP',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'composition', composition_acknowledged: false,
    })).rejects.toThrow(/acknowledg/i);
    await setGstConfig(restaurant, {
      mode: 'composition', gstin, legal_name: 'GST Test Kitchen LLP',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'composition', composition_acknowledged: true,
    });
    const { sitting } = await placeOrder(slug, item, 2);
    const order = (await db.query('select total_paise, tax_paise from orders where order_session_id=$1', [sitting])).rows[0];
    expect([Number(order.total_paise), Number(order.tax_paise)]).toEqual([21000, 0]);
    const invoiceId = await closeAndIssue(user, sitting);
    const inv = (await db.query('select document_type, gst_snapshot, totals_snapshot, irp_status from restaurant_invoices where id=$1', [invoiceId])).rows[0];
    expect(inv.document_type).toBe('bill_of_supply');
    expect(inv.gst_snapshot.notice).toContain('Composition taxable person');
    expect(Number(inv.totals_snapshot.tax_paise)).toBe(0);
    expect(Number(inv.totals_snapshot.total_paise)).toBe(21000);
    expect(inv.irp_status).toBe('not_required');
  }, 20000);

  it('18% profile requires the specified-premises attestation and checks state code against GSTIN', async () => {
    const user = randomUUID(); const slug = `${slugBase}-18-${randomUUID().slice(0,4)}`;
    const { restaurant, gstin, pan } = await makeRestaurant(slug, user);
    await expect(setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'specified_premises',
      gstin, legal_name: 'Hotel Attached Restaurant Pvt Ltd',
      address: 'Hotel Tower, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', specified_premises_attested: false,
    })).rejects.toThrow(/specified-premises|specified premises/i);
    await expect(setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Hotel Attached Restaurant Pvt Ltd',
      address: 'Hotel Tower, Test Lane, Nagpur', state_code: '29', pan, // state must match GSTIN
      registration_type: 'regular',
    })).rejects.toThrow(/state code/i);
    await setGstConfig(restaurant, {
      ...specified(gstin), pan, state_code: '27',
    });
    const rate = (await db.query("select (public.gst_pricing($1)).rate_bps as rate", [restaurant])).rows[0].rate;
    expect(Number(rate)).toBe(1800);
  }, 20000);

  it('a sitting priced under one GST mode cannot be issued under another', async () => {
    const user = randomUUID(); const slug = `${slugBase}-mix-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    const { sitting } = await placeOrder(slug, item, 1); // placed in off mode
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Switched Later LLP',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular',
    });
    await expect(closeAndIssue(user, sitting)).rejects.toThrow(/different GST configuration/i);
  }, 20000);

  it('issued GST documents are immutable even for direct superuser DML; only void transition is permitted', async () => {
    const user = randomUUID(); const slug = `${slugBase}-imm-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Immutable Doc LLP',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular',
    });
    const { sitting } = await placeOrder(slug, item, 1);
    const invoiceId = await closeAndIssue(user, sitting);
    await expect(db.query("update restaurant_invoices set seller_snapshot='{}' where id=$1", [invoiceId])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query("delete from restaurant_invoices where id=$1", [invoiceId])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query("update restaurant_invoice_lines set line_number=99 where invoice_id=$1", [invoiceId])).rejects.toMatchObject({ code: '42501' });
    // voiding is permitted and keeps the record
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      await db.query("select void_restaurant_invoice($1,'Test void of a local GST document')", [invoiceId]);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const inv = (await db.query('select status, void_reason from restaurant_invoices where id=$1', [invoiceId])).rows[0];
    expect(inv.status).toBe('voided');
    expect(inv.void_reason).toContain('Test void');
  }, 20000);

  it('regular GST: B2B issue records the buyer, snapshots it, and defers finalisation above the e-invoice threshold', async () => {
    const user = randomUUID(); const slug = `${slugBase}-b2b-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    // Above the ₹5 crore e-invoice threshold.
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Threshold Test Pvt Ltd', trade_name: 'Threshold',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    const recipient = { name: 'Buyer Foods LLP', gstin: SYNTHETIC_BUYER, address: 'Buyer House, MIDC, Pune', email: 'accounts@buyer.example' };
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id', [sitting, JSON.stringify(recipient)])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const inv = (await db.query(
      'select recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_email, customer_snapshot, irp_status from restaurant_invoices where id=$1',
      [invoiceId])).rows[0];
    expect(inv.recipient_name).toBe('Buyer Foods LLP');
    expect(inv.recipient_gstin).toBe(SYNTHETIC_BUYER);
    expect(inv.recipient_state_code).toBe('29'); // derived from GSTIN, not typed
    expect(inv.recipient_address).toBe('Buyer House, MIDC, Pune');
    expect(inv.recipient_email).toBe('accounts@buyer.example');
    expect((inv.customer_snapshot as { gstin?: string }).gstin).toBe(SYNTHETIC_BUYER);
    expect(inv.irp_status).toBe('pending'); // must not be rendered final until IRN exists
  }, 20000);

  it('at ₹5 crore for all covered prior FYs an ordinary B2B invoice is not IRN-held', async () => {
    const user = randomUUID(); const slug = `${slugBase}-b2c-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin } = await makeRestaurant(slug, user);
    // Exactly ₹5 crore across the complete PAN history, not just one FY.
    await asRole(user, (c) => save(c, restaurant, 0, { ...regular(gstin), preceding_fy_turnover_paise: 5_000_000_000,
      activation: activation({ aato: { highest_prior_fy_paise: 5_000_000_000, reference: 'Synthetic complete PAN evidence', reporting_category: 'under_10cr' } }) }));
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    try {
      const invoiceId = (await db.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ ...BUYER, name: 'Boundary Buyer' })])).rows[0].id;
      expect((await db.query('select irp_status from restaurant_invoices where id=$1', [invoiceId])).rows[0].irp_status).toBe('not_required');
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('regular GST: unknown preceding-FY AATO makes e-invoice applicability fail closed (pending)', async () => {
    const user = randomUUID(); const slug = `${slugBase}-aato-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Unknown AATO Pvt Ltd', trade_name: 'Unknown AATO',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: null,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    try {
      const invoiceId = (await db.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ ...BUYER, name: 'Unknown Buyer' })])).rows[0].id;
      expect((await db.query('select irp_status from restaurant_invoices where id=$1', [invoiceId])).rows[0].irp_status).toBe('pending');
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('rejects buyer details on a normal receipt and on a Bill of Supply — Regular GST only', async () => {
    const offUser = randomUUID(); const offSlug = `${slugBase}-offb2b-${randomUUID().slice(0,4)}`;
    const off = await makeRestaurant(offSlug, offUser);
    const offSitting = (await placeOrder(offSlug, off.item, 1)).sitting;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [offUser]);
    await db.query('select mark_order_session_paid($1)', [offSitting]);
    try {
      await expect(db.query('select close_order_session_and_issue_receipt($1,$2::jsonb)',
        [offSitting, JSON.stringify({ name: 'Off Buyer', gstin: SYNTHETIC_BUYER })])).rejects.toThrow(/Regular GST/i);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }

    const cmpUser = randomUUID(); const cmpSlug = `${slugBase}-cmpb2b-${randomUUID().slice(0,4)}`;
    const cmp = await makeRestaurant(cmpSlug, cmpUser);
    await setGstConfig(cmp.restaurant, {
      mode: 'composition', gstin: cmp.gstin, legal_name: 'Composition Buyer Co',
      address: 'Composition Lane, Nagpur', state_code: '27', pan: cmp.pan,
      registration_type: 'composition', composition_acknowledged: true,
    });
    const cmpSitting = (await placeOrder(cmpSlug, cmp.item, 1)).sitting;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cmpUser]);
    await db.query('select mark_order_session_paid($1)', [cmpSitting]);
    try {
      await expect(db.query('select close_order_session_and_issue_receipt($1,$2::jsonb)',
        [cmpSitting, JSON.stringify({ name: 'Cmp Buyer', gstin: SYNTHETIC_BUYER })])).rejects.toThrow(/Regular GST/i);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('rejects malformed and incorrect-checksum buyer GSTIN without closing the sitting', async () => {
    const user = randomUUID(); const slug = `${slugBase}-badgstin-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Format Check Pvt Ltd', trade_name: 'Format',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    try {
      await expect(db.query('select close_order_session_and_issue_receipt($1,$2::jsonb)',
        [sitting, JSON.stringify({ name: 'Bad GSTIN', gstin: 'XXAAICA9305C1Z9' })])).rejects.toThrow(/GSTIN/i);
      const badChecksum = SYNTHETIC_BUYER.slice(0, -1) + (SYNTHETIC_BUYER.endsWith('0') ? '1' : '0');
      await expect(db.query('select close_order_session_and_issue_receipt($1,$2::jsonb)',
        [sitting, JSON.stringify({ name: 'Bad checksum', gstin: badChecksum })])).rejects.toThrow(/checksum/i);
      expect((await db.query('select status from order_sessions where id=$1', [sitting])).rows[0].status).toBe('open');
      expect((await db.query('select count(*)::int n from restaurant_invoice_series where restaurant_id=$1', [restaurant])).rows[0].n).toBe(0);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('Regular mode refuses a buyer GSTIN state prefix outside the 01–38 range', async () => {
    const user = randomUUID(); const slug = `${slugBase}-badele-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Range Check Pvt Ltd', trade_name: 'Range',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    try {
      await expect(db.query('select close_order_session_and_issue_receipt($1,$2::jsonb)',
        [sitting, JSON.stringify({ name: 'Far Away Buyer', gstin: '99AAICA9305C1Z9' })])).rejects.toThrow(/state code/i);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('alcoholic items are refused before pricing a GST ticket but never block a normal receipt', async () => {
    const user = randomUUID(); const slug = `${slugBase}-alc-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await db.query('update items set is_alcoholic = true where id = $1', [item]);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Alcohol Test Pvt Ltd', trade_name: 'Alcohol',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular',
    });
    await expect(placeOrder(slug, item, 1)).rejects.toThrow(/alcoholic/i);
    expect((await db.query('select count(*)::int n from orders where restaurant_id=$1', [restaurant])).rows[0].n).toBe(0);

    // and the same alcohol line is perfectly fine on a non-GST receipt
    const user2 = randomUUID(); const slug2 = `${slugBase}-alcok-${randomUUID().slice(0,4)}`;
    const plain = await makeRestaurant(slug2, user2);
    await db.query('update items set is_alcoholic = true where id = $1', [plain.item]);
    const sitting2 = (await placeOrder(slug2, plain.item, 1)).sitting;
    const invoiceId = await closeAndIssue(user2, sitting2);
    expect((await db.query('select document_type from restaurant_invoices where id=$1', [invoiceId])).rows[0].document_type).toBe('receipt');
  }, 20000);

  it('checks shared registration within the account without coupling independent tenants', async () => {
    const base = `${slugBase}-shr-${randomUUID().slice(0,4)}`;
    const userA = randomUUID();
    const a = await makeRestaurant(`${base}-a`, userA);
    const account = (await db.query('insert into accounts(owner_id) values ($1) returning id', [userA])).rows[0].id;
    await db.query('update restaurants set account_id=$1 where id=$2', [account, a.restaurant]);
    const sharedGstin = a.gstin;
    const sharedPan = a.pan;
    await setGstConfig(a.restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin: sharedGstin, legal_name: 'Shared Identity LLP', trade_name: 'Shared',
      address: 'Head Office, Test Lane, Nagpur', state_code: '27', pan: sharedPan,
      registration_type: 'regular',
    });
    // Different outlet, same GSTIN, same identity: must be allowed.
    const b = await makeRestaurant(`${base}-b`, userA);
    await db.query('update restaurants set account_id=$1 where id=$2', [account, b.restaurant]);
    await setGstConfig(b.restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin: sharedGstin, legal_name: 'Shared Identity LLP', trade_name: 'Shared Branch',
      address: 'Branch Office, Test Lane, Nagpur', state_code: '27', pan: sharedPan,
      registration_type: 'regular',
    });
    // Different outlet, same GSTIN, different legal name: must be refused.
    const c = await makeRestaurant(`${base}-c`, userA);
    await db.query('update restaurants set account_id=$1 where id=$2', [account, c.restaurant]);
    await expect(setGstConfig(c.restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin: sharedGstin, legal_name: 'Completely Different Pvt Ltd',
      address: 'Elsewhere, Test Lane, Nagpur', state_code: '27', pan: sharedPan,
      registration_type: 'regular',
    })).rejects.toThrow(/in this account sharing a GSTIN/i);
    // Same PAN, different GSTIN, Composition vs regular: must be refused.
    const d = await makeRestaurant(`${base}-d`, userA);
    await db.query('update restaurants set account_id=$1 where id=$2', [account, d.restaurant]);
    const samePanOtherGstin = syntheticGstin(`29${sharedPan}2Z`);
    await expect(setGstConfig(d.restaurant, {
      mode: 'composition', gstin: samePanOtherGstin, legal_name: 'Shared Identity LLP',
      address: 'Branch Office, Test Lane, Nagpur', state_code: '29', pan: sharedPan,
      registration_type: 'composition', composition_acknowledged: true,
    })).rejects.toThrow(/same registration type|straddle/i);
    const independent = await makeRestaurant(`${base}-independent`, randomUUID());
    await setGstConfig(independent.restaurant, {
      mode: 'composition', gstin: sharedGstin, legal_name: 'Independent Tenant',
      address: 'Test Lane, Independent Outlet', state_code: '27', pan: sharedPan,
      registration_type: 'composition', composition_acknowledged: true,
    });
    expect((await db.query('select mode from restaurant_gst_config where restaurant_id=$1', [a.restaurant])).rows[0].mode).toBe('regular');
  }, 20000);

  it('record_restaurant_irp_request appends attempts, owner/manager only, never a service role', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-irp-${randomUUID().slice(0,4)}`;
    const cashier = randomUUID();
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, owner);
    await db.query('insert into profiles(id) values ($1)', [cashier]);
    await db.query('insert into memberships(restaurant_id,user_id,role) values ($1,$2,$3)', [restaurant, cashier, 'cashier']);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'IRP Audit Pvt Ltd', trade_name: 'IRP',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    const invoiceId = await closeAndIssue(owner, sitting);
    await expect(asRole(owner, (c) => c.query("select record_restaurant_irp_request($1,'sandbox','v1','submitted')", [invoiceId]), 'service_role')).rejects.toMatchObject({ code: '42501' });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cashier]);
    try {
      await expect(db.query("select record_restaurant_irp_request($1,'sandbox','v1','submitted')", [invoiceId])).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    try {
      const first = (await db.query("select record_restaurant_irp_request($1,'sandbox','v1','submitted','aa','bb') id", [invoiceId])).rows[0].id;
      const second = (await db.query("select record_restaurant_irp_request($1,'sandbox','v1','rejected','cc','dd','2150','Invalid GSTIN of recipient') id", [invoiceId])).rows[0].id;
      expect(first).not.toBe(second);
      const attempts = (await db.query('select attempt_no, status from restaurant_irp_requests where invoice_id=$1 order by attempt_no', [invoiceId])).rows;
      expect(attempts.map((a: { attempt_no: number }) => a.attempt_no)).toEqual([1, 2]);
      expect(attempts.map((a: { status: string }) => a.status)).toEqual(['submitted', 'rejected']);
      await expect(db.query("select record_restaurant_irp_request($1,'sandbox','v1','bogus')", [invoiceId])).rejects.toMatchObject({ code: '23514' });
      // the audit row is append-only at the database privilege layer: even an
      // authenticated role cannot write it directly
      for (const statement of [
        "update restaurant_irp_requests set status='accepted' where invoice_id=$1",
        "insert into restaurant_irp_requests(restaurant_id,invoice_id,attempt_no,provider,payload_version,status) values($1,$1,99,'rogue','v1','accepted')",
      ]) {
        await db.query('begin');
        try {
          await db.query('set local role authenticated');
          await expect(db.query(statement, [invoiceId])).rejects.toMatchObject({ code: '42501' });
        } finally {
          await db.query('rollback');
        }
      }
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('a shared receipt link exposes the buyer snapshot so the printed bill carries it', async () => {
    const user = randomUUID(); const slug = `${slugBase}-share-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin } = await makeRestaurant(slug, user);
    await asRole(user, (c) => save(c, restaurant, 0, { ...regular(gstin),
      activation: activation({ aato: { highest_prior_fy_paise: 1_000_000_000, reference: 'Complete synthetic evidence', reporting_category: 'under_10cr' } }) }));
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ ...BUYER, name: 'Share Buyer LLP' })])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      await db.query('select create_restaurant_invoice_share_link($1,$2)', [invoiceId, hash]);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const read = () => asRole(null, (c) => c.query('select read_shared_restaurant_invoice($1) payload', [hash]), 'anon').then(({ rows }) => rows[0].payload);
    const shared = await read() as { invoice: { customer_snapshot?: { gstin?: string; name?: string } | null } };
    expect(shared.invoice.customer_snapshot?.gstin).toBe(SYNTHETIC_BUYER);
    expect(shared.invoice.customer_snapshot?.name).toBe('Share Buyer LLP');
    await asRole(user, (c) => c.query("select void_restaurant_invoice($1,'Synthetic void for replacement')", [invoiceId]));
    expect(await read()).toBeNull();
    // The receipt helper is not a client entry point: EXECUTE is revoked from
    // authenticated/service_role (20261119000100), so a reissue for an already
    // closed sitting is performed by the database owner, exactly as the
    // settlement wrapper does internally.
    let next: string;
    try {
      // Owner identity on the claim, but not the `authenticated` role: the grant
      // to authenticated is revoked (20261119000100), while the helper's own
      // membership check still judges the actor.
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      next = (await db.query('select issue_closed_session_receipt($1,$2) id',
        [sitting, JSON.stringify({ ...BUYER, name: 'Share Buyer LLP' })])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    expect(next).not.toBe(invoiceId);
    const documents = (await db.query('select id, status, sequence_number, totals_snapshot, supersedes_invoice_id from restaurant_invoices where order_session_id=$1 order by sequence_number', [sitting])).rows;
    expect(documents.map((d) => [d.id, d.status, d.sequence_number, d.supersedes_invoice_id]))
      .toEqual([[invoiceId, 'voided', 1, null], [next, 'issued', 2, invoiceId]]);
    expect(documents[0].totals_snapshot).toEqual(documents[1].totals_snapshot);
    expect((await db.query('select count(*)::int n from payments where restaurant_id=$1', [restaurant])).rows[0].n).toBe(1);
    const report = (await asRole(user, (c) => c.query("select document_status, total_paise from report_gst_documents($1,now()-interval '1 day',now()+interval '1 day')", [restaurant]))).rows;
    expect(report).toEqual([{ document_status: 'issued', total_paise: '10500' }, { document_status: 'voided', total_paise: '10500' }]);
  }, 20000);

  it('the reconciliation view surfaces the pending IRP document with its attempt count', async () => {
    const user = randomUUID(); const slug = `${slugBase}-recon-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Recon View Pvt Ltd', trade_name: 'Recon',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ ...BUYER, name: 'Recon Buyer LLP' })])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const before = (await db.query('select irp_status, is_b2b, attempt_count, last_attempt_at from public.list_restaurant_irp_reconciliation() where invoice_id=$1', [invoiceId])).rows[0];
    expect(before.irp_status).toBe('pending');
    expect(before.is_b2b).toBe(true);
    expect(before.attempt_count).toBe(0);
    expect(before.last_attempt_at).toBeNull();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      await db.query("select record_restaurant_irp_request($1,'sandbox','v1','submitted','aa',null)", [invoiceId]);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const after = (await db.query('select attempt_count, last_attempt_at from public.list_restaurant_irp_reconciliation() where invoice_id=$1', [invoiceId])).rows[0];
    expect(after.attempt_count).toBe(1);
    expect(after.last_attempt_at).not.toBeNull();
  }, 20000);

  it('alcohol blocks Composition activation at the database, and the reverse path is gated too', async () => {
    const user = randomUUID(); const slug = `${slugBase}-alg-${randomUUID().slice(0,4)}`;
    const { restaurant, item } = await makeRestaurant(slug, user);
    await db.query('update items set is_alcoholic = true where id = $1', [item]);
    // activating composition with an alcoholic item must be refused by the trigger
    await expect(setGstConfig(restaurant, {
      mode: 'composition', gstin: syntheticGstin('29AAAAA0000A1Z'), legal_name: 'Alcohol Composition Co',
      address: 'Composition Lane, Nagpur', state_code: '29', pan: 'AAAAA0000A',
      registration_type: 'composition', composition_acknowledged: true,
    })).rejects.toThrow(/alcoholic/i);
    // and activating composition first blocks flagging the item afterwards
    await db.query('update items set is_alcoholic = false where id = $1', [item]);
    await setGstConfig(restaurant, {
      mode: 'composition', gstin: syntheticGstin('29BBBBB1111B1Z'), legal_name: 'Alcohol Composition Co',
      address: 'Composition Lane, Nagpur', state_code: '29', pan: 'BBBBB1111B',
      registration_type: 'composition', composition_acknowledged: true,
    });
    await expect(db.query('update items set is_alcoholic = true where id = $1', [item])).rejects.toThrow(/Composition Scheme/i);
    // inserting a new alcoholic item is refused too
    const category = (await db.query('select id from categories where restaurant_id=$1', [restaurant])).rows[0].id;
    await expect(db.query(
      `insert into items(restaurant_id,category_id,name,price_paise,is_available,is_alcoholic) values($1,$2,'Wine',15000,true,true)`,
      [restaurant, category])).rejects.toThrow(/Composition Scheme/i);
  }, 20000);

  it('e-invoice issuance profile: columns store, validate and mirror into history', async () => {
    const user = randomUUID(); const slug = `${slugBase}-eirp-${randomUUID().slice(0,4)}`;
    const { restaurant, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Issuance Profile Pvt Ltd', trade_name: 'Issuance',
      address: 'Profile House, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000,
      einvoice_location: 'Nagpur', einvoice_pincode: '440001', einvoice_hsn_sac: '996331',
    });
    const row = (await db.query('select einvoice_location, einvoice_pincode, einvoice_hsn_sac from restaurant_gst_config where restaurant_id=$1', [restaurant])).rows[0];
    expect([row.einvoice_location, row.einvoice_pincode, row.einvoice_hsn_sac]).toEqual(['Nagpur', '440001', '996331']);
    const hist = (await db.query('select einvoice_location, einvoice_pincode, einvoice_hsn_sac from restaurant_gst_config_history where restaurant_id=$1 order by config_version desc limit 1', [restaurant])).rows[0];
    expect([hist.einvoice_location, hist.einvoice_pincode, hist.einvoice_hsn_sac]).toEqual(['Nagpur', '440001', '996331']);
    // invalid PIN and HSN are refused by the database, not just the form
    await expect(setGstConfig(restaurant, { einvoice_pincode: '011001' })).rejects.toThrow();
    await expect(setGstConfig(restaurant, { einvoice_hsn_sac: 'ABC' })).rejects.toThrow();
    await expect(setGstConfig(restaurant, { einvoice_hsn_sac: '123' })).rejects.toThrow();
    await expect(setGstConfig(restaurant, { einvoice_location: 'x' })).rejects.toThrow();
  }, 20000);

  it('records an explicit Specified Premises effective date and expires the proof at the FY boundary', async () => {
    const user = randomUUID(); const slug = `${slugBase}-eff-${randomUUID().slice(0,4)}`;
    const { restaurant, gstin } = await makeRestaurant(slug, user);
    const effective = `${currentFy()}-04-01`;
    await expect(asRole(user, (c) => save(c, restaurant, 0, { ...specified(gstin), specified_premises_effective_from: null })))
      .rejects.toMatchObject({ code: '23514' });
    await asRole(user, (c) => save(c, restaurant, 0, specified(gstin, effective)));
    const profileOn = (date: string) => db.query('select * from gst_pricing_at($1,$2)', [restaurant, date]);
    expect((await profileOn(indiaToday())).rows[0].rate_bps).toBe(1800);
    if (effective !== indiaToday()) await expect(profileOn(effective)).rejects.toThrow(/not active on the supply date/i);
    await expect(profileOn(`${currentFy() + 1}-04-01`)).rejects.toThrow(/review its GST settings/i);
    const boundary = (await db.query(`select gst_financial_year_start(('2027-03-31T18:29:59Z'::timestamptz at time zone 'Asia/Kolkata')::date) before,
      gst_financial_year_start(('2027-03-31T18:30:00Z'::timestamptz at time zone 'Asia/Kolkata')::date) after`)).rows[0];
    expect(boundary).toEqual({ before: 2026, after: 2027 });
    const row = (await db.query('select specified_premises_effective_from::text as eff, premises_evidence from restaurant_gst_config_history where restaurant_id=$1', [restaurant])).rows[0];
    expect(row).toEqual({ eff: effective, premises_evidence: premisesEvidence() });
  }, 20000);

  it('allows only the outlet owner through the versioned settings RPC, and records the declaration and actor', async () => {
    const owner = randomUUID();
    const slug = `${slugBase}-save`;
    const { restaurant, gstin } = await makeRestaurant(slug, owner);
    const other = await makeRestaurant(`${slugBase}-other`, randomUUID());
    const staff: Record<string, string> = {};
    for (const role of ['manager', 'cashier', 'kitchen']) {
      const user = staff[role] = randomUUID();
      await db.query('insert into profiles(id) values($1)', [user]);
      await db.query('insert into memberships(restaurant_id,user_id,role) values($1,$2,$3)', [restaurant, user, role]);
      await expect(asRole(user, (c) => save(c, restaurant, 0, OFF))).rejects.toMatchObject({ code: '42501' });
    }
    await expect(asRole(owner, (c) => save(c, other.restaurant, 0, OFF))).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(null, (c) => save(c, restaurant, 0, OFF), 'anon')).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(owner, (c) => save(c, restaurant, 0, OFF), 'service_role')).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(owner, (c) => c.query("insert into restaurant_gst_config(restaurant_id,mode,off_declared) values($1,'off',true)", [restaurant])))
      .rejects.toMatchObject({ code: '42501' });
    for (const input of [{ mode: 'off' }, { ...OFF, off_has_obligation: true }, { ...OFF, off_declared: 'true' }]) {
      await expect(asRole(owner, (c) => save(c, restaurant, 0, input))).rejects.toMatchObject({ code: '23514' });
    }
    expect((await db.query('select count(*)::int n from restaurant_gst_config where restaurant_id=$1', [restaurant])).rows[0].n).toBe(0);
    expect(await asRole(owner, (c) => save(c, restaurant, 0, { ...OFF, restaurant_id: other.restaurant, config_version: 99, updated_by: staff.manager }))).toBe(1);
    await expect(asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)))).rejects.toThrow(/reload before saving/i);
    await expect(asRole(owner, (c) => c.query("update restaurant_gst_config set mode='composition' where restaurant_id=$1", [restaurant])))
      .rejects.toMatchObject({ code: '42501' });
    const history = (c: Client) => c.query('select mode,off_declared,off_declared_at,changed_by,config_version from restaurant_gst_config_history where restaurant_id=$1', [restaurant]);
    const row = (await asRole(staff.manager, history)).rows[0];
    expect(row).toMatchObject({ mode: 'off', off_declared: true, changed_by: owner, config_version: 1 });
    expect(row.off_declared_at).not.toBeNull();
    for (const user of [staff.kitchen, staff.cashier]) {
      expect((await asRole(user, history)).rowCount).toBe(0);
      expect((await asRole(user, (c) => c.query('select gstin from restaurant_gst_config where restaurant_id=$1', [restaurant]))).rowCount).toBe(0);
    }
    await expect(asRole(owner, (c) => c.query('select * from gst_pricing($1)', [other.restaurant]))).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(null, (c) => c.query('select * from restaurant_gst_config', []), 'anon')).rejects.toMatchObject({ code: '42501' });
    await db.query("update restaurants set trial_started_at=now()-interval '30 days' where id=$1", [restaurant]);
    await expect(asRole(owner, (c) => save(c, restaurant, 1, regular(gstin)))).rejects.toThrow(/read-only/i);
  });

  it('requires outlet membership (not account ownership) for GST configuration, history and reports', async () => {
    const leftOwner = randomUUID(); const rightOwner = randomUUID(); const stranger = randomUUID();
    const left = await makeRestaurant(`${slugBase}-left`, leftOwner);
    const right = await makeRestaurant(`${slugBase}-right`, rightOwner);
    const foreign = await makeRestaurant(`${slugBase}-foreign`, stranger);
    const unassigned = randomUUID();
    await db.query('insert into profiles(id) values ($1)', [unassigned]);
    const account = (await db.query('insert into accounts(owner_id) values ($1) returning id', [leftOwner])).rows[0].id;
    await db.query('update restaurants set account_id=$1 where id in ($2,$3)', [account, left.restaurant, right.restaurant]);
    for (const [user, outlet] of [[leftOwner, left], [rightOwner, right], [stranger, foreign]] as const) {
      expect(await asRole(user, (c) => save(c, outlet.restaurant, 0, regular(outlet.gstin)))).toBe(1);
    }
    const read = (c: Client) => c.query(`select restaurant_id, gstin, config_version from restaurant_gst_config`);
    const history = (c: Client) => c.query(`select restaurant_id, gstin, config_version from restaurant_gst_config_history`);
    for (const [user, outlet] of [[leftOwner, left], [rightOwner, right], [stranger, foreign]] as const) {
      const onlyOwn = [{ restaurant_id: outlet.restaurant, gstin: outlet.gstin, config_version: 1 }];
      expect((await asRole(user, read)).rows).toEqual(onlyOwn);
      expect((await asRole(user, history)).rows).toEqual(onlyOwn);
    }
    expect((await asRole(unassigned, read)).rows).toEqual([]);
    expect((await asRole(unassigned, history)).rows).toEqual([]);
    for (const [actor, outlet] of [[leftOwner, right], [rightOwner, left], [stranger, left], [leftOwner, foreign], [unassigned, left], [null, left]] as const) {
      await expect(asRole(actor, (c) => save(c, outlet.restaurant, 1, OFF))).rejects.toMatchObject({ code: '42501' });
      await expect(asRole(actor, (c) => c.query(`select * from report_gst_documents(
        $1, statement_timestamp()-interval '1 day', statement_timestamp())`, [outlet.restaurant])))
        .rejects.toMatchObject({ code: '42501' });
    }
    for (const table of ['restaurant_gst_config', 'restaurant_gst_config_history']) {
      // Even an authorized owner cannot edit or erase history via table writes.
      await expect(asRole(leftOwner, (c) => c.query(`delete from ${table} where restaurant_id=$1`, [left.restaurant])))
        .rejects.toMatchObject({ code: '42501' });
      await expect(asRole(null, (c) => c.query(`select * from ${table}`), 'anon')).rejects.toMatchObject({ code: '42501' });
      const acl = (await db.query(`select relrowsecurity,
          has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE, TRUNCATE') as client_write,
          has_table_privilege('service_role', oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') as service_access
        from pg_class where oid = $1::regclass`, [`public.${table}`])).rows[0];
      expect(acl).toEqual({ relrowsecurity: true, client_write: false, service_access: false });
    }
    expect((await db.query(`select count(*)::int n from restaurant_gst_config_history where restaurant_id=any($1)`,
      [[left.restaurant, right.restaurant, foreign.restaurant]])).rows[0].n).toBe(3);
  });

  it('exposes only slug-scoped quote treatment/rate; DB validates GSTIN, acknowledgment and specified-premises date', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-quote`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => c.query('update restaurants set tax_rate_bps = 1200 where id=$1', [restaurant]));
    const quote = (s = slug) => asRole(null, (c) => c.query('select * from public_order_pricing($1)', [s]), 'anon').then(({ rows }) => rows);
    expect(await quote()).toEqual([{ tax_treatment: 'exclusive', tax_rate_bps: 1200 }]);
    expect(await quote('missing-outlet')).toEqual([]);
    const wrongChecksum = gstin.slice(0, 14) + (gstin.endsWith('Z') ? '0' : 'Z');
    for (const invalid of [regular(wrongChecksum), { ...composition(gstin), composition_acknowledged: false },
      { ...regular(gstin), regular_profile: 'custom' }, { ...regular(gstin), registration_type: 'composition' },
      specified(gstin, '2025-03-31'), specified(gstin, '2099-01-01'), { ...specified(gstin, '2025-04-01'), specified_premises_attested: false }]) {
      await expect(asRole(owner, (c) => save(c, restaurant, 0, invalid))).rejects.toMatchObject({ code: '23514' });
    }
    expect(await asRole(owner, (c) => save(c, restaurant, 0, composition(gstin)))).toBe(1);
    expect(await quote()).toEqual([{ tax_treatment: 'none', tax_rate_bps: 0 }]);
    expect(await asRole(owner, (c) => save(c, restaurant, 1, regular(gstin)))).toBe(2);
    expect(await quote()).toEqual([{ tax_treatment: 'inclusive', tax_rate_bps: 500 }]);
    const treatmentStart = `${currentFy()}-04-01`;
    expect(await asRole(owner, (c) => save(c, restaurant, 2, specified(gstin)))).toBe(3);
    expect(await quote()).toEqual([{ tax_treatment: 'inclusive', tax_rate_bps: 1800 }]);
    expect((await db.query('select specified_premises_effective_from::text as effective from restaurant_gst_config_history where restaurant_id=$1 and config_version=3', [restaurant])).rows[0].effective).toBe(treatmentStart);
    await db.query('update items set price_paise=11800 where id=$1', [item]);
    const { order, sitting } = await placeOrder(slug, item, 1);
    const line = (await db.query('select id from order_items where order_id=$1', [order])).rows[0].id;
    const edit = await asRole(owner, (c) => c.query('select set_order_line_quantities($1,$2) result', [order, JSON.stringify([{ line_id: line, qty: 2 }])]));
    expect(edit.rows[0].result).toMatchObject({ total_paise: 23600, tax_paise: 3600 });
    const invoice = await closeAndIssue(owner, sitting);
    expect((await db.query('select gst_snapshot from restaurant_invoices where id=$1', [invoice])).rows[0].gst_snapshot)
      .toMatchObject({ rate_bps: 1800, taxable_paise: 20000, cgst_paise: 1800, sgst_paise: 1800, specified_premises_effective_from: treatmentStart });
    expect(await asRole(owner, (c) => save(c, restaurant, 3, OFF))).toBe(4);
    expect(await quote()).toEqual([{ tax_treatment: 'none', tax_rate_bps: 0 }]);
    await db.query('update restaurants set is_active=false where id=$1', [restaurant]);
    expect(await quote()).toEqual([]);
  });

  it.each([[10510, 500, 1], [10511, 501, -1]])('rounds a %i-paise ticket pair once as a document without changing a payment', async (price, tax, delta) => {
    const owner = randomUUID(); const slug = `${slugBase}-round-${price}`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)));
    await db.query('update items set price_paise=$2 where id=$1', [item, price]);
    const first = await placeOrder(slug, item, 1);
    const second = await placeOrder(slug, item, 1);
    expect(first.sitting).toBe(second.sitting);
    const { sitting } = first;
    const pre = (await db.query('select id,total_paise,tax_paise,gst_mode_snapshot,gst_config_version from orders where order_session_id=$1 order by id', [sitting])).rows;
    expect(pre.map((row) => [Number(row.total_paise), Number(row.tax_paise), row.gst_mode_snapshot, row.gst_config_version]))
      .toEqual([[price, tax, 'regular', 1], [price, tax, 'regular', 1]]);
    expect(computeQuoteTotals([{ unitPricePaise: price, qty: 1 }], 500, 'inclusive')).toMatchObject({ totalPaise: price, taxPaise: tax });
    await expect(asRole(owner, (c) => save(c, restaurant, 1, OFF))).rejects.toThrow(/close all sittings/i);
    await expect(asRole(owner, (c) => c.query('select close_order_session_and_issue_receipt($1)', [sitting]))).rejects.toThrow(/outstanding balance/i);
    await expect(db.query('update orders set discount_paise=1 where id=$1', [first.order])).rejects.toThrow(/discounts/i);
    // Classification is from the time of sale, even after an item's later edit.
    await db.query('update items set is_alcoholic=true, price_paise=99000 where id=$1', [item]);
    const id = await closeAndIssue(owner, sitting, CONSUMER);
    const invoice = (await db.query('select * from restaurant_invoices where id=$1', [id])).rows[0];
    const gross = price * 2;
    expect(invoice.totals_snapshot).toMatchObject({ total_paise: gross, taxable_paise: gross - 1001,
      tax_paise: 1001, cgst_paise: 501, sgst_paise: 500, amount_paid_paise: gross, outstanding_paise: 0,
      ticket_tax_paise: 2 * tax, gst_rounding_delta_paise: delta });
    const noteId = (await asRole(owner, (c) => c.query("select issue_invoice_note($1,'credit_note','other','Synthetic document adjustment') id", [id]))).rows[0].id;
    const manager = randomUUID(); const cashier = randomUUID();
    await db.query('insert into profiles(id) values($1),($2)', [manager, cashier]);
    await db.query("insert into memberships(restaurant_id,user_id,role) values($1,$2,'manager'),($1,$3,'cashier')", [restaurant, manager, cashier]);
    for (const relation of ['restaurant_notes', 'restaurant_note_events']) {
      const notes = (c: Client) => c.query(`select id from ${relation} where restaurant_id=$1`, [restaurant]);
      expect((await asRole(manager, notes)).rowCount).toBe(1);
      expect((await asRole(cashier, notes)).rowCount).toBe(0);
    }
    await expect(asRole(owner, (c) => c.query("select void_restaurant_invoice($1,'Correction requested')", [id]))).rejects.toThrow(/active credit\/debit notes/i);
    expect(await asRole(owner, (c) => save(c, restaurant, 1, OFF))).toBe(2);
    expect((await asRole(owner, (c) => c.query('select close_order_session_and_issue_receipt($1) id', [sitting]))).rows[0].id).toBe(id);
    expect((await db.query('select * from restaurant_invoices where id=$1', [id])).rows[0]).toEqual(invoice);
    expect((await db.query('select id,total_paise,tax_paise,gst_mode_snapshot,gst_config_version from orders where order_session_id=$1 order by id', [sitting])).rows).toEqual(pre);
    const span = "now()-interval '1 day',now()+interval '1 day'";
    const docs = (await asRole(owner, (c) => c.query(`select * from report_gst_documents($1,${span})`, [restaurant]))).rows;
    expect(docs).toMatchObject([
      { document_type: 'credit_note', total_paise: String(gross), cgst_paise: '501', sgst_paise: '500', rounding_delta_paise: null },
      { document_type: 'gst_tax_invoice', rate_bps: 500, total_paise: String(gross), cgst_paise: '501', rounding_delta_paise: String(delta) },
    ]);
    expect((await db.query('select total_paise,cgst_paise,sgst_paise from restaurant_notes where id=$1', [noteId])).rows[0])
      .toEqual({ total_paise: String(gross), cgst_paise: '501', sgst_paise: '500' });
    const sales = (await asRole(owner, (c) => c.query(`select report_sales($1,${span})->'totals' totals`, [restaurant]))).rows[0].totals;
    expect(sales).toMatchObject({ billed_paise: gross, collected_paise: gross, refunded_paise: 0, tax_paise: tax * 2 });
  });

  it.each(['off', 'same-rate identity change', '18%'])('refuses legacy configuration drift (%s) without losing money or numbering', async (change) => {
    const owner = randomUUID(); const slug = `${slugBase}-drift-${change.replaceAll(/[^a-z0-9]+/g, '')}`;
    const { restaurant, gstin, item, pan } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)));
    const { sitting } = await placeOrder(slug, item, 1);
    // Simulate data from older writer permissions. No supported client can
    // do this through the new settings RPC while a ticket is active.
    await setGstConfig(restaurant, change === 'off' ? OFF_DB_ROW : {
      ...(change === '18%' ? specified(gstin) : regular(gstin)),
      legal_name: 'Different registration snapshot', pan, state_code: '27',
    });
    await expect(placeOrder(slug, item, 1)).rejects.toThrow(/different GST configuration/i);
    await expect(closeAndIssue(owner, sitting)).rejects.toThrow(/different GST configuration/i);
    expect((await db.query('select status,closed_at from order_sessions where id=$1', [sitting])).rows[0]).toEqual({ status: 'open', closed_at: null });
    expect((await db.query('select count(*)::int n from restaurant_invoice_series where restaurant_id=$1', [restaurant])).rows[0].n).toBe(0);
    expect((await db.query('select status,amount_paise from payments where restaurant_id=$1', [restaurant])).rows)
      .toEqual([{ status: 'recorded', amount_paise: '10500' }]);
  });

  it.each(['settings first', 'alcohol first'])('serializes Composition and alcoholic classification (%s)', async (first) => {
    const owner = randomUUID(); const slug = `${slugBase}-race-${first.split(' ')[0]}`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    const conn = new Client({ connectionString: URL_VALUE });
    await conn.connect();
    const flagAlcohol = (c: Client) => c.query('update items set is_alcoholic=true where id=$1', [item]);
    const chooseComposition = (c: Client) => save(c, restaurant, 0, composition(gstin));
    const settingsFirst = first === 'settings first';
    let contender: Promise<unknown> | undefined;
    try {
      await asRole(owner, async (c) => {
        if (settingsFirst) await chooseComposition(c); else await flagAlcohol(c);
        const pid = (await conn.query('select pg_backend_pid() pid')).rows[0].pid;
        contender = asRole<unknown>(owner, (other) => settingsFirst ? flagAlcohol(other) : chooseComposition(other), 'authenticated', conn)
          .then(() => null, (error) => error);
        await expect.poll(async () => (await c.query('select cardinality(pg_blocking_pids($1)) > 0 blocked', [pid])).rows[0].blocked,
          { timeout: 4000 }).toBe(true);
      });
      expect(await contender).toMatchObject({ code: '23514' });
      expect((await db.query('select i.is_alcoholic,c.mode from items i left join restaurant_gst_config c using (restaurant_id) where i.id=$1', [item])).rows[0])
        .toEqual(settingsFirst ? { is_alcoholic: false, mode: 'composition' } : { is_alcoholic: true, mode: null });
    } finally {
      await contender;
      await conn.end();
    }
  });


  it('keeps an IRN-held invoice private even if an old link had already been minted', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-hold-share`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)));
    const { sitting } = await placeOrder(slug, item, 1);
    await asRole(owner, (c) => c.query('select mark_order_session_paid($1)', [sitting]));
    const invoice = (await asRole(owner, (c) => c.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id',
      [sitting, JSON.stringify({ ...BUYER, name: 'Synthetic B2B buyer' })]))).rows[0].id;
    expect((await db.query('select irp_status,irn from restaurant_invoices where id=$1', [invoice])).rows[0]).toEqual({ irp_status: 'pending', irn: null });
    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await expect(asRole(owner, (c) => c.query('select * from create_restaurant_invoice_share_link($1,$2)', [invoice, tokenHash]))).rejects.toThrow(/on IRN hold/i);
    // Model an already minted link from the previous schema, not an allowed write by a client.
    await db.query("insert into restaurant_invoice_share_links(restaurant_id,invoice_id,created_by,token_hash,expires_at) values($1,$2,$3,$4,now()+interval '24 hours')", [restaurant, invoice, owner, tokenHash]);
    expect((await asRole(null, (c) => c.query('select read_shared_restaurant_invoice($1) payload', [tokenHash]), 'anon')).rows[0].payload).toBeNull();
    expect((await db.query('select access_count from restaurant_invoice_share_links where token_hash=$1', [tokenHash])).rows[0].access_count).toBe('0');
    const rows = (await asRole(owner, (c) => c.query("select * from report_gst_documents($1,now()-interval '1 day',now()+interval '1 day')", [restaurant]))).rows;
    expect(rows).toMatchObject([{ document_type: 'gst_tax_invoice', irn_held: true, total_paise: '10500' }]);
  });

  it('does not let a direct issue or legacy surplus on another ticket skip GST settlement', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-unsettled`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)));
    const first = await placeOrder(slug, item, 1);
    const second = await placeOrder(slug, item, 1);
    expect(first.sitting).toBe(second.sitting);
    await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise) values($1,$2,'cash','recorded',21000)", [restaurant, first.order]);
    const checkout = () => asRole(owner, (c) => c.query('select close_order_session_and_issue_receipt($1)', [first.sitting]));
    await expect(checkout()).rejects.toThrow(/outstanding balance/i);
    // Only simulating an older writer that already closed the sitting.
    await db.query("update order_sessions set status='closed',closed_at=now() where id=$1", [first.sitting]);
    // An owner can no longer reach the helper directly at all — the grant is
    // gone (20261119000100) — which is a stricter boundary than the settlement
    // check the helper used to perform for callers it admitted.
    await expect(asRole(owner, (c) => c.query('select issue_closed_session_receipt($1)', [first.sitting])))
      .rejects.toThrow(/permission denied for function issue_closed_session_receipt/i);
    // The settlement gate itself is unchanged and still refuses through the wrapper.
    await expect(checkout()).rejects.toThrow(/outstanding balance/i);
    expect((await db.query('select count(*)::int n from restaurant_invoice_series where restaurant_id=$1', [restaurant])).rows[0].n).toBe(0);
    expect((await db.query('select order_id,amount_paise from payments where restaurant_id=$1', [restaurant])).rows).toEqual([{ order_id: first.order, amount_paise: '21000' }]);
  });

  it('includes the selected portion and add-on exactly once in both the quote and the GST document', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-modifiers`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)));
    const variant = (await db.query("insert into item_variants(item_id,name,price_paise) values($1,'Large',11500) returning id", [item])).rows[0].id;
    const group = (await db.query("insert into item_addon_groups(item_id,name) values($1,'Extra') returning id", [item])).rows[0].id;
    const addon = (await db.query("insert into item_addons(group_id,name,price_paise) values($1,'Cheese',500) returning id", [group])).rows[0].id;
    const line = { itemId: item, variantId: variant, addonIds: [addon], qty: 2 };
    const quote = priceCart([line], [{ id: item, name: 'Plate', isVeg: true, isAvailable: true, pricePaise: 10500,
      variants: [{ id: variant, name: 'Large', pricePaise: 11500 }], addons: [{ id: addon, name: 'Cheese', groupId: group, pricePaise: 500, maxSelect: 1 }],
    }], 500, 'inclusive');
    expect(quote.totals).toMatchObject({ totalPaise: 24000, taxablePaise: 22857, taxPaise: 1143 });
    const { order, sitting } = await placeOrder(slug, item, line.qty, line);
    expect((await db.query('select total_paise,tax_paise from orders where id=$1', [order])).rows[0]).toEqual({ total_paise: '24000', tax_paise: '1143' });
    const invoice = await closeAndIssue(owner, sitting);
    expect((await db.query('select line_snapshot from restaurant_invoice_lines where invoice_id=$1', [invoice])).rows[0].line_snapshot)
      .toMatchObject({ variant: 'Large', addons: ['Cheese'], unit_price_paise: 12000, amount_paise: 24000 });
  });

  it('classifies imported draft items through the same Composition gate and does not allow publishing to bypass order admission', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-draft-alcohol`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    const draft = (await db.query("insert into menus(restaurant_id,name,is_published) values($1,'Imported menu',false) returning id", [restaurant])).rows[0].id;
    const section = (await db.query("insert into categories(restaurant_id,menu_id,name) values($1,$2,'Synthetic drinks') returning id", [restaurant, draft])).rows[0].id;
    const importBatch = (c: Client) => c.query(
      "insert into items(restaurant_id,category_id,name,price_paise,is_alcoholic,is_available) values($1,$2,'Stock A',11000,false,true),($1,$2,'Stock B',12000,true,true) returning id,is_alcoholic", [restaurant, section],
    );
    await asRole(owner, (c) => save(c, restaurant, 0, composition(gstin)));
    await expect(asRole(owner, importBatch)).rejects.toThrow(/Composition Scheme.*alcoholic/i);
    expect((await db.query('select count(*)::int n from items where category_id=$1', [section])).rows[0].n).toBe(0);
    await asRole(owner, (c) => save(c, restaurant, 1, regular(gstin)));
    const [plain, alcoholic] = (await asRole(owner, importBatch)).rows;
    expect([plain.is_alcoholic, alcoholic.is_alcoholic]).toEqual([false, true]);
    await expect(placeOrder(slug, plain.id, 1)).rejects.toThrow(/none of those dishes are available/i);
    const brand = (await db.query(`insert into restaurant_brand_profiles(restaurant_id,import_id,status,name,theme,menu_id)
      values($1,$2,'draft','GST catalog fixture','{"accent":"forest"}'::jsonb,$3) returning id`, [restaurant, randomUUID(), draft])).rows[0].id;
    const published = await asRole(owner, (c) => c.query('select publish_menu_brand_pair($1,$2) result', [draft, brand]));
    expect(published.rows[0].result).toMatchObject({ ok: true, already: false });
    await expect(placeOrder(slug, alcoholic.id, 1)).rejects.toThrow(/alcoholic/i);
    const { sitting } = await placeOrder(slug, item, 1);
    expect((await asRole(null, (c) => c.query('select id from items where id=$1', [plain.id]), 'anon')).rowCount).toBe(1);
    await closeAndIssue(owner, sitting);
    await expect(asRole(owner, (c) => save(c, restaurant, 2, composition(gstin)))).rejects.toThrow(/alcoholic items/i);
    // Removing the classified item allows the outlet to change mode, but an
    // older publish snapshot cannot quietly reintroduce it under Composition.
    await asRole(owner, (c) => c.query('delete from items where id=$1', [alcoholic.id]));
    expect(await asRole(owner, (c) => save(c, restaurant, 2, composition(gstin)))).toBe(3);
    const rollback = () => asRole(owner, (c) => c.query('select rollback_last_publish($1) result', [restaurant]));
    await expect(rollback()).rejects.toThrow(/Composition Scheme.*alcoholic/i);
    expect((await db.query('select is_published from menus where id=$1', [draft])).rows[0].is_published).toBe(true);
    expect((await db.query('select name from restaurants where id=$1', [restaurant])).rows[0].name).toBe('GST catalog fixture');
    expect(await asRole(owner, (c) => save(c, restaurant, 3, regular(gstin)))).toBe(4);
    expect((await rollback()).rows[0].result).toMatchObject({ ok: true, already: false });
    expect((await db.query('select is_alcoholic from items where id=$1', [alcoholic.id])).rows[0].is_alcoholic).toBe(true);
    expect((await db.query('select is_published from menus where id=$1', [draft])).rows[0].is_published).toBe(false);
  });

  it.each(['owner demotion', 'account expiry'])('rechecks authorization after %s while a save waits', async (change) => {
    const owner = randomUUID();
    const { restaurant, gstin } = await makeRestaurant(`${slugBase}-${change.split(' ')[0]}`, owner);
    const account = (await db.query('insert into accounts(owner_id) values ($1) returning id', [owner])).rows[0].id;
    await db.query('update restaurants set account_id=$1 where id=$2', [account, restaurant]);
    const contender = new Client({ connectionString: URL_VALUE });
    await contender.connect();
    const pid = (await contender.query('select pg_backend_pid() pid')).rows[0].pid;
    let pending: Promise<unknown> | undefined;
    try {
      await db.query('begin');
      try {
        await db.query("select pg_advisory_xact_lock(hashtextextended('gst-outlet:' || $1, 0))", [restaurant]);
        pending = asRole(owner, (c) => save(c, restaurant, 0, regular(gstin)), 'authenticated', contender)
          .then(() => null, (error) => error);
        await expect.poll(async () => (await db.query('select cardinality(pg_blocking_pids($1)) > 0 blocked', [pid])).rows[0].blocked,
          { timeout: 4000 }).toBe(true);
        // Commit the entitlement/role change before the blocked write resumes.
        if (change === 'owner demotion') {
          await db.query("update memberships set role='manager' where restaurant_id=$1 and user_id=$2", [restaurant, owner]);
        } else {
          await db.query("update accounts set trial_started_at=now()-interval '30 days', trial_ends_at=now()-interval '9 days' where id=$1", [account]);
        }
        await db.query('commit');
      } catch (error) {
        await db.query('rollback');
        throw error;
      }
      expect(await pending).toMatchObject(change === 'owner demotion' ? { code: '42501' } : { code: 'P0001', message: expect.stringMatching(/read-only/i) });
      for (const table of ['restaurant_gst_config', 'restaurant_gst_config_history']) {
        expect((await db.query(`select 1 from ${table} where restaurant_id=$1`, [restaurant])).rowCount).toBe(0);
      }
    } finally {
      await pending;
      await contender.end();
    }
  });

  it('refuses a guest ticket priced before a competing settings save; requires a fresh quote', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-quote-race`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    const { public_token: qr } = (await db.query('select public_token from table_qr_codes where restaurant_id=$1 and revoked_at is null limit 1', [restaurant])).rows[0];
    const token = (await asRole(null, (c) => c.query('select session_token from open_table_session($1,$2)', [qr, 'c'.repeat(64)]), 'anon')).rows[0].session_token;
    const conn = new Client({ connectionString: URL_VALUE });
    await conn.connect();
    const pid = (await conn.query('select pg_backend_pid() pid')).rows[0].pid;
    const place = () => asRole(null, (c) => c.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4::uuid,null) result',
      [slug, JSON.stringify([{ itemId: item, qty: 1 }]), token, randomUUID()]).then(({ rows }) => rows[0].result), 'anon', conn);
    let pending: ReturnType<typeof place> | undefined;
    try {
      await asRole(owner, async (c) => {
        expect(await save(c, restaurant, 0, regular(gstin))).toBe(1);
        pending = place();
        // Wait for a real conflicting lock, not an arbitrary scheduling delay.
        await expect.poll(async () => (await c.query('select cardinality(pg_blocking_pids($1)) > 0 blocked', [pid])).rows[0].blocked,
          { timeout: 4000 }).toBe(true);
      });
      expect(await pending).toMatchObject({ code: null, error: { code: 'P0001', message: expect.stringMatching(/settings changed/i) } });
      expect((await db.query('select 1 from orders where restaurant_id=$1', [restaurant])).rowCount).toBe(0);
      expect(await place()).toMatchObject({ code: expect.any(String), error: null });
      expect((await db.query('select gst_mode_snapshot,gst_config_version,total_paise,tax_paise from orders where restaurant_id=$1', [restaurant])).rows)
        .toEqual([{ gst_mode_snapshot: 'regular', gst_config_version: 1, total_paise: '10500', tax_paise: '500' }]);
      await expect(asRole(owner, (c) => save(c, restaurant, 1, OFF))).rejects.toThrow(/active tickets/i);
    } finally {
      await pending;
      await conn.end();
    }
  });

  it('serializes two saves from the same settings form version', async () => {
    const owner = randomUUID();
    const { restaurant, gstin } = await makeRestaurant(`${slugBase}-stale-save`, owner);
    const conn = new Client({ connectionString: URL_VALUE });
    await conn.connect();
    const pid = (await conn.query('select pg_backend_pid() pid')).rows[0].pid;
    let contender: Promise<unknown> | undefined;
    try {
      await asRole(owner, async (c) => {
        expect(await save(c, restaurant, 0, regular(gstin))).toBe(1);
        contender = asRole(owner, (other) => save(other, restaurant, 0, OFF), 'authenticated', conn).then(() => null, (error) => error);
        await expect.poll(async () => (await c.query('select cardinality(pg_blocking_pids($1)) > 0 blocked', [pid])).rows[0].blocked,
          { timeout: 4000 }).toBe(true);
      });
      expect(await contender).toMatchObject({ message: expect.stringMatching(/reload before saving/i) });
      expect((await db.query('select config_version,mode,changed_by from restaurant_gst_config_history where restaurant_id=$1', [restaurant])).rows)
        .toEqual([{ config_version: 1, mode: 'regular', changed_by: owner }]);
    } finally {
      await contender;
      await conn.end();
    }
  });


  it('validates FSSAI, derives the approved profile boundary, and accepts either hotel evidence route', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-ca-profile`;
    const { restaurant, gstin } = await makeRestaurant(slug, owner);
    const write = (v: number, input: Record<string, unknown>) => asRole(owner, (c) => save(c, restaurant, v, input));
    const quote = () => asRole(null, (c) => c.query('select * from public_order_pricing($1)', [slug]), 'anon').then(r => r.rows[0]);
    const optIn = {
      basis: 'opt_in', reference: 'Synthetic reviewed filing', treatment_fy_start: currentFy(),
      filed_on: `${currentFy()}-03-31`, filing_from: `${currentFy()}-01-01`, filing_through: `${currentFy()}-03-31`,
    };
    for (const invalid of [
      { ...regular(gstin), fssai_number: undefined },
      { ...regular(gstin), fssai_number: '0123456789012' },
      { ...composition(gstin), fssai_number: '0123456789012X' },
      { ...OFF, fssai_number: 12345678901234 },
      { ...OFF, gstin },
      { ...regular(gstin), gstin: gstin.slice(0, 14) },
      { ...regular(gstin), business_type: null },
      { ...regular(gstin), service_sac: '1234' },
      { ...specified(gstin), business_type: 'standalone' },
      { ...specified(gstin), premises_evidence: null },
      { ...specified(gstin), premises_evidence: { ...premisesEvidence(), room_value_paise: 750000 } },
      { ...specified(gstin), premises_evidence: { ...premisesEvidence(), room_supply_fy_start: currentFy() } },
      { ...specified(gstin), premises_evidence: { ...optIn, filed_on: `${currentFy()}-04-02` } },
      { ...specified(gstin), premises_evidence: { ...optIn, reference: '' } },
    ]) {
      await expect(write(0, invalid)).rejects.toMatchObject({ code: '23514' });
    }
    expect((await db.query('select count(*)::int n from restaurant_gst_config_history where restaurant_id=$1', [restaurant])).rows[0].n).toBe(0);
    expect(await write(0, regular(gstin))).toBe(1);
    expect(await quote()).toEqual({ tax_treatment: 'inclusive', tax_rate_bps: 500 });
    expect(await write(1, { ...regular(gstin), business_type: 'hotel', activation: activation({ hotel_review:{treatment_fy:currentFy(),room_fy:currentFy()-1,reference:'Synthetic prior room records',confirmed:true,room_basis:'actual',max_room_paise:750000,declaration_status:'none_in_force'} }) })).toBe(2);
    expect(await quote()).toEqual({ tax_treatment: 'inclusive', tax_rate_bps: 500 });
    expect(await write(2, specified(gstin))).toBe(3);
    expect(await quote()).toEqual({ tax_treatment: 'inclusive', tax_rate_bps: 1800 });
    expect(await write(3, { ...specified(gstin), premises_evidence: optIn,
      activation: activation({ declaration_route:'annexure_vii', declaration_fy: currentFy() }) })).toBe(4);
    expect(await quote()).toEqual({ tax_treatment: 'inclusive', tax_rate_bps: 1800 });
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      await expect(asRole(owner, (c) => c.query('select * from gst_pricing_at($1,$2)', [restaurant, indiaToday()]), role)).rejects.toMatchObject({ code: '42501' });
    }
    expect((await db.query('select gstin, fssai_number, business_type, premises_evidence from restaurant_gst_config_history where restaurant_id=$1 and config_version=4', [restaurant])).rows[0])
      .toEqual({ gstin, fssai_number: SYNTHETIC_FSSAI, business_type: 'hotel', premises_evidence: optIn });
  });

  it('issues a qualified 18% tax invoice with its paid gross, SAC and saved place of supply', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-qualified-issue`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => save(c, restaurant, 0, specified(gstin)));
    const shortYear = (year: number) => String(year % 100).padStart(2, '0');
    const priorFy = `${shortYear(currentFy() - 1)}-${shortYear(currentFy())}`;
    // Model an already-populated prior-year counter; issue dates are never caller inputs.
    await db.query("insert into restaurant_invoice_series(restaurant_id,financial_year,series_code,next_number) values($1,$2,'INV',7)", [restaurant, priorFy]);
    const { order, sitting } = await placeOrder(slug, item, 1);
    expect((await db.query('select total_paise,tax_paise,tax_rate_bps_snapshot from orders where id=$1', [order])).rows[0])
      .toEqual({ total_paise: '10500', tax_paise: '1602', tax_rate_bps_snapshot: 1800 });
    const id = await closeAndIssue(owner, sitting);
    const invoice = (await db.query('select * from restaurant_invoices where id=$1', [id])).rows[0];
    expect(invoice).toMatchObject({
      series_code: 'INV', document_type: 'gst_tax_invoice', irp_status: 'not_required',
      sequence_number: 1, financial_year: `${shortYear(currentFy())}-${shortYear(currentFy() + 1)}`,
      seller_snapshot: { fssai_number: SYNTHETIC_FSSAI, gstin },
      gst_snapshot: { service_sac: SYNTHETIC_SERVICE_SAC, regular_profile: 'specified_premises', rate_bps: 1800,
        taxable_paise: 8898, cgst_paise: 801, sgst_paise: 801, igst_paise: 0, place_of_supply_state_code: '27' },
      totals_snapshot: { total_paise: 10500, amount_paid_paise: 10500, gst_rounding_delta_paise: 0 },
    });
    expect(invoice.gst_snapshot).not.toHaveProperty('premises_evidence');
    expect((await db.query('select next_number from restaurant_invoice_series where restaurant_id=$1 and financial_year=$2', [restaurant, priorFy])).rows[0].next_number).toBe(7);
  });

  it('allocates independent sequences concurrently, reserves voided numbers, and resumes GST without repricing', async () => {
    const owner = randomUUID(); const slug = `${slugBase}-ca-series`;
    const { restaurant, gstin, item } = await makeRestaurant(slug, owner);
    await asRole(owner, (c) => c.query('update restaurants set tax_rate_bps=1200 where id=$1', [restaurant]));
    const table = (await db.query("insert into dining_tables(restaurant_id,label) values($1,'G2') returning id", [restaurant])).rows[0].id;
    const tableToken = randomBytes(32).toString('hex');
    await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)', [restaurant, table, tableToken]);
    const numberRe = /^[A-Z0-9/-]{1,16}$/;
    const readInvoice = async (id: string) => (await db.query('select * from restaurant_invoices where id=$1', [id])).rows[0];
    const write = (v: number, cfg: Record<string, unknown>) => asRole(owner, (c) => save(c, restaurant, v, cfg));
    await write(0, regular(gstin));
    const a = await placeOrder(slug, item, 1);
    const b = await placeOrder(slug, item, 1, { tableToken });
    expect(b.sitting).not.toBe(a.sitting);
    for (const sitting of [a.sitting, b.sitting]) {
      await asRole(owner, (c) => c.query('select mark_order_session_paid($1)', [sitting]));
    }
    const countCounters = () => db.query('select count(*)::int n from restaurant_invoice_series where restaurant_id=$1', [restaurant]);
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await db.query('set local role authenticated');
      expect((await db.query('select close_order_session_and_issue_receipt($1) id', [a.sitting])).rows[0].id).toBeTruthy();
    } finally {
      await db.query('rollback');
    }
    expect((await countCounters()).rows[0].n).toBe(0);
    expect((await db.query('select status from order_sessions where id=$1', [a.sitting])).rows[0].status).toBe('open');
    const other = new Client({ connectionString: URL_VALUE });
    await other.connect();
    const issue = (sitting: string, conn = db) => asRole(owner, async (c) =>
      (await c.query('select close_order_session_and_issue_receipt($1) id', [sitting])).rows[0].id as string, 'authenticated', conn);
    let aId: string;
    let bId: string;
    try {
      [aId, bId] = await Promise.all([issue(a.sitting), issue(b.sitting, other)]);
    } finally {
      await other.end();
    }
    const first = await readInvoice(aId);
    const second = await readInvoice(bId);
    expect([first.sequence_number, second.sequence_number].sort()).toEqual([1, 2]);
    expect(await issue(a.sitting)).toBe(aId);
    expect(first).toMatchObject({ document_type: 'gst_tax_invoice', series_code: 'INV', seller_snapshot: { gstin, fssai_number: SYNTHETIC_FSSAI },
      gst_snapshot: { service_sac: SYNTHETIC_SERVICE_SAC, rate_bps: 500 } });
    const originalPayments = (await db.query('select * from payments where restaurant_id=$1 order by id', [restaurant])).rows;
    await asRole(owner, (c) => c.query("select void_restaurant_invoice($1,'Synthetic correction for series test')", [aId]));
    const voided = await readInvoice(aId);
    expect(voided).toMatchObject({ invoice_number: first.invoice_number, sequence_number: first.sequence_number, status: 'voided', totals_snapshot: first.totals_snapshot });
    const replaced = await readInvoice(await issue(a.sitting));
    expect(replaced).toMatchObject({ sequence_number: 3, series_code: 'INV', supersedes_invoice_id: aId, totals_snapshot: first.totals_snapshot });
    expect((await db.query('select * from payments where restaurant_id=$1 order by id', [restaurant])).rows).toEqual(originalPayments);
    await expect(db.query('update restaurant_invoices set series_code=null where id=$1', [aId])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('delete from restaurant_invoices where id=$1', [aId])).rejects.toMatchObject({ code: '42501' });

    await write(1, composition(gstin));
    const bos = await readInvoice(await closeAndIssue(owner, (await placeOrder(slug, item, 1)).sitting));
    expect(bos).toMatchObject({ document_type: 'bill_of_supply', series_code: 'BOS', sequence_number: 1,
      gst_snapshot: { notice: 'Composition taxable person, not eligible to collect tax on supplies' },
      seller_snapshot: { gstin, fssai_number: SYNTHETIC_FSSAI }, totals_snapshot: { tax_paise: 0 } });
    await write(2, OFF);
    await expect(asRole(owner, (c) => c.query('update restaurants set tax_rate_bps=1800, gstin=$2 where id=$1', [restaurant, gstin])))
      .rejects.toMatchObject({ code: 'P0001', message: 'Legacy tax and GSTIN are inactive for this billing configuration.' });
    const retailOrder = await placeOrder(slug, item, 1);
    expect((await db.query('select total_paise,tax_paise,tax_rate_bps_snapshot from orders where id=$1', [retailOrder.order])).rows[0])
      .toEqual({ total_paise: '10500', tax_paise: '0', tax_rate_bps_snapshot: 0 });
    const retail = await readInvoice(await closeAndIssue(owner, retailOrder.sitting));
    expect(retail).toMatchObject({ document_type: 'receipt', series_code: 'RBL', sequence_number: 1, gst_snapshot: null,
      totals_snapshot: { total_paise: 10500, tax_paise: 0 },
      seller_snapshot: { fssai_number: SYNTHETIC_FSSAI, phone: '07120000000', name: 'GST Test Kitchen', address: 'Registered office, Test Lane' } });
    expect(retail.seller_snapshot).not.toHaveProperty('gstin');
    expect((await db.query('select gstin, registration_type from restaurant_gst_config where restaurant_id=$1', [restaurant])).rows[0])
      .toEqual({ gstin: null, registration_type: 'unregistered' });
    const hash = randomBytes(32).toString('hex');
    await asRole(owner, (c) => c.query('select * from create_restaurant_invoice_share_link($1,$2)', [retail.id, hash]));

    await write(3, regular(gstin));
    const resumed = await readInvoice(await closeAndIssue(owner, (await placeOrder(slug, item, 1)).sitting));
    expect(resumed).toMatchObject({ document_type: 'gst_tax_invoice', series_code: 'INV', sequence_number: 4 });
    for (const inv of [voided, second, replaced, bos, retail, resumed]) {
      expect(inv.invoice_number).toMatch(numberRe);
      expect(await readInvoice(inv.id)).toEqual(inv);
    }
    const report = await asRole(owner, (c) => c.query("select document_type,document_status,document_count,series_code,financial_year from report_gst_documents($1,now()-interval '1 day',now()+interval '1 day')", [restaurant]));
    expect(report.rows).toEqual([
      { document_type: 'bill_of_supply', document_status: 'issued', document_count: 1, series_code: 'BOS', financial_year: bos.financial_year },
      { document_type: 'gst_tax_invoice', document_status: 'issued', document_count: 3, series_code: 'INV', financial_year: resumed.financial_year },
      { document_type: 'gst_tax_invoice', document_status: 'voided', document_count: 1, series_code: 'INV', financial_year: first.financial_year },
      { document_type: 'retail_bill', document_status: 'issued', document_count: 1, series_code: 'RBL', financial_year: retail.financial_year },
    ]);
    const shared = (await asRole(null, (c) => c.query('select read_shared_restaurant_invoice($1) payload', [hash]), 'anon')).rows[0].payload;
    const publicSeller = Object.fromEntries(Object.entries(retail.seller_snapshot).filter(([k]) =>
      !['pan','restaurant_id','einvoice_location','einvoice_pincode','activation_effective_from'].includes(k)));
    expect(shared.invoice.seller_snapshot).toEqual(publicSeller);
    expect(shared.invoice.invoice_number).toEqual(retail.invoice_number);
    expect(shared.invoice.gst_snapshot).toBeNull();
    const foreign = randomUUID();
    await makeRestaurant(`${slug}-foreign`, foreign);
    expect((await asRole(foreign, (c) => c.query('select id from restaurant_invoices where id=$1', [retail.id]))).rows).toEqual([]);
    await expect(asRole(owner, (c) => c.query('select * from restaurant_invoice_series where restaurant_id=$1', [restaurant]))).rejects.toMatchObject({ code: '42501' });
  }, 30000);
  it('requires dated activation and namespace review at the RPC, not only in the form', async () => {
    const owner = randomUUID();
    const { restaurant,gstin } = await makeRestaurant(`${slugBase}-activation-boundary`, owner);
    const go = (a: unknown) => asRole(owner,c => save(c,restaurant,0,{...regular(gstin),activation:a}));
    await expect(go(null)).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/confirm activation/i)});
    await expect(go(activation({effective_from:'2025-04-01'}))).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/today in India/i)});
    await expect(go(activation({premises_state_code:'29'}))).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/must match/i)});
    await expect(go(activation({external_prefixes:['INV']}))).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/overlaps/i)});
    await expect(asRole(owner,c => save(c,restaurant,0,{...regular(gstin),business_type:'hotel'}))).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/preceding FY hotel room/i)});
    expect((await db.query('select count(*)::int n from restaurant_gst_number_namespaces where restaurant_id=$1',[restaurant])).rows[0].n).toBe(0);
    expect(await go(activation())).toBe(1);
    const h = (await db.query('select config_version,changed_by,activation from restaurant_gst_config_history where restaurant_id=$1',[restaurant])).rows[0];
    expect(h).toMatchObject({config_version:1,changed_by:owner,activation:{effective_from:indiaToday(),confirmed_by:owner,review_status:'owner_attested'}});
    await expect(asRole(owner,c => c.query("update restaurant_gst_config_history set activation='{}' where restaurant_id=$1",[restaurant]))).rejects.toMatchObject({code:'42501'});
  });

  it('derives Annexure VIII from acknowledgment and registration dates; no arbitrary window or fallback', async () => {
    const owner = randomUUID();
    const { restaurant,gstin } = await makeRestaurant(`${slugBase}-viii`,owner);
    const today = indiaToday(), fy = currentFy();
    const end = addBillingDays(today,15);
    const opts = { ...specified(gstin,today), premises_evidence:{ basis:'opt_in',reference:'Synthetic ARN and registration proof',
      treatment_fy_start:fy, filed_on:today,filing_from:today, filing_through:end } };
    const attested = activation({declaration_route:'annexure_viii',declaration_fy:fy,registration_effective_on:today});
    const write = (payload: Record<string,unknown>) => asRole(owner,c => save(c,restaurant,0,payload));
    await expect(write({...opts,activation:{...attested,registration_effective_on:addBillingDays(today,1)}})).rejects.toMatchObject({code:'23514'});
    await expect(write({...opts,activation:attested,premises_evidence:{...opts.premises_evidence,filing_through:addBillingDays(today,16)}})).rejects.toMatchObject({code:'23514'});
    expect(await write({...opts,activation:attested})).toBe(1);
  });

  it('serializes cross-outlet GSTIN namespace reservations and keeps distinct series', async () => {
    const owner = randomUUID(), slug = `${slugBase}-one-gstin`;
    const a = await makeRestaurant(slug + '-a',owner), b = await makeRestaurant(slug + '-b',owner);
    const cfg = regular(a.gstin);
    const parallel = new Client({ connectionString: URL_VALUE }); await parallel.connect();
    try {
      const outcomes = await Promise.allSettled([asRole(owner,c => save(c,a.restaurant,0,cfg)),asRole(owner,c => save(c,b.restaurant,0,cfg),'authenticated',parallel)]);
      expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find(x => x.status === 'rejected')).toMatchObject({reason:{code:'23514',message:expect.stringMatching(/numbering series conflicts/i)}});
      const rejected = outcomes[0].status === 'rejected' ? b : a;
      const loser = outcomes[0].status === 'rejected' ? a : b;
      const draft = {...cfg,activation:activation({series:{INV:'IX2',BOS:'BX2',RBL:'RX2',CN:'CX2',DN:'DX2'}})};
      expect(await asRole(owner,c => save(c,loser.restaurant,0,draft))).toBe(1);
      const actives = await db.query('select prefix from restaurant_gst_number_namespaces where restaurant_id=any($1::uuid[]) order by prefix', [[a.restaurant,b.restaurant]]);
      expect(actives.rows.map(x => x.prefix)).toEqual(['CN','CX2','DN','DX2','INV','IX2']);
      expect((await db.query('select count(*)::int n from restaurant_gst_config_history where restaurant_id=$1',[rejected.restaurant])).rows[0].n).toBe(1);
      await expect(asRole(owner,c => save(c,loser.restaurant,1,{...draft,activation:{...draft.activation,series:{...draft.activation.series,INV:'IX3'}}}))).rejects.toMatchObject({code:'23514'});
      expect((await db.query('select count(*)::int n from restaurant_gst_config_history where restaurant_id=$1',[loser.restaurant])).rows[0].n).toBe(1);
    } finally { await parallel.end(); }
  });

  it('reads a saved buyer by outlet and current revision, then freezes the buyer and PoS on the invoice', async () => {
    const owner = randomUUID(), manager = randomUUID(), other = randomUUID(), slug = `${slugBase}-buyer-records`;
    const { restaurant,gstin,item } = await makeRestaurant(slug,owner);
    const stranger = (await makeRestaurant(`${slug}-foreign`,other)).restaurant;
    await db.query('insert into profiles(id) values ($1)',[manager]);
    await db.query("insert into memberships(restaurant_id,user_id,role) values($1,$2,'manager')",[restaurant,manager]);
    const cfg = {...regular(gstin),activation:activation({aato:{highest_prior_fy_paise:4_900_000_000,reference:'Synthetic PAN review',reporting_category:'under_10cr'}})};
    await asRole(owner,c => save(c,restaurant,0,cfg));
    const makeBuyer = (actor: string, version: number, details: Record<string,unknown> = BUYER, outlet = restaurant) => asRole(actor,async c =>
      (await c.query('select save_restaurant_gst_buyer($1,$2,$3) buyer',[outlet,version,details])).rows[0].buyer);
    await expect(makeBuyer(manager,0)).rejects.toMatchObject({code:'42501'});
    await expect(makeBuyer(owner,0,{...BUYER,state_code:'27'})).rejects.toMatchObject({code:'23514'});
    const buyer = await makeBuyer(owner,0);
    const foreign = await makeBuyer(other,0,BUYER,stranger);
    const next = await makeBuyer(owner,1,{...BUYER,phone:'07120000000'});
    await expect(makeBuyer(owner,1)).rejects.toMatchObject({code:'P0001'});
    expect((await asRole(other,c => c.query('select id from restaurant_gst_buyers where restaurant_id=$1',[restaurant]))).rows).toEqual([]);
    await expect(asRole(owner,c => c.query("update restaurant_gst_buyers set details='{}' where id=$1",[buyer.id]))).rejects.toMatchObject({code:'42501'});
    const { sitting } = await placeOrder(slug,item,1);
    await asRole(owner,c => c.query('select mark_order_session_paid($1)',[sitting]));
    const issue = (recipient: Record<string,unknown>) => asRole(owner,async c =>
      (await c.query('select close_order_session_and_issue_receipt($1,$2) id',[sitting,recipient])).rows[0].id);
    for (const invalid of [{buyer_id:foreign.id,revision:foreign.revision},{buyer_id:buyer.id,revision:1},{...BUYER,supply_kind:'SEZ'}, {...BUYER,place_of_supply_state_code:'29'}]) {
      await expect(issue(invalid)).rejects.toThrow(/unavailable|direct restaurant/i);
    }
    const id = await issue({buyer_id:next.id,revision:next.revision});
    expect(await issue({buyer_id:next.id,revision:next.revision})).toBe(id);
    await makeBuyer(owner,2,{...BUYER, name:'Updated buyer name'});
    await expect(issue({buyer_id:next.id,revision:3})).rejects.toThrow(/immutable document/i);
    expect((await db.query('select customer_snapshot,gst_snapshot,irp_status from restaurant_invoices where id=$1',[id])).rows[0]).toMatchObject({
      customer_snapshot:{gstin:BUYER.gstin,name:BUYER.name,buyer_id:buyer.id,buyer_revision:2,state_code:'29',phone:'07120000000'},
      gst_snapshot:{place_of_supply_state_code:'27',recipient_type:'B2B',igst_paise:0},irp_status:'not_required',
    });
    expect((await asRole(manager,c => c.query('select revision from restaurant_gst_buyer_history where buyer_id=$1 order by revision',[buyer.id]))).rows).toEqual([{revision:1},{revision:2},{revision:3}]);
    await expect(asRole(manager,c => c.query('select void_restaurant_invoice($1,$2)',[id,'Synthetic manager not authorized']))).rejects.toMatchObject({code:'42501'});
    const tokenHash = randomBytes(32).toString('hex');
    await asRole(owner,c => c.query('select create_restaurant_invoice_share_link($1,$2)',[id,tokenHash]));
    const shared = (await asRole(null,c => c.query('select read_shared_restaurant_invoice($1) bill',[tokenHash]),'anon')).rows[0].bill;
    expect(shared.invoice.customer_snapshot).toMatchObject({name:BUYER.name,gstin:BUYER.gstin,address:BUYER.address});
    for (const key of ['buyer_id','buyer_revision','email','phone']) expect(shared.invoice.customer_snapshot).not.toHaveProperty(key);
    expect(shared.invoice.gst_snapshot).not.toHaveProperty('irp_evidence');
  });

  it('prepares one immutable held INV-01 request from historical high AATO; a direct caller cannot install artifacts', async () => {
    const owner = randomUUID(), outsider = randomUUID(), slug = `${slugBase}-preflight`;
    const { restaurant,gstin,item } = await makeRestaurant(slug,owner);
    await makeRestaurant(`${slug}-foreign`,outsider);
    await asRole(owner,c => save(c,restaurant,0,{...regular(gstin),einvoice_location:'Synthetic City',einvoice_pincode:'440001',einvoice_hsn_sac:'996331',
      preceding_fy_turnover_paise:100_000_000,activation:activation({ aato:{highest_prior_fy_paise:6_000_000_000,reference:'Earlier FY in complete synthetic PAN review',reporting_category:'under_10cr'} })}));
    const { sitting } = await placeOrder(slug,item,1);
    await asRole(owner,c => c.query('select mark_order_session_paid($1)',[sitting]));
    const id = (await asRole(owner,c => c.query('select close_order_session_and_issue_receipt($1,$2) id',[sitting,BUYER]))).rows[0].id;
    const i = (await db.query('select invoice_number,gst_snapshot,seller_snapshot,customer_snapshot,irp_status from restaurant_invoices where id=$1',[id])).rows[0];
    expect(i).toMatchObject({irp_status:'pending',gst_snapshot:{irp_evidence:{applicability:'required',reporting_category:'under_10cr'}}});
    const payload = buildIrpPayload({documentType:'INV',documentNumber:i.invoice_number,issuedDate:i.gst_snapshot.issued_local_date,
      seller:{gstin,legalName:i.seller_snapshot.legal_name,tradeName:null,address1:i.seller_snapshot.address,address2:null,location:'Synthetic City',
        pincode:'440001',stateCode:'27',phone:'07120000000',email:null}, buyer:{gstin:BUYER.gstin,legalName:BUYER.name,address1:BUYER.address,
        address2:null,location:BUYER.location,pincode:BUYER.pincode,stateCode:'29',phone:null,email:BUYER.email},
      placeOfSupplyStateCode:'27',supplyType:'B2B',lines:[{itemName:'Plate',quantity:1,unitPricePaise:10000,grossAmountPaise:10000,discountPaise:0,
        taxablePaise:10000,cgstPaise:250,sgstPaise:250,igstPaise:0,rateBps:500,totalItemValuePaise:10500}]});
    const wire = toValidatedInv01(payload);
    const prepare = (actor: string, request: unknown = wire, hash = payload.fingerprintSha256) => asRole(actor,c => c.query(
      'select record_gst_irp_preflight($1,$2,$3,$4,$5) result',[restaurant,id,'invoice',hash,request]));
    await expect(prepare(outsider)).rejects.toMatchObject({code:'42501'});
    await expect(prepare(owner,{...wire,ProviderAttestation:'not allowed'})).rejects.toMatchObject({code:'23514'});
    await expect(prepare(owner,{...wire,ValDtls:{...wire.ValDtls,TotInvVal:1}})).rejects.toMatchObject({code:'23514'});
    await expect(prepare(owner,{...wire,BuyerDtls:{...wire.BuyerDtls,Ph:'9876543210'}})).rejects.toMatchObject({code:'23514'});
    await expect(prepare(owner,{...wire,ItemList:[{...wire.ItemList[0],UnitPrice:1}]})).rejects.toMatchObject({code:'23514'});
    const first = (await prepare(owner)).rows[0].result;
    const second = (await prepare(owner)).rows[0].result;
    expect(second).toEqual({...first,duplicate:true});
    await expect(prepare(owner,wire,'f'.repeat(64))).rejects.toMatchObject({code:'23514'});
    await expect(asRole(owner,c => c.query('select * from restaurant_irp_jobs'))).rejects.toMatchObject({code:'42501'});
    expect((await db.query('select irp_status,irn from restaurant_invoices where id=$1',[id])).rows[0]).toEqual({irp_status:'pending',irn:null});
    expect((await db.query('select status,environment,response_snapshot from restaurant_irp_jobs where invoice_id=$1',[id])).rows).toEqual([{status:'prepared_offline',environment:'offline',response_snapshot:null}]);
    expect((await asRole(owner,c => c.query('select list_gst_irp_preflights($1) info',[restaurant]))).rows[0].info[0]).toMatchObject({invoice_id:id,status:'prepared_offline'});

    // Test-only store, driven by disconnected synthetic adapters. No response
    // contains an IRN, ACK or signed invoice/QR, even in this fixture.
    const params=[first.id,restaurant,documentKey(payload),'rehearsal-fixture',fingerprint(wire),JSON.stringify(wire)];
    const connection=new Client({connectionString:URL_VALUE}); await connection.connect();
    try {
      const makeStore=(conn:Client)=>postgresRehearsalStore(async (q,args)=>(await conn.query(q,args)).rows[0].value,
        {preflightId:first.id,outletId:restaurant});
      const store=makeStore(db);
      const reopened=makeStore(connection);
      let releaseDuplicate: (result:{kind:'duplicate'}) => void = () => {};
      const duplicate = new Promise<{kind:'duplicate'}>(resolve=>{releaseDuplicate=resolve;});
      const adapter: Inv01ProviderAdapter = { id:'rehearsal-fixture',environment:'provider_test',
        generate:vi.fn().mockReturnValue(duplicate),lookup:vi.fn().mockResolvedValue({kind:'indeterminate'}),cancel:vi.fn() };
      const starting:ProviderJob={state:'prepared',revision:0,payloadSha256:fingerprint(wire),documentKey:documentKey(payload),
        environment:'provider_test',providerId:adapter.id};
      const reserved=await store.reserve(starting,wire);
      expect(reserved).toMatchObject({state:'prepared',revision:0});
      await expect(reopened.reserve({...starting,payloadSha256:'0'.repeat(64)},wire)).rejects.toMatchObject({code:'23514'});
      await expect(asRole(owner,c=>c.query('select reserve_gst_irp_rehearsal($1,$2,$3,$4,$5,$6)',params))).rejects.toMatchObject({code:'42501'});
      await expect(asRole(owner,c=>c.query('select * from restaurant_irp_job_events'))).rejects.toMatchObject({code:'42501'});
      const advance=(s=store)=>advanceIrpJob({payload,reportingCategory:'under_10cr',reportingDate:indiaToday(),environment:'provider_test',adapter,store:s,verifyAck:()=>null});
      const contenders=[advance(store),advance(reopened)];
      try {
        // The losing worker must finish before the fake provider reply. This
        // controls the schedule instead of counting a race-dependent lookup.
        const loser=await Promise.race(contenders);
        expect(['prepared','dispatching']).toContain(loser.state);
        expect(adapter.lookup).not.toHaveBeenCalled();
      } finally {
        releaseDuplicate({kind:'duplicate'});
        await Promise.all(contenders);
      }
      expect(adapter.generate).toHaveBeenCalledTimes(1);
      expect(await reopened.reserve(starting,wire)).toMatchObject({state:'reconcile',issue:'provider_duplicate'});
      expect(await advance(reopened)).toMatchObject({state:'reconcile',issue:'lookup_indeterminate'});
      vi.mocked(adapter.lookup).mockResolvedValueOnce({kind:'confirmed_absent'});
      const retry = await advance(reopened);
      expect(retry).toMatchObject({state:'retryable',issue:'provider_confirmed_absent'});
      const args=(p:ProviderJob,n:string,meta:unknown)=>[p.jobId,restaurant,p.documentKey,p.providerId,p.payloadSha256,p.revision,p.state,n,meta];
      const casSql='select cas_gst_irp_rehearsal($1,$2,$3,$4,$5,$6,$7,$8,$9)';
      await expect(db.query(casSql,args(retry,'verified',{operation:'generate',result:'outcome'}))).rejects.toMatchObject({code:'23514'});
      await expect(db.query(casSql,args(retry,'dispatching',{operation:'cancel',result:'dispatch'}))).rejects.toMatchObject({code:'23514'});
      await expect(db.query(casSql,args(retry,'dispatching',{operation:'generate',result:'dispatch',rawBody:'not persistable'}))).rejects.toMatchObject({code:'23514'});

      let returnLate: (result:{kind:'rejected';code:string}) => void = () => {};
      const lateOutcome = new Promise<{kind:'rejected';code:string}>(resolve=>{returnLate=resolve;});
      let dispatched: () => void = () => {};
      const sent = new Promise<void>(resolve=>{dispatched=resolve;});
      vi.mocked(adapter.generate).mockImplementationOnce(() => {dispatched(); return lateOutcome;});
      const late = advance(store);
      // Attach the assertion before resolving the promise, even if a later
      // storage check fails. The worker does not own the recovery connection.
      const lateResult = late.catch((error:unknown)=>error);
      try {
        await sent;
        const jobId=reserved.jobId!;
        const load = async () => (await reopened.load(jobId))!;
        const firstDispatch=await load();
        expect(firstDispatch).toMatchObject({state:'dispatching',revision:5});
        expect(firstDispatch).not.toHaveProperty('request_payload');
        expect((await connection.query('select load_gst_irp_rehearsal($1,$2) value',[randomUUID(),jobId])).rows[0].value).toBeNull();
        for (const role of ['anon','authenticated','service_role'] as const) await expect(asRole(owner,c=>c.query(
          'select load_gst_irp_rehearsal($1,$2)',[restaurant,jobId]),role)).rejects.toMatchObject({code:'42501'});
        expect(await advance(reopened)).toMatchObject({state:'dispatching'});
        expect(await recoverAbandonedIrpJob(reopened,firstDispatch,Date.parse(firstDispatch.updatedAt!)+120_000)).toBe(firstDispatch);
        // Isolate the test clock by aging this synthetic marker, not by
        // overriding the production recovery function or the app clock.
        await connection.query("update restaurant_irp_jobs set updated_at=clock_timestamp()-interval '121 seconds' where id=$1",[jobId]);
        const stranded=await load();
        const recovered=await recoverAbandonedIrpJob(reopened,stranded,Date.now());
        expect(recovered).toMatchObject({state:'reconcile',issue:'abandoned_dispatch',revision:6});
        returnLate({kind:'rejected',code:'SYNTHETIC_LATE_REPLY'});
        expect(await lateResult).toMatchObject({message:expect.stringMatching(/outcome not persisted/i)});
        expect(await load()).toMatchObject({state:'reconcile',revision:6});
      } finally { returnLate({kind:'rejected',code:'SYNTHETIC_LATE_REPLY'}); await lateResult; }
      expect(adapter.generate).toHaveBeenCalledTimes(2);
      vi.mocked(adapter.lookup).mockResolvedValueOnce({kind:'found',body:'synthetic malformed lookup, no invoice fields'});
      expect(await advance(reopened)).toMatchObject({state:'reconcile',issue:'unverified_lookup'});
      expect((await db.query('select state,response from restaurant_irp_job_events where job_id=$1 order by revision',[reserved.jobId])).rows)
        .toMatchObject([{state:'prepared'},{state:'dispatching'},{state:'reconcile',response:{issue:'provider_duplicate',responseSha256:expect.stringMatching(/^[a-f0-9]{64}$/)}},
          {state:'reconcile'},{state:'retryable'},{state:'dispatching'},{state:'reconcile',response:{issue:'abandoned_dispatch'}},
          {state:'reconcile',response:{issue:'unverified_lookup',responseSha256:expect.stringMatching(/^[a-f0-9]{64}$/)}}]);
      expect((await db.query('select irp_status,irn from restaurant_invoices where id=$1',[id])).rows[0]).toEqual({irp_status:'pending',irn:null});
      await expect(asRole(owner,c=>c.query('select create_restaurant_invoice_share_link($1,$2)',[id,'e'.repeat(64)]))).rejects.toMatchObject({code:'P0001'});
      const voidIt=(c=db)=>asRole(owner,x=>x.query('select void_restaurant_invoice($1,$2)',[id,'Synthetic local void order of operations']),'authenticated',c);
      await expect(voidIt()).rejects.toThrow(/outstanding IRP rehearsal/i);
      vi.mocked(adapter.lookup).mockResolvedValueOnce({kind:'confirmed_absent'});
      const free=await advance(reopened);
      // Provider prevents dispatch (positive local evidence), not a timeout.
      vi.mocked(adapter.generate).mockResolvedValueOnce({kind:'not_dispatched'});
      const clear=await advance(reopened);
      expect(clear).toMatchObject({state:'retryable',issue:'confirmed_not_dispatched'});
      expect(clear.revision).toBe(free.revision+2);
      const dispatch:ProviderJob={...clear,state:'dispatching',revision:clear.revision+1,result:'dispatch',issue:undefined,responseSha256:undefined};
      // Both serializations: claim wins and local void is refused; certainty
      // of non-dispatch clears it, then void wins against the next claim.
      expect(await store.compareAndSwap(clear,dispatch)).toBe(true);
      await expect(voidIt(connection)).rejects.toThrow(/outstanding IRP rehearsal/i);
      expect(await store.compareAndSwap(dispatch,{...dispatch,state:'retryable',revision:dispatch.revision+1,result:'outcome',issue:'confirmed_not_dispatched'})).toBe(true);
      const beforeVoid=(await reopened.load(reserved.jobId!))!;
      await voidIt(connection);
      expect(await store.compareAndSwap(beforeVoid,{...dispatch,revision:beforeVoid.revision+1})).toBe(false);
      expect((await db.query('select status,irn from restaurant_invoices where id=$1',[id])).rows[0]).toEqual({status:'voided',irn:null});
      await expect(reopened.reserve(starting,wire)).rejects.toThrow(/no longer an IRN-held/i);

    } finally { await connection.end(); }

  });

  it('prepares a held adjustment from unchanged B2B source lines and never treats preflight as final', async () => {
    const owner = randomUUID(), slug = `${slugBase}-offline-note`;
    const {restaurant,gstin,item} = await makeRestaurant(slug,owner);
    const profile = {...regular(gstin),einvoice_location:'Synthetic City',einvoice_pincode:'440001',einvoice_hsn_sac:'996331'};
    const reviewed = (max: number) => ({ ...profile, activation:activation({aato:{
      highest_prior_fy_paise:max,reference:'Synthetic complete PAN evidence',reporting_category:'under_10cr',
    }}) });
    await asRole(owner,c => save(c,restaurant,0,reviewed(5_000_000_000)));
    await db.query('update items set price_paise=10511 where id=$1',[item]);
    const first = await placeOrder(slug,item,3);
    await placeOrder(slug,item,1);
    const invoice = await asRole(owner,async c => {
      await c.query('select mark_order_session_paid($1)',[first.sitting]);
      return (await c.query('select close_order_session_and_issue_receipt($1,$2) id',[first.sitting,BUYER])).rows[0].id;
    });
    const source = (await db.query('select invoice_number,irp_status,totals_snapshot,gst_snapshot from restaurant_invoices where id=$1',[invoice])).rows[0];
    expect(source.irp_status).toBe('not_required');
    await asRole(owner,c => save(c,restaurant,1,reviewed(5_000_000_001)));
    const note = (await asRole(owner,c => c.query("select issue_invoice_note($1,'debit_note','other','Synthetic full correction after PAN evidence review') id",[invoice]))).rows[0].id;
    const n = (await db.query('select document_number,gst_snapshot,irp_status,totals_snapshot,seller_snapshot from restaurant_notes where id=$1',[note])).rows[0];
    expect(n.irp_status).toBe('pending');
    const g = n.gst_snapshot, t = n.totals_snapshot;
    const lines = (await db.query('select line_snapshot s from restaurant_invoice_lines where invoice_id=$1 order by line_number',[invoice])).rows;
    expect(lines).toHaveLength(2);
    const projected = prepareEinvoicePayload({profile:{mode:'regular',registrationType:'regular',gstin,legalName:profile.legal_name,tradeName:null,
      address:profile.address,stateCode:'27',precedingFyTurnoverPaise:null,einvoiceLocation:profile.einvoice_location,
      einvoicePincode:profile.einvoice_pincode,einvoiceHsnSac:profile.service_sac},invoice:{
      invoiceNumber:n.document_number,issuedLocalDate:g.issued_local_date,irpStatus:n.irp_status,status:'issued',documentType:'debit_note',
      irpEvidence:{applicability:'required',reportingCategory:'under_10cr'},
      originalInvoice:{documentType:'INV',documentNumber:source.invoice_number,issuedDate:source.gst_snapshot.issued_local_date},
      gst:{rateBps:g.rate_bps,taxablePaise:g.taxable_paise,cgstPaise:g.cgst_paise,sgstPaise:g.sgst_paise,igstPaise:g.igst_paise,placeOfSupplyStateCode:'27'},
      totals:{subtotalPaise:t.source_total_paise,taxPaise:t.tax_paise,totalPaise:t.total_paise},
      seller:{name:profile.legal_name,tradeName:null,address:profile.address,phone:n.seller_snapshot.phone},
      recipient:{name:BUYER.name,gstin:BUYER.gstin,address:BUYER.address,location:BUYER.location,pincode:BUYER.pincode,email:BUYER.email},
      lines:lines.map(({s}) => ({itemName:s.item_name,quantity:s.quantity,unitPricePaise:s.unit_price_paise,amountPaise:s.amount_paise})),
    }});
    expect(projected.ok).toBe(true);
    if (!projected.ok) throw new Error(projected.error);
    const wire = toValidatedInv01(projected.payload);
    expect(wire).toMatchObject({DocDtls:{Typ:'DBN'},RefDtls:{PrecDocDtls:[{InvNo:source.invoice_number}]}});
    const record = (p: unknown) => asRole(owner,c => c.query('select record_gst_irp_preflight($1,$2,$3,$4,$5) result',
      [restaurant,note,'note',projected.payload.fingerprintSha256,p]));
    await expect(record({...wire, RefDtls:{PrecDocDtls:[{InvNo:'WRONG/26-27/000001',InvDt:'01/01/2026'}]}})).rejects.toMatchObject({code:'23514'});
    expect((await record(wire)).rows[0].result).toMatchObject({status:'prepared_offline',duplicate:false});
    expect((await db.query('select irp_status,irn from restaurant_notes where id=$1',[note])).rows[0]).toEqual({irp_status:'pending',irn:null});
    const ledger = (await asRole(owner,c => c.query('select report_gst_reconciliation($1,$2,$2::date+1) ledger',[restaurant,indiaToday()]))).rows[0].ledger;
    expect(ledger.buckets).toEqual(expect.arrayContaining([expect.objectContaining({kind:'debit_note',status:'issued',irp_status:'pending',count:1})]));
    expect(ledger.payments.reduce((sum: number, group: {amount_paise:number}) => sum+group.amount_paise,0)).toBe(42044);
  });

  it('blocks known high-turnover B2C without a reviewed payment QR workflow, across outlets with the PAN', async () => {
    const owner = randomUUID(), slug = `${slugBase}-dynamic-payment-qr`;
    const a = await makeRestaurant(slug,owner), b = await makeRestaurant(`${slug}-sibling`,owner);
    const bGstin = syntheticGstin(`27${a.pan}2Z`);
    await asRole(owner,c => save(c,a.restaurant,0,{...regular(a.gstin),activation:activation({aato:{
      highest_prior_fy_paise:500_000_000_001,reference:'Synthetic dynamic-QR category',reporting_category:'at_least_10cr',
    }})}));
    await asRole(owner,c => save(c,b.restaurant,0,regular(bGstin)));
    const {sitting} = await placeOrder(`${slug}-sibling`,b.item,1);
    await asRole(owner,c => c.query('select mark_order_session_paid($1)',[sitting]));
    await expect(asRole(owner,c => c.query('select close_order_session_and_issue_receipt($1)',[sitting]))).rejects.toThrow(/dynamic payment QR/);
    expect((await db.query('select status from order_sessions where id=$1',[sitting])).rows[0].status).toBe('open');
    const {id} = (await asRole(owner,c => c.query('select close_order_session_and_issue_receipt($1,$2) id',[sitting,BUYER]))).rows[0];
    expect((await db.query('select irp_status,sequence_number from restaurant_invoices where id=$1',[id])).rows[0]).toEqual({irp_status:'pending',sequence_number:1});
    const ledger = (await asRole(owner,c => c.query('select report_gst_reconciliation($1,$2,$2::date+1) ledger',[b.restaurant,indiaToday()]))).rows[0].ledger;
    expect(ledger.payments).toEqual([{status:'recorded',linked_to:'held_sitting',count:1,amount_paise:10500}]);
  });

  it('requires high-value B2C particulars atomically and reconciles notes and refunds without doubling cash', async () => {
    const owner = randomUUID(), slug = `${slugBase}-settlement-report`;
    const { restaurant,gstin,item } = await makeRestaurant(slug,owner);
    await db.query('update items set price_paise=5250000 where id=$1',[item]);
    await asRole(owner,c => save(c,restaurant,0,regular(gstin)));
    const {order,sitting} = await placeOrder(slug,item,1);
    await asRole(owner,c => c.query('select mark_order_session_paid($1)',[sitting]));
    const issue = (recipient: unknown) => asRole(owner,c => c.query('select close_order_session_and_issue_receipt($1,$2) id',[sitting,recipient]));
    await expect(issue(null)).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/Rule 46/i)});
    expect((await db.query('select status from order_sessions where id=$1',[sitting])).rows[0].status).toBe('open');
    expect((await db.query('select count(*)::int n from restaurant_invoice_series where restaurant_id=$1',[restaurant])).rows[0].n).toBe(0);
    const id = (await issue({recipient_type:'consumer',name:'Synthetic Consumer',address:'Synthetic Billing Lane',state_code:'27'})).rows[0].id;
    expect((await db.query('select sequence_number,customer_snapshot from restaurant_invoices where id=$1',[id])).rows[0]).toMatchObject({sequence_number:1,customer_snapshot:{recipient_type:'consumer',delivery_address:'1 Synthetic Test Lane'}});
    await asRole(owner,c => c.query("select issue_invoice_note($1,'credit_note','returned_supply','Synthetic full eligible adjustment')",[id]));
    const report = (series: string | null = null) => asRole(owner,async c => (await c.query('select report_gst_reconciliation($1,$2,$2::date+1,null,$3,null,null,null,100) report',
      [restaurant,indiaToday(),series])).rows[0].report);
    const ledger = await report();
    expect(ledger).toMatchObject({document_count:2,payments:[{count:1,amount_paise:5250000,status:'recorded',linked_to:'issued_sitting'}]});
    expect(ledger.documents.map((d: {kind:string;taxable:number;cgst:number;sgst:number;gross:number}) => [d.kind,d.taxable,d.cgst,d.sgst,d.gross])).toEqual([
      ['credit_note',5000000,125000,125000,5250000],['gst_tax_invoice',5000000,125000,125000,5250000],
    ]);
    expect(await report('CN')).toMatchObject({document_count:1,payments:ledger.payments});
    // Legacy fixture status, not a refund API and not a dated refund event.
    await db.query("update payments set status='refunded' where order_id=$1",[order]);
    expect((await report()).payments).toEqual([{count:1,amount_paise:5250000,status:'refunded',linked_to:'issued_sitting'}]);
    await expect(asRole(null,c => c.query('select report_gst_reconciliation($1,current_date,current_date+1)',[restaurant]),'anon')).rejects.toMatchObject({code:'42501'});
  });

  it('records a private outlet deferral without enabling GST, mutating history or making a registration declaration', async () => {
    const owner=randomUUID(), manager=randomUUID(), other=randomUUID();
    const {restaurant,item}=await makeRestaurant(`${slugBase}-defer`,owner);
    await db.query('insert into profiles(id) values($1),($2)',[manager,other]);
    await db.query("insert into memberships(restaurant_id,user_id,role) values($1,$2,'manager')",[restaurant,manager]);
    const defer=(actor:string,v=0,reason='premises')=>asRole(actor,c=>c.query('select record_gst_outlet_deferral($1,$2,$3)',[restaurant,v,reason]));
    const list=(actor:string)=>asRole(actor,async c=>(await c.query('select list_gst_outlet_deferrals($1) value',[restaurant])).rows[0].value);
    await expect(defer(manager)).rejects.toMatchObject({code:'42501'});
    await expect(list(other)).rejects.toMatchObject({code:'42501'});
    await expect(defer(owner,2)).rejects.toMatchObject({code:'P0001'});
    await defer(owner); await defer(owner);
    await expect(defer(owner,0,'series')).rejects.toMatchObject({code:'P0001'});
    expect(await list(manager)).toEqual([expect.objectContaining({profile_version:0,reason:'premises',recorded_by:owner})]);
    expect((await db.query('select * from restaurant_gst_config where restaurant_id=$1',[restaurant])).rowCount).toBe(0);
    await expect(asRole(manager,c=>c.query('select * from restaurant_gst_deferrals'))).rejects.toMatchObject({code:'42501'});
    await expect(asRole(owner,c=>c.query('select place_gst_direct_ticket($1,$2,$3,$4,true)',[restaurant,randomUUID(),'takeaway',JSON.stringify([{item_id:item,qty:1}])]))).rejects.toThrow(/activate and review/i);
    expect(await asRole(owner,c=>save(c,restaurant,0,OFF))).toBe(1);
    await expect(defer(owner,1)).rejects.toThrow(/cannot disable an active/i);
    expect(await list(owner)).toHaveLength(1);
  });

  it('requires FY coverage for a 5% hotel and validates an Annexure IX without overriding qualifying room evidence', async () => {
    const owner=randomUUID(), {restaurant,gstin} = await makeRestaurant(`${slugBase}-hotel-negative`,owner);
    const legacy=await makeRestaurant(`${slugBase}-pre-review-hotel`,randomUUID());
    await setGstConfig(legacy.restaurant,{...regular(legacy.gstin),pan:legacy.pan,state_code:'27',business_type:'hotel'});
    await expect(db.query('select * from gst_pricing_at($1,$2)',[legacy.restaurant,indiaToday()])).rejects.toThrow(/review its GST settings/i);
    const fy=currentFy();
    const profile = (patch:Record<string,unknown>)=>asRole(owner,c=>save(c,restaurant,0,{...regular(gstin),business_type:'hotel',
      activation:activation({hotel_review:{treatment_fy:fy,room_fy:fy-1,reference:'Synthetic complete room review',confirmed:true,
        room_basis:'actual',max_room_paise:750000,declaration_status:'opted_out',opt_out_fy:fy,
        opt_out_filed:`${fy}-03-31`,opt_out_reference:'Synthetic Annexure IX evidence',...patch}})}));
    for (const patch of [{room_fy:fy},{max_room_paise:750001},{opt_out_filed:`${fy}-04-01`},{opt_out_reference:''},{confirmed:false}]) {
      await expect(profile(patch)).rejects.toMatchObject({code:'23514'});
    }
    await expect(profile({})).resolves.toBe(1);
    const read=(date:string)=>db.query('select * from gst_pricing_at($1,$2)',[restaurant,date]);
    expect((await read(indiaToday())).rows[0]).toMatchObject({mode:'regular',rate_bps:500});
    await expect(read(`${fy+1}-04-01`)).rejects.toThrow(/review its GST settings/i);
    // Rule 10 can supply a valid effective registration date before ARN.
    const { rows }=await db.query(`select gst_declared_premises_window($1,'annexure_viii',2026,'2026-06-01','2026-06-24','2026-06-01') ok`,[{
      basis:'opt_in',reference:'Synthetic registered proof',treatment_fy_start:2026,filed_on:'2026-06-24',filing_from:'2026-06-09',filing_through:'2026-06-24',
    }]);
    expect(rows[0].ok).toBe(true);
  });

  it.each(['standalone','hotel','composition','unregistered'] as const)('uses paid immutable snapshots for direct takeaway and delivery: %s', async mode => {
    const owner=randomUUID(), {restaurant,gstin,item}=await makeRestaurant(`${slugBase}-direct-${mode}`,owner);
    const patch = mode==='composition' ? composition(gstin) : mode==='unregistered' ? OFF : mode==='hotel' ? specified(gstin) : regular(gstin);
    await db.query('update items set is_alcoholic=false where id=$1',[item]);
    await asRole(owner,c=>save(c,restaurant,0,{...patch, ...(['standalone','hotel'].includes(mode) ? {
      activation:activation({aato:{highest_prior_fy_paise:5_000_000_000,reference:'Synthetic complete review',reporting_category:'under_10cr'}}),
    } : {})}));
    for (const channel of ['takeaway','direct_delivery']) {
      const delivery = channel==='direct_delivery', address='1 Synthetic Destination';
      const key=randomUUID();
      const request=[restaurant,key,channel,JSON.stringify([{item_id:item,qty:1}]),true,delivery?'27':null,delivery?address:null];
      const submit=(conn=db)=>asRole(owner,async c=>(await c.query('select place_gst_direct_ticket($1,$2,$3,$4,$5,$6,$7) id',request)).rows[0].id,'authenticated',conn);
      const concurrent=new Client({connectionString:URL_VALUE}); await concurrent.connect();
      let id: string;
      try { const ids=await Promise.all([submit(),submit(concurrent)]); expect(ids[0]).toBe(ids[1]); id=ids[0]; } finally { await concurrent.end(); }
      const rec = (await db.query('select id,table_id,total_paise,discount_paise,tax_paise from orders where order_session_id=$1',[id])).rows[0];
      expect(rec).toMatchObject({table_id:null,total_paise:'10500',discount_paise:'0',tax_paise:mode==='standalone'?'500':mode==='hotel'?'1602':'0'});
      const issue=(recipient:unknown=null)=>asRole(owner,async c=>(await c.query('select close_order_session_and_issue_receipt($1,$2) id',[id,recipient])).rows[0].id);
      await expect(issue()).rejects.toThrow(/full outstanding balance/);
      await asRole(owner,c=>c.query('select mark_order_session_paid($1)',[id]));
      const doc=await issue(mode==='standalone'?BUYER:null);
      expect(await issue(mode==='standalone'?BUYER:null)).toBe(doc);
      const saved=(await db.query('select * from restaurant_invoices where id=$1',[doc])).rows[0];
      expect(saved).toMatchObject({status:'issued',irp_status:'not_required',sequence_number:delivery?2:1,
        seller_snapshot:{fulfilment_kind:channel},totals_snapshot:{total_paise:10500,amount_paid_paise:10500},source_order_ids:[rec.id]});
      if (mode==='standalone') expect(saved).toMatchObject({gst_snapshot:{place_of_supply_state_code:'27',cgst_paise:250,sgst_paise:250,igst_paise:0},
        customer_snapshot:{gstin:BUYER.gstin,state_code:'29',...(delivery ? {delivery_address:address} : {})}});
      if (delivery) {
        const hash=createHash('sha256').update(randomBytes(32)).digest('hex');
        await asRole(owner,c=>c.query('select create_restaurant_invoice_share_link($1,$2)',[doc,hash]));
        const shared = (await asRole(null,c=>c.query('select read_shared_restaurant_invoice($1) value',[hash]),'anon')).rows[0].value;
        expect(shared.invoice).toBeTruthy(); expect(JSON.stringify(shared)).not.toContain(address);
      }
    }
  });

  it('refuses unproven fulfilment and re-checks a Regular delivery before payment if PAN evidence changes', async () => {
    const owner=randomUUID(), outside=randomUUID();
    const slug=`${slugBase}-direct-errors`;
    const {restaurant,item,gstin,pan}=await makeRestaurant(slug,owner);
    const b=await makeRestaurant(`${slugBase}-direct-foreign`,outside);
    await asRole(owner,c=>save(c,restaurant,0,regular(gstin)));
    await db.query('update items set is_alcoholic=false where id=$1',[item]);
    const key=randomUUID(), address='1 Synthetic Destination';
    const input=[restaurant,key,'direct_delivery',JSON.stringify([{item_id:item,qty:1}]),true,'27',address];
    const place=(patch:Record<number,unknown>={},actor:string|null=owner,role:'anon'|'authenticated'='authenticated')=>asRole(actor,async c=>(await c.query(
      'select place_gst_direct_ticket($1,$2,$3,$4,$5,$6,$7) id',input.map((value,i)=>Object.hasOwn(patch,i)?patch[i]:value))).rows[0].id,role);
    await expect(place({},null,'anon')).rejects.toMatchObject({code:'42501'});
    await expect(place({},outside)).rejects.toMatchObject({code:'42501'});
    const kitchen=randomUUID(); await db.query('insert into profiles(id) values($1)',[kitchen]);
    await db.query("insert into memberships(restaurant_id,user_id,role) values($1,$2,'kitchen')",[restaurant,kitchen]);
    await expect(place({},kitchen)).rejects.toMatchObject({code:'42501'});
    for (const patch of [{4:false},{5:'29'},{2:'marketplace'},{6:null},{3:JSON.stringify([{item_id:item,qty:1,discount:100}])}]) {
      await expect(place(patch)).rejects.toMatchObject({code:'23514'});
    }
    await expect(place()).rejects.toThrow(/current PAN review/i);
    const guest=(await asRole(null,c=>c.query('select place_public_order_attempt($1,$2,null,null,$3) result',
      [slug,JSON.stringify([{itemId:item,qty:1}]),randomUUID()]),'anon')).rows[0].result;
    expect(guest).toMatchObject({code:null,error:{code:'P0001',message:expect.stringMatching(/scan your table QR/i)}});
    expect((await db.query('select count(*)::int n from orders where restaurant_id=$1',[restaurant])).rows[0].n).toBe(0);
    const low=aatoReview(5_000_000_000);
    await asRole(owner,c=>save(c,restaurant,1,{...regular(gstin),activation:low}));
    await expect(place({3:JSON.stringify([{item_id:item,qty:1,variant_id:randomUUID()}])})).rejects.toThrow(/variant is unavailable/i);
    await expect(place({3:JSON.stringify([{item_id:b.item,qty:1}])})).rejects.toMatchObject({code:'P0001'});
    const session=await place();
    const {id:order}= (await db.query('select id from orders where order_session_id=$1',[session])).rows[0];
    await expect(place({6:'Different synthetic destination'})).rejects.toMatchObject({code:'23514'});
    const { rows } = await asRole(owner,c=>c.query('select list_gst_direct_destinations($1) data',[restaurant]));
    expect(rows[0].data).toEqual([{session_id:session,state_code:'27',delivery_address:address}]);
    await expect(asRole(kitchen,c=>c.query('select list_gst_direct_destinations($1)',[restaurant]))).rejects.toMatchObject({code:'42501'});
    const prep=(actor:string|null,outlet=restaurant,role:'anon'|'authenticated'='authenticated')=>asRole(actor,
      c=>c.query('select * from list_gst_direct_prep_routes($1,$2)',[outlet,[order]]),role);
    expect((await prep(kitchen)).rows).toEqual([{order_id:order,fulfilment_kind:'direct_delivery'}]);
    expect((await prep(outside,b.restaurant)).rows).toEqual([]);
    await expect(prep(outside)).rejects.toMatchObject({code:'42501'});
    await expect(prep(null,restaurant,'anon')).rejects.toMatchObject({code:'42501'});
    // Same-PAN evidence arrives after the order. Both payment doors must
    // serialize with the sibling save, not read the old committed review
    // while the new save is in progress and record a payment anyway.
    const paymentConn=new Client({connectionString:URL_VALUE}); await paymentConn.connect();
    try {
      await asRole(outside,async c=>{
        await save(c,b.restaurant,0,{...regular(syntheticGstin(`27${pan}2Z`)),preceding_fy_turnover_paise:5_000_000_001});
        const counterSql="select record_counter_payment($1,$2,'cash',$3,$4)";
        for (const [sql,params] of [[counterSql,[slug,order,10500,randomUUID()]],
          ['select mark_order_session_paid($1)',[session]]] as const) {
          await expect(asRole(owner,async p=>{
            await p.query("set local lock_timeout='200ms'");
            return p.query(sql,[...params]);
          },'authenticated',paymentConn)).rejects.toMatchObject({code:'55P03'});
        }
      });
    } finally { await paymentConn.end(); }
    await expect(place({1:randomUUID()})).rejects.toThrow(/current PAN review/i);
    await expect(asRole(owner,c=>c.query('select mark_order_session_paid($1)',[session]))).rejects.toThrow(/do not accept payment/i);
    await expect(asRole(owner,c=>c.query("select record_counter_payment($1,$2,'cash',$3,$4)",[slug,order,10500,randomUUID()]))).rejects.toThrow(/do not accept payment/i);
    await expect(asRole(owner,c=>c.query('select close_order_session_and_issue_receipt($1,$2)',[session,BUYER]))).rejects.toThrow(/full outstanding balance/i);
    expect(await place()).toBe(session); // same saved evidence, no duplicate admission

    expect((await db.query('select status from order_sessions where id=$1',[session])).rows[0].status).toBe('open');
    expect((await db.query('select count(*)::int n from restaurant_invoice_series where restaurant_id=$1',[restaurant])).rows[0].n).toBe(0);
    expect((await db.query('select amount_paise,status from payments where restaurant_id=$1',[restaurant])).rows).toEqual([]);
  });

  it('lets concurrent Regular delivery payments take a shared PAN review lock without upgrading it', async () => {
    const owner=randomUUID(), slug=`${slugBase}-direct-pan-readers`;
    const {restaurant,item,gstin,pan}=await makeRestaurant(slug,owner);
    await asRole(owner,c=>save(c,restaurant,0,{...regular(gstin),activation:aatoReview(4_000_000_000)}));
    const place=async ()=>(await asRole(owner,c=>c.query("select place_gst_direct_ticket($1,$2,'direct_delivery',$3,true,'27','Synthetic delivery address') id",
      [restaurant,randomUUID(),JSON.stringify([{item_id:item,qty:1}])]))).rows[0].id;
    const a=await place(), b=await place();
    const peers=[new Client({connectionString:URL_VALUE}),new Client({connectionString:URL_VALUE})];
    await Promise.all(peers.map(c=>c.connect()));
    await db.query('begin');
    try {
      // A held shared lock stands for another in-progress checkout. The old
      // shared-to-exclusive upgrade cannot complete until it is released.
      await db.query('select pg_advisory_xact_lock_shared(hashtextextended(lower($1),9132))',[pan]);
      const settle=(id:string,conn:Client)=>asRole(owner,async c=>{
        await c.query("set local statement_timeout='2s'");
        return c.query('select mark_order_session_paid($1)',[id]);
      },'authenticated',conn);
      const settled=await Promise.allSettled([settle(a,peers[0]),settle(b,peers[1])]);
      expect(settled.map(x=>x.status)).toEqual(['fulfilled','fulfilled']);
    } finally { await db.query('rollback'); await Promise.all(peers.map(c=>c.end())); }
    expect((await db.query('select count(*)::int n,sum(amount_paise)::int total from payments where restaurant_id=$1',[restaurant])).rows[0])
      .toEqual({n:2,total:21000});
  });

  it('issues a complete identified direct-delivery document privately without offering a redacted Rule 46 copy', async () => {
    const owner=randomUUID(), {restaurant,item,gstin}=await makeRestaurant(`${slugBase}-direct-private`,owner);
    await asRole(owner,c=>save(c,restaurant,0,{...regular(gstin),activation:aatoReview(5_000_000_000)}));
    await db.query('update items set is_alcoholic=false,price_paise=5250000 where id=$1',[item]);
    const address='Private synthetic direct shipping lane';
    const {id:session}=(await asRole(owner,c=>c.query("select place_gst_direct_ticket($1,$2,'direct_delivery',$3,true,'27',$4) id",
      [restaurant,randomUUID(),JSON.stringify([{item_id:item,qty:1}]),address]))).rows[0];
    await asRole(owner,c=>c.query('select mark_order_session_paid($1)',[session]));
    const close=(recipient:unknown)=>asRole(owner,c=>c.query('select close_order_session_and_issue_receipt($1,$2) id',[session,recipient]));
    await expect(close(null)).rejects.toThrow(/Rule 46/i);
    const {id}=(await close({recipient_type:'consumer',name:'Synthetic customer',address:'Synthetic billing lane',state_code:'27'})).rows[0];
    expect((await db.query('select gst_snapshot,customer_snapshot from restaurant_invoices where id=$1',[id])).rows[0])
      .toMatchObject({gst_snapshot:{taxable_paise:5000000},customer_snapshot:{recipient_type:'consumer',delivery_address:address}});
    const hash=randomBytes(32).toString('hex');
    await expect(asRole(owner,c=>c.query('select create_restaurant_invoice_share_link($1,$2)',[id,hash]))).rejects.toThrow(/print this invoice privately/i);
    expect((await asRole(null,c=>c.query('select read_shared_restaurant_invoice($1) bill',[hash]),'anon')).rows[0].bill).toBeNull();
  });

  it('consolidates only finance memberships within a selected account, with stable linkage and independent payments', async () => {
    const owner=randomUUID(), coOwner=randomUUID();
    await db.query('insert into profiles(id) values($1),($2)',[owner,coOwner]);
    const {rows:[acct]}=await db.query('insert into accounts(owner_id) values($1) returning id',[owner]);
    const {rows:[unrelated]}=await db.query('insert into accounts(owner_id) values($1) returning id',[coOwner]);
    const tag=`${slugBase}-finance`;
    const r1=await makeRestaurant(tag+'-a',owner,acct.id), r2=await makeRestaurant(tag+'-b',coOwner,acct.id);
    const excluded=await makeRestaurant(tag+'-c',coOwner,acct.id), otherAccount=await makeRestaurant(tag+'-foreign',owner,unrelated.id);
    await db.query("insert into memberships(restaurant_id,user_id,role) values($1,$3,'manager'),($2,$3,'cashier')",[r2.restaurant,excluded.restaurant,owner]);
    const add=async (f:typeof r1,actor:string,k:string,kind:'regular'|'off')=>{
      const {sitting}=await placeOrder(tag+k,f.item,1);
      if (kind === 'regular') expect((await placeOrder(tag+k,f.item,1)).sitting).toBe(sitting);
      return { id:await closeAndIssue(actor,sitting,kind==='regular' ? CONSUMER : null), kind };
    };
    await asRole(owner,c=>save(c,r1.restaurant,0,regular(r1.gstin)));
    await asRole(coOwner,c=>save(c,r2.restaurant,0,OFF));
    await db.query('update items set price_paise=10511 where id=$1',[r1.item]);
    await db.query("update restaurants set name='=Synthetic exported outlet, escaped' where id=$1",[r1.restaurant]);
    const sale=await add(r1,owner,'-a','regular'), retail=await add(r2,coOwner,'-b','off');
    await add(excluded,coOwner,'-c','off'); await add(otherAccount,owner,'-foreign','off');
    const note=(await asRole(owner,c=>c.query("select issue_invoice_note($1,'credit_note','returned_supply','Synthetic adjustment, not a refund') id",[sale.id]))).rows[0].id;
    await asRole(coOwner,c=>c.query('select void_restaurant_invoice($1,$2)',[retail.id,'Synthetic void evidence']));
    const report=(scope='account',status:string|null=null,detailLimit=10,pivot=r1.restaurant)=>asRole(owner,async c=>(await c.query(
      'select report_gst_finance($1,$2,$2::date+1,p_detail_limit=>$3,p_scope=>$4,p_status=>$5) data',[pivot,indiaToday(),detailLimit,scope,status])).rows[0].data);
    const consolidated=await report();
    expect(consolidated.outlets.map((r:{id:string})=>r.id)).toEqual([r1.restaurant,r2.restaurant].sort());
    expect(consolidated).toMatchObject({document_count:3,payments:expect.arrayContaining([
      {outlet_id:r1.restaurant,status:'recorded',linked_to:'issued_sitting',count:2,amount_paise:21022},
      {outlet_id:r2.restaurant,status:'recorded',linked_to:'void_only_sitting',count:1,amount_paise:10500},
    ])});
    expect(consolidated.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({id:note,source_id:sale.id,profile:'other_than_specified_premises',kind:'credit_note',gross:21022,paid_at_issue:null}),
      expect.objectContaining({id:retail.id,lifecycle:'voided',profile:'unregistered',taxable:null}),
    ]));
    expect(JSON.stringify(consolidated)).not.toContain(excluded.restaurant);
    expect(JSON.stringify(consolidated)).not.toContain(otherAccount.restaurant);
    const filters = getGstFilters(new URLSearchParams({scope:'account',from:indiaToday(),through:indiaToday()}))!;
    const csv = gstLedgerCsv(consolidated,filters);
    expect(csv).toContain(`"'=Synthetic exported outlet, escaped"`);
    expect(csv).toContain(',210.22,200.21,5.01,5.00,0.00,210.22,-0.01,other_than_specified_premises,500,');
    expect(csv).toContain(',recorded,issued_sitting,2,210.22\r\n');
    expect(csv).toContain(',recorded,void_only_sitting,1,105.00\r\n');
    for (const value of [CONSUMER.name,CONSUMER.address,excluded.restaurant,otherAccount.restaurant]) expect(csv).not.toContain(value);
    expect(await report()).toEqual(consolidated);
    expect(await report('selected')).toMatchObject({document_count:2});
    expect(await report('account','voided')).toMatchObject({document_count:1,payments:consolidated.payments});
    const limited=await report('account',null,1);
    expect(limited).toMatchObject({document_count:3,buckets:consolidated.buckets}); expect(limited.documents).toHaveLength(1);
    await expect(report('account',null,1,excluded.restaurant)).rejects.toMatchObject({code:'42501'});
    expect((await db.query("select gst_finance_lifecycle('issued','cancelled') cancelled,gst_finance_lifecycle('issued','generated') unapproved")).rows[0])
      .toEqual({cancelled:'cancelled',unapproved:'held'});
  });

});
