import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * Priority 4 operational delivery, against a real PostgreSQL.
 *
 * The database is the only authority here: a revision row is a wake-up token,
 * the guest version is the only edit cursor, and a table transfer has to keep
 * the ticket while invalidating the physical proof it was admitted with.
 * Nothing in this file proves Realtime transport; the journey fixture covers
 * the socket separately.
 */
const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Operational realtime tests require a locally-created disposable autodine_check_* database');
  }
}

type Fixture = {
  restaurant: string;
  slug: string;
  otherRestaurant: string;
  owner: string;
  manager: string;
  kitchen: string;
  waiter: string;
  foreignWaiter: string;
  item: string;
  tables: { id: string; token: string; session: string }[];
  order: string;
  line: string;
  sitting: string;
  code: string;
  guestToken: string;
};
let db: Client;

async function fixture(): Promise<Fixture> {
  const owners = [randomUUID(), randomUUID()];
  const users = { owner: owners[0], manager: randomUUID(), kitchen: randomUUID(), waiter: randomUUID(), foreignWaiter: randomUUID() };
  await db.query('insert into profiles(id) values ($1),($2),($3),($4),($5)',
    [users.owner, users.manager, users.kitchen, users.waiter, users.foreignWaiter]);
  const slug = 'rt-' + randomUUID();
  const restaurant = (await db.query(`insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
    values ($1,'Realtime restaurant','Test-only address',0,'scan') returning id`, [slug])).rows[0].id;
  const otherRestaurant = (await db.query(`insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
    values ($1,'Foreign restaurant','Test-only address',0,'scan') returning id`, ['rt-other-' + randomUUID()])).rows[0].id;
  await db.query(`insert into memberships(restaurant_id,user_id,role) values
    ($1,$2,'owner'),($1,$3,'manager'),($1,$4,'kitchen'),($1,$5,'waiter')`,
    [restaurant, users.owner, users.manager, users.kitchen, users.waiter]);
  await db.query("insert into memberships(restaurant_id,user_id,role) values ($1,$2,'waiter')", [otherRestaurant, users.foreignWaiter]);
  const menu = (await db.query("insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id", [restaurant])).rows[0].id;
  const category = (await db.query("insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id", [restaurant, menu])).rows[0].id;
  const item = (await db.query("insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Thali',12500,true) returning id",
    [restaurant, category])).rows[0].id;
  const tables = [];
  for (const label of ['T1', 'T2', 'T3']) {
    const id = (await db.query('insert into dining_tables(restaurant_id,label) values($1,$2) returning id', [restaurant, label])).rows[0].id;
    // The trigger on dining_tables provisions the table's single live card.
    const token = (await db.query('select public_token from table_qr_codes where table_id=$1 and revoked_at is null', [id])).rows[0].public_token as string;
    const session = (await db.query('select * from open_table_session($1,$2)', [token, 'a'.repeat(64)])).rows[0].session_token;
    tables.push({ id, token, session });
  }
  const guestToken = randomUUID();
  const code = (await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',
    [slug, JSON.stringify([{ itemId: item, qty: 2 }]), tables[0].session, guestToken])).rows[0].code;
  const order = (await db.query('select id,order_session_id from orders where restaurant_id=$1 and code=$2', [restaurant, code])).rows[0];
  const line = (await db.query('select id from order_items where order_id=$1 order by sort_order limit 1', [order.id])).rows[0].id;
  return {
    restaurant, slug, otherRestaurant, ...users, item, tables,
    order: order.id, line, sitting: order.order_session_id, code, guestToken,
  };
}

async function asRole<T>(user: string | null, role: 'authenticated' | 'anon', work: () => Promise<T>, commit = false): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    const result = await work();
    await db.query(commit ? 'commit' : 'rollback');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
const asStaff = <T>(user: string, work: () => Promise<T>) => asRole(user, 'authenticated', work);
const asAnon = <T>(work: () => Promise<T>) => asRole(null, 'anon', work);
/** Mutations must survive the transaction under test. */
const didStaff = <T>(user: string, work: () => Promise<T>) => asRole(user, 'authenticated', work, true);
const didAnon = <T>(work: () => Promise<T>) => asRole(null, 'anon', work, true);

async function rejection(work: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await work(); } catch (error) { return error as { code?: string; message: string }; }
  throw new Error('expected the database to refuse this call');
}

async function verifiedWaiterState(f: Fixture, table: number, token = f.tables[table].session) {
  return (await db.query('select read_verified_waiter_state($1,$2,$3) state',
    [f.slug, `T${table + 1}`, token])).rows[0].state as string;
}

async function callAt(f: Fixture, table: number, request = randomUUID()) {
  return (await db.query('select call_verified_waiter_at($1,$2,$3,$4) state',
    [f.slug, `T${table + 1}`, f.tables[table].session, request])).rows[0].state as string;
}

describe.skipIf(!URL_VALUE)('operational delivery and floor authority', () => {
  let f: Fixture;
  beforeAll(async () => { db = new Client({ connectionString: URL_VALUE }); await db.connect(); f = await fixture(); }, 60_000);
  beforeEach(async () => { await db.query("select set_config('request.jwt.claim.sub','',false)"); });
  afterAll(async () => { if (db) await db.end(); });

  it('coalesces a committed operational transaction into one content-free revision', async () => {
    const columns = (await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='outlet_live_revisions' order by column_name`)).rows.map(r => r.column_name);
    // No order, guest, staff, payment or note field can ride the wake-up.
    expect(columns).toEqual(['changed_at', 'event_id', 'outlet_id', 'version']);

    const read = async () => (await db.query('select event_id,version from outlet_live_revisions where outlet_id=$1', [f.restaurant])).rows[0];
    const start = await read();
    expect(Number(start.version)).toBeGreaterThan(0);

    await db.query('begin');
    await db.query("update orders set prep_status='preparing' where id=$1", [f.order]);
    await db.query("update orders set prep_status='ready' where id=$1", [f.order]);
    await db.query('update order_items set qty=3 where order_id=$1', [f.order]);
    await db.query('commit');
    const first = await read();
    expect(Number(first.version)).toBe(Number(start.version) + 1);
    expect(first.event_id).not.toBe(start.event_id);

    // A separate transaction is a separate signal: no batching across commits.
    await db.query("update orders set prep_status='served' where id=$1", [f.order]);
    expect(Number((await read()).version)).toBe(Number(start.version) + 2);

    const published = (await db.query(`select tablename from pg_publication_tables
      where pubname='supabase_realtime' order by tablename`)).rows.map(r => r.tablename);
    const settings = (await db.query(`select pubinsert,pubupdate,pubdelete from pg_publication where pubname='supabase_realtime'`)).rows[0];
    // Raw business rows are not streamed, and DELETE cannot be row-filtered safely.
    expect(published).toEqual(['outlet_live_revisions']);
    expect(settings).toEqual({ pubinsert: true, pubupdate: true, pubdelete: false });
  }, 30_000);

  it('gives the waiter role only the outlet-scoped floor projection', async () => {
    const own = await asStaff(f.waiter, async () => (await db.query('select id from list_my_waiter_outlets()')).rows);
    expect(own.map(row => row.id)).toEqual([f.restaurant]);

    expect(await asStaff(f.waiter, async () => (await db.query('select count(*)::int n from orders')).rows[0].n)).toBe(0);
    expect(await asStaff(f.waiter, async () => (await db.query('select count(*)::int n from order_sessions')).rows[0].n)).toBe(0);
    expect(await asStaff(f.waiter, async () => (await db.query('select count(*)::int n from payments')).rows[0].n)).toBe(0);
    expect(await asStaff(f.waiter, async () => (await db.query('select count(*)::int n from table_waiter_calls')).rows[0].n)).toBe(0);
    const hidden = await asStaff(f.waiter, () => rejection(() => db.query('select request_key from table_waiter_calls')));
    expect(hidden.code).toBe('42501');

    const snapshot = await asStaff(f.waiter, async () => (await db.query('select floor_service_snapshot($1) s', [f.restaurant])).rows[0].s);
    expect(snapshot.tables).toHaveLength(3);
    expect(snapshot.calls).toHaveLength(0);
    expect(Object.keys(snapshot).sort()).toEqual(['calls', 'callsTruncated', 'canWork', 'tables', 'tablesTruncated']);
    expect(JSON.stringify(snapshot)).not.toMatch(/guest|token|total|payment/i);

    expect((await asStaff(f.waiter, async () => (await db.query('select read_outlet_live_version($1) v', [f.restaurant])).rows[0].v)))
      .toMatch(/^\d+$/);
    expect((await asStaff(f.foreignWaiter, () => rejection(() => db.query('select read_outlet_live_version($1)', [f.restaurant])))).code).toBe('42501');
    expect((await asStaff(f.foreignWaiter, () => rejection(() => db.query('select floor_service_snapshot($1)', [f.restaurant])))).code).toBe('42501');
    expect(await asStaff(f.kitchen, async () => (await db.query('select count(*)::int n from list_my_waiter_outlets()')).rows[0].n)).toBe(0);

    expect(await asAnon(async () => (await db.query("select has_table_privilege('anon','public.outlet_live_revisions','SELECT') ok")).rows[0].ok)).toBe(false);
    expect(await asStaff(f.manager, async () => (await db.query("select has_table_privilege('authenticated','public.outlet_live_revisions','INSERT') ok")).rows[0].ok)).toBe(false);
    expect((await asStaff(f.manager, () => rejection(() => db.query('insert into outlet_live_revisions(outlet_id,event_id,version,changed_at) values($1,gen_random_uuid(),99,now())', [f.restaurant])))).code).toBe('42501');
  }, 30_000);

  it('binds a guest call to the verified location and makes staff acknowledgement idempotent', async () => {
    expect(await verifiedWaiterState(f, 0)).toBe('idle');
    // Same live token, different physical table: no call and no state leak.
    expect((await db.query('select read_verified_waiter_state($1,$2,$3) s', [f.slug, 'T2', f.tables[0].session])).rows[0].s).toBe('expired');
    expect((await asAnon(() => rejection(() => db.query('select call_verified_waiter_at($1,$2,$3,$4)', [f.slug, 'T2', f.tables[0].session, randomUUID()])))).code).toBe('P0001');

    const request = randomUUID();
    expect(await callAt(f, 1, request)).toBe('created');
    expect(await callAt(f, 1, request)).toBe('already_open');
    expect(await callAt(f, 1)).toBe('already_open');
    expect(await verifiedWaiterState(f, 1)).toBe('waiting');

    const callId = (await db.query('select id from table_waiter_calls where table_id=$1 and status=$2', [f.tables[1].id, 'open'])).rows[0].id;
    expect((await didStaff(f.manager, async () => (await db.query('select acknowledge_waiter_call($1,$2) s', [f.restaurant, callId])).rows[0].s))).toBe('acknowledged');
    const firstAck = (await db.query('select acknowledged_at,acknowledged_by from table_waiter_calls where id=$1', [callId])).rows[0];
    expect(firstAck.acknowledged_by).toBe(f.manager);
    // A second tap by another person must not restamp the acknowledgement.
    expect((await didStaff(f.waiter, async () => (await db.query('select acknowledge_waiter_call($1,$2) s', [f.restaurant, callId])).rows[0].s))).toBe('acknowledged');
    expect((await db.query('select acknowledged_at,acknowledged_by from table_waiter_calls where id=$1', [callId])).rows[0]).toEqual(firstAck);
    expect(await verifiedWaiterState(f, 1)).toBe('acknowledged');

    // The legacy resolve path uses the same lock and refuses a foreign outlet.
    expect(await asStaff(f.foreignWaiter, async () => (await db.query('select resolve_table_waiter_call($1) r', [callId])).rows[0].r)).toBe(false);
    expect(await didStaff(f.manager, async () => (await db.query('select resolve_table_waiter_call($1) r', [callId])).rows[0].r)).toBe(true);
    expect(await verifiedWaiterState(f, 1)).toBe('idle');
    expect(await didStaff(f.manager, async () => (await db.query('select finish_waiter_call($1,$2) s', [f.restaurant, callId])).rows[0].s)).toBe('resolved');

    await db.query("update table_verification_sessions set revoked_at=now() where table_id=$1", [f.tables[1].id]);
    expect(await verifiedWaiterState(f, 1)).toBe('expired');
    expect((await asAnon(() => rejection(() => db.query('select call_verified_waiter_at($1,$2,$3,$4)', [f.slug, 'T2', f.tables[1].session, randomUUID()])))).code).toBe('P0001');
  }, 30_000);

  it('moves the sitting without moving the ticket, and refuses unsafe transfers', async () => {
    const before = (await db.query('select table_id from orders where id=$1', [f.order])).rows[0].table_id;
    expect((await asStaff(f.kitchen, () => rejection(() => db.query('select transfer_open_sitting($1,$2,$3,$4,$5)',
      [f.restaurant, f.sitting, f.tables[0].id, f.tables[2].id, randomUUID()])))).code).toBe('42501');

    const request = randomUUID();
    expect((await didStaff(f.owner, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [f.restaurant, f.sitting, f.tables[0].id, f.tables[2].id, request])).rows[0].s))).toBe('moved');
    // Replaying the same id is a statement about the same move, never a second one.
    expect((await asStaff(f.owner, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [f.restaurant, f.sitting, f.tables[0].id, f.tables[2].id, request])).rows[0].s))).toBe('already_recorded');
    expect((await db.query('select table_id from order_sessions where id=$1', [f.sitting])).rows[0].table_id).toBe(f.tables[2].id);
    // The bearer capability and admitted table on the ticket are preserved.
    expect((await db.query('select table_id from orders where id=$1', [f.order])).rows[0].table_id).toBe(before);
    const revoked = (await db.query('select table_id from table_verification_sessions where restaurant_id=$1 and revoked_at is not null', [f.restaurant])).rows.map(r => r.table_id);
    expect(revoked).toEqual(expect.arrayContaining([f.tables[0].id, f.tables[2].id]));
    const labels = await asStaff(f.kitchen, async () => (await db.query('select * from list_order_floor_labels($1,$2::uuid[])', [f.restaurant, [f.order]])).rows);
    expect(labels).toEqual([{ order_id: f.order, table_label: 'T3' }]);

    // Occupied destination, open call, and money already attached all refuse.
    const t4 = (await db.query("insert into dining_tables(restaurant_id,label) values($1,'T4') returning id", [f.restaurant])).rows[0].id;
    const t4Token = (await db.query('select public_token from table_qr_codes where table_id=$1 and revoked_at is null', [t4])).rows[0].public_token as string;
    const t4Session = (await db.query('select * from open_table_session($1,$2)', [t4Token, 'b'.repeat(64)])).rows[0].session_token;
    // Occupancy is a sitting, and a sitting begins with its first ticket.
    await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null)',
      [f.slug, JSON.stringify([{ itemId: f.item, qty: 1 }]), t4Session, randomUUID()]);
    const transfer = (to: string, from = f.tables[2].id) => didStaff(f.owner, async () => (await db.query('select transfer_open_sitting($1,$2,$3,$4,$5) s',
      [f.restaurant, f.sitting, from, to, randomUUID()])).rows[0].s);
    expect(await transfer(t4)).toBe('occupied');

    const freshToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const t2 = f.tables[2].id;
    // A replacement card is a rotation: revoke the live one first, exactly as
    // rotate_table_qr_code does, so the one-live-card invariant holds.
    await db.query('update table_qr_codes set revoked_at=now() where table_id=$1 and revoked_at is null', [t2]);
    await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)', [f.restaurant, t2, freshToken]);
    const freshSession = (await db.query('select * from open_table_session($1,$2)', [freshToken, 'c'.repeat(64)])).rows[0].session_token;
    const label = (await db.query('select label from dining_tables where id=$1', [t2])).rows[0].label;
    expect((await db.query('select call_verified_waiter_at($1,$2,$3,$4) s', [f.slug, label, freshSession, randomUUID()])).rows[0].s).toBe('created');
    // A free destination isolates the call and payment refusals from occupancy.
    const t5 = (await db.query("insert into dining_tables(restaurant_id,label) values($1,'T5') returning id", [f.restaurant])).rows[0].id;
    expect(await transfer(t5)).toBe('call_open');
    await db.query("update table_waiter_calls set status='resolved',resolved_at=now() where table_id=$1 and status='open'", [t2]);
    await db.query("update orders set payment_status='paid' where id=$1", [f.order]);
    expect(await transfer(t5)).toBe('held_or_paid');
  }, 30_000);

  it('edits only at the displayed guest version and audits operational changes', async () => {
    // Earlier cases advanced preparation; the edit contract is about the bill,
    // so put the ticket back in the state a guest actually edits from.
    await db.query("update orders set prep_status='new', payment_status='pending' where id=$1", [f.order]);
    const status = (await asAnon(async () => (await db.query('select get_guest_order_status($1,$2,$3) s', [f.slug, f.code, f.guestToken])).rows[0].s));
    expect(Object.keys(status).sort()).toEqual(['confirmed_at', 'hold_required', 'payment_status', 'placed_at', 'prep_status', 'revision']);
    const revision = status.revision as string;
    const edit = (version: string, qty: number, token = f.guestToken) => didAnon(async () => {
      const result = await db.query('select set_guest_order_lines_at_version($1,$2,$3,$4) s',
        [f.order, token, version, JSON.stringify([{ line_id: f.line, qty }])]);
      return result.rows[0].s as string;
    });
    expect(await edit('999999', 3)).toBe('stale');
    expect(await edit(revision, 3)).toBe('updated');
    const moved = (await asAnon(async () => (await db.query('select get_guest_order_status($1,$2,$3) s', [f.slug, f.code, f.guestToken])).rows[0].s));
    expect(Number(moved.revision)).toBeGreaterThan(Number(revision));
    expect((await asAnon(async () => (await db.query("select get_public_order($1,$2,$3)->>'total_paise' t", [f.slug, f.code, f.guestToken])).rows[0].t))).toBe('37500');
    // The old version is spent: a duplicated tab cannot re-apply its basket.
    expect(await edit(revision, 5)).toBe('stale');
    expect(await edit(moved.revision, 5, randomUUID())).toBe('not_found');

    await didStaff(f.owner, async () => { await db.query("update orders set prep_status='preparing' where id=$1", [f.order]); });
    const history = await asStaff(f.manager, async () => (await db.query('select operation,actor_id,before_prep,after_prep,before_qty,after_qty from order_operation_history where order_id=$1 order by changed_at', [f.order])).rows);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'prep', actor_id: f.owner, before_prep: 'new', after_prep: 'preparing' }),
      expect.objectContaining({ operation: 'quantity', before_qty: 2, after_qty: 3 }),
    ]));
    expect(await asStaff(f.waiter, async () => (await db.query('select count(*)::int n from order_operation_history')).rows[0].n)).toBe(0);
  }, 30_000);

  it('bounds the floor snapshot and flags truncation rather than lying', async () => {
    await db.query(`insert into dining_tables(restaurant_id,label)
      select $1,'X'||n from generate_series(1,201) n`, [f.restaurant]);
    const snapshot = await asStaff(f.owner, async () => (await db.query('select floor_service_snapshot($1) s', [f.restaurant])).rows[0].s);
    expect(snapshot.tables).toHaveLength(200);
    expect(snapshot.tablesTruncated).toBe(true);
    expect(snapshot.callsTruncated).toBe(false);
  }, 30_000);
});
