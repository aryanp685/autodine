import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
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
  // Valid GSTIN layout (state + PAN + entity + Z + checksum shape); the
  // database does not verify the checksum, the app does.
  const gstin = `27${pan}1Z${String.fromCharCode(65 + ((n * 7 + 1) % 26))}`;
  return { gstin, pan };
}
const OTHER_GSTIN = '29ABCPK1234L1ZS';
void OTHER_GSTIN;

let db: Client;

async function makeRestaurant(slug: string, user: string): Promise<{ restaurant: string; item: string; gstin: string; pan: string }> {
  const { gstin, pan } = nextGstin();
  await db.query('insert into profiles(id) values ($1)', [user]);
  const restaurant = (await db.query(
    `insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
     values ($1,'GST Test Kitchen','Registered office, Test Lane',0,'scan') returning id`, [slug])).rows[0].id;
  await db.query(`insert into memberships(restaurant_id,user_id,role) values ($1,$2,'owner')`, [restaurant, user]);
  const menu = (await db.query(`insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id`,[restaurant])).rows[0].id;
  const category = (await db.query(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id`,[restaurant,menu])).rows[0].id;
  // ₹105.00 inclusive at 5% -> ₹100.00 taxable + ₹5.00 GST, exactly.
  const item = (await db.query(`insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Plate',10500,true) returning id`,[restaurant,category])).rows[0].id;
  const table = (await db.query(`insert into dining_tables(restaurant_id,label) values($1,'G1') returning id`,[restaurant])).rows[0].id;
  await db.query(`insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)`,[restaurant,table,randomUUID().replaceAll('-','') + randomUUID().replaceAll('-','')]);
  return { restaurant, item, gstin, pan };
}

async function placeOrder(slug: string, item: string, qty: number): Promise<{ code: string; order: string; sitting: string }> {
  const { rows } = await db.query('select public_token from table_qr_codes where restaurant_id = (select id from restaurants where slug = $1)', [slug]);
  const token: string = rows[0]?.public_token;
  // guest sessions are minted through the QR path; emulate via open_table_session like the readiness fixture
  const sessionToken = (await db.query('select * from open_table_session($1,$2)',[token,'a'.repeat(64)])).rows[0].session_token;
  const code = (await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',[slug,JSON.stringify([{itemId:item,qty}]),sessionToken,randomUUID()])).rows[0].code;
  const order = (await db.query('select id,order_session_id from orders where restaurant_id=(select id from restaurants where slug=$1) and code=$2',[slug,code])).rows[0];
  return { code, order: order.id, sitting: order.order_session_id };
}

async function setGstConfig(restaurant: string, config: Record<string, unknown>) {
  const cols = Object.keys(config);
  const values = Object.values(config);
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  await db.query(
    `insert into public.restaurant_gst_config(restaurant_id,${cols.join(',')}) values ($1,${placeholders})
     on conflict (restaurant_id) do update set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}`,
    [restaurant, ...values]);
}

async function closeAndIssue(user: string, sitting: string): Promise<string> {
  await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return (await db.query('select issue_closed_session_receipt($1) id', [sitting])).rows[0].id;
  } finally {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

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
    expect(inv.irp_status).toBe('not_required'); // B2C — recipient capture not built
    const totals = inv.totals_snapshot;
    expect(Number(totals.taxable_paise)).toBe(20000);
    expect(Number(totals.cgst_paise) + Number(totals.sgst_paise)).toBe(Number(totals.tax_paise));
    expect(Number(totals.total_paise)).toBe(21000);
  }, 20000);

  it('composition requires acknowledgment, then issues a tax-free Bill of Supply', async () => {
    const user = randomUUID(); const slug = `${slugBase}-cmp-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await expect(setGstConfig(restaurant, {
      mode: 'composition', gstin, legal_name: 'GST Test Kitchen LLP',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'composition', composition_acknowledged: false,
    })).rejects.toThrow(/acknowledge/i);
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
      mode: 'regular', regular_profile: 'specified_premises',
      gstin, legal_name: 'Hotel Attached Restaurant Pvt Ltd',
      address: 'Hotel Tower, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', specified_premises_attested: true,
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
    void OTHER_GSTIN;
  }, 20000);

  it('regular GST: B2B issue records the buyer, snapshots it, and defers finalisation to a future IRN at/above the e-invoice threshold', async () => {
    const user = randomUUID(); const slug = `${slugBase}-b2b-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    // ₹60 crore AATO — above the ₹5 crore e-invoice threshold.
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Threshold Test Pvt Ltd', trade_name: 'Threshold',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000_00,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    const recipient = { name: 'Buyer Foods LLP', gstin: '27AAICA9305C1Z9', address: 'Buyer House, MIDC, Pune', email: 'accounts@buyer.example' };
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select issue_closed_session_receipt($1,$2::jsonb) id', [sitting, JSON.stringify(recipient)])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const inv = (await db.query(
      'select recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_email, customer_snapshot, irp_status from restaurant_invoices where id=$1',
      [invoiceId])).rows[0];
    expect(inv.recipient_name).toBe('Buyer Foods LLP');
    expect(inv.recipient_gstin).toBe('27AAICA9305C1Z9');
    expect(inv.recipient_state_code).toBe('27'); // derived from GSTIN, not typed
    expect(inv.recipient_address).toBe('Buyer House, MIDC, Pune');
    expect(inv.recipient_email).toBe('accounts@buyer.example');
    expect((inv.customer_snapshot as { gstin?: string }).gstin).toBe('27AAICA9305C1Z9');
    expect(inv.irp_status).toBe('pending'); // must not be rendered final until IRN exists
  }, 20000);

  it('regular GST: buyer GSTIN rejected at/under the threshold is not, but formatting and mode rules still fail closed', async () => {
    const user = randomUUID(); const slug = `${slugBase}-b2c-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    // Exactly ₹5 crore AATO — the threshold is "preceding FY turnover exceeds ₹5 crore".
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Boundary Test Pvt Ltd', trade_name: 'Boundary',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 5_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      const invoiceId = (await db.query('select issue_closed_session_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ name: 'Boundary Buyer', gstin: '29ABCDE1234F1Z5' })])).rows[0].id;
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
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      const invoiceId = (await db.query('select issue_closed_session_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ name: 'Unknown Buyer', gstin: '29ABCDE1234F1Z5' })])).rows[0].id;
      expect((await db.query('select irp_status from restaurant_invoices where id=$1', [invoiceId])).rows[0].irp_status).toBe('pending');
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('rejects buyer details on a normal receipt and on a Bill of Supply — Regular GST only', async () => {
    const offUser = randomUUID(); const offSlug = `${slugBase}-offb2b-${randomUUID().slice(0,4)}`;
    const off = await makeRestaurant(offSlug, offUser);
    const offSitting = (await placeOrder(offSlug, off.item, 1)).sitting;
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [offSitting, offUser]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [offUser]);
    try {
      await expect(db.query('select issue_closed_session_receipt($1,$2::jsonb)',
        [offSitting, JSON.stringify({ name: 'Off Buyer', gstin: '29ABCDE1234F1Z5' })])).rejects.toThrow(/Regular GST/i);
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
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [cmpSitting, cmpUser]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cmpUser]);
    try {
      await expect(db.query('select issue_closed_session_receipt($1,$2::jsonb)',
        [cmpSitting, JSON.stringify({ name: 'Cmp Buyer', gstin: '29ABCDE1234F1Z5' })])).rejects.toThrow(/Regular GST/i);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('rejects malformed buyer GSTIN and a state code that disagrees with the GSTIN', async () => {
    const user = randomUUID(); const slug = `${slugBase}-badgstin-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Format Check Pvt Ltd', trade_name: 'Format',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      await expect(db.query('select issue_closed_session_receipt($1,$2::jsonb)',
        [sitting, JSON.stringify({ name: 'Bad GSTIN', gstin: 'XXAAICA9305C1Z9' })])).rejects.toThrow(/GSTIN/i);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('composition mode refuses a buyer GSTIN state prefix outside the 01–38 range', async () => {
    const user = randomUUID(); const slug = `${slugBase}-badele-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Range Check Pvt Ltd', trade_name: 'Range',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      await expect(db.query('select issue_closed_session_receipt($1,$2::jsonb)',
        [sitting, JSON.stringify({ name: 'Far Away Buyer', gstin: '99AAICA9305C1Z9' })])).rejects.toThrow(/state code/i);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }, 20000);

  it('alcoholic lines block every GST document but never a normal receipt', async () => {
    const user = randomUUID(); const slug = `${slugBase}-alc-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await db.query('update items set is_alcoholic = true where id = $1', [item]);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Alcohol Test Pvt Ltd', trade_name: 'Alcohol',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular',
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await expect(closeAndIssue(user, sitting)).rejects.toThrow(/alcoholic/i);

    // and the same alcohol line is perfectly fine on a non-GST receipt
    const user2 = randomUUID(); const slug2 = `${slugBase}-alcok-${randomUUID().slice(0,4)}`;
    const plain = await makeRestaurant(slug2, user2);
    await db.query('update items set is_alcoholic = true where id = $1', [plain.item]);
    const sitting2 = (await placeOrder(slug2, plain.item, 1)).sitting;
    const invoiceId = await closeAndIssue(user2, sitting2);
    expect((await db.query('select document_type from restaurant_invoices where id=$1', [invoiceId])).rows[0].document_type).toBe('receipt');
  }, 20000);

  it('outlets sharing a GSTIN must agree on identity; one PAN cannot straddle regular and Composition', async () => {
    const base = `${slugBase}-shr-${randomUUID().slice(0,4)}`;
    const userA = randomUUID();
    const a = await makeRestaurant(`${base}-a`, userA);
    const sharedGstin = a.gstin;
    const sharedPan = a.pan;
    await setGstConfig(a.restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin: sharedGstin, legal_name: 'Shared Identity LLP', trade_name: 'Shared',
      address: 'Head Office, Test Lane, Nagpur', state_code: '27', pan: sharedPan,
      registration_type: 'regular',
    });
    // Different outlet, same GSTIN, same identity: must be allowed.
    const b = await makeRestaurant(`${base}-b`, randomUUID());
    await setGstConfig(b.restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin: sharedGstin, legal_name: 'Shared Identity LLP', trade_name: 'Shared Branch',
      address: 'Branch Office, Test Lane, Nagpur', state_code: '27', pan: sharedPan,
      registration_type: 'regular',
    });
    // Different outlet, same GSTIN, different legal name: must be refused.
    const c = await makeRestaurant(`${base}-c`, randomUUID());
    await expect(setGstConfig(c.restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin: sharedGstin, legal_name: 'Completely Different Pvt Ltd',
      address: 'Elsewhere, Test Lane, Nagpur', state_code: '27', pan: sharedPan,
      registration_type: 'regular',
    })).rejects.toThrow(/Another outlet under GSTIN/i);
    // Same PAN, different GSTIN, Composition vs regular: must be refused.
    const d = await makeRestaurant(`${base}-d`, randomUUID());
    const samePanOtherGstin = '29' + sharedPan + '2Z7';
    await expect(setGstConfig(d.restaurant, {
      mode: 'composition', gstin: samePanOtherGstin, legal_name: 'Shared Identity LLP',
      address: 'Branch Office, Test Lane, Nagpur', state_code: '29', pan: sharedPan,
      registration_type: 'composition', composition_acknowledged: true,
    })).rejects.toThrow(/same registration type|straddle/i);
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
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000_00,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    const invoiceId = await closeAndIssue(owner, sitting);
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
    const { createHash } = await import('node:crypto');
    const user = randomUUID(); const slug = `${slugBase}-share-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Share Check Pvt Ltd', trade_name: 'Share',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select issue_closed_session_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ name: 'Share Buyer LLP', gstin: '27AAICA9305C1Z9' })])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const hash = createHash('sha256').update(token).digest('hex');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      await db.query('select create_restaurant_invoice_share_link($1,$2)', [invoiceId, hash]);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const shared = (await db.query('select read_shared_restaurant_invoice($1) payload', [hash])).rows[0].payload as { invoice: { customer_snapshot?: { gstin?: string; name?: string } | null } };
    expect(shared.invoice.customer_snapshot?.gstin).toBe('27AAICA9305C1Z9');
    expect(shared.invoice.customer_snapshot?.name).toBe('Share Buyer LLP');
  }, 20000);

  it('the reconciliation view surfaces the pending IRP document with its attempt count', async () => {
    const user = randomUUID(); const slug = `${slugBase}-recon-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'other_than_specified_premises',
      gstin, legal_name: 'Recon View Pvt Ltd', trade_name: 'Recon',
      address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000_00,
    });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [sitting, user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select issue_closed_session_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ name: 'Recon Buyer LLP', gstin: '29ABCDE1234F1ZW' })])).rows[0].id;
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
      mode: 'composition', gstin: '29AAAAA0000A1Z2', legal_name: 'Alcohol Composition Co',
      address: 'Composition Lane, Nagpur', state_code: '29', pan: 'AAAAA0000A',
      registration_type: 'composition', composition_acknowledged: true,
    })).rejects.toThrow(/alcoholic/i);
    // and activating composition first blocks flagging the item afterwards
    await db.query('update items set is_alcoholic = false where id = $1', [item]);
    await setGstConfig(restaurant, {
      mode: 'composition', gstin: '29BBBBB1111B1Z2', legal_name: 'Alcohol Composition Co',
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
      registration_type: 'regular', preceding_fy_turnover_paise: 6_000_000_000_00,
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

  it('the specified-premises effective date defaults to the notification date and is kept on the config', async () => {
    const user = randomUUID(); const slug = `${slugBase}-eff-${randomUUID().slice(0,4)}`;
    const { restaurant, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'regular', regular_profile: 'specified_premises',
      gstin, legal_name: 'Effective Date Pvt Ltd', trade_name: 'Effective',
      address: 'Hotel Tower, Test Lane, Nagpur', state_code: '27', pan,
      registration_type: 'regular', specified_premises_attested: true,
    });
    const row = (await db.query('select specified_premises_effective_from::text as eff from restaurant_gst_config where restaurant_id=$1', [restaurant])).rows[0];
    expect(String(row.eff)).toBe('2025-04-01');
    await setGstConfig(restaurant, { specified_premises_effective_from: '2025-06-01' });
    const row2 = (await db.query('select specified_premises_effective_from::text as eff from restaurant_gst_config where restaurant_id=$1', [restaurant])).rows[0];
    expect(String(row2.eff)).toBe('2025-06-01');
  }, 20000);
});
