import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * P5 — cross-module integration on a real PostgreSQL.
 *
 * These are the seams between modules, not another module's unit test:
 * a guest token that belongs to another outlet, a payment retried by two
 * tabs, a receipt retried after it was already issued, and an issued document
 * standing still while the order around it keeps moving.
 */
const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('P5 integration tests require a locally-created disposable autodine_check_* database');
  }
}

type Outlet = { id: string; slug: string; item: string; order: string; sitting: string; code: string; token: string; session: string; tables: { id: string; card: string; session: string }[] };
type Fixture = { a: Outlet; b: Outlet; floor: Outlet; owner: string; manager: string; cashier: string; kitchen: string; waiter: string; otherOwner: string; callB: string };
let db: Client;

async function outlet(slug: string, tables = 2): Promise<Outlet> {
  const id = (await db.query(`insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
    values ($1,$1,'Test-only address',0,'scan') returning id`, [slug])).rows[0].id;
  const menu = (await db.query("insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id", [id])).rows[0].id;
  const category = (await db.query("insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id", [id, menu])).rows[0].id;
  const item = (await db.query("insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Thali',12500,true) returning id",
    [id, category])).rows[0].id;
  const built: { id: string; card: string; session: string }[] = [];
  let session = '';
  for (let index = 0; index < tables; index += 1) {
    const tableId = (await db.query('insert into dining_tables(restaurant_id,label) values($1,$2) returning id', [id, `T${index + 1}`])).rows[0].id;
    const publicToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)', [id, tableId, publicToken]);
    const opened = (await db.query('select * from open_table_session($1,$2)', [publicToken, 'a'.repeat(64)])).rows[0];
    if (index === 0) session = opened.session_token;
    built.push({ id: tableId, card: publicToken, session: opened.session_token });
  }
  const token = randomUUID();
  const code = (await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',
    [slug, JSON.stringify([{ itemId: item, qty: 2 }]), session, token])).rows[0].code;
  const order = (await db.query('select id,order_session_id from orders where restaurant_id=$1 and code=$2', [id, code])).rows[0];
  return { id, slug, item, order: order.id, sitting: order.order_session_id, code, token, session, tables: built };
}

async function asUser<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await db.query('set local role authenticated');
    const result = await work();
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
async function asAnon<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub','',true)");
    await db.query('set local role anon');
    const result = await work();
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
}
async function refusal(work: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await work(); } catch (error) { return error as { code?: string; message: string }; }
  throw new Error('expected the database to refuse this call');
}

describe.skipIf(!URL_VALUE)('P5 cross-module integration', () => {
  let f: Fixture;
  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
    const people = { owner: randomUUID(), manager: randomUUID(), cashier: randomUUID(), kitchen: randomUUID(), waiter: randomUUID(), otherOwner: randomUUID() };
    await db.query('insert into profiles(id) values ($1),($2),($3),($4),($5),($6)',
      [people.owner, people.manager, people.cashier, people.kitchen, people.waiter, people.otherOwner]);
    const a = await outlet('p5-outlet-a-' + randomUUID());
    const b = await outlet('p5-outlet-b-' + randomUUID());
    // A third outlet for the floor lifecycle: one occupied table, two free ones.
    const floor = await outlet('p5-floor-' + randomUUID(), 3);
    await db.query(`insert into memberships(restaurant_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'manager'),($1,$4,'cashier'),($1,$5,'kitchen'),($1,$6,'waiter')`,
      [a.id, people.owner, people.manager, people.cashier, people.kitchen, people.waiter]);
    await db.query("insert into memberships(restaurant_id,user_id,role) values ($1,$2,'owner')", [b.id, people.otherOwner]);
    await db.query(`insert into memberships(restaurant_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'manager'),($1,$4,'cashier'),($1,$5,'kitchen'),($1,$6,'waiter')`,
      [floor.id, people.owner, people.manager, people.cashier, people.kitchen, people.waiter]);
    // A real guest call at outlet B: the cross-outlet probes below try to touch it.
    await db.query('select call_waiter($1,$2)', [b.session, randomUUID()]);
    const callB = (await db.query("select id from table_waiter_calls where restaurant_id=$1 and status='open'", [b.id])).rows[0].id;
    f = { a, b, floor, ...people, callB };
  }, 60_000);
  beforeEach(async () => { await db.query("select set_config('request.jwt.claim.sub','',false)"); });
  afterAll(async () => { if (db) await db.end(); });

  it('refuses every outlet-A role a write or read into outlet B, and leaves B untouched', async () => {
    for (const user of [f.owner, f.manager, f.cashier, f.kitchen, f.waiter]) {
      expect((await refusal(() => asUser(user, () => db.query('select transfer_open_sitting($1,$2,$3,$4,$5)',
        [f.b.id, f.b.sitting, f.b.tables[0].id, f.b.tables[1].id, randomUUID()])))).code).toBe('42501');
      expect((await refusal(() => asUser(user, () => db.query('select acknowledge_waiter_call($1,$2)', [f.b.id, f.callB])))).code).toBe('42501');
      expect((await refusal(() => asUser(user, () => db.query("select record_counter_payment($1,$2,'cash',25000,$3)",
        [f.b.slug, f.b.order, randomUUID()])))).code).toBe('42501');
      expect((await refusal(() => asUser(user, () => db.query('select set_order_line_quantities($1,$2::jsonb,null)',
        [f.b.order, JSON.stringify([])])))).code).toBe('42501');
    }
    // A guest token from outlet A is not a capability for outlet B.
    expect(await asAnon(async () => (await db.query('select get_public_order($1,$2,$3) o', [f.b.slug, f.b.code, f.a.token])).rows[0].o)).toBeNull();
    const bVersion = (await db.query('select guest_live_version v from orders where id=$1', [f.b.order])).rows[0].v;
    expect(await asAnon(async () => (await db.query('select set_guest_order_lines_at_version($1,$2,$3,$4) s',
      [f.b.order, f.a.token, String(bVersion), JSON.stringify([])])).rows[0].s)).toBe('not_found');

    const untouched = (await db.query(`select
      (select table_id from order_sessions where id=$1) sitting_table,
      (select count(*)::int from payments where restaurant_id=$2) payments,
      (select status from table_waiter_calls where id=$3) call_status,
      (select acknowledged_at from table_waiter_calls where id=$3) acknowledged,
      (select prep_status from orders where id=$4) prep`,
      [f.b.sitting, f.b.id, f.callB, f.b.order])).rows[0];
    expect(untouched).toEqual({ sitting_table: f.b.tables[0].id, payments: 0, call_status: 'open', acknowledged: null, prep: 'new' });
    expect((await db.query('select count(*)::int n from order_operation_history where restaurant_id=$1', [f.b.id])).rows[0].n).toBe(0);
  }, 60_000);

  it('stops a guest edit once the kitchen has started, without moving the version or the audit log', async () => {
    const line = (await db.query('select id from order_items where order_id=$1 order by sort_order limit 1', [f.a.order])).rows[0].id;
    const before = (await db.query('select guest_live_version v from orders where id=$1', [f.a.order])).rows[0].v;
    await asUser(f.kitchen, () => db.query("update orders set prep_status='preparing' where id=$1", [f.a.order]));
    // A kitchen start is a content change, so the guest's older revision is stale.
    // Re-read it to prove the kitchen-state guard refuses a *current* edit too,
    // rather than leaning on the stale-version check.
    const version = (await db.query('select guest_live_version v, prep_status p from orders where id=$1', [f.a.order])).rows[0];
    expect(version.p).toBe('preparing');
    expect(Number(version.v)).toBeGreaterThan(Number(before));
    const refused = await refusal(() => asAnon(() => db.query('select set_guest_order_lines_at_version($1,$2,$3,$4)',
      [f.a.order, f.a.token, String(version.v), JSON.stringify([{ line_id: line, qty: 5 }])])));
    expect(refused.code).toBe('P0001');
    expect(refused.message).toMatch(/kitchen has already started/i);
    expect((await db.query('select guest_live_version v, prep_status p from orders where id=$1', [f.a.order])).rows[0])
      .toEqual({ v: version.v, p: 'preparing' });
    expect((await db.query("select count(*)::int n from order_operation_history where order_id=$1 and operation='quantity'", [f.a.order])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from order_operation_history where order_id=$1 and operation='prep'", [f.a.order])).rows[0].n).toBe(1);
  }, 30_000);

  it('records one payment under a retried request key, issues one receipt, and freezes the document', async () => {
    const total = Number((await db.query('select total_paise t from orders where id=$1', [f.a.order])).rows[0].t);
    expect(total).toBe(25000);
    const key = randomUUID();
    const first = (await asUser(f.cashier, async () => (await db.query('select record_counter_payment($1,$2,$3,$4,$5) id',
      [f.a.slug, f.a.order, 'cash', total, key])).rows[0].id)) as string;
    // The same key from a second tab is the same payment, not a second one.
    const replay = (await asUser(f.cashier, async () => (await db.query('select record_counter_payment($1,$2,$3,$4,$5) id',
      [f.a.slug, f.a.order, 'cash', total, key])).rows[0].id)) as string;
    expect(replay).toBe(first);
    expect((await db.query('select count(*)::int n from payments where order_id=$1', [f.a.order])).rows[0].n).toBe(1);
    // A fresh key cannot take the same money twice.
    const secondCharge = await refusal(() => asUser(f.cashier, () => db.query('select record_counter_payment($1,$2,$3,$4,$5)',
      [f.a.slug, f.a.order, 'cash', total, randomUUID()])));
    expect(secondCharge.code).toBe('P0001');
    expect(secondCharge.message).toMatch(/only unpaid pending orders can be settled/i);

    const invoice = (await asUser(f.cashier, async () => (await db.query('select close_order_session_and_issue_receipt($1) id', [f.a.sitting])).rows[0].id)) as string;
    const again = (await asUser(f.cashier, async () => (await db.query('select close_order_session_and_issue_receipt($1) id', [f.a.sitting])).rows[0].id)) as string;
    expect(again).toBe(invoice);
    expect((await db.query('select count(*)::int n from restaurant_invoices where order_session_id=$1', [f.a.sitting])).rows[0].n).toBe(1);
    const issuedSql = `select totals_snapshot->>'total_paise' total,status,invoice_number,
      totals_snapshot->>'subtotal_paise' subtotal from restaurant_invoices where id=$1`;
    const issued = (await db.query(issuedSql, [invoice])).rows[0];
    expect(issued).toMatchObject({ total: '25000', subtotal: '25000', status: 'issued' });
    expect((await refusal(() => db.query('update restaurant_invoices set totals_snapshot=$2 where id=$1',
      [invoice, JSON.stringify({ total_paise: 1 })]))).code).toBe('42501');
    expect((await refusal(() => db.query('update restaurant_invoices set invoice_number=$2 where id=$1',
      [invoice, 'INV/99-99/999999']))).code).toBe('42501');
    expect((await refusal(() => db.query('delete from restaurant_invoices where id=$1', [invoice]))).code).toBe('42501');
    expect((await db.query(issuedSql, [invoice])).rows[0]).toEqual(issued);
    // A paid, closed ticket is not editable through the guest route either.
    const live = (await db.query('select guest_live_version v from orders where id=$1', [f.a.order])).rows[0].v;
    const stale = await asAnon(async () => (await db.query('select set_guest_order_lines_at_version($1,$2,$3,$4) s',
      [f.a.order, f.a.token, '0', JSON.stringify([])])).rows[0].s);
    expect(stale).toBe('stale');
    const edit = await refusal(() => asAnon(() => db.query('select set_guest_order_lines_at_version($1,$2,$3,$4)',
      [f.a.order, f.a.token, String(live), JSON.stringify([])])));
    expect(edit.code).toBe('P0001');
    // The kitchen started this ticket in the previous test, so either ticket
    // guard is a correct refusal; the payment state is asserted below.
    expect(edit.message).toMatch(/already been paid|kitchen has already started/i);
    // The issued amount still matches the tickets and the recorded tender.
    expect((await db.query(`select (select sum(total_paise) from orders where order_session_id=$1) tickets,
      (select sum(amount_paise) from payments p join orders o on o.id=p.order_id where o.order_session_id=$1) paid`,
      [f.a.sitting])).rows[0]).toEqual({ tickets: '25000', paid: '25000' });
  }, 60_000);

  it('issues a plain receipt without tax or an IRP record at an outlet with no GST registration', async () => {
    const b = f.b;
    const order = (await db.query('select total_paise t, tax_paise x, gst_mode_snapshot m from orders where id=$1', [b.order])).rows[0];
    expect([Number(order.t), Number(order.x), order.m]).toEqual([25000, 0, 'off']);
    await asUser(f.otherOwner, () => db.query("select record_counter_payment($1,$2,'cash',25000,$3)",
      [b.slug, b.order, randomUUID()]));
    const invoice = (await asUser(f.otherOwner, async () => (await db.query('select close_order_session_and_issue_receipt($1) id',
      [b.sitting])).rows[0].id)) as string;
    const doc = (await db.query(`select document_type, invoice_number, gst_snapshot, irp_status, irn,
      totals_snapshot->>'total_paise' total, totals_snapshot->>'tax_paise' tax,
      totals_snapshot->>'taxable_paise' taxable, jsonb_array_length(payment_snapshot->'payments') tenders
      from restaurant_invoices where id=$1`, [invoice])).rows[0];
    expect(doc).toMatchObject({ document_type: 'receipt', irp_status: 'not_required', irn: null,
      gst_snapshot: null, total: '25000', tax: '0', taxable: null });
    expect(doc.invoice_number).toMatch(/^INV\/\d{2}-\d{2}\/\d{6}$/);
    // Nothing was prepared for, or sent to, an e-invoice provider.
    expect((await db.query('select count(*)::int n from restaurant_irp_jobs where invoice_id=$1', [invoice])).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int n from irp_dispatches where outlet_id=$1', [b.id])).rows[0].n).toBe(0);
    // The same document is what a shared link renders; no tax breakup exists to show.
    expect((await db.query('select status from restaurant_invoices where id=$1', [invoice])).rows[0].status).toBe('issued');
  }, 30_000);

  it('runs the floor lifecycle: idempotent acknowledgement, a blocked transfer, and a revoked table proof', async () => {
    const floor = f.floor;
    const [from, to, spare] = floor.tables;
    expect((await db.query('select count(*)::int n from orders where restaurant_id=$1', [floor.id])).rows[0].n).toBe(1);

    async function raiseCall(): Promise<string> {
      await db.query('select call_waiter($1,$2)', [from.session, randomUUID()]);
      return (await db.query("select id from table_waiter_calls where restaurant_id=$1 and table_id=$2 and status='open' order by created_at desc limit 1",
        [floor.id, from.id])).rows[0].id as string;
    }
    const first = await raiseCall();
    expect(await asUser(f.manager, async () => (await db.query('select acknowledge_waiter_call($1,$2) s', [floor.id, first])).rows[0].s)).toBe('acknowledged');
    const acked = (await db.query('select acknowledged_at, acknowledged_by from table_waiter_calls where id=$1', [first])).rows[0];
    expect(acked.acknowledged_by).toBe(f.manager);
    // A second tap from another device does not reassign the acknowledgement.
    expect(await asUser(f.waiter, async () => (await db.query('select acknowledge_waiter_call($1,$2) s', [floor.id, first])).rows[0].s)).toBe('acknowledged');
    expect((await db.query('select acknowledged_at, acknowledged_by from table_waiter_calls where id=$1', [first])).rows[0]).toEqual(acked);

    // A move cannot strand an open call at either table.
    const second = await raiseCall();
    expect(await asUser(f.manager, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [floor.id, floor.sitting, from.id, to.id, randomUUID()])).rows[0].s)).toBe('call_open');
    expect((await db.query('select table_id from order_sessions where id=$1', [floor.sitting])).rows[0].table_id).toBe(from.id);
    await asUser(f.manager, () => db.query('select finish_waiter_call($1,$2)', [floor.id, second]));

    const request = randomUUID();
    expect(await asUser(f.manager, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [floor.id, floor.sitting, from.id, to.id, request])).rows[0].s)).toBe('moved');
    expect((await db.query('select table_id from order_sessions where id=$1', [floor.sitting])).rows[0].table_id).toBe(to.id);
    // Old physical proof is revoked at both ends; no unrevoked session survives.
    expect((await db.query('select count(*)::int n from table_verification_sessions where restaurant_id=$1 and table_id in ($2,$3) and revoked_at is null',
      [floor.id, from.id, to.id])).rows[0].n).toBe(0);
    // A replayed request is the same move, not a second one.
    expect(await asUser(f.manager, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [floor.id, floor.sitting, from.id, to.id, request])).rows[0].s)).toBe('already_recorded');
    expect((await db.query('select count(*)::int n from sitting_table_moves where sitting_id=$1', [floor.sitting])).rows[0].n).toBe(1);
    // The guest keeps their order and token across the move...
    const guestView = await asAnon(async () => (await db.query('select get_public_order($1,$2,$3) o', [floor.slug, floor.code, floor.token])).rows[0].o);
    expect(guestView.code).toBe(floor.code);
    expect(guestView.lines).toHaveLength(1);
    // ...but the revoked proof cannot place another order at the old table.
    const ordersBefore = (await db.query('select count(*)::int n from orders where restaurant_id=$1', [floor.id])).rows[0].n;
    const refused = await refusal(() => asAnon(() => db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null)',
      [floor.slug, JSON.stringify([{ itemId: floor.item, qty: 1 }]), from.session, randomUUID()])));
    expect(refused.code).toBeTruthy();
    expect((await db.query('select count(*)::int n from orders where restaurant_id=$1', [floor.id])).rows[0].n).toBe(ordersBefore);

    // Once money is on the ticket the sitting cannot be moved again.
    await asUser(f.cashier, () => db.query("select record_counter_payment($1,$2,'cash',25000,$3)",
      [floor.slug, floor.order, randomUUID()]));
    expect(await asUser(f.manager, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [floor.id, floor.sitting, to.id, spare.id, randomUUID()])).rows[0].s)).toBe('held_or_paid');
    expect((await db.query('select table_id from order_sessions where id=$1', [floor.sitting])).rows[0].table_id).toBe(to.id);
  }, 60_000);
});
