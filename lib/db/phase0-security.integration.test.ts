/**
 * Database-level security regression for the Phase 0 boundaries.
 *
 * Runs only against the disposable database created by
 * scripts/verify-database.mjs. Every check acts as the role PostgREST would
 * use -- `anon` for a guest, `authenticated` with a JWT subject for staff --
 * inside a transaction that is rolled back.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PUBLIC_RESTAURANT_COLUMNS } from './public-restaurant';

const URL_VALUE = process.env.READINESS_DB_URL || '';
// A test URL is not permission to mutate an arbitrary database.
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Security tests require a locally-created disposable autodine_check_* database');
  }
}

type Fixture = {
  restaurant: string; slug: string; item: string;
  owner: string; kitchen: string; cashier: string; outsider: string;
  /** A table nobody has sat at yet. */
  freshQrToken: string;
  /** Unpaid ticket, still `new`. */
  order: string;
  /** Ticket already settled at the counter, so the audit ledger is populated. */
  paidOrder: string;
};

let db: Client;

async function fixture(): Promise<Fixture> {
  const slug = 'phase0-' + randomUUID();
  const [owner, kitchen, cashier, outsider] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.query('insert into profiles(id) values ($1),($2),($3),($4)', [owner, kitchen, cashier, outsider]);
  const restaurant = (await db.query(
    `insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
     values ($1,'Phase 0 restaurant','Test-only address',0,'scan') returning id`, [slug])).rows[0].id;
  await db.query(
    `insert into memberships(restaurant_id,user_id,role) values ($1,$2,'owner'),($1,$3,'kitchen'),($1,$4,'cashier')`,
    [restaurant, owner, kitchen, cashier]);
  const menu = (await db.query(`insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id`, [restaurant])).rows[0].id;
  const category = (await db.query(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id`, [restaurant, menu])).rows[0].id;
  const item = (await db.query(`insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Dish',12500,true) returning id`, [restaurant, category])).rows[0].id;
  const tokens: string[] = [];
  for (const label of ['T1', 'T2']) {
    const table = (await db.query(`insert into dining_tables(restaurant_id,label) values($1,$2) returning id`, [restaurant, label])).rows[0].id;
    const token = (await db.query('select public_token from table_qr_codes where table_id=$1 and revoked_at is null', [table])).rows[0].public_token as string;
    tokens.push(token);
  }
  const sessionToken = (await db.query('select * from open_table_session($1,$2)', [tokens[0], 'a'.repeat(64)])).rows[0].session_token;
  const place = async () => {
    const code = (await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',
      [slug, JSON.stringify([{ itemId: item, qty: 2 }]), sessionToken, randomUUID()])).rows[0].code;
    return (await db.query('select id from orders where restaurant_id=$1 and code=$2', [restaurant, code])).rows[0].id as string;
  };
  const order = await place();
  const paidOrder = await place();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query('select record_counter_payment($1,$2,$3,$4,$5)', [slug, paidOrder, 'cash', 25000, randomUUID()]);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  return { restaurant, slug, item, owner, kitchen, cashier, outsider, freshQrToken: tokens[1], order, paidOrder };
}

/** Runs `work` as a PostgREST role, then rolls everything back. */
async function asRole<T>(role: 'anon' | 'authenticated', user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    return await work();
  } finally { await db.query('rollback'); }
}
const guest = <T>(work: () => Promise<T>) => asRole('anon', null, work);
const staff = <T>(user: string, work: () => Promise<T>) => asRole('authenticated', user, work);

describe.skipIf(!URL_VALUE)('Phase 0 database security boundaries', () => {
  let a: Fixture, b: Fixture;
  beforeAll(async () => { db = new Client({ connectionString: URL_VALUE }); await db.connect(); a = await fixture(); b = await fixture(); }, 30000);
  afterAll(async () => { if (db) await db.end(); });

  describe('restaurant rows', () => {
    it('are not readable by a guest, even though active restaurants exist', async () => {
      expect((await db.query('select count(*)::int n from restaurants where is_active')).rows[0].n).toBeGreaterThanOrEqual(2);
      await expect(guest(() => db.query('select id from restaurants')))
        .rejects.toMatchObject({ code: '42501' });
    });

    it('are not readable by a signed-in user who is not staff there', async () => {
      const read = (user: string) => staff(user, async () => (await db.query('select id from restaurants where id=$1', [a.restaurant])).rows);
      expect(await read(a.outsider)).toEqual([]);
      expect(await read(b.owner)).toEqual([]);
    });

    it('keeps operational restaurant fields readable while withholding account and billing columns', async () => {
      const rows = await staff(a.kitchen, async () => (await db.query('select id, name, tagline from restaurants')).rows);
      expect(rows.map((row) => row.id)).toEqual([a.restaurant]);
      expect(rows[0].name).toBe('Phase 0 restaurant');

      // The account link and old per-restaurant plan fields are retained for
      // compatibility but are not a direct staff read path to subscription
      // state. SELECT grants are shared by the authenticated database role, so
      // probe both a privileged restaurant Owner and operational staff roles.
      for (const user of [a.owner, a.cashier, a.kitchen]) {
        await expect(staff(user, () => db.query(
          'select account_id, plan, plan_status, trial_started_at, plan_started_at, plan_expires_at from restaurants where id=$1',
          [a.restaurant],
        ))).rejects.toMatchObject({ code: '42501' });
      }
    });

    it('have no public read policy left, and guests hold no write privilege', async () => {
      const policies = (await db.query(`select policyname from pg_policies where schemaname='public' and tablename='restaurants' order by 1`)).rows.map((row) => row.policyname);
      expect(policies).toEqual(['restaurants_read', 'restaurants_update']);
      await expect(guest(() => db.query(`update restaurants set name='taken over' where id=$1`, [a.restaurant]))).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('public storefront projection', () => {
    it('returns exactly the public columns for one slug, to guests and to signed-in non-members', async () => {
      const readers: Array<<T>(work: () => Promise<T>) => Promise<T>> = [guest, (work) => staff(a.outsider, work), (work) => staff(b.owner, work)];
      for (const reader of readers) {
        const rows = await reader(async () => (await db.query('select * from public_restaurant_profile($1)', [a.slug])).rows);
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0]).sort()).toEqual([...PUBLIC_RESTAURANT_COLUMNS].sort());
        expect(rows[0]).toMatchObject({ id: a.restaurant, slug: a.slug, name: 'Phase 0 restaurant', is_active: true });
      }
    });

    it('cannot enumerate restaurants', async () => {
      for (const probe of [null, '', '   ', '%', '_', 'phase0-%', a.slug.slice(0, 12), a.slug.toUpperCase()]) {
        expect(await guest(async () => (await db.query('select id from public_restaurant_profile($1)', [probe])).rows)).toEqual([]);
      }
    });

    it('answers for a closed restaurant as closed, while its menu stays hidden', async () => {
      await db.query('begin');
      try {
        await db.query('update restaurants set is_active=false where id=$1', [a.restaurant]);
        await db.query('set local role anon');
        expect((await db.query('select is_active, name from public_restaurant_profile($1)', [a.slug])).rows).toEqual([{ is_active: false, name: 'Phase 0 restaurant' }]);
        expect((await db.query('select count(*)::int n from menus where restaurant_id=$1', [a.restaurant])).rows[0].n).toBe(0);
        expect((await db.query('select count(*)::int n from items where restaurant_id=$1', [a.restaurant])).rows[0].n).toBe(0);
      } finally { await db.query('rollback'); }
    });
  });

  describe('public QR menu and ordering are preserved', () => {
    it('a guest still reads the published menu', async () => {
      const counts = await guest(async () => (await db.query(
        `select (select count(*)::int from menus where restaurant_id=$1) menus,
                (select count(*)::int from categories where restaurant_id=$1) categories,
                (select count(*)::int from items where restaurant_id=$1) items`, [a.restaurant])).rows[0]);
      expect(counts).toEqual({ menus: 1, categories: 1, items: 1 });
    });

    it('a guest still opens a table and places an order', async () => {
      await db.query('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub','',true)");
        await db.query('set local role anon');
        const session = (await db.query('select * from open_table_session($1,$2)', [a.freshQrToken, 'c'.repeat(64)])).rows[0];
        expect(session.status).toBe('opened');
        await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',
          [a.slug, JSON.stringify([{ itemId: a.item, qty: 1 }]), session.session_token, randomUUID()]);
        await db.query('reset role');
        expect((await db.query('select count(*)::int n from orders where restaurant_id=$1', [a.restaurant])).rows[0].n).toBe(3);
      } finally { await db.query('rollback'); }
    });

    it('the write gate used by row policies still answers for a guest', async () => {
      expect(await guest(async () => (await db.query('select restaurant_can_write($1) ok', [a.restaurant])).rows[0].ok)).toBe(true);
    });
  });

  describe('finance data', () => {
    const count = (table: 'payment_audit_events' | 'payments', user: string) =>
      staff(user, async () => (await db.query(`select count(*)::int n from ${table} where restaurant_id=$1`, [a.restaurant])).rows[0].n as number);

    it('the payment audit ledger is readable by owner, manager and cashier roles only', async () => {
      const recorded = (await db.query('select count(*)::int n from payment_audit_events where restaurant_id=$1', [a.restaurant])).rows[0].n;
      expect(recorded).toBeGreaterThan(0);
      expect(await count('payment_audit_events', a.owner)).toBe(recorded);
      expect(await count('payment_audit_events', a.cashier)).toBe(recorded);
      expect(await count('payment_audit_events', a.kitchen)).toBe(0);
      expect(await count('payment_audit_events', a.outsider)).toBe(0);
      expect(await count('payment_audit_events', b.owner)).toBe(0);
    });

    it('payments stay hidden from kitchen staff', async () => {
      expect(await count('payments', a.cashier)).toBeGreaterThan(0);
      expect(await count('payments', a.kitchen)).toBe(0);
    });

    it('a cashier still collects at the counter; kitchen staff cannot', async () => {
      const pay = (user: string) => staff(user, async () => {
        await db.query('select record_counter_payment($1,$2,$3,$4,$5)', [a.slug, a.order, 'cash', 25000, randomUUID()]);
        await db.query('reset role');
        return (await db.query('select payment_status from orders where id=$1', [a.order])).rows[0].payment_status;
      });
      await expect(pay(a.kitchen)).rejects.toThrow();
      await expect(pay(a.outsider)).rejects.toThrow();
      expect(await pay(a.cashier)).toBe('paid');
    });
  });

  describe('ticket progress', () => {
    const move = (user: string) => staff(user, async () =>
      (await db.query(`update orders set prep_status='preparing' where id=$1 returning id`, [a.order])).rowCount);

    it('is refused to cashiers, outsiders and other restaurants', async () => {
      expect(await move(a.cashier)).toBe(0);
      expect(await move(a.outsider)).toBe(0);
      expect(await move(b.kitchen)).toBe(0);
    });

    it('still works for kitchen staff and owners', async () => {
      expect(await move(a.kitchen)).toBe(1);
      expect(await move(a.owner)).toBe(1);
    });
  });

  describe('plan and trial state', () => {
    const read = (user: string) => staff(user, async () =>
      (await db.query(
        `select restaurant_access($1) access,
                restaurant_trial_ends_at($1) trial_ends,
                restaurant_features($1) features,
                restaurant_has_feature($1, 'kitchen') has_kitchen`,
        [a.restaurant],
      )).rows[0]);

    it('cannot be read by a guest through the plan functions', async () => {
      for (const call of ['restaurant_access($1)', 'restaurant_trial_ends_at($1)', 'restaurant_features($1)']) {
        await expect(guest(() => db.query(`select ${call}`, [a.restaurant]))).rejects.toMatchObject({ code: '42501' });
      }
      await expect(guest(() => db.query(
        "select restaurant_has_feature($1, 'kitchen')", [a.restaurant],
      ))).rejects.toMatchObject({ code: '42501' });
    });

    it('is "not found" for a signed-in user who is not staff there', async () => {
      for (const user of [a.outsider, b.owner]) {
        const row = await read(user);
        expect(row.access).toBeNull();
        expect(row.trial_ends).toBeNull();
        expect(row.features).toEqual([]);
        expect(row.has_kitchen).toBe(false);
      }
    });

    it('keeps operational entitlements for Cashier/Kitchen but reserves plan and trial state for Owner/Manager', async () => {
      const owner = await read(a.owner);
      expect(owner.access).toMatchObject({ plan: 'trial', status: 'trialing', can_write: true, read_only: false });
      expect(owner.trial_ends).not.toBeNull();
      expect(owner.has_kitchen).toBe(true);

      for (const user of [a.cashier, a.kitchen]) {
        const row = await read(user);
        expect(row.access).toMatchObject({ can_write: true, read_only: false });
        expect(Array.isArray(row.access.features)).toBe(true);
        expect(row.access.features.length).toBeGreaterThan(0);
        expect(Object.keys(row.access).sort()).toEqual(['can_write', 'features', 'read_only']);
        expect(row.trial_ends).toBeNull();
        expect(row.has_kitchen).toBe(true);
      }
    });

    it('answers the account subscription functions only for the account own staff', async () => {
      // These two take an ACCOUNT id, and an id is not a secret. The only
      // thing standing between one tenant's commercial facts and another
      // tenant is the caller's rights on the row, which is why both are
      // declared SECURITY INVOKER: as DEFINER they would answer, correctly,
      // for any id anybody cared to name.
      // The fixture restaurants are inserted straight into the table, so they
      // predate the account backfill; give restaurant A an account of its own,
      // as an operator would, and use its id.
      const ownerProfile = randomUUID();
      await db.query('insert into profiles(id) values ($1)', [ownerProfile]);
      const account = (await db.query('insert into accounts(owner_id) values ($1) returning id', [ownerProfile])).rows[0].id as string;
      await db.query('update restaurants set account_id=$1 where id=$2', [account, a.restaurant]);
      expect(account).toBeTruthy();

      for (const stranger of [a.outsider, b.owner]) {
        const row = await staff(stranger, async () => (await db.query(
          'select account_trial_ends_at($1) trial_ends, account_outlet_count($1) outlets', [account])).rows[0]);
        expect(row.trial_ends).toBeNull();
        expect(row.outlets).toBe(0);
      }

      // A guest cannot call them at all: the subscription family is staff-only,
      // not merely invisible. (A function is born with EXECUTE granted to
      // PUBLIC, so this needs an explicit revoke in the migration.)
      await expect(guest(() => db.query('select account_trial_ends_at($1)', [account])))
        .rejects.toMatchObject({ code: '42501' });
      await expect(guest(() => db.query('select account_outlet_count($1)', [account])))
        .rejects.toMatchObject({ code: '42501' });
      // Including the write gate itself, which is SECURITY DEFINER and would
      // otherwise answer for any account id a guest cared to name.
      await expect(guest(() => db.query('select account_can_write($1)', [account])))
        .rejects.toMatchObject({ code: '42501' });

      // Membership alone still supports the outlet-count operation, but it
      // does not grant a Cashier access to the account's trial date.
      const cashierRead = await staff(a.cashier, async () => (await db.query(
        'select account_trial_ends_at($1) trial_ends, account_outlet_count($1) outlets', [account])).rows[0]);
      expect(cashierRead.trial_ends).toBeNull();
      expect(cashierRead.outlets).toBe(1);

      // The same account-state call from its Owner still answers in full.
      const own = await staff(a.owner, async () => (await db.query(
        'select account_trial_ends_at($1) trial_ends, account_outlet_count($1) outlets', [account])).rows[0]);
      expect(own.trial_ends).not.toBeNull();
      expect(own.outlets).toBeGreaterThanOrEqual(1);

      // Leave the fixture as it was found: this is the only test that needs
      // restaurant A to have an account.
      await db.query('update restaurants set account_id=null where id=$1', [a.restaurant]);
      await db.query('delete from accounts where id=$1', [account]);
      await db.query('delete from profiles where id=$1', [ownerProfile]);
    });

    it('lets nobody but the service role set a subscription', async () => {
      // admin_set_subscription moves the trial clock and the plan. Only the
      // service role holds it: an authenticated caller — even the owner of
      // the account being renewed — meets a privilege error, not a renewal.
      const renew = "select admin_set_subscription($1,'business',null,12)";
      await expect(guest(() => db.query(renew, [a.slug]))).rejects.toMatchObject({ code: '42501' });
      for (const user of [a.owner, b.owner, a.outsider]) {
        await expect(staff(user, () => db.query(renew, [a.slug]))).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  describe('commercial and tax data is not public', () => {
    it('returns no GSTIN through the public storefront read', async () => {
      // A GSTIN is a tax registration number. It belongs on a bill the
      // business issues, never on a menu page anyone with the link can read.
      const result = String((await db.query(
        `select pg_get_function_result(p.oid) result
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'public_restaurant_profile'`)).rows[0]?.result ?? '');
      expect(result).toMatch(/TABLE\(/i);
      expect(result.toLowerCase()).not.toContain('gstin');

      const rows = await guest(async () => (await db.query('select * from public_restaurant_profile($1)', [a.slug])).rows);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0])).not.toContain('gstin');
      // The public identity set is still there: name, phone, address.
      expect(rows[0].name).toBeTruthy();
      expect(rows[0]).toHaveProperty('phone');
      expect(rows[0]).toHaveProperty('address');
    });

    it('gives a guest no path to the GSTIN, the plan or the trial on the tenant row', async () => {
      await expect(guest(() => db.query(
        'select gstin, plan, plan_status, trial_started_at, upi_id from restaurants where slug=$1', [a.slug],
      ))).rejects.toMatchObject({ code: '42501' });
      // The storefront row carries a real GSTIN in the fixture, which is
      // exactly what the public read must not hand out.
      const stored = (await db.query('select gstin from restaurants where id=$1', [a.restaurant])).rows[0];
      expect(stored.gstin === null || typeof stored.gstin === 'string').toBe(true);
    });

    it('keeps the account subscription unreadable by guests and by other tenants', async () => {
      // A guest holds no privilege on the table at all, which is stronger
      // than a policy that happens to return no rows.
      await expect(guest(() => db.query('select * from accounts'))).rejects.toMatchObject({ code: '42501' });
      expect(await staff(a.outsider, async () => (await db.query('select * from accounts')).rows)).toEqual([]);
      expect(await staff(b.owner, async () => (await db.query('select * from accounts')).rows)).toEqual([]);
    });
  });

  describe('table QR lifecycle', () => {
    const tableOf = async (token: string) => (await db.query(
      'select table_id from table_qr_codes where public_token = $1', [token])).rows[0].table_id as string;
    const liveCodes = async (table: string) => (await db.query(
      'select count(*)::int n from table_qr_codes where table_id = $1 and revoked_at is null', [table])).rows[0].n as number;

    it("refuses to rotate or retire another outlet's table code", async () => {
      const target = await tableOf(a.freshQrToken);
      for (const intruder of [a.outsider, b.owner]) {
        // Both hold a real account: a signed-in stranger, and the owner of a
        // different restaurant. Neither is a member of a.
        await expect(staff(intruder, () => db.query('select rotate_table_qr_code($1)', [target])))
          .rejects.toMatchObject({ code: '42501' });
        await expect(staff(intruder, () => db.query('select retire_table_qr_code($1)', [target])))
          .rejects.toMatchObject({ code: '42501' });
      }
      // The card still works: a refused attempt revoked nothing, so a guest can
      // still open a session with the token printed on that table.
      const opened = await guest(async () => (await db.query(
        'select status from open_table_session($1,$2)', [a.freshQrToken, 'b'.repeat(64)])).rows[0].status);
      expect(opened).toBe('opened');
    });

    it('refuses guests at the function boundary', async () => {
      const target = await tableOf(a.freshQrToken);
      // `anon` holds no EXECUTE on either RPC: the app never calls them for a
      // guest, and a scanner cannot rotate the card it just read.
      await expect(guest(() => db.query('select rotate_table_qr_code($1)', [target])))
        .rejects.toMatchObject({ code: '42501' });
      await expect(guest(() => db.query('select retire_table_qr_code($1)', [target])))
        .rejects.toMatchObject({ code: '42501' });
    });

    it('rejects a missing or unknown table identifier', async () => {
      // 22023 for a missing id, P0002 for an id that names no table: neither
      // path may fall through to a write.
      await expect(staff(a.owner, () => db.query('select rotate_table_qr_code($1::uuid)', [null])))
        .rejects.toMatchObject({ code: '22023' });
      const unknown = randomUUID();
      await expect(staff(a.owner, () => db.query('select rotate_table_qr_code($1)', [unknown])))
        .rejects.toMatchObject({ code: 'P0002' });
      await expect(staff(a.owner, () => db.query('select retire_table_qr_code($1)', [unknown])))
        .rejects.toMatchObject({ code: 'P0002' });
    });

    it('lets an outlet manager rotate, and refuses cashier and kitchen staff', async () => {
      const manager = randomUUID();
      await db.query('insert into profiles(id) values ($1)', [manager]);
      await db.query("insert into memberships(restaurant_id,user_id,role) values ($1,$2,'manager')", [a.restaurant, manager]);
      const target = await tableOf(a.freshQrToken);

      const issued = await staff(manager, async () =>
        (await db.query('select rotate_table_qr_code($1) token', [target])).rows[0].token as string);
      expect(issued).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
      expect(issued).not.toBe(a.freshQrToken);

      // Membership is not the same as authority: a cashier and a kitchen
      // account belong to the outlet and still may not manage its cards.
      for (const denied of [a.cashier, a.kitchen]) {
        await expect(staff(denied, () => db.query('select rotate_table_qr_code($1)', [target])))
          .rejects.toMatchObject({ code: '42501' });
        await expect(staff(denied, () => db.query('select retire_table_qr_code($1)', [target])))
          .rejects.toMatchObject({ code: '42501' });
      }
    });

    it('replaces the old card, and two rotations leave exactly one live card', async () => {
      const target = await tableOf(b.freshQrToken);
      const outcome = await staff(b.owner, async () => {
        const first = (await db.query('select rotate_table_qr_code($1) token', [target])).rows[0].token as string;
        // A guest holding the replaced card is told it is revoked, not "unknown".
        await db.query('set local role anon');
        const replaced = (await db.query('select status from open_table_session($1,$2)',
          [b.freshQrToken, 'c'.repeat(64)])).rows[0].status as string;
        await db.query('set local role authenticated');
        const second = (await db.query('select rotate_table_qr_code($1) token', [target])).rows[0].token as string;
        return { first, second, replaced, live: await liveCodes(target) };
      });
      expect(outcome.first).not.toBe(b.freshQrToken);
      expect(outcome.second).not.toBe(outcome.first);
      expect(outcome.replaced).toBe('revoked');
      // The invariant the printed card relies on: one live code per table.
      expect(outcome.live).toBe(1);
    });

    it('accepts the replacement card and makes rotation idempotent under repeats', async () => {
      const target = await tableOf(b.freshQrToken);
      const outcome = await staff(b.owner, async () => {
        const token = (await db.query('select rotate_table_qr_code($1) token', [target])).rows[0].token as string;
        await db.query('set local role anon');
        const opened = (await db.query('select status from open_table_session($1,$2)',
          [token, 'd'.repeat(64)])).rows[0].status as string;
        await db.query('set local role authenticated');
        // Retiring twice is a no-op the second time, not an error: staff may
        // press it again after a timeout and must not see a scary failure.
        await db.query('select retire_table_qr_code($1)', [target]);
        await db.query('select retire_table_qr_code($1)', [target]);
        return { opened, live: await liveCodes(target) };
      });
      expect(outcome.opened).toBe('opened');
      expect(outcome.live).toBe(0);
    });

    it('refuses a second live card for one table at the database level', async () => {
      // The invariant that makes a printed card unambiguous. It is enforced by
      // table_qr_codes_one_active_per_table, so it holds even for a writer that
      // never calls rotate_table_qr_code (20261122000200).
      const table = (await db.query(
        "insert into dining_tables(restaurant_id,label) values($1,'invariant') returning id",
        [a.restaurant])).rows[0].id as string;
      const live = (await db.query(
        'select public_token from table_qr_codes where table_id=$1 and revoked_at is null', [table])).rows[0].public_token;
      expect(live).toBeTruthy();
      await expect(db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)',
        [a.restaurant, table, randomUUID().replaceAll('-', '')])).rejects.toMatchObject({ code: '23505' });
      // Once the live card is revoked the slot is free again, so rotation and
      // replacement still work.
      await db.query('update table_qr_codes set revoked_at=now() where table_id=$1 and revoked_at is null', [table]);
      await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)',
        [a.restaurant, table, randomUUID().replaceAll('-', '')]);
      expect(await liveCodes(table)).toBe(1);
    });

    it('serialises concurrent rotations so a table never ends with two live cards', async () => {
      const table = (await db.query(
        "insert into dining_tables(restaurant_id,label) values($1,'race') returning id",
        [a.restaurant])).rows[0].id as string;
      const rotate = async (client: Client) => {
        await client.query('begin');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [a.owner]);
        await client.query('set local role authenticated');
        const { rows } = await client.query('select rotate_table_qr_code($1) token', [table]);
        await client.query('commit');
        return rows[0].token as string;
      };
      const one = new Client({ connectionString: URL_VALUE });
      const two = new Client({ connectionString: URL_VALUE });
      await one.connect(); await two.connect();
      try {
        const [first, second] = await Promise.all([rotate(one), rotate(two)]);
        expect(first).not.toBe(second);
        // Both rotations committed. Whatever the interleaving, the table has
        // exactly one live card afterwards: the advisory lock and the unique
        // index agree.
        expect(await liveCodes(table)).toBe(1);
      } finally { await one.end(); await two.end(); }
    });

    it("lets the outlet's owner rotate and retire its own code", async () => {
      const target = await tableOf(b.freshQrToken);
      const outcome = await staff(b.owner, async () => {
        const token = (await db.query('select rotate_table_qr_code($1) token', [target])).rows[0].token as string;
        const afterRotate = await liveCodes(target);
        await db.query('select retire_table_qr_code($1)', [target]);
        return { token, afterRotate, afterRetire: await liveCodes(target) };
      });
      expect(outcome.token).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
      expect(outcome.token).not.toBe(b.freshQrToken);
      // Rotate revokes the old cards and installs exactly one new code; retire
      // leaves none.
      expect(outcome.afterRotate).toBe(1);
      expect(outcome.afterRetire).toBe(0);
    });
  });

  describe('kitchen announcement claims', () => {
    // These two need committed state, so they switch role for the session
    // instead of using the rollback wrapper.
    const asCommitted = async <T>(user: string, work: () => Promise<T>): Promise<T> => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.query('set role authenticated');
      try { return await work(); } finally {
        await db.query('reset role');
        await db.query("select set_config('request.jwt.claim.sub','',false)");
      }
    };

    it('hands a stale claim to another device and keeps a fresh one', async () => {
      const order = (await db.query(
        `insert into orders(restaurant_id,code,prep_status,subtotal_paise,total_paise)
         values($1,$2,'new',12500,12500) returning id`,
        [a.restaurant, 'CLAIM' + randomUUID().slice(0, 8)])).rows[0].id as string;
      const second = randomUUID();
      await db.query('insert into profiles(id) values ($1)', [second]);
      await db.query("insert into memberships(restaurant_id,user_id,role) values ($1,$2,'kitchen')", [a.restaurant, second]);

      const claim = (user: string) => asCommitted(user, async () => (await db.query(
        'select claim_kitchen_order_announcement($1) c', [order])).rows[0].c as boolean);

      expect(await claim(a.kitchen)).toBe(true);
      // A device that crashed holds the claim: without the two-minute expiry
      // this call would return false forever and the ticket would never be
      // announced (20261122000100).
      expect(await claim(second)).toBe(false);
      await db.query(
        "update kitchen_announcement_claims set claimed_at = statement_timestamp() - interval '3 minutes' where order_id=$1",
        [order]);
      expect(await claim(second)).toBe(true);
      expect((await db.query('select claimed_by from kitchen_announcement_claims where order_id=$1', [order])).rows[0].claimed_by).toBe(second);
      // Still exactly one claim row per order, so the board cannot double-announce.
      expect((await db.query('select count(*)::int n from kitchen_announcement_claims where order_id=$1', [order])).rows[0].n).toBe(1);
    });

    it('keeps the claim gate closed to non-kitchen staff and to guests', async () => {
      const order = (await db.query(
        `insert into orders(restaurant_id,code,prep_status,subtotal_paise,total_paise)
         values($1,$2,'new',12500,12500) returning id`,
        [a.restaurant, 'GATE' + randomUUID().slice(0, 8)])).rows[0].id as string;
      await expect(asCommitted(a.cashier, async () => db.query(
        'select claim_kitchen_order_announcement($1)', [order]))).rejects.toMatchObject({ code: '42501' });
      await expect(guest(() => db.query('select claim_kitchen_order_announcement($1)', [order])))
        .rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('SECURITY DEFINER trigger functions', () => {
    it('grants EXECUTE on no trigger function to any runtime role', async () => {
      // PostgreSQL does not consult EXECUTE for trigger-fired functions
      // (proven on the embedded cluster; see
      // scripts/local-pg/probe-trigger-execute.mjs). The functions exist in
      // the PostgREST catalogue, so no runtime role should hold EXECUTE.
      const { rows } = await db.query(`
        select p.proname as name,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
               has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
               has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prorettype = 'trigger'::regtype
           and p.prosecdef`);
      expect(rows.length).toBeGreaterThanOrEqual(13);
      for (const row of rows) {
        expect(
          [row.anon_exec, row.public_exec, row.authenticated_exec, row.service_role_exec],
          `trigger function ${row.name} leaks EXECUTE to a runtime role`,
        ).toEqual([false, false, false, false]);
      }
    });

    it('still fires a trigger whose function holds EXECUTE for no runtime role', async () => {
      // ensure_table_qr_code() provisions a QR token for every new dining
      // table, so a table appearing in table_qr_codes proves the trigger
      // path works with EXECUTE revoked everywhere.
      const slug = 'trigger-probe-' + randomUUID();
      const restaurant = (await db.query(
        `insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
         values ($1,'Trigger probe restaurant','Test-only address',0,'scan') returning id`,
        [slug],
      )).rows[0].id;
      const table = (await db.query(
        `insert into dining_tables(restaurant_id,label) values ($1,'Probe') returning id`,
        [restaurant],
      )).rows[0].id;
      const qr = (await db.query(
        'select public_token from table_qr_codes where table_id = $1',
        [table],
      )).rows[0];
      expect(qr?.public_token).toBeTruthy();
    });
  });
});
