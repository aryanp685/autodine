/**
 * Credit/debit note lifecycle regression against disposable PostgreSQL.
 *
 * Covers 20261114000500_credit_debit_notes.sql: issuance against GST
 * documents only, immutable snapshot amounts, series allocation, one live
 * note of each kind per source, audited void terminal transition, note IRP
 * audit rows, and the RLS read boundary. Every test runs against a
 * locally-created autodine_check_* database — never a hosted instance.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { syntheticGstin, SYNTHETIC_BUYER, SYNTHETIC_FSSAI, SYNTHETIC_SERVICE_SAC } from '@/lib/gst/test-fixtures';
const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Note tests require a locally-created disposable autodine_check_* database');
  }
}

let gstinSeq = 100;
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

async function makeRestaurant(slug: string, user: string): Promise<{ restaurant: string; item: string; gstin: string; pan: string }> {
  const { gstin, pan } = nextGstin();
  await db.query('insert into profiles(id) values ($1)', [user]);
  const restaurant = (await db.query(
    `insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
     values ($1,'Note Test Kitchen','Registered office, Test Lane',0,'scan') returning id`, [slug])).rows[0].id;
  await db.query(`insert into memberships(restaurant_id,user_id,role) values ($1,$2,'owner')`, [restaurant, user]);
  const menu = (await db.query(`insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id`,[restaurant])).rows[0].id;
  const category = (await db.query(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id`,[restaurant,menu])).rows[0].id;
  const item = (await db.query(`insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Plate',10500,true) returning id`,[restaurant,category])).rows[0].id;
  const table = (await db.query(`insert into dining_tables(restaurant_id,label) values($1,'N1') returning id`,[restaurant])).rows[0].id;
  await db.query(`insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)`,[restaurant,table,randomUUID().replaceAll('-','') + randomUUID().replaceAll('-','')]);
  return { restaurant, item, gstin, pan };
}

async function placeOrder(slug: string, item: string, qty: number) {
  const token = (await db.query('select public_token from table_qr_codes where restaurant_id=(select id from restaurants where slug=$1)', [slug])).rows[0].public_token;
  const sessionToken = (await db.query('select * from open_table_session($1,$2)',[token,'a'.repeat(64)])).rows[0].session_token;
  const code = (await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',[slug,JSON.stringify([{itemId:item,qty}]),sessionToken,randomUUID()])).rows[0].code;
  const order = (await db.query('select id,order_session_id from orders where restaurant_id=(select id from restaurants where slug=$1) and code=$2',[slug,code])).rows[0];
  return { order: order.id, sitting: order.order_session_id };
}

async function setGstConfig(restaurant: string, config: Record<string, unknown>) {
  const today = (await db.query("select ((now() at time zone 'Asia/Kolkata')::date)::text as day")).rows[0].day;
  config = { fssai_number: SYNTHETIC_FSSAI, service_sac: SYNTHETIC_SERVICE_SAC,
    ...(config.mode === 'regular' ? { business_type: 'standalone', activation: {
      effective_from: today, premises_address: '1 Disposable Note Test Lane', premises_state_code: '27', invoice_phone: '07120000000',
    } } : {}), ...config };
  const cols = Object.keys(config);
  const values = Object.values(config);
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  await db.query(
    `insert into public.restaurant_gst_config(restaurant_id,${cols.join(',')}) values ($1,${placeholders})
     on conflict (restaurant_id) do update set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}`,
    [restaurant, ...values]);
}

const REGULAR_CONFIG = (gstin: string, pan: string) => ({
  mode: 'regular', regular_profile: 'other_than_specified_premises',
  gstin, legal_name: 'Note Test Kitchen LLP', trade_name: 'Note Test',
  address: 'Registered office, Test Lane, Nagpur', state_code: '27', pan,
  registration_type: 'regular', preceding_fy_turnover_paise: 1_000_000_000,
});

const CONSUMER = { recipient_type: 'consumer', name: 'Synthetic Note Recipient', address: '1 Disposable Billing Lane', state_code: '29' };
async function issueRegularGSTDocument(user: string, slug: string, item: string, qty = 2, identified = true): Promise<string> {
  const { sitting } = await placeOrder(slug, item, qty);
  const cfg = (await db.query('select c.mode from restaurant_gst_config c join restaurants r on r.id=c.restaurant_id where r.slug=$1',[slug])).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query('select mark_order_session_paid($1)', [sitting]);
  try {
    return (await db.query('select close_order_session_and_issue_receipt($1,$2) id', [sitting, identified && cfg?.mode === 'regular' ? CONSUMER : null])).rows[0].id;
  } finally {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

async function asActor(user: string, work: () => Promise<unknown>): Promise<unknown> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try { return await work(); } finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
const issueNote = (user: string, invoiceId: string, kind: string, reasonCode: string, reason: string) =>
  asActor(user, () => db.query('select issue_invoice_note($1,$2,$3,$4) id', [invoiceId, kind, reasonCode, reason]));

describe.skipIf(!URL_VALUE)('Credit/debit notes (disposable PostgreSQL)', () => {
  const slugBase = 'note-' + randomUUID().slice(0, 8);
  beforeAll(async () => { db = new Client({ connectionString: URL_VALUE }); await db.connect(); }, 30000);
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => { await db.query("select set_config('request.jwt.claim.sub','',false)"); });

  it('owner issues a credit note mirroring the parent GST snapshot, with series allocation and audit events', async () => {
    const user = randomUUID(); const slug = `${slugBase}-cn-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 2);

    const noteId = (await issueNote(user, invoiceId, 'credit_note', 'returned_supply', 'Goods returned by the customer') as { rows: Array<{ id: string }> }).rows[0].id;
    const note = (await db.query(
      'select document_number, status, irp_status, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, source_document_number, reason_code from restaurant_notes where id=$1',
      [noteId])).rows[0];
    expect(note.document_number).toMatch(/^CN\/[0-9]{2}-[0-9]{2}\/000001$/);
    expect(note.status).toBe('issued');
    expect(note.irp_status).toBe('not_required');
    // 2 × ₹105.00 inclusive @5% -> ₹200 taxable, ₹5+₹5 GST, ₹210 total.
    expect([Number(note.taxable_paise), Number(note.cgst_paise), Number(note.sgst_paise), Number(note.igst_paise), Number(note.total_paise)])
      .toEqual([20000, 500, 500, 0, 21000]);
    const parent = (await db.query('select invoice_number, irp_status from restaurant_invoices where id=$1', [invoiceId])).rows[0];
    expect(note.source_document_number).toBe(parent.invoice_number);
    const events = (await db.query("select event, reason from restaurant_note_events where note_id=$1", [noteId])).rows;
    expect(events.map((e) => e.event)).toEqual(['issued']);
    expect(events[0].reason).toContain('returned_supply');
  }, 20000);

  it('one live note of each kind per source; a voided note frees the kind for a renumbered replacement', async () => {
    const user = randomUUID(); const slug = `${slugBase}-dup-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);

    await issueNote(user, invoiceId, 'credit_note', 'rate_difference', 'Charged less than billed');
    await expect(issueNote(user, invoiceId, 'credit_note', 'rate_difference', 'Charged less than billed again')).rejects.toMatchObject({ code: 'P0001' });
    const debit = (await issueNote(user, invoiceId, 'debit_note', 'rate_difference', 'Supplier short-shipped us') as { rows: Array<{ id: string }> }).rows[0].id;
    expect((await db.query('select document_number from restaurant_notes where id=$1', [debit])).rows[0].document_number).toMatch(/^DN\/[0-9]{2}-[0-9]{2}\/000001$/);

    const first = (await db.query("select id from restaurant_notes where invoice_id=$1 and document_type='credit_note'", [invoiceId])).rows[0].id;
    await asActor(user, () => db.query('select void_invoice_note($1,$2)', [first, 'Wrong reason recorded']));
    const replacement = (await issueNote(user, invoiceId, 'credit_note', 'quantity_difference', 'Quantity was short by two plates') as { rows: Array<{ id: string }> }).rows[0].id;
    expect((await db.query('select document_number from restaurant_notes where id=$1', [replacement])).rows[0].document_number).toMatch(/^CN\/[0-9]{2}-[0-9]{2}\/000002$/);
  }, 20000);

  it('the unique index backstop refuses a second live credit note even written directly', async () => {
    const user = randomUUID(); const slug = `${slugBase}-idx-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);
    await issueNote(user, invoiceId, 'credit_note', 'other', 'Direct-insert backstop check');
    await expect(db.query(`
      insert into restaurant_notes (restaurant_id, invoice_id, document_type, document_number, financial_year,
        sequence_number, reason_code, reason, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
        gst_snapshot, seller_snapshot, customer_snapshot, totals_snapshot, source_document_number, source_issued_at)
      select restaurant_id, invoice_id, 'credit_note', 'CN/' || financial_year || '/999998', financial_year,
             999998, 'other', 'Direct insert backstop', taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
             gst_snapshot, seller_snapshot, customer_snapshot, totals_snapshot, source_document_number, source_issued_at
        from restaurant_notes where invoice_id = $1 and document_type = 'credit_note'`, [invoiceId]))
      .rejects.toMatchObject({ code: '23505' });
  }, 20000);

  it('notes against a plain (off-mode) receipt are refused', async () => {
    const user = randomUUID(); const slug = `${slugBase}-rcpt-${randomUUID().slice(0,4)}`;
    const { item } = await makeRestaurant(slug, user); // no GST config => off mode
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);
    await expect(issueNote(user, invoiceId, 'credit_note', 'other', 'Attempt against a plain receipt')).rejects.toMatchObject({ code: 'P0001' });
  }, 20000);

  it('notes against a voided document are refused', async () => {
    const user = randomUUID(); const slug = `${slugBase}-void-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);
    await asActor(user, () => db.query("select void_restaurant_invoice($1,$2)", [invoiceId, 'Cancelled by the owner outright']));
    await expect(issueNote(user, invoiceId, 'credit_note', 'other', 'Attempt against a voided document')).rejects.toMatchObject({ code: 'P0001' });
  }, 20000);

  it('refuses a new tax note against a tax-free Bill of Supply without consuming a note number', async () => {
    const user = randomUUID(); const slug = `${slugBase}-comp-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, {
      mode: 'composition', gstin, legal_name: 'Composition Kitchen LLP', address: 'Registered office, Test Lane',
      state_code: '27', pan, registration_type: 'composition', composition_acknowledged: true,
    });
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);
    await expect(issueNote(user, invoiceId, 'debit_note', 'rate_difference', 'Composition price uplift'))
      .rejects.toMatchObject({ code: '23514', message: expect.stringMatching(/Bill of Supply corrections/) });
    expect((await db.query('select count(*)::int n from restaurant_note_series where restaurant_id=$1',[restaurant])).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int n from restaurant_notes where invoice_id=$1',[invoiceId])).rows[0].n).toBe(0);
  });

  it('refuses to invent an anonymous original buyer and freezes the identified original on both note kinds', async () => {
    const user = randomUUID(); const slug = `${slugBase}-recipient-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const anonymous = await issueRegularGSTDocument(user, slug, item, 1, false);
    for (const kind of ['credit_note','debit_note']) {
      await expect(issueNote(user, anonymous, kind, 'other', 'Anonymous original cannot be amended here'))
        .rejects.toMatchObject({code:'23514', message:expect.stringMatching(/Rule 53/)});
    }
    const identified = await issueRegularGSTDocument(user,slug,item,1);
    for (const kind of ['credit_note','debit_note']) await issueNote(user,identified,kind,'other','Synthetic identified original');
    const notes = (await db.query(`select n.sequence_number,n.customer_snapshot,n.gst_snapshot->'rate_bps' rate,
      n.source_document_number=i.invoice_number and n.source_issued_at=i.issued_at source_matches
      from restaurant_notes n join restaurant_invoices i on i.id=n.invoice_id where n.invoice_id=$1`,[identified])).rows;
    expect(notes).toEqual(Array.from({length:2},()=>({sequence_number:1,rate:500,source_matches:true,
      customer_snapshot:{...CONSUMER,delivery_address:'1 Disposable Note Test Lane'}})));
  });

  it('cashier, kitchen and outsiders cannot issue or void notes; the unauthenticated role is refused', async () => {
    const user = randomUUID(); const cashier = randomUUID(); const kitchen = randomUUID(); const outsider = randomUUID();
    const slug = `${slugBase}-role-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await db.query('insert into profiles(id) values ($1),($2),($3)', [cashier, kitchen, outsider]);
    await db.query(`insert into memberships(restaurant_id,user_id,role) values ($1,$2,'cashier'),($1,$3,'kitchen')`, [restaurant, cashier, kitchen]);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);

    await expect(issueNote(cashier, invoiceId, 'credit_note', 'other', 'Cashier attempt to issue a note')).rejects.toMatchObject({ code: '42501' });
    await expect(issueNote(kitchen, invoiceId, 'credit_note', 'other', 'Kitchen attempt to issue a note')).rejects.toMatchObject({ code: '42501' });
    await expect(issueNote(outsider, invoiceId, 'credit_note', 'other', 'Outsider attempt to issue a note')).rejects.toMatchObject({ code: '42501' });
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await expect(db.query('select issue_invoice_note($1,$2,$3,$4)', [invoiceId, 'credit_note', 'other', 'Anonymous attempt to issue'])).rejects.toMatchObject({ code: '42501' });

    const noteId = (await issueNote(user, invoiceId, 'credit_note', 'other', 'Owner issues for void-permission checks') as { rows: Array<{ id: string }> }).rows[0].id;
    await expect(asActor(cashier, () => db.query('select void_invoice_note($1,$2)', [noteId, 'Cashier trying to void']))).rejects.toMatchObject({ code: '42501' });
    await expect(asActor(kitchen, () => db.query('select void_invoice_note($1,$2)', [noteId, 'Kitchen trying to void']))).rejects.toMatchObject({ code: '42501' });
    await expect(asActor(outsider, () => db.query('select void_invoice_note($1,$2)', [noteId, 'Outsider trying to void']))).rejects.toMatchObject({ code: '42501' });
    await expect(asActor(cashier, () => db.query("select record_note_irp_request($1,'sandbox','autodine.irp.v1','payload_built')", [noteId]))).rejects.toMatchObject({ code: '42501' });
  }, 20000);

  it('void is audited, terminal, and never deletes or rewrites the note', async () => {
    const user = randomUUID(); const slug = `${slugBase}-immut-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);
    const noteId = (await issueNote(user, invoiceId, 'credit_note', 'post_supply_change', 'Buyer returned the whole order') as { rows: Array<{ id: string }> }).rows[0].id;

    await asActor(user, () => db.query('select void_invoice_note($1,$2)', [noteId, 'Issued against the wrong document']));
    const note = (await db.query('select status, voided_by, void_reason from restaurant_notes where id=$1', [noteId])).rows[0];
    expect(note.status).toBe('voided');
    expect(note.voided_by).toBe(user);
    expect(note.void_reason).toBe('Issued against the wrong document');
    const events = (await db.query('select event from restaurant_note_events where note_id=$1 order by created_at, event', [noteId])).rows.map((r) => r.event);
    expect(events.sort()).toEqual(['issued', 'voided']);

    await expect(asActor(user, () => db.query('select void_invoice_note($1,$2)', [noteId, 'Voiding it a second time']))).rejects.toMatchObject({ code: 'P0001' });
    await expect(db.query('delete from restaurant_notes where id=$1', [noteId])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('update restaurant_notes set taxable_paise = 1 where id=$1', [noteId])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query("update restaurant_notes set voided_reason = 'rewritten' where id=$1", [noteId])).rejects.toMatchObject({ code: '42703' });
    await expect(db.query("update restaurant_notes set void_reason = 'rewritten after the fact' where id=$1", [noteId])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('update restaurant_note_events set reason=$2 where note_id=$1', [noteId, 'rewritten'])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('delete from restaurant_note_events where note_id=$1', [noteId])).rejects.toMatchObject({ code: '42501' });
  }, 20000);

  it('note IRP attempts are appended, sequenced per note, and never accepted for a foreign note', async () => {
    const user = randomUUID(); const slug = `${slugBase}-irp-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, REGULAR_CONFIG(gstin, pan));
    const invoiceId = await issueRegularGSTDocument(user, slug, item, 1);
    const noteId = (await issueNote(user, invoiceId, 'credit_note', 'other', 'IRP audit fixture note') as { rows: Array<{ id: string }> }).rows[0].id;

    const HASH_A = 'a'.repeat(64); const HASH_B = 'b'.repeat(64);
    await asActor(user, () => db.query("select record_note_irp_request($1,'sandbox','autodine.irp.v1','payload_built',$2)", [noteId, HASH_A]));
    await asActor(user, () => db.query("select record_note_irp_request($1,'sandbox','autodine.irp.v1','submitted',$2,$3)", [noteId, HASH_A, HASH_B]));
    const rows = (await db.query('select attempt_no, status, invoice_id, note_id from restaurant_irp_requests where note_id=$1 order by attempt_no', [noteId])).rows;
    expect(rows.map((r) => [r.attempt_no, r.status])).toEqual([[1, 'payload_built'], [2, 'submitted']]);
    expect(rows.every((r) => r.invoice_id === null && r.note_id === noteId)).toBe(true);

    await expect(asActor(user, () => db.query("select record_note_irp_request($1,'sandbox','autodine.irp.v1','bogus')", [noteId]))).rejects.toMatchObject({ code: '23514' });
    await expect(asActor(user, () => db.query("select record_note_irp_request($1,'sandbox','autodine.irp.v1','payload_built')", [randomUUID()]))).rejects.toMatchObject({ code: 'P0002' });
  }, 20000);

  it('an e-invoice-pending B2B parent cannot acquire a new adjustment (fail closed)', async () => {
    const user = randomUUID(); const slug = `${slugBase}-einv-${randomUUID().slice(0,4)}`;
    const { restaurant, item, gstin, pan } = await makeRestaurant(slug, user);
    await setGstConfig(restaurant, { ...REGULAR_CONFIG(gstin, pan), preceding_fy_turnover_paise: 6_000_000_000_00 });
    const { sitting } = await placeOrder(slug, item, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.query('select mark_order_session_paid($1)', [sitting]);
    let invoiceId: string;
    try {
      invoiceId = (await db.query('select close_order_session_and_issue_receipt($1,$2::jsonb) id',
        [sitting, JSON.stringify({ name: 'Buyer Foods LLP', gstin: SYNTHETIC_BUYER, location: 'Synthetic City', pincode: '560001', address: 'Buyer House, MIDC, Pune' })])).rows[0].id;
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    expect((await db.query('select irp_status from restaurant_invoices where id=$1', [invoiceId])).rows[0].irp_status).toBe('pending');
    await expect(issueNote(user, invoiceId, 'credit_note', 'returned_supply', 'Buyer returned 100 percent of supply'))
      .rejects.toMatchObject({code:'P0001',message:expect.stringMatching(/original.*held/i)});
  }, 20000);

  it('staff of another outlet cannot read the notes (RLS boundary)', async () => {
    const aUser = randomUUID(); const bUser = randomUUID();
    const aSlug = `${slugBase}-rls-a-${randomUUID().slice(0,4)}`; const bSlug = `${slugBase}-rls-b-${randomUUID().slice(0,4)}`;
    const a = await makeRestaurant(aSlug, aUser);
    await makeRestaurant(bSlug, bUser);
    await setGstConfig(a.restaurant, REGULAR_CONFIG(a.gstin, a.pan));
    const invoiceId = await issueRegularGSTDocument(aUser, aSlug, a.item, 1);
    await issueNote(aUser, invoiceId, 'credit_note', 'other', 'RLS fixture note for outlet A');

    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [bUser]);
      await db.query('set local role authenticated');
      const rows = (await db.query('select id from restaurant_notes')).rows;
      expect(rows).toEqual([]);
      const events = (await db.query('select id from restaurant_note_events')).rows;
      expect(events).toEqual([]);
    } finally {
      await db.query('rollback');
    }
  }, 20000);
});
