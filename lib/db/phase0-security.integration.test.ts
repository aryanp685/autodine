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
    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)', [restaurant, table, token]);
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
      expect(await guest(async () => (await db.query('select id from restaurants')).rows)).toEqual([]);
    });

    it('are not readable by a signed-in user who is not staff there', async () => {
      const read = (user: string) => staff(user, async () => (await db.query('select id from restaurants where id=$1', [a.restaurant])).rows);
      expect(await read(a.outsider)).toEqual([]);
      expect(await read(b.owner)).toEqual([]);
    });

    it('stay fully readable by their own staff, plan and trial included', async () => {
      const rows = await staff(a.kitchen, async () => (await db.query('select id, plan, trial_started_at from restaurants')).rows);
      expect(rows.map((row) => row.id)).toEqual([a.restaurant]);
      expect(rows[0].plan).toBeTruthy();
      expect(rows[0].trial_started_at).toBeTruthy();
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
      (await db.query('select restaurant_access($1) access, restaurant_trial_ends_at($1) trial_ends, restaurant_features($1) features', [a.restaurant])).rows[0]);

    it('cannot be read by a guest through the plan functions', async () => {
      for (const call of ['restaurant_access($1)', 'restaurant_trial_ends_at($1)', 'restaurant_features($1)']) {
        await expect(guest(() => db.query(`select ${call}`, [a.restaurant]))).rejects.toMatchObject({ code: '42501' });
      }
    });

    it('is "not found" for a signed-in user who is not staff there', async () => {
      for (const user of [a.outsider, b.owner]) {
        const row = await read(user);
        expect(row.access).toBeNull();
        expect(row.trial_ends).toBeNull();
        expect(row.features).toEqual([]);
      }
    });

    it('is still available to the restaurant own staff', async () => {
      const row = await read(a.cashier);
      expect(row.access).not.toBeNull();
      expect(row.trial_ends).not.toBeNull();
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

      // The same call from the account's own staff still answers in full.
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
      expect(await guest(async () => (await db.query(
        'select gstin, plan, plan_status, trial_started_at, upi_id from restaurants where slug=$1', [a.slug])).rows)).toEqual([]);
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
});
