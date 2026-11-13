/**
 * Phase 6D account-entitlement hardening against the disposable PostgreSQL
 * created by scripts/verify-database.mjs.
 *
 * These tests use the real `authenticated`, `anon` and `service_role` database
 * roles. JWT subjects are simulated with the same request claim the local
 * Supabase shim exposes; this is direct-SQL RLS/trigger validation, NOT an
 * HTTP/PostgREST test.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Account-link tests require a locally-created disposable autodine_check_* database');
  }
}

type Restaurant = { owner: string; account: string; restaurant: string; name: string; slug: string };

type Fixture = { linked: Restaurant; target: Restaurant; manager: string; foreignOwner: string };

let db: Client;
let a: Fixture;

async function createRestaurant(label: string): Promise<Restaurant> {
  const owner = randomUUID();
  const name = `Phase 6D ${label} ${owner.slice(0, 8)}`;
  const slug = `phase6d-${label}-${owner}`;
  const restaurant = (await db.query(
    'select public.create_account_with_restaurant($1,$2,$3,$4) id',
    [name, slug, 'Asia/Kolkata', owner],
  )).rows[0].id as string;
  const account = (await db.query(
    'select account_id from public.restaurants where id=$1', [restaurant],
  )).rows[0].account_id as string;
  return { owner, account, restaurant, name, slug };
}

async function asRole<T>(role: 'anon' | 'authenticated', user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    return await work();
  } finally {
    await db.query('rollback');
  }
}
const guest = <T>(work: () => Promise<T>) => asRole('anon', null, work);
const staff = <T>(user: string, work: () => Promise<T>) => asRole('authenticated', user, work);

describe.skipIf(!URL_VALUE)('Phase 6D restaurant account-link guard', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
    const linked = await createRestaurant('linked');
    const target = await createRestaurant('target');
    const manager = randomUUID();
    const foreignOwner = randomUUID();
    await db.query('insert into public.profiles(id) values($1),($2)', [manager, foreignOwner]);
    await db.query(
      "insert into public.memberships(restaurant_id,user_id,role) values($1,$2,'manager')",
      [linked.restaurant, manager],
    );
    // A is expired while its old restaurant-level fields remain intact. B is
    // writable, so an association change would have a material entitlement and
    // account-RLS effect if the guard were absent.
    await db.query(
      "update public.accounts set plan_status='expired', trial_ends_at=now()-interval '1 day' where id=$1",
      [linked.account],
    );
    await db.query(
      "update public.accounts set plan='business', plan_status='active', plan_expires_at=now()+interval '30 days' where id=$1",
      [target.account],
    );
    a = { linked, target, manager, foreignOwner };
  }, 30000);

  beforeEach(async () => {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  it('adds a trigger guard without removing the established UPDATE grant, RLS policy, or legacy plan trigger', async () => {
    const acl = (await db.query(`
      select has_table_privilege('authenticated','public.restaurants','UPDATE') as authenticated_update,
             has_column_privilege('authenticated','public.restaurants','account_id','UPDATE') as account_column_update,
             has_table_privilege('anon','public.restaurants','UPDATE') as anon_update
    `)).rows[0];
    expect(acl).toEqual({ authenticated_update: true, account_column_update: true, anon_update: false });

    const policy = (await db.query(`
      select qual, with_check from pg_policies
       where schemaname='public' and tablename='restaurants' and policyname='restaurants_update'
    `)).rows[0];
    expect(policy).toBeTruthy();
    expect(policy.qual).toMatch(/can_manage_restaurant/i);
    expect(policy.with_check).toMatch(/can_manage_restaurant/i);
    expect(`${policy.qual} ${policy.with_check}`).not.toMatch(/account_id/i);

    const triggers = (await db.query(`
      select t.tgname, t.tgenabled, p.prosecdef, p.proconfig, pg_get_triggerdef(t.oid) as definition,
             pg_get_functiondef(p.oid) as body
        from pg_trigger t join pg_proc p on p.oid=t.tgfoid
       where t.tgrelid='public.restaurants'::regclass and not t.tgisinternal
       order by t.tgname
    `)).rows;
    const accountGuard = triggers.find((trigger) => trigger.tgname === 'restaurants_account_id_immutable');
    const planGuard = triggers.find((trigger) => trigger.tgname === 'restaurants_plan_guard');
    expect(accountGuard).toBeTruthy();
    expect(accountGuard.tgenabled).toBe('O');
    expect(accountGuard.prosecdef).toBe(true);
    expect(accountGuard.proconfig).toContain('search_path=public, pg_temp');
    expect(accountGuard.definition).toMatch(/BEFORE UPDATE ON public\.restaurants/i);
    expect(accountGuard.body).toMatch(/old\.account_id is distinct from new\.account_id/i);
    expect(accountGuard.body).toMatch(/auth\.uid\(\) is not null/i);
    const guardCode = accountGuard.body.replace(/--[^\n]*/g, '');
    expect(guardCode).not.toMatch(/bypass|set_config|current_setting|app\./i);
    expect(planGuard).toBeTruthy();
    expect(planGuard.tgenabled).toBe('O');
    expect(planGuard.body).toMatch(/new\.trial_started_at/i);
    expect(planGuard.body).toMatch(/new\.plan_status/i);
    expect(planGuard.body).not.toMatch(/account_id/i);

    const column = (await db.query(`
      select is_nullable from information_schema.columns
       where table_schema='public' and table_name='restaurants' and column_name='account_id'
    `)).rows[0];
    expect(column.is_nullable).toBe('YES');
    const foreignKey = (await db.query(`
      select c.confdeltype from pg_constraint c
       where c.conrelid='public.restaurants'::regclass and c.contype='f'
         and c.conkey=array[(select attnum from pg_attribute where attrelid='public.restaurants'::regclass and attname='account_id')]
    `)).rows[0];
    expect(foreignKey.confdeltype).toBe('n'); // ON DELETE SET NULL remains.

    const guardExec = (await db.query(`
      select has_function_privilege('anon','public.prevent_restaurant_account_reassignment()','EXECUTE') as anon_exec,
             has_function_privilege('authenticated','public.prevent_restaurant_account_reassignment()','EXECUTE') as auth_exec
    `)).rows[0];
    expect(guardExec).toEqual({ anon_exec: false, auth_exec: false });
  });

  it('rejects both detachment and reassignment for owners and managers, with no entitlement change', async () => {
    expect((await db.query('select public.restaurant_can_write($1) ok', [a.linked.restaurant])).rows[0].ok).toBe(false);
    expect((await db.query('select public.restaurant_can_write($1) ok', [a.target.restaurant])).rows[0].ok).toBe(true);

    for (const user of [a.linked.owner, a.manager]) {
      for (const destination of [null, a.target.account]) {
        await expect(staff(user, () => db.query(
          'update public.restaurants set account_id=$1 where id=$2 returning account_id',
          [destination, a.linked.restaurant],
        ))).rejects.toMatchObject({ code: '42501' });
      }
    }

    const unchanged = (await db.query(
      'select account_id, public.restaurant_can_write(id) can_write from public.restaurants where id=$1',
      [a.linked.restaurant],
    )).rows[0];
    expect(unchanged).toEqual({ account_id: a.linked.account, can_write: false });
    expect((await db.query('select count(*)::int n from public.accounts where id=$1', [a.target.account])).rows[0].n).toBe(1);
  });

  it('keeps the membership row boundary: a manager cannot modify another restaurant row', async () => {
    const result = await staff(a.manager, () => db.query(
      'update public.restaurants set name=$1 where id=$2 returning id',
      [`not-${a.target.name}`, a.target.restaurant],
    ));
    expect(result.rowCount).toBe(0);
    expect((await db.query('select name from public.restaurants where id=$1', [a.target.restaurant])).rows[0].name)
      .toBe(a.target.name);
  });

  it('preserves owner/manager settings, tax, verification, branding, storefront and operational writes after expiry', async () => {
    const slug = `phase6d-updated-${randomUUID()}`;
    const result = await staff(a.linked.owner, async () => (await db.query(`
      update public.restaurants
         set name=$1, tagline=$2, address=$3, phone=$4, gstin=$5, slug=$6,
             timezone='Asia/Kolkata', tax_rate_bps=725,
             guest_verification_mode='scan_confirm',
             announcement_text='Synthetic service notice', announcement_on=true,
             is_active=false, online_payments_enabled=true,
             logo_path=id::text || '/logo.png', banner_path=id::text || '/banner.webp',
             accent='maroon', updated_at=now(),
             upi_id='phase6d.owner@okicici', upi_payee_name='Synthetic Owner'
       where id=$7
       returning account_id, name, tagline, address, phone, gstin, slug, timezone,
                 tax_rate_bps, guest_verification_mode, announcement_text, announcement_on,
                 is_active, online_payments_enabled, logo_path, banner_path, accent,
                 upi_id, upi_payee_name
    `, [
      'Phase 6D updated name', 'Synthetic tagline', 'Synthetic address', '+91 90000 00000',
      '27ABCDE1234F1Z5', slug, a.linked.restaurant,
    ])).rows[0]);

    expect(result).toMatchObject({
      account_id: a.linked.account,
      name: 'Phase 6D updated name',
      tagline: 'Synthetic tagline',
      address: 'Synthetic address',
      phone: '+91 90000 00000',
      gstin: '27ABCDE1234F1Z5',
      slug,
      timezone: 'Asia/Kolkata',
      tax_rate_bps: 725,
      guest_verification_mode: 'scan_confirm',
      announcement_text: 'Synthetic service notice',
      announcement_on: true,
      is_active: false,
      online_payments_enabled: true,
      logo_path: `${a.linked.restaurant}/logo.png`,
      banner_path: `${a.linked.restaurant}/banner.webp`,
      accent: 'maroon',
      upi_id: 'phase6d.owner@okicici',
      upi_payee_name: 'Synthetic Owner',
    });
    expect((await db.query('select public.restaurant_can_write($1) ok', [a.linked.restaurant])).rows[0].ok).toBe(false);
  });

  it('preserves the authenticated brand publish and rollback path that updates restaurant branding', async () => {
    const menu = (await db.query(
      'select id from public.menus where restaurant_id=$1 order by created_at,id limit 1',
      [a.target.restaurant],
    )).rows[0].id as string;
    const profile = (await db.query(`
      insert into public.restaurant_brand_profiles(restaurant_id,import_id,status,name,theme,menu_id)
      values($1,$2,'draft','Synthetic published brand','{"accent":"forest"}'::jsonb,$3)
      returning id
    `, [a.target.restaurant, randomUUID(), menu])).rows[0].id as string;

    await staff(a.target.owner, async () => {
      const published = (await db.query(
        'select public.publish_menu_brand_pair($1,$2) result', [menu, profile],
      )).rows[0].result as { ok: boolean; already?: boolean };
      expect(published).toMatchObject({ ok: true, already: false });
      const live = (await db.query(
        'select name, account_id, brand_theme_enabled from public.restaurants where id=$1',
        [a.target.restaurant],
      )).rows[0];
      expect(live).toMatchObject({
        name: 'Synthetic published brand', account_id: a.target.account, brand_theme_enabled: true,
      });

      const rolledBack = (await db.query(
        'select public.rollback_last_publish($1) result', [a.target.restaurant],
      )).rows[0].result as { ok: boolean; already?: boolean };
      expect(rolledBack).toMatchObject({ ok: true, already: false });
      const restored = (await db.query(
        'select account_id, brand_theme_enabled from public.restaurants where id=$1',
        [a.target.restaurant],
      )).rows[0];
      expect(restored).toMatchObject({ account_id: a.target.account, brand_theme_enabled: false });
    });
  });

  it('keeps a nullable unlinked legacy restaurant and its existing write-gate fallback', async () => {
    const owner = randomUUID();
    const slug = `phase6d-legacy-${owner}`;
    await db.query('insert into public.profiles(id) values($1)', [owner]);
    const restaurant = (await db.query(`
      insert into public.restaurants(slug,name,account_id,trial_started_at,plan,plan_status,is_active)
      values($1,'Synthetic legacy unlinked restaurant',null,now()-interval '3 days','trial','trialing',true)
      returning id
    `, [slug])).rows[0].id as string;
    await db.query(
      "insert into public.memberships(restaurant_id,user_id,role) values($1,$2,'owner')", [restaurant, owner],
    );

    const legacy = await staff(owner, async () => {
      const gate = (await db.query(
        'select account_id, public.restaurant_can_write(id) can_write from public.restaurants where id=$1',
        [restaurant],
      )).rows[0];
      const updated = (await db.query(
        'update public.restaurants set name=$1 where id=$2 returning account_id,name',
        ['Synthetic legacy repair', restaurant],
      )).rows[0];
      return { gate, updated };
    });
    expect(legacy.gate).toEqual({ account_id: null, can_write: true });
    expect(legacy.updated).toEqual({ account_id: null, name: 'Synthetic legacy repair' });
  });

  it('keeps initial service-role account creation and authenticated create_outlet linking intact', async () => {
    const signupOwner = randomUUID();
    await db.query('begin');
    try {
      await db.query('set local role service_role');
      const created = (await db.query(
        'select public.create_account_with_restaurant($1,$2,$3,$4) id',
        [`Phase 6D service signup ${signupOwner.slice(0, 8)}`, `phase6d-service-${signupOwner}`, 'Asia/Kolkata', signupOwner],
      )).rows[0].id as string;
      await db.query('reset role');
      const link = (await db.query(
        'select account_id from public.restaurants where id=$1', [created],
      )).rows[0].account_id;
      expect(link).toBeTruthy();
      expect((await db.query('select count(*)::int n from public.memberships where restaurant_id=$1 and user_id=$2 and role=\'owner\'', [created, signupOwner])).rows[0].n).toBe(1);
    } finally {
      await db.query('rollback');
    }

    const outlet = await staff(a.target.owner, async () => {
      const id = (await db.query(
        'select public.create_outlet($1,$2) id',
        [`Phase 6D added outlet ${randomUUID().slice(0, 8)}`, `phase6d-outlet-${randomUUID()}`],
      )).rows[0].id as string;
      const row = (await db.query(
        'select account_id from public.restaurants where id=$1', [id],
      )).rows[0];
      const membership = (await db.query(
        "select role from public.memberships where restaurant_id=$1 and user_id=auth.uid()", [id],
      )).rows[0];
      return { id, account_id: row.account_id, membership: membership.role };
    });
    expect(outlet.account_id).toBe(a.target.account);
    expect(outlet.membership).toBe('owner');
  });

  it('retains the audited entitlement function grants and makes no probe-grant change', async () => {
    const rights = (await db.query(`
      select has_function_privilege('anon','public.restaurant_can_write(uuid)','EXECUTE') as anon_restaurant_probe,
             has_function_privilege('authenticated','public.restaurant_can_write(uuid)','EXECUTE') as auth_restaurant_probe,
             has_function_privilege('anon','public.account_can_write(uuid)','EXECUTE') as anon_account_probe,
             has_function_privilege('authenticated','public.account_can_write(uuid)','EXECUTE') as auth_account_probe,
             has_function_privilege('authenticated','public.create_account_with_restaurant(text,text,text,uuid)','EXECUTE') as auth_signup,
             has_function_privilege('service_role','public.create_account_with_restaurant(text,text,text,uuid)','EXECUTE') as service_signup,
             has_function_privilege('authenticated','public.create_outlet(text,text)','EXECUTE') as auth_outlet,
             has_function_privilege('anon','public.create_outlet(text,text)','EXECUTE') as anon_outlet,
             has_function_privilege('authenticated','public.claim_account_trial(uuid)','EXECUTE') as auth_claim_trial,
             has_function_privilege('service_role','public.claim_account_trial(uuid)','EXECUTE') as service_claim_trial
    `)).rows[0];
    expect(rights).toEqual({
      anon_restaurant_probe: true,
      auth_restaurant_probe: true,
      anon_account_probe: false,
      auth_account_probe: true,
      auth_signup: false,
      service_signup: true,
      auth_outlet: true,
      anon_outlet: false,
      auth_claim_trial: false,
      service_claim_trial: true,
    });

    // Compatibility is intentionally not changed in this P0 migration: the
    // existing integration contract lets anon call this boolean gate, although
    // the storefront only needs its result inside server-side order RPCs.
    expect(await guest(async () => (await db.query(
      'select public.restaurant_can_write($1) ok', [a.target.restaurant],
    )).rows[0].ok)).toBe(true);
    await expect(guest(() => db.query(
      'select public.account_can_write($1)', [a.target.account],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(staff(a.foreignOwner, () => db.query(
      'select public.create_account_with_restaurant($1,$2,$3,$4)',
      ['Unauthorised signup RPC', `phase6d-forbidden-${randomUUID()}`, 'Asia/Kolkata', a.foreignOwner],
    ))).rejects.toMatchObject({ code: '42501' });
  });
});
