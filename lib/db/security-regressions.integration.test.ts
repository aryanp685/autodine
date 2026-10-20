import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER = '81000000-0000-4000-8000-000000000001';
const MANAGER = '81000000-0000-4000-8000-000000000002';
const RESTAURANT_A = '82000000-0000-4000-8000-000000000001';
const RESTAURANT_B = '82000000-0000-4000-8000-000000000002';
const ITEM_A = '83000000-0000-4000-8000-000000000001';
const MENU_A = '84000000-0000-4000-8000-000000000001';
const MENU_B = '84000000-0000-4000-8000-000000000002';
const CATEGORY_A = '85000000-0000-4000-8000-000000000001';
const CATEGORY_B = '85000000-0000-4000-8000-000000000002';

let db: PGlite;

async function asRole<T>(role: 'anon' | 'authenticated', userId: string, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);

  for (const file of [
    '20261019000001_init.sql',
    '20261019000002_public_read.sql',
    '20261019000003_trial_entitlements.sql',
    '20261019000004_counter_orders.sql',
    '20261019000005_cash_collection.sql',
    '20261019000006_qr_verification_sessions.sql',
    '20261020000008_security_hardening.sql',
  ]) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }

  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated;
    grant select, insert, update, delete on
      public.restaurants, public.profiles, public.memberships,
      public.menus, public.categories, public.items, public.item_variants,
      public.dining_tables, public.qr_tokens
      to authenticated;
    grant select on public.restaurants, public.menus, public.categories,
      public.items, public.item_variants, public.dining_tables,
      public.orders, public.order_items, public.payments, public.restaurant_subscriptions
      to anon, authenticated;
    grant truncate, references, trigger on all tables in schema public to anon, authenticated;

    insert into public.profiles(id, full_name) values
      ('${OWNER}', 'Security test owner'),
      ('${MANAGER}', 'Security test manager');
    insert into public.restaurants(id, slug, name, trial_started_at) values
      ('${RESTAURANT_A}', 'security-test-a', 'Security Test A', now()),
      ('${RESTAURANT_B}', 'security-test-b', 'Security Test B', now());
    insert into public.memberships(restaurant_id, user_id, role) values
      ('${RESTAURANT_A}', '${OWNER}', 'owner'),
      ('${RESTAURANT_A}', '${MANAGER}', 'manager');
    insert into public.menus(id, restaurant_id, name) values
      ('${MENU_A}', '${RESTAURANT_A}', 'Menu A'),
      ('${MENU_B}', '${RESTAURANT_B}', 'Menu B');
    insert into public.categories(id, restaurant_id, menu_id, name) values
      ('${CATEGORY_A}', '${RESTAURANT_A}', '${MENU_A}', 'Category A'),
      ('${CATEGORY_B}', '${RESTAURANT_B}', '${MENU_B}', 'Category B');
    insert into public.items(id, restaurant_id, category_id, name, price_paise) values
      ('${ITEM_A}', '${RESTAURANT_A}', '${CATEGORY_A}', 'Item A', 1000);
  `);

  await db.exec(readFileSync(
    new URL('../../supabase/migrations/20261020000009_security_regressions.sql', import.meta.url),
    'utf8',
  ));
  await db.exec(readFileSync(
    new URL('../../supabase/migrations/20261020205436_owner_optional_tax_settings.sql', import.meta.url),
    'utf8',
  ));
});

afterAll(async () => {
  await db.close();
});

describe('security regression migration', () => {
  it('sets new restaurant rows to 0% tax without changing existing settings', async () => {
    const existing = await db.query<{ tax_rate_bps: number }>(
      'select tax_rate_bps from public.restaurants where id = $1',
      [RESTAURANT_A],
    );
    expect(existing.rows[0]?.tax_rate_bps).toBe(500);

    const freshId = '82000000-0000-4000-8000-000000000003';
    await db.query(
      'insert into public.restaurants(id, slug, name) values ($1, $2, $3)',
      [freshId, 'security-test-new', 'Security Test New'],
    );
    const fresh = await db.query<{ tax_rate_bps: number }>(
      'select tax_rate_bps from public.restaurants where id = $1',
      [freshId],
    );
    expect(fresh.rows[0]?.tax_rate_bps).toBe(0);
  });

  it('allows only the owner to update the tax setting through the narrow RPC', async () => {
    const updated = await asRole('authenticated', OWNER, () => db.query<{ set_restaurant_tax_rate: number }>(
      'select public.set_restaurant_tax_rate($1, $2) as set_restaurant_tax_rate',
      [RESTAURANT_A, 525],
    ));
    expect(updated.rows[0]?.set_restaurant_tax_rate).toBe(525);

    const current = await db.query<{ tax_rate_bps: number }>(
      'select tax_rate_bps from public.restaurants where id = $1',
      [RESTAURANT_A],
    );
    expect(current.rows[0]?.tax_rate_bps).toBe(525);

    await expect(asRole('authenticated', MANAGER, () => db.query(
      'select public.set_restaurant_tax_rate($1, $2)',
      [RESTAURANT_A, 500],
    ))).rejects.toThrow(/only the restaurant owner/i);

    await expect(asRole('authenticated', OWNER, () => db.query(
      'select public.set_restaurant_tax_rate($1, $2)',
      [RESTAURANT_A, 3001],
    ))).rejects.toThrow(/between 0% and 30%/i);

    const disabled = await asRole('authenticated', OWNER, () => db.query<{ set_restaurant_tax_rate: number }>(
      'select public.set_restaurant_tax_rate($1, 0) as set_restaurant_tax_rate',
      [RESTAURANT_A],
    ));
    expect(disabled.rows[0]?.set_restaurant_tax_rate).toBe(0);
  });

  it('prevents owners and managers from changing trial or tax fields directly', async () => {
    for (const userId of [OWNER, MANAGER]) {
      await expect(
        asRole('authenticated', userId, () => db.query(
          "update public.restaurants set trial_started_at = statement_timestamp() + interval '365 days' where id = $1",
          [RESTAURANT_A],
        )),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        asRole('authenticated', userId, () => db.query(
          'update public.restaurants set tax_rate_bps = 0 where id = $1',
          [RESTAURANT_A],
        )),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('revokes TRUNCATE from API roles even when it was previously granted', async () => {
    const relations = [
      'restaurants', 'memberships', 'menus', 'categories', 'items',
      'dining_tables', 'orders', 'order_items', 'payments',
    ];
    for (const relation of relations) {
      const result = await db.query<{ anon_can_truncate: boolean; authenticated_can_truncate: boolean }>(
        `select
          has_table_privilege('anon', $1, 'TRUNCATE') as anon_can_truncate,
          has_table_privilege('authenticated', $1, 'TRUNCATE') as authenticated_can_truncate`,
        [`public.${relation}`],
      );
      expect(result.rows[0]).toEqual({ anon_can_truncate: false, authenticated_can_truncate: false });
    }
  });

  it('rejects category/menu and item/category links across restaurants', async () => {
    await expect(
      asRole('authenticated', OWNER, () => db.query(
        'insert into public.categories(id, restaurant_id, menu_id, name) values ($1, $2, $3, $4)',
        ['86000000-0000-4000-8000-000000000001', RESTAURANT_A, MENU_B, 'Mismatched category'],
      )),
    ).rejects.toThrow(/foreign key/i);

    await expect(
      asRole('authenticated', OWNER, () => db.query(
        'insert into public.items(id, restaurant_id, category_id, name, price_paise) values ($1, $2, $3, $4, $5)',
        ['86000000-0000-4000-8000-000000000002', RESTAURANT_A, CATEGORY_B, 'Mismatched item', 100],
      )),
    ).rejects.toThrow(/foreign key/i);
  });

  it('accepts the inclusive 99 limits and rejects larger counter orders', async () => {
    const maxQuantity = await asRole('authenticated', OWNER, () => db.query<{ order_id: string }>(
      'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
      ['security-test-a', JSON.stringify([{ item_id: ITEM_A, qty: 99 }]), 'maximum quantity'],
    ));
    expect(maxQuantity.rows[0]?.order_id).toBeTruthy();

    const maxLines = Array.from({ length: 99 }, () => ({ item_id: ITEM_A, qty: 1 }));
    const maxLinesResult = await asRole('authenticated', OWNER, () => db.query<{ order_id: string }>(
      'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
      ['security-test-a', JSON.stringify(maxLines), 'maximum lines'],
    ));
    const count = await db.query<{ line_count: number }>(
      'select count(*)::int as line_count from public.order_items where order_id = $1',
      [maxLinesResult.rows[0]?.order_id],
    );
    expect(count.rows[0]?.line_count).toBe(99);

    await expect(
      asRole('authenticated', OWNER, () => db.query(
        'select public.place_counter_order($1, $2::jsonb, $3)',
        ['security-test-a', JSON.stringify([{ item_id: ITEM_A, qty: 100 }]), 'too many units'],
      )),
    ).rejects.toThrow(/quantity.*1 and 99/i);

    await expect(
      asRole('authenticated', OWNER, () => db.query(
        'select public.place_counter_order($1, $2::jsonb, $3)',
        ['security-test-a', JSON.stringify(Array.from({ length: 100 }, () => ({ item_id: ITEM_A, qty: 1 }))), 'too many lines'],
      )),
    ).rejects.toThrow(/more than 99 lines/i);
  });
});
