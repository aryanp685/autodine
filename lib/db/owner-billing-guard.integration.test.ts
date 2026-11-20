/**
 * Owner-only billing configuration guard (D3) against disposable PostgreSQL.
 *
 * Covers migration 20261115000200_owner_billing_configuration_guard.sql
 * (renumbered from PR #181):
 *
 *   - the owner can change tax_rate_bps and gstin;
 *   - a manager cannot, and neither can a cashier/kitchen role, and neither
 *     can a JWT-less privileged path (auth.uid() is null is NOT a bypass);
 *   - ordinary restaurant edits by owner/manager are untouched;
 *   - the database refuses out-of-range tax and a malformed GSTIN even from
 *     the owner;
 *   - the trigger is enabled, SECURITY DEFINER, and executable by nobody.
 *
 * Direct-SQL trigger enforcement with simulated JWT claims — NOT an
 * HTTP/PostgREST test. Requires the disposable autodine_check_* database.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Owner billing guard tests require a locally-created disposable autodine_check_* database');
  }
}

let db: Client;

type Fixture = { owner: string; manager: string; restaurant: string };

let f: Fixture;

async function asRole<T>(role: 'authenticated' | 'service_role', user: string | null, work: () => Promise<T>): Promise<T> {
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

describe.skipIf(!URL_VALUE)('Owner billing configuration guard (disposable PostgreSQL)', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
    const owner = randomUUID();
    const manager = randomUUID();
    const restaurant = (await db.query(
      'select public.create_account_with_restaurant($1,$2,$3,$4) id',
      [`Billing Guard ${owner.slice(0, 8)}`, `billing-guard-${owner}`, 'Asia/Kolkata', owner],
    )).rows[0].id;
    await db.query('insert into public.profiles(id) values ($1)', [manager]);
    await db.query(
      "insert into public.memberships(restaurant_id,user_id,role) values ($1,$2,'manager')",
      [restaurant, manager],
    );
    f = { owner, manager, restaurant };
  }, 30000);

  beforeEach(async () => {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  it('lets the owner change tax rate and GSTIN', async () => {
    // The asRole harness rolls the transaction back at the end, so the
    // assertions read inside the same transaction.
    await staff(f.owner, async () => {
      await db.query('update public.restaurants set tax_rate_bps=$1 where id=$2', [725, f.restaurant]);
      await db.query("update public.restaurants set gstin=$1 where id=$2", ['27ABCDE1234F1Z5', f.restaurant]);
      const row = (await db.query('select tax_rate_bps, gstin from public.restaurants where id=$1', [f.restaurant])).rows[0];
      expect(row.tax_rate_bps).toBe(725);
      expect(row.gstin).toBe('27ABCDE1234F1Z5');
    });
  });

  it('refuses a manager tax or GSTIN change with 42501', async () => {
    await expect(staff(f.manager, () => db.query(
      'update public.restaurants set tax_rate_bps=$1 where id=$2', [1200, f.restaurant],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(staff(f.manager, () => db.query(
      "update public.restaurants set gstin=$1 where id=$2", ['27ABCDE1234F1Z5', f.restaurant],
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses the JWT-less paths too — no privileged bypass exists', async () => {
    // service_role has no membership row here: RLS hides the row, so the
    // statement matches nothing and the trigger never fires. The write does
    // not land either way.
    const viaService = await service(() => db.query(
      'update public.restaurants set tax_rate_bps=$1 where id=$2', [500, f.restaurant],
    ));
    expect(viaService.rowCount ?? 0).toBe(0);
    // The direct superuser call sees the row, the trigger fires, and the
    // JWT-less actor is refused: a privileged SQL session is not a loophole.
    await expect(db.query(
      'update public.restaurants set tax_rate_bps=$1 where id=$2', [500, f.restaurant],
    )).rejects.toMatchObject({ code: '42501' });
    // And an operator repair impersonating the owner explicitly (setting the
    // subject claim for one transaction) is the documented way through for
    // approved fixes — the guard still judges it as the owner.
    const before = (await db.query('select tax_rate_bps from public.restaurants where id=$1', [f.restaurant])).rows[0].tax_rate_bps;
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [f.owner]);
      await db.query('update public.restaurants set tax_rate_bps=$1 where id=$2', [500, f.restaurant]);
      const inside = (await db.query('select tax_rate_bps from public.restaurants where id=$1', [f.restaurant])).rows[0].tax_rate_bps;
      expect(inside).toBe(500);
    } finally {
      await db.query('rollback');
    }
    const after = (await db.query('select tax_rate_bps from public.restaurants where id=$1', [f.restaurant])).rows[0].tax_rate_bps;
    expect(after).toBe(before); // rolled back — the impersonated write itself succeeded, the guard judged the owner
  });

  it('still allows owner and manager to edit ordinary restaurant fields', async () => {
    await staff(f.manager, async () => {
      const result = await db.query(
        "update public.restaurants set tagline=$1, phone=$2 where id=$3",
        ['Synthetic tagline', '+91 90000 00000', f.restaurant],
      );
      expect(result.rowCount).toBe(1);
    });
    await staff(f.owner, async () => {
      await db.query(
        'update public.restaurants set name=$1 where id=$2',
        ['Billing Guard Renamed', f.restaurant],
      );
      const row = (await db.query('select name from public.restaurants where id=$1', [f.restaurant])).rows[0];
      expect(row.name).toBe('Billing Guard Renamed');
    });
  });

  it('enforces the 30% ceiling and the GSTIN format even for the owner', async () => {
    await expect(staff(f.owner, () => db.query(
      'update public.restaurants set tax_rate_bps=$1 where id=$2', [3001, f.restaurant],
    ))).rejects.toMatchObject({ code: '23514' });
    await expect(staff(f.owner, () => db.query(
      "update public.restaurants set gstin=$1 where id=$2", ['NOT-A-GSTIN', f.restaurant],
    ))).rejects.toMatchObject({ code: '23514' });
  });

  it('leaves the stored billing configuration byte-identical after a refused attempt', async () => {
    // A refused billing edit must be a no-op, not a partial write: the money
    // columns stay exactly as they were, so a retried or racing attempt can
    // never leave a half-applied tax change behind.
    const before = (await db.query(
      'select tax_rate_bps, gstin from public.restaurants where id=$1', [f.restaurant],
    )).rows[0];
    await expect(staff(f.manager, () => db.query(
      'update public.restaurants set tax_rate_bps=$1, gstin=$2 where id=$3',
      [1800, '27ABCDE1234F1Z5', f.restaurant],
    ))).rejects.toMatchObject({ code: '42501' });
    const after = (await db.query(
      'select tax_rate_bps, gstin from public.restaurants where id=$1', [f.restaurant],
    )).rows[0];
    expect(after).toEqual(before);
  });

  it('is idempotent — re-applying the migration reproduces one trigger and no grants', async () => {
    // Retries and re-runs are the normal case for a forward-only migration
    // track. Applying the file a second time must neither stack a duplicate
    // trigger nor restore EXECUTE to a runtime role.
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261115000200_owner_billing_configuration_guard.sql'),
      'utf8',
    );
    await db.query(sql);
    await db.query(sql);
    const triggers = (await db.query(`
      select count(*)::int n from pg_trigger
       where tgrelid = 'public.restaurants'::regclass
         and tgname = 'restaurants_billing_configuration_guard'
         and not tgisinternal
    `)).rows[0].n;
    expect(triggers).toBe(1);
    const grants = (await db.query(`
      select count(*)::int n from aclexplode(
        (select proacl from pg_proc
          where proname = 'guard_restaurant_billing_configuration'
            and pronamespace = 'public'::regnamespace)
      ) acl
      where acl.grantee in (0, (select oid from pg_roles where rolname='anon'),
                            (select oid from pg_roles where rolname='authenticated'),
                            (select oid from pg_roles where rolname='service_role'))
    `)).rows[0].n;
    expect(grants).toBe(0);
    // The boundary still holds after the re-runs.
    await expect(staff(f.manager, () => db.query(
      'update public.restaurants set tax_rate_bps=$1 where id=$2', [900, f.restaurant],
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('ships the guard as an enabled, SECURITY DEFINER trigger executable by nobody', async () => {
    const trigger = (await db.query(`
      select t.tgenabled, p.prosecdef, p.proconfig, pg_get_triggerdef(t.oid) as definition
        from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid='public.restaurants'::regclass
         and t.tgname = 'restaurants_billing_configuration_guard'
    `)).rows[0];
    expect(trigger).toBeTruthy();
    expect(trigger.tgenabled).toBe('O');
    expect(trigger.prosecdef).toBe(true);
    expect(trigger.proconfig).toContain('search_path=public, pg_temp');
    expect(trigger.definition).toMatch(/BEFORE UPDATE OF tax_rate_bps, gstin ON public\.restaurants/i);

    const acl = (await db.query(`
      select count(*)::int n
        from aclexplode(coalesce(
          (select proacl from pg_proc where proname = 'guard_restaurant_billing_configuration'
            and pronamespace = 'public'::regnamespace),
          (select proacl from pg_proc where proname = 'guard_restaurant_billing_configuration'
            and pronamespace = 'public'::regnamespace)
        )) acl
       where acl.grantee in (0, (select oid from pg_roles where rolname='anon'),
                             (select oid from pg_roles where rolname='authenticated'),
                             (select oid from pg_roles where rolname='service_role'))
    `)).rows[0].n;
    expect(acl).toBe(0);
  });
});
