import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

const root = process.cwd();
const apiUrl = process.env.API_URL ?? process.env.SUPABASE_URL ?? '';
const anonKey = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const databaseUrl = process.env.DB_URL ?? process.env.SUPABASE_DB_URL ?? '';
const envFile = process.env.E2E_FIXTURE_ENV_FILE;

function assertLoopback(value, label, protocol) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (protocol && parsed.protocol !== protocol) throw new Error(`${label} must use ${protocol}.`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`Refusing non-loopback ${label} (${parsed.hostname}); this harness is local-only.`);
  }
  return parsed;
}

if (!apiUrl || !anonKey || !serviceKey || !databaseUrl || !envFile) {
  throw new Error('Require local API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL and E2E_FIXTURE_ENV_FILE.');
}
assertLoopback(apiUrl, 'Supabase API URL', 'http:');
const db = assertLoopback(databaseUrl, 'Supabase database URL', 'postgresql:');
if (db.port !== '54322') throw new Error('Expected the disposable Supabase local database on port 54322.');

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
const migrationDir = path.join(root, 'supabase/migrations');
const ownerEmail = `e2e-owner-${randomUUID().slice(0, 8)}@autodine.test`;
const ownerPassword = randomBytes(18).toString('base64url');
const memberEmail = `e2e-member-${randomUUID().slice(0, 8)}@autodine.test`;
const memberPassword = randomBytes(18).toString('base64url');
const expiredInviteCode = 'E2E-EXPIRED-INVITE-2026';
const tableCode = '482916';

async function apply(sql, source) {
  try {
    await client.query(sql);
  } catch (error) {
    throw new Error(`Failed applying ${source}: ${error.message}`, { cause: error });
  }
  console.log(`applied ${source}`);
}

async function createLocalUser(email, password, name) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.id) {
    throw new Error(`Failed creating synthetic Auth user ${email}: HTTP ${response.status} ${body?.msg ?? body?.message ?? ''}`);
  }
  return body.id;
}

await client.connect();
try {
  await client.query('select 1');
  // The official local stack already owns auth.uid(), storage, roles and its
  // Realtime publication. Apply only repository migrations plus the marked
  // local-only inferred base-table scaffold, in the repository's tested order.
  const migrationFiles = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    if (file.startsWith('20261021000006')) {
      await apply(
        await readFile(path.join(root, 'scripts/local-pg/005_scaffold_missing_tables.sql'), 'utf8'),
        'scripts/local-pg/005_scaffold_missing_tables.sql (inferred local-only scaffold)',
      );
    }
    await apply(await readFile(path.join(migrationDir, file), 'utf8'), `supabase/migrations/${file}`);
  }
  if (migrationFiles.length !== 45) throw new Error(`Expected 45 checked-in migrations, found ${migrationFiles.length}.`);

  const required = await client.query(`
    select
      to_regprocedure('public.open_table_session(text,text)') is not null as open_session,
      to_regprocedure('public.place_public_order(text,jsonb,text,text,uuid,text)') is not null as place_order,
      to_regprocedure('public.public_qr_intro(text)') is not null as qr_intro,
      to_regprocedure('public.create_staff_invite(uuid,public.member_role,integer)') is not null as staff_invites,
      to_regclass('storage.buckets') is not null as storage_schema,
      exists (select 1 from pg_publication where pubname = 'supabase_realtime') as realtime_publication
  `);
  if (Object.values(required.rows[0]).some((value) => !value)) {
    throw new Error(`The local stack or migration chain is missing a required service/schema object: ${JSON.stringify(required.rows[0])}`);
  }

  const ownerId = await createLocalUser(ownerEmail, ownerPassword, 'AutoDine E2E Owner');
  const memberId = await createLocalUser(memberEmail, memberPassword, 'AutoDine E2E Cashier');
  await client.query(
    `insert into public.profiles (id, full_name) values ($1, 'AutoDine E2E Owner'), ($2, 'AutoDine E2E Cashier')
     on conflict (id) do update set full_name = excluded.full_name`,
    [ownerId, memberId],
  );

  const slug = `autodine-e2e-${randomUUID().slice(0, 8)}`;
  const restaurantResult = await client.query(
    `insert into public.restaurants
       (slug, name, tagline, address, timezone, is_active, trial_started_at,
        guest_verification_mode, upi_id, upi_payee_name)
     values ($1, 'AutoDine Synthetic E2E', 'Disposable test fixture', 'Local-only fixture',
             'Asia/Kolkata', true, now(), 'scan', 'e2e.autodine@okhdfcbank', 'AutoDine E2E')
     returning id`,
    [slug],
  );
  const restaurantId = restaurantResult.rows[0].id;
  await client.query(
    `insert into public.memberships (restaurant_id, user_id, role)
     values ($1, $2, 'owner'), ($1, $3, 'cashier')`,
    [restaurantId, ownerId, memberId],
  );
  const menu = await client.query(
    `insert into public.menus (restaurant_id, name, is_published, sort_order)
     values ($1, 'Synthetic E2E menu', true, 0) returning id`,
    [restaurantId],
  );
  const category = await client.query(
    `insert into public.categories (restaurant_id, menu_id, name, sort_order)
     values ($1, $2, 'Main', 0) returning id`,
    [restaurantId, menu.rows[0].id],
  );
  await client.query(
    `insert into public.items
       (restaurant_id, category_id, name, description, price_paise, is_veg, is_available, sort_order)
     values ($1, $2, 'Synthetic Paneer Dish', 'Disposable local E2E fixture', 34900, true, true, 0)`,
    [restaurantId, category.rows[0].id],
  );

  await client.query(
    `insert into public.dining_tables (restaurant_id, label, seats, is_active)
     values ($1, 'E2E Table', 4, true), ($1, 'E2E Retired Table', 4, true)`,
    [restaurantId],
  );
  await client.query(
    `insert into public.dining_tables (restaurant_id, label, seats, is_active)
     select $1, 'E2E Guest ' || lpad(n::text, 2, '0'), 4, true
       from generate_series(1, 25) as n`,
    [restaurantId],
  );
  const cards = await client.query(
    `select t.label, q.public_token
       from public.dining_tables t
       join public.table_qr_codes q on q.table_id = t.id
      where t.restaurant_id = $1 order by t.label`,
    [restaurantId],
  );
  const liveToken = cards.rows.find((row) => row.label === 'E2E Table')?.public_token;
  const expiredToken = cards.rows.find((row) => row.label === 'E2E Retired Table')?.public_token;
  const scanTokens = cards.rows
    .filter((row) => row.label.startsWith('E2E Guest '))
    .map((row) => row.public_token);
  if (!liveToken || !expiredToken || scanTokens.length !== 25) throw new Error(`Synthetic QR card seed is incomplete (${cards.rows.length} total cards, ${scanTokens.length} per-test cards).`);
  await client.query('update public.table_qr_codes set revoked_at = now() where public_token = $1', [expiredToken]);

  const otherRestaurant = await client.query(
    `insert into public.restaurants (slug, name, timezone, is_active, trial_started_at)
     values ($1, 'AutoDine Other Synthetic Tenant', 'Asia/Kolkata', true, now()) returning id`,
    [`${slug}-other`],
  );
  const otherOrder = await client.query(
    `insert into public.orders
       (restaurant_id, code, prep_status, payment_status, subtotal_paise, discount_paise, tax_paise, total_paise)
     values ($1, 'E2E-OTHER', 'new', 'pending', 0, 0, 0, 0) returning id`,
    [otherRestaurant.rows[0].id],
  );

  await client.query(
    `insert into public.restaurant_invites
       (restaurant_id, role, code_hash, created_by, created_at, expires_at)
     values ($1, 'cashier', public.hash_invite_code($2), $3,
             now() - interval '2 days', now() - interval '1 day')`,
    [restaurantId, expiredInviteCode, ownerId],
  );

  const envValues = {
    // Next emits same-origin redirects with localhost on its production server;
    // match that host so the browser returns the host-only fixture cookies.
    E2E_BASE_URL: 'http://localhost:3100',
    E2E_QR_TOKEN: liveToken,
    E2E_QR_TOKENS: scanTokens.join(','),
    E2E_TABLE_CODE: tableCode,
    E2E_SLUG: slug,
    E2E_OWNER_EMAIL: ownerEmail,
    E2E_OWNER_PASSWORD: ownerPassword,
    E2E_MEMBER_EMAIL: memberEmail,
    E2E_MEMBER_PASSWORD: memberPassword,
    E2E_ROLE: 'cashier',
    E2E_EXPIRED_QR_TOKEN: expiredToken,
    E2E_EXPIRED_INVITE_CODE: expiredInviteCode,
    E2E_OTHER_ORDER_ID: otherOrder.rows[0].id,
  };
  const lines = Object.entries(envValues).map(([key, value]) => `${key}=${value}`);
  await writeFile(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`Seeded only synthetic Supabase Auth/database fixtures for ${slug}; migration chain: ${migrationFiles.length}/45.`);
} finally {
  await client.end();
}
