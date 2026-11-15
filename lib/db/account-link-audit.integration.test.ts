/**
 * Audited account-link enforcement (D1 hardening) against disposable PostgreSQL.
 *
 * Covers migration 20261115000300_audit_restaurant_account_reassignment.sql on
 * top of 20261112000200_immutable_restaurant_account_link.sql:
 *
 *   - a JWT-carrying caller can never move restaurants.account_id (42501),
 *     and the rejected attempt writes nothing;
 *   - the service/migration path may apply a change, and the applied change
 *     lands in restaurant_account_link_audit with actor, before/after links;
 *   - the audit ledger is append-only and unreadable to client roles;
 *   - ordinary restaurant updates do not touch the ledger.
 *
 * Direct-SQL RLS/trigger validation with simulated JWT claims — NOT an
 * HTTP/PostgREST test. Requires the disposable autodine_check_* database.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Account-link audit tests require a locally-created disposable autodine_check_* database');
  }
}

let db: Client;

async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    return await work();
  } finally {
    await db.query('rollback');
  }
}
const staff = <T>(user: string, work: () => Promise<T>) => asRole('authenticated', user, work);
const service = <T>(work: () => Promise<T>) => asRole('service_role', null, work);

async function createLinkedRestaurant(label: string, owner: string): Promise<{ restaurant: string; account: string }> {
  const restaurant = (await db.query(
    'select public.create_account_with_restaurant($1,$2,$3,$4) id',
    [`Audit fixture ${label}`, `audit-${owner}`, 'Asia/Kolkata', owner],
  )).rows[0].id;
  const account = (await db.query('select account_id from public.restaurants where id=$1', [restaurant])).rows[0].account_id;
  return { restaurant, account };
}

async function auditRows(restaurant: string) {
  return (await db.query(
    'select restaurant_id, old_account_id, new_account_id, actor_role, actor_user from public.restaurant_account_link_audit where restaurant_id = $1 order by id',
    [restaurant],
  )).rows;
}

describe.skipIf(!URL_VALUE)('Account-link audit ledger (disposable PostgreSQL)', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
  }, 30000);

  beforeEach(async () => {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  it('refuses a client reassignment and records nothing in the ledger', async () => {
    const owner = randomUUID();
    const targetOwner = randomUUID();
    const fixture = await createLinkedRestaurant('refuse', owner);
    const target = await createLinkedRestaurant('refuse-target', targetOwner);

    await expect(staff(owner, () => db.query(
      'update public.restaurants set account_id=$1 where id=$2',
      [target.account, fixture.restaurant],
    ))).rejects.toMatchObject({ code: '42501' });

    expect(await auditRows(fixture.restaurant)).toEqual([]);
  });

  it('audits an applied trusted repair with the before/after link and actor', async () => {
    const owner = randomUUID();
    const targetOwner = randomUUID();
    const fixture = await createLinkedRestaurant('service', owner);
    const target = await createLinkedRestaurant('service-target', targetOwner);

    // Trusted maintenance path, no JWT subject: the change applies and the
    // same trigger writes the audit row. The committed row stays in the
    // disposable database for the tamper-proof suite below.
    await db.query(
      'update public.restaurants set account_id=$1 where id=$2',
      [target.account, fixture.restaurant],
    );
    const rows = await auditRows(fixture.restaurant);
    expect(rows).toHaveLength(1);
    expect(rows[0].old_account_id).toBe(fixture.account);
    expect(rows[0].new_account_id).toBe(target.account);
    expect(rows[0].actor_role).toBe('postgres');
    expect(rows[0].actor_user).toBeNull();
    // Under hosted Supabase, service_role bypasses RLS and reaches the same
    // trigger with no JWT subject; the row then records actor_role='service_role'.
    // This disposable shim has no BYPASSRLS on service_role, so the superuser
    // path stands in for the mechanism; the owner verifies the hosted row
    // shape with the bounded probe in the runbook.
  });

  it('audits a migration-style backfill (null to account) exactly once', async () => {
    const owner = randomUUID();
    const { restaurant } = await createLinkedRestaurant('backfill', owner);
    const account = (await db.query('select account_id from public.restaurants where id=$1', [restaurant])).rows[0].account_id;

    // Superuser maintenance path (no JWT): both the detach and the re-attach
    // are applied changes, so both are audited — in order.
    await db.query('update public.restaurants set account_id = null where id = $1', [restaurant]);
    await db.query('update public.restaurants set account_id = $1 where id = $2', [account, restaurant]);

    const rows = await auditRows(restaurant);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.old_account_id, r.new_account_id])).toEqual([
      [account, null],
      [null, account],
    ]);
    expect(rows.every((r) => r.actor_role === 'postgres')).toBe(true);
  });

  it('does not write the ledger for ordinary owner updates', async () => {
    const owner = randomUUID();
    const fixture = await createLinkedRestaurant('ordinary', owner);
    await staff(owner, () => db.query(
      'update public.restaurants set tagline=$1 where id=$2',
      ['Synthetic tagline', fixture.restaurant],
    ));
    expect(await auditRows(fixture.restaurant)).toEqual([]);
  });

  it('denies client roles any read of the ledger', async () => {
    const owner = randomUUID();
    const targetOwner = randomUUID();
    const fixture = await createLinkedRestaurant('denyread', owner);
    const target = await createLinkedRestaurant('denyread-target', targetOwner);
    await db.query('update public.restaurants set account_id=$1 where id=$2', [target.account, fixture.restaurant]);

    await expect(staff(owner, () => db.query('select * from public.restaurant_account_link_audit')))
      .rejects.toMatchObject({ code: '42501' });
    await expect(asRole('anon', null, () => db.query('select * from public.restaurant_account_link_audit')))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('lets service_role read the ledger for support, and no client role can write it directly', async () => {
    const owner = randomUUID();
    const targetOwner = randomUUID();
    const fixture = await createLinkedRestaurant('serviceview', owner);
    const target = await createLinkedRestaurant('serviceview-target', targetOwner);
    // Committed repair so there IS a row to read; the role then proves its
    // support access. (service_role cannot write restaurants here — RLS —
    // but it holds SELECT on the audit ledger by design.)
    await db.query('update public.restaurants set account_id=$1 where id=$2', [target.account, fixture.restaurant]);
    const seen = await service(() => db.query(
      'select count(*)::int n from public.restaurant_account_link_audit where restaurant_id=$1',
      [fixture.restaurant],
    ));
    expect(seen.rows[0].n).toBe(1);

    await expect(staff(owner, () => db.query(
      'insert into public.restaurant_account_link_audit (restaurant_id, actor_role) values ($1, $2)',
      [fixture.restaurant, 'forge'],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(staff(owner, () => db.query(
      'update public.restaurant_account_link_audit set actor_role=$1 where restaurant_id=$2',
      ['forge', fixture.restaurant],
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('the ledger refuses updates and deletes even from privileged paths', async () => {
    const owner = randomUUID();
    const targetOwner = randomUUID();
    const fixture = await createLinkedRestaurant('immutable', owner);
    const target = await createLinkedRestaurant('immutable-target', targetOwner);
    // Committed (superuser) repair path so the ledger row persists for the
    // tamper attempts below.
    await db.query('update public.restaurants set account_id=$1 where id=$2', [target.account, fixture.restaurant]);

    await expect(db.query(
      'update public.restaurant_account_link_audit set actor_role=$1 where restaurant_id=$2',
      ['forge', fixture.restaurant],
    )).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(
      'delete from public.restaurant_account_link_audit where restaurant_id=$1',
      [fixture.restaurant],
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('initial linking on INSERT never fires the ledger', async () => {
    const owner = randomUUID();
    const fixture = await createLinkedRestaurant('insert', owner);
    expect(await auditRows(fixture.restaurant)).toEqual([]);
  });
});
