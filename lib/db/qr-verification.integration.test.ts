import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LEGACY_RESTAURANT = '21000000-0000-4000-8000-000000000001';
const INACTIVE_RESTAURANT = '21000000-0000-4000-8000-000000000002';
const TABLE_DISABLED_RESTAURANT = '21000000-0000-4000-8000-000000000003';
const LEGACY_TABLE = '41000000-0000-4000-8000-000000000001';
const INACTIVE_TABLE = '41000000-0000-4000-8000-000000000002';
const DISABLED_TABLE = '41000000-0000-4000-8000-000000000004';
const ACTIVE_LEGACY_QR = '61000000-0000-4000-8000-000000000001';
const EXPIRED_LEGACY_QR = '61000000-0000-4000-8000-000000000002';
const MALFORMED_LEGACY_QR = '61000000-0000-4000-8000-000000000003';
const INACTIVE_LEGACY_QR = '61000000-0000-4000-8000-000000000004';
const DISABLED_TABLE_QR = '61000000-0000-4000-8000-000000000005';
const ACTIVE_TOKEN = '0123456789abcdef01234567';
const EXPIRED_TOKEN = 'abcdef0123456789abcdef01';
const MALFORMED_TOKEN = 'too-short';
const INACTIVE_TOKEN = 'fedcba9876543210fedcba98';

const ORDER_RESTAURANT = '22000000-0000-4000-8000-000000000001';
const OTHER_RESTAURANT = '22000000-0000-4000-8000-000000000002';
const EXPIRED_TRIAL_RESTAURANT = '22000000-0000-4000-8000-000000000003';
const ORDER_TABLE = '42000000-0000-4000-8000-000000000001';
const OTHER_TABLE = '42000000-0000-4000-8000-000000000002';
const EXPIRED_TRIAL_TABLE = '42000000-0000-4000-8000-000000000003';
const ORDER_ITEM = '32000000-0000-4000-8000-000000000001';
const OTHER_ITEM = '32000000-0000-4000-8000-000000000002';
const ORDER_MENU = '52000000-0000-4000-8000-000000000001';
const OTHER_MENU = '52000000-0000-4000-8000-000000000002';
const EXPIRED_MENU = '52000000-0000-4000-8000-000000000003';
const ORDER_CATEGORY = '53000000-0000-4000-8000-000000000001';
const OTHER_CATEGORY = '53000000-0000-4000-8000-000000000002';
const EXPIRED_CATEGORY = '53000000-0000-4000-8000-000000000003';
const QR_ORDER = '62000000-0000-4000-8000-000000000001';
const QR_OTHER = '62000000-0000-4000-8000-000000000002';
const QR_EXPIRED_TRIAL = '62000000-0000-4000-8000-000000000003';
const QR_REVOKED = '62000000-0000-4000-8000-000000000004';
const TOKEN_ORDER = 'a'.repeat(64);
const TOKEN_OTHER = 'b'.repeat(64);
const TOKEN_EXPIRED_TRIAL = 'c'.repeat(64);
const TOKEN_EXPIRED_SESSION = 'd'.repeat(64);
const TOKEN_REVOKED_SESSION = 'e'.repeat(64);
const TOKEN_REVOKED_QR = 'f'.repeat(64);
const TOKEN_INACTIVE_TABLE = '1'.repeat(64);
const TOKEN_INACTIVE_RESTAURANT = '2'.repeat(64);
const TOKEN_TAMPERED = '3'.repeat(64);
const IP_HASH = '9'.repeat(64);

const baseMigrations = [
  '20261019000001_init.sql',
  '20261019000002_public_read.sql',
  '20261019000003_trial_entitlements.sql',
  '20261019000004_counter_orders.sql',
  '20261019000005_cash_collection.sql',
];
const qrMigration = readFileSync(new URL('../../supabase/migrations/20261019000006_qr_verification_sessions.sql', import.meta.url), 'utf8');

let db: PGlite;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', userId: string, action: () => Promise<T>): Promise<T> {
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
  for (const file of baseMigrations) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }

  // This is the pre-0006 local snapshot used to exercise the additive backfill.
  await db.exec(`
    insert into public.restaurants (id, slug, name, is_active, trial_started_at) values
      ('${LEGACY_RESTAURANT}', 'legacy-qr-place', 'Legacy QR Place', true, now()),
      ('${INACTIVE_RESTAURANT}', 'inactive-legacy-place', 'Inactive Legacy Place', false, now()),
      ('${TABLE_DISABLED_RESTAURANT}', 'table-disabled-place', 'Table Disabled Place', true, now()),
      ('${ORDER_RESTAURANT}', 'qr-order-place', 'QR Order Place', true, now()),
      ('${OTHER_RESTAURANT}', 'qr-other-place', 'QR Other Place', true, now()),
      ('${EXPIRED_TRIAL_RESTAURANT}', 'qr-expired-trial-place', 'QR Expired Trial Place', true, now() - interval '11 days');

    insert into public.dining_tables (id, restaurant_id, label, is_active) values
      ('${LEGACY_TABLE}', '${LEGACY_RESTAURANT}', 'L1', true),
      ('${INACTIVE_TABLE}', '${INACTIVE_RESTAURANT}', 'I1', true),
      ('${DISABLED_TABLE}', '${TABLE_DISABLED_RESTAURANT}', 'D1', false),
      ('${ORDER_TABLE}', '${ORDER_RESTAURANT}', 'O1', true),
      ('${OTHER_TABLE}', '${OTHER_RESTAURANT}', 'O2', true),
      ('${EXPIRED_TRIAL_TABLE}', '${EXPIRED_TRIAL_RESTAURANT}', 'E1', true);

    insert into public.qr_tokens (id, restaurant_id, table_id, token, expires_at) values
      ('${ACTIVE_LEGACY_QR}', '${LEGACY_RESTAURANT}', '${LEGACY_TABLE}', '${ACTIVE_TOKEN}', now() + interval '7 days'),
      ('${EXPIRED_LEGACY_QR}', '${LEGACY_RESTAURANT}', '${LEGACY_TABLE}', '${EXPIRED_TOKEN}', now() - interval '1 minute'),
      ('${MALFORMED_LEGACY_QR}', '${LEGACY_RESTAURANT}', '${LEGACY_TABLE}', '${MALFORMED_TOKEN}', now() + interval '7 days'),
      ('${INACTIVE_LEGACY_QR}', '${INACTIVE_RESTAURANT}', '${INACTIVE_TABLE}', '${INACTIVE_TOKEN}', now() + interval '7 days'),
      ('${DISABLED_TABLE_QR}', '${TABLE_DISABLED_RESTAURANT}', '${DISABLED_TABLE}', '0123456789abcdeffedcba98', now() + interval '7 days');
  `);

  await db.exec(qrMigration);
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated;
    grant select, insert, update, delete on
      public.restaurants, public.profiles, public.memberships,
      public.menus, public.categories, public.items, public.item_variants,
      public.dining_tables, public.qr_tokens, public.table_qr_codes,
      public.restaurant_verification_settings, public.table_verification_sessions,
      public.qr_verification_attempts, public.qr_token_migration_issues
      to service_role;
    grant insert, select on public.orders, public.order_items to service_role;
  `);

  await db.exec(`
    insert into public.menus (id, restaurant_id, name, is_published) values
      ('${ORDER_MENU}', '${ORDER_RESTAURANT}', 'Order menu', true),
      ('${OTHER_MENU}', '${OTHER_RESTAURANT}', 'Other menu', true),
      ('${EXPIRED_MENU}', '${EXPIRED_TRIAL_RESTAURANT}', 'Expired trial menu', true);
    insert into public.categories (id, restaurant_id, menu_id, name) values
      ('${ORDER_CATEGORY}', '${ORDER_RESTAURANT}', '${ORDER_MENU}', 'Main'),
      ('${OTHER_CATEGORY}', '${OTHER_RESTAURANT}', '${OTHER_MENU}', 'Main'),
      ('${EXPIRED_CATEGORY}', '${EXPIRED_TRIAL_RESTAURANT}', '${EXPIRED_MENU}', 'Main');

    insert into public.items (id, restaurant_id, category_id, name, price_paise, is_available) values
      ('${ORDER_ITEM}', '${ORDER_RESTAURANT}', '${ORDER_CATEGORY}', 'Database-priced item', 1299, true),
      ('${OTHER_ITEM}', '${OTHER_RESTAURANT}', '${OTHER_CATEGORY}', 'Other-tenant item', 700, true);

    insert into public.table_qr_codes (id, restaurant_id, table_id, public_token) values
      ('${QR_ORDER}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${'a'.repeat(48)}'),
      ('${QR_OTHER}', '${OTHER_RESTAURANT}', '${OTHER_TABLE}', '${'b'.repeat(48)}'),
      ('${QR_EXPIRED_TRIAL}', '${EXPIRED_TRIAL_RESTAURANT}', '${EXPIRED_TRIAL_TABLE}', '${'c'.repeat(48)}'),
      ('${QR_REVOKED}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${'d'.repeat(48)}');

    insert into public.table_verification_sessions
      (token_hash, restaurant_id, table_id, qr_code_id, created_at, expires_at, revoked_at) values
      ('${sha256(TOKEN_ORDER)}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${QR_ORDER}', now(), now() + interval '60 minutes', null),
      ('${sha256(TOKEN_OTHER)}', '${OTHER_RESTAURANT}', '${OTHER_TABLE}', '${QR_OTHER}', now(), now() + interval '60 minutes', null),
      ('${sha256(TOKEN_EXPIRED_TRIAL)}', '${EXPIRED_TRIAL_RESTAURANT}', '${EXPIRED_TRIAL_TABLE}', '${QR_EXPIRED_TRIAL}', now(), now() + interval '60 minutes', null),
      ('${sha256(TOKEN_EXPIRED_SESSION)}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${QR_ORDER}', now() - interval '2 hours', now() - interval '1 hour', null),
      ('${sha256(TOKEN_REVOKED_SESSION)}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${QR_ORDER}', now(), now() + interval '60 minutes', now()),
      ('${sha256(TOKEN_REVOKED_QR)}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${QR_REVOKED}', now(), now() + interval '60 minutes', null),
      ('${sha256(TOKEN_INACTIVE_TABLE)}', '${ORDER_RESTAURANT}', '${ORDER_TABLE}', '${QR_ORDER}', now(), now() + interval '60 minutes', null),
      ('${sha256(TOKEN_INACTIVE_RESTAURANT)}', '${OTHER_RESTAURANT}', '${OTHER_TABLE}', '${QR_OTHER}', now(), now() + interval '60 minutes', null);


  `);
});

afterAll(async () => {
  await db.close();
});

describe('printed QR migration and verified guest sessions', () => {
  it('backfills only valid active unexpired legacy tokens and reports excluded row IDs', async () => {
    const migrated = await db.query<{ id: string; public_token: string; source_qr_token_id: string }>(
      'select id, public_token, source_qr_token_id from public.table_qr_codes where source_qr_token_id is not null',
    );
    expect(migrated.rows).toEqual([
      expect.objectContaining({ public_token: ACTIVE_TOKEN, source_qr_token_id: ACTIVE_LEGACY_QR }),
    ]);

    const issues = await db.query<{ legacy_qr_token_id: string; reason: string }>(
      'select legacy_qr_token_id, reason from public.qr_token_migration_issues order by legacy_qr_token_id',
    );
    expect(issues.rows).toEqual([
      { legacy_qr_token_id: EXPIRED_LEGACY_QR, reason: 'expired' },
      { legacy_qr_token_id: MALFORMED_LEGACY_QR, reason: 'invalid_token_format' },
      { legacy_qr_token_id: INACTIVE_LEGACY_QR, reason: 'inactive_restaurant' },
      { legacy_qr_token_id: DISABLED_TABLE_QR, reason: 'inactive_table' },
    ]);
  });

  it('is idempotent and preserves token identifiers across a rerun', async () => {
    await db.exec(qrMigration);
    const migrated = await db.query<{ count: number }>(
      'select count(*)::int as count from public.table_qr_codes where source_qr_token_id is not null',
    );
    const issues = await db.query<{ count: number }>('select count(*)::int as count from public.qr_token_migration_issues');
    expect(migrated.rows[0]?.count).toBe(1);
    expect(issues.rows[0]?.count).toBe(4);
  });

  it('rotates a printed QR atomically, invalidates its sessions, and records manual code rotations', async () => {
    const legacyHash = sha256('9'.repeat(64));
    await db.query(
      `insert into public.table_verification_sessions(token_hash, restaurant_id, table_id, qr_code_id, expires_at)
       select $1, restaurant_id, table_id, id, now() + interval '60 minutes'
       from public.table_qr_codes where source_qr_token_id = $2`,
      [legacyHash, ACTIVE_LEGACY_QR],
    );

    const issued = await db.query<{ id: string; public_token: string }>(
      `with issued as (
         select public.issue_table_qr_code($1, $2, $3, null) as qr
       )
       select (qr).id as id, (qr).public_token as public_token from issued`,
      [LEGACY_RESTAURANT, LEGACY_TABLE, 'N'.repeat(48)],
    );
    expect(issued.rows[0]?.public_token).toBe('N'.repeat(48));
    const oldQr = await db.query<{ revoked_at: string | null }>(
      'select revoked_at from public.table_qr_codes where source_qr_token_id = $1',
      [ACTIVE_LEGACY_QR],
    );
    const oldSession = await db.query<{ revoked_at: string | null }>(
      'select revoked_at from public.table_verification_sessions where token_hash = $1',
      [legacyHash],
    );
    expect(oldQr.rows[0]?.revoked_at).not.toBeNull();
    expect(oldSession.rows[0]?.revoked_at).not.toBeNull();

    const newQrId = issued.rows[0]?.id;
    expect(newQrId).toBeTruthy();
    const newSessionHash = sha256('8'.repeat(64));
    await db.query(
      `insert into public.table_verification_sessions(token_hash, restaurant_id, table_id, qr_code_id, expires_at)
       values ($1, $2, $3, $4, now() + interval '60 minutes')`,
      [newSessionHash, LEGACY_RESTAURANT, LEGACY_TABLE, newQrId],
    );
    const revoked = await db.query<{ revoke_table_qr_code: boolean }>(
      'select public.revoke_table_qr_code($1, $2)', [LEGACY_RESTAURANT, newQrId],
    );
    expect(revoked.rows[0]?.revoke_table_qr_code).toBe(true);
    const revokedSession = await db.query<{ revoked_at: string | null }>(
      'select revoked_at from public.table_verification_sessions where token_hash = $1', [newSessionHash],
    );
    expect(revokedSession.rows[0]?.revoked_at).not.toBeNull();

    const rotated1 = await db.query<{ version: number }>(
      'select public.rotate_restaurant_verification_code($1, null)::int as version', [LEGACY_RESTAURANT],
    );
    const rotated2 = await db.query<{ version: number }>(
      'select public.rotate_restaurant_verification_code($1, null)::int as version', [LEGACY_RESTAURANT],
    );
    expect(rotated1.rows[0]?.version).toBe(2);
    expect(rotated2.rows[0]?.version).toBe(3);
  });

  it('keeps verification records and order RPCs inaccessible to anonymous or authenticated clients', async () => {
    await expect(asRole('anon', '', () => db.query('select public_token from public.table_qr_codes')))
      .rejects.toThrow(/permission denied/i);
    await expect(asRole('authenticated', '', () => db.query('select code_version from public.restaurant_verification_settings')))
      .rejects.toThrow(/permission denied/i);
    await expect(asRole('anon', '', () => db.query(
      'select * from public.reserve_qr_verification_attempt($1, $2)', [QR_ORDER, IP_HASH],
    ))).rejects.toThrow(/permission denied/i);

    await expect(asRole('anon', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_ORDER, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/permission denied/i);
    await expect(asRole('authenticated', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_ORDER, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/permission denied/i);
  });

  it('uses the session-bound restaurant and table, and ignores tampered client prices/totals', async () => {
    const result = await asRole('service_role', '', () => db.query<{ order_id: string }>(
      'select public.place_order($1, $2::jsonb, $3) as order_id',
      [TOKEN_ORDER, JSON.stringify([{ item_id: ORDER_ITEM, qty: 2, price_paise: 1, total_paise: 2, restaurant_id: OTHER_RESTAURANT }]), null],
    ));
    const orderId = result.rows[0]?.order_id;
    expect(orderId).toBeTruthy();
    const order = await db.query<{ restaurant_id: string; table_id: string; subtotal_paise: number; tax_paise: number; total_paise: number }>(
      'select restaurant_id, table_id, subtotal_paise, tax_paise, total_paise from public.orders where id = $1',
      [orderId],
    );
    expect(order.rows[0]).toMatchObject({
      restaurant_id: ORDER_RESTAURANT,
      table_id: ORDER_TABLE,
      subtotal_paise: 2598,
      tax_paise: 130,
      total_paise: 2728,
    });
  });

  it('rejects invalid, expired, or revoked sessions and a revoked QR', async () => {
    for (const token of ['not-a-session', TOKEN_EXPIRED_SESSION, TOKEN_REVOKED_SESSION]) {
      await expect(asRole('service_role', '', () => db.query(
        'select public.place_order($1, $2::jsonb, null)',
        [token, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
      ))).rejects.toThrow(/verification/i);
    }

    await db.query("update public.table_qr_codes set revoked_at = now() where id = $1", [QR_REVOKED]);
    const revokedSession = await db.query<{ revoked_at: string | null }>(
      'select revoked_at from public.table_verification_sessions where token_hash = $1',
      [sha256(TOKEN_REVOKED_QR)],
    );
    expect(revokedSession.rows[0]?.revoked_at).not.toBeNull();
    await expect(asRole('service_role', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_REVOKED_QR, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/verification has expired/i);
  });

  it('revokes sessions when a table or restaurant is disabled', async () => {
    await db.query('update public.dining_tables set is_active = false where id = $1', [ORDER_TABLE]);
    const tableSession = await db.query<{ revoked_at: string | null }>(
      'select revoked_at from public.table_verification_sessions where token_hash = $1',
      [sha256(TOKEN_INACTIVE_TABLE)],
    );
    expect(tableSession.rows[0]?.revoked_at).not.toBeNull();
    await db.query('update public.dining_tables set is_active = true where id = $1', [ORDER_TABLE]);

    await db.query('update public.restaurants set is_active = false where id = $1', [OTHER_RESTAURANT]);
    const restaurantSession = await db.query<{ revoked_at: string | null }>(
      'select revoked_at from public.table_verification_sessions where token_hash = $1',
      [sha256(TOKEN_INACTIVE_RESTAURANT)],
    );
    expect(restaurantSession.rows[0]?.revoked_at).not.toBeNull();
    await db.query('update public.restaurants set is_active = true where id = $1', [OTHER_RESTAURANT]);
  });

  it('rejects cross-restaurant items and respects server-side trial entitlements', async () => {
    await db.query(
      `insert into public.table_verification_sessions(token_hash, restaurant_id, table_id, qr_code_id, expires_at)
       values ($1, $2, $3, $4, now() + interval '60 minutes')`,
      [sha256(TOKEN_TAMPERED), ORDER_RESTAURANT, ORDER_TABLE, QR_ORDER],
    );
    await expect(asRole('service_role', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_TAMPERED, JSON.stringify([{ item_id: OTHER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/no longer available/i);

    await db.query('update public.menus set is_published = false where id = $1', [ORDER_MENU]);
    await expect(asRole('service_role', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_TAMPERED, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/menu is not currently available/i);
    await db.query('update public.menus set is_published = true where id = $1', [ORDER_MENU]);
    await db.query('update public.items set is_available = false where id = $1', [ORDER_ITEM]);
    await expect(asRole('service_role', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_TAMPERED, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/no longer available/i);
    await db.query('update public.items set is_available = true where id = $1', [ORDER_ITEM]);

    await expect(asRole('service_role', '', () => db.query(
      'select public.place_order($1, $2::jsonb, null)',
      [TOKEN_EXPIRED_TRIAL, JSON.stringify([{ item_id: ORDER_ITEM, qty: 1 }])],
    ))).rejects.toThrow(/read-only/i);
  });

  it('atomically rate-limits the sixth attempt and resets after cooldown/window expiry', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const reserved = await db.query<{ allowed: boolean }>(
        'select allowed from public.reserve_qr_verification_attempt($1, $2)',
        [QR_ORDER, IP_HASH],
      );
      expect(reserved.rows[0]?.allowed).toBe(true);
      const blocked = await db.query<{ record_qr_verification_failure: boolean }>(
        'select public.record_qr_verification_failure($1, $2)',
        [QR_ORDER, IP_HASH],
      );
      expect(Boolean(blocked.rows[0]?.record_qr_verification_failure)).toBe(attempt === 5);
    }

    const sixth = await db.query<{ allowed: boolean; retry_after_seconds: number }>(
      'select * from public.reserve_qr_verification_attempt($1, $2)',
      [QR_ORDER, IP_HASH],
    );
    expect(sixth.rows[0]?.allowed).toBe(false);
    expect(sixth.rows[0]?.retry_after_seconds).toBeGreaterThan(0);

    await db.query("update public.qr_verification_attempts set blocked_until = now() - interval '1 second', window_started_at = now() - interval '16 minutes' where qr_code_id = $1 and ip_hash = $2", [QR_ORDER, IP_HASH]);
    const afterCooldown = await db.query<{ allowed: boolean }>(
      'select allowed from public.reserve_qr_verification_attempt($1, $2)',
      [QR_ORDER, IP_HASH],
    );
    expect(afterCooldown.rows[0]?.allowed).toBe(true);
  });

  it('serializes concurrent reservations so no more than five are allowed in a bucket', async () => {
    await db.query('delete from public.qr_verification_attempts where qr_code_id = $1 and ip_hash = $2', [QR_OTHER, IP_HASH]);
    const reservations = await Promise.all(Array.from({ length: 20 }, () => db.query<{ allowed: boolean }>(
      'select allowed from public.reserve_qr_verification_attempt($1, $2)',
      [QR_OTHER, IP_HASH],
    )));
    expect(reservations.filter((result) => result.rows[0]?.allowed)).toHaveLength(5);
    const row = await db.query<{ attempt_count: number }>(
      'select attempt_count from public.qr_verification_attempts where qr_code_id = $1 and ip_hash = $2',
      [QR_OTHER, IP_HASH],
    );
    expect(row.rows[0]?.attempt_count).toBe(5);
  });

  it('purges rate-limit hashes after the 24-hour retention bound', async () => {
    await db.query('update public.qr_verification_attempts set updated_at = now() - interval \'24 hours 1 minute\' where qr_code_id = $1', [QR_OTHER]);
    const deleted = await db.query<{ cleanup_expired_qr_verification_attempts: number }>(
      'select public.cleanup_expired_qr_verification_attempts()',
    );
    expect(deleted.rows[0]?.cleanup_expired_qr_verification_attempts).toBeGreaterThanOrEqual(1);
    const left = await db.query<{ count: number }>(
      'select count(*)::int as count from public.qr_verification_attempts where qr_code_id = $1',
      [QR_OTHER],
    );
    expect(left.rows[0]?.count).toBe(0);
  });
});

describe('QR scheduled retention migration', () => {
  it('schedules the cleanup job at 15-minute intervals without embedding user data', () => {
    const schedule = readFileSync(new URL('../../supabase/migrations/20261019000007_qr_attempt_cleanup_schedule.sql', import.meta.url), 'utf8');
    expect(schedule).toMatch(/create extension if not exists pg_cron/i);
    expect(schedule).toMatch(/\*\/15 \* \* \* \*/);
    expect(schedule).toContain('public.cleanup_expired_qr_verification_attempts()');
    expect(schedule).toMatch(/cron\.unschedule/);
    expect(schedule).not.toMatch(/ip_address|verification_code|session_token/i);
  });
});
