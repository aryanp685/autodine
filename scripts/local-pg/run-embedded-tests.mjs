import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

const root = process.cwd();
const dataDir = await mkdtemp(path.join(tmpdir(), 'autodine-pg-e2e-'));
const password = `local-${randomUUID().replaceAll('-', '')}`;
const migrationsDir = path.join(root, 'supabase/migrations');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await unusedPort();
const postgres = new EmbeddedPostgres({
  databaseDir: path.join(dataDir, 'cluster'),
  port,
  user: 'postgres',
  password,
  persistent: false,
  onLog: (message) => process.env.LOCAL_PG_VERBOSE && process.stderr.write(message),
  onError: (error) => process.stderr.write(`${error.message}\n`),
});

async function apply(client, sql, label) {
  try {
    await client.query(sql);
  } catch (error) {
    throw new Error(`Local PostgreSQL failed while applying ${label}: ${error.message}`, { cause: error });
  }
  console.log(`applied ${label}`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function runSyntheticGuestLoad(connectionString) {
  const users = Number.parseInt(process.env.LOCAL_LOAD_USERS ?? '5000', 10);
  const restaurantsCount = Math.ceil(users / 50);
  const poolSize = Number.parseInt(process.env.LOCAL_LOAD_DB_CONNECTIONS ?? '64', 10);
  if (!Number.isInteger(users) || users < 100 || users > 20_000) {
    throw new Error('LOCAL_LOAD_USERS must be an integer from 100 through 20000.');
  }
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 80) {
    throw new Error('LOCAL_LOAD_DB_CONNECTIONS must be an integer from 1 through 80 on this disposable cluster.');
  }

  const { Pool } = pg;
  const pool = new Pool({ connectionString, max: poolSize });
  pool.on('error', (error) => process.stderr.write(`[synthetic-load pool] ${error.message}\n`));
  const prefix = `load-${randomUUID().slice(0, 12)}`;
  try {
    await pool.query(
      `insert into public.restaurants
         (slug, name, address, timezone, is_active, trial_started_at, guest_verification_mode)
       select $2 || '-' || lpad(n::text, 3, '0'), 'Synthetic Load ' || n,
              'Isolated load fixture', 'UTC', true, now(), 'scan'
         from generate_series(1, $1::int) as n`,
      [restaurantsCount, prefix],
    );
    await pool.query(
      `insert into public.menus (restaurant_id, name, is_published, sort_order)
       select id, 'Synthetic menu', true, 0 from public.restaurants where slug like $1 || '-%'`,
      [prefix],
    );
    await pool.query(
      `insert into public.categories (restaurant_id, menu_id, name, sort_order)
       select r.id, m.id, 'Synthetic menu', 0
         from public.restaurants r join public.menus m on m.restaurant_id = r.id
        where r.slug like $1 || '-%'`,
      [prefix],
    );
    await pool.query(
      `insert into public.items
         (restaurant_id, category_id, name, description, price_paise, is_veg, is_available, sort_order)
       select c.restaurant_id, c.id, 'Synthetic item', 'Disposable load-test fixture',
              100, true, true, 0
         from public.categories c join public.restaurants r on r.id = c.restaurant_id
        where r.slug like $1 || '-%'`,
      [prefix],
    );
    const tablesForLastRestaurant = users - (restaurantsCount - 1) * 50;
    await pool.query(
      `insert into public.dining_tables (restaurant_id, label, is_active)
       select r.id, 'Load table ' || g.n, true
         from public.restaurants r
         cross join lateral generate_series(
           1,
           case when r.slug = $1 || '-' || lpad($2::text, 3, '0') then $3::int else 50 end
         ) as g(n)
        where r.slug like $1 || '-%'`,
      [prefix, restaurantsCount, tablesForLastRestaurant],
    );

    const { rows: guests } = await pool.query(
      `select r.slug, i.id as item_id, q.public_token
         from public.restaurants r
         join public.items i on i.restaurant_id = r.id
         join public.dining_tables t on t.restaurant_id = r.id
         join public.table_qr_codes q on q.table_id = t.id and q.revoked_at is null
        where r.slug like $1 || '-%'
        order by r.slug, t.label`,
      [prefix],
    );
    if (guests.length !== users) throw new Error(`Expected ${users} synthetic guests, seeded ${guests.length}.`);

    const sessionsStarted = performance.now();
    const sessions = await Promise.all(guests.map(async (guest, index) => {
      const ipHash = createHash('sha256').update(`${prefix}:ip:${index}`).digest('hex');
      const result = await pool.query('select * from public.open_table_session($1, $2)', [guest.public_token, ipHash]);
      if (result.rows[0]?.status !== 'opened') {
        throw new Error(`Synthetic guest ${index + 1} could not open its table session: ${result.rows[0]?.status}`);
      }
      return {
        slug: guest.slug,
        itemId: guest.item_id,
        sessionToken: result.rows[0].session_token,
        guestToken: randomUUID(),
        ipHash,
      };
    }));
    const sessionsMs = Math.round(performance.now() - sessionsStarted);

    const ordersStarted = performance.now();
    const codes = await Promise.all(sessions.map(async (guest) => {
      const result = await pool.query(
        'select public.place_public_order($1, $2::jsonb, $3, $4, $5::uuid, $6) as code',
        [guest.slug, JSON.stringify([{ itemId: guest.itemId, qty: 1 }]), null, guest.sessionToken, guest.guestToken, guest.ipHash],
      );
      return { slug: guest.slug, code: result.rows[0]?.code, guestToken: guest.guestToken };
    }));
    const ordersMs = Math.round(performance.now() - ordersStarted);
    const persisted = await pool.query(
      `select count(distinct o.id)::int as orders,
              count(oi.id)::int as lines,
              count(distinct o.guest_token)::int as guests
         from public.orders o
         join public.order_items oi on oi.order_id = o.id
        where o.guest_token = any($1::uuid[])`,
      [codes.map((entry) => entry.guestToken)],
    );
    const result = persisted.rows[0];
    const tenantOrderCodes = codes.map((entry) => `${entry.slug}:${entry.code}`);
    if (codes.some((entry) => !entry.code) || new Set(tenantOrderCodes).size !== users) {
      throw new Error('Synthetic order codes were missing or duplicated within a restaurant.');
    }
    if (result.orders !== users || result.lines !== users || result.guests !== users) {
      throw new Error(`Persisted synthetic load mismatch: ${JSON.stringify(result)} (expected ${users} each).`);
    }
    console.log(
      `[synthetic-load] ${users} distinct guests; ${users} sessions + ${users} real SQL orders; ` +
        `${restaurantsCount} synthetic restaurants; DB pool cap ${poolSize}; ` +
        `session-open ${sessionsMs}ms (${Math.round(users / (sessionsMs / 1000))}/s), ` +
        `order-write ${ordersMs}ms (${Math.round(users / (ordersMs / 1000))}/s); all rows verified`,
    );
  } finally {
    await pool.end();
  }
}

let client;
try {
  console.log(`Starting disposable PostgreSQL 17 on 127.0.0.1:${port}`);
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('autodine_local');
  client = postgres.getPgClient('autodine_local');
  await client.connect();
  client.on('notice', (notice) => console.log(notice.message));

  await apply(
    client,
    await readFile(path.join(root, 'scripts/local-pg/000_supabase_shim.sql'), 'utf8'),
    'scripts/local-pg/000_supabase_shim.sql (local-only Supabase object shim)',
  );

  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    if (file.startsWith('20261021000006')) {
      await apply(
        client,
        await readFile(path.join(root, 'scripts/local-pg/005_scaffold_missing_tables.sql'), 'utf8'),
        'scripts/local-pg/005_scaffold_missing_tables.sql (local-only inferred scaffold)',
      );
    }
    const migration = await readFile(path.join(migrationsDir, file), 'utf8');
    const localSql = migration.replace(
      /^create extension if not exists "pgcrypto";\s*$/gm,
      '-- local harness only: PostgreSQL 17 provides gen_random_uuid natively',
    );
    await apply(client, localSql, `supabase/migrations/${file}`);
  }

  await apply(
    client,
    await readFile(path.join(root, 'scripts/local-pg/900_local_seed.sql'), 'utf8'),
    'scripts/local-pg/900_local_seed.sql (synthetic restaurant/table/order)',
  );
  await apply(
    client,
    await readFile(path.join(root, 'scripts/local-pg/910_local_e2e_seed.sql'), 'utf8'),
    'scripts/local-pg/910_local_e2e_seed.sql (synthetic menu fixture)',
  );

  const schema = await client.query(`
    select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as functions,
      (select count(*)::int from pg_policies where schemaname = 'public') as rls_policies,
      (select count(*)::int from information_schema.columns where table_schema = 'public') as columns
  `);
  const schemaCounts = schema.rows[0];
  if (migrationFiles.length !== 60 || schemaCounts.tables < 20 || schemaCounts.functions < 20) {
    throw new Error(`Unexpected schema verification counts: ${JSON.stringify({ migrations: migrationFiles.length, ...schemaCounts })}`);
  }
  const keyObjects = await client.query(`
    select
      to_regprocedure('public.open_table_session(text,text)') is not null as has_open_table_session,
      to_regprocedure('public.place_public_order(text,jsonb,text,text,uuid,text)') is not null as has_place_public_order,
      to_regprocedure('public.close_order_session_and_issue_receipt(uuid)') is not null as has_receipt_function,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='total_paise') as has_order_total
  `);
  const missing = Object.entries(keyObjects.rows[0]).filter(([, present]) => !present).map(([name]) => name);
  if (missing.length) throw new Error(`Required schema objects are missing: ${missing.join(', ')}`);
  console.log(`schema verified: ${migrationFiles.length} migrations; ${schemaCounts.tables} tables, ${schemaCounts.columns} columns, ${schemaCounts.functions} public functions, ${schemaCounts.rls_policies} RLS policies`);
  await client.query(await readFile(path.join(root, 'scripts/branch-db/03-verify-after.sql'), 'utf8'));
  console.log('executed scripts/branch-db/03-verify-after.sql read-only verification queries');

  await apply(
    client,
    await readFile(path.join(root, 'supabase/checks/06_scan_limits.sql'), 'utf8'),
    'supabase/checks/06_scan_limits.sql (transaction rolls back its synthetic checks)',
  );
  for (const name of ['07_p8_close_settlement.sql', '08_p3_incremental_tickets.sql']) {
    await apply(
      client,
      await readFile(path.join(root, 'supabase/checks', name), 'utf8'),
      `supabase/checks/${name} (transaction rolls back its synthetic checks)`,
    );
  }

  await client.query(`
    alter role authenticator with login noinherit password '${password}';
    grant anon, authenticated, service_role to authenticator;
  `);
  await client.end();
  client = undefined;

  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/autodine_local`;
  const env = {
    ...process.env,
    THROTTLE_DB_URL: connectionString,
    CI: 'true',
  };
  delete env.DATABASE_URL;
  console.log('Running the five PostgreSQL-gated throttling/order tests against the disposable cluster.');
  await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'app/menu/throttle-db.integration.test.tsx'], env);
  console.log('All five PostgreSQL-gated tests passed.');
  await runSyntheticGuestLoad(connectionString);
  console.log('The disposable cluster will now be destroyed.');
} finally {
  if (client) await client.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
}
