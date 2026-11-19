/**
 * Disposable-cluster runner for the ten PostgreSQL-gated vitest suites.
 *
 * Before this runner existed, the GST / credit-note / subscription / report-
 * sales / readiness / RLS integration suites could only run when somebody had
 * hand-built an `autodine_check_*` database — so they silently skipped in CI
 * (198 tests). This harness builds that database from the repository's own
 * migrations on a throwaway embedded PostgreSQL 17, points READINESS_DB_URL /
 * THROTTLE_DB_URL at it, runs the suites and destroys the cluster.
 *
 * READINESS_DB_URL is only honoured for localhost with an autodine_check_*
 * path (the suites refuse anything else). The disposable database is created
 * fresh, replayed from supabase/migrations, and dropped on exit. Nothing here
 * touches staging or production, and no fixture is shared between runs.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const root = process.cwd();
const dataDir = await mkdtemp(path.join(tmpdir(), 'autodine-pg-integration-'));
const password = `local-${randomUUID().replaceAll('-', '')}`;
const migrationsDir = path.join(root, 'supabase/migrations');
const dbName = `autodine_check_${randomBytes(8).toString('hex')}`;

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

const INTEGRATION_SUITES = [
  'app/menu/throttle-db.integration.test.tsx',
  'lib/db/credit-debit-notes.integration.test.ts',
  'lib/db/gst-two-mode.integration.test.ts',
  'lib/db/phase0-security.integration.test.ts',
  'lib/db/readiness.integration.test.ts',
  'lib/db/report-sales.integration.test.ts',
  'lib/db/account-link-audit.integration.test.ts',
  'lib/db/owner-billing-guard.integration.test.ts',
  'lib/db/restaurant-account-link.integration.test.ts',
  'lib/db/subscription-billing.integration.test.ts',
];

let admin;
try {
  console.log(`Starting disposable PostgreSQL 17 on 127.0.0.1:${port}`);
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(dbName);
  admin = postgres.getPgClient(dbName);
  await admin.connect();
  admin.on('notice', (notice) => console.log(notice.message));

  const apply = async (sql, label) => {
    try {
      await admin.query(sql);
      console.log(`applied ${label}`);
    } catch (error) {
      throw new Error(`Local PostgreSQL failed while applying ${label}: ${error.message}`, { cause: error });
    }
  };

  await apply(
    await readFile(path.join(root, 'scripts/local-pg/000_supabase_shim.sql'), 'utf8'),
    'scripts/local-pg/000_supabase_shim.sql (local-only Supabase object shim)',
  );

  // Emulate the inspected Supabase project grants for both public-object
  // owners (same sequence as scripts/verify-cold-recovery.mjs and
  // scripts/verify-database.mjs): client roles get usage on the schemas and
  // full defaults on tables/sequences they create; the repository's
  // 20261110001220 migration and the owner-operation file below then remove
  // the maintenance/sequence defaults again. Plain PostgreSQL has none of
  // this out of the box, which is why a naive replay cannot run the suites.
  await apply(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`,
    'Supabase table/sequence/function default privileges (postgres owner)');
  await admin.query('set role supabase_admin');
  try {
    await apply(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`,
      'Supabase table/sequence/function default privileges (supabase_admin owner)');
  } finally {
    await admin.query('reset role');
  }

  // Synthetic pre-existing relations so the revoke migration's current-object
  // sweep is exercised for both owners (created BEFORE migrations run).
  await apply(`create table public.acl_existing_postgres(id uuid primary key);
    create sequence public.acl_existing_postgres_seq;`,
    'ACL-owner fixtures (postgres)');
  await admin.query('set role supabase_admin');
  try {
    await apply(`create table public.acl_existing_supabase_admin(id uuid primary key);
      create sequence public.acl_existing_supabase_admin_seq;`,
      'ACL-owner fixtures (supabase_admin)');
  } finally {
    await admin.query('reset role');
  }

  const migrationFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    if (file.startsWith('20261021000006')) {
      await apply(
        await readFile(path.join(root, 'scripts/local-pg/005_scaffold_missing_tables.sql'), 'utf8'),
        'scripts/local-pg/005_scaffold_missing_tables.sql (local-only inferred scaffold)',
      );
    }
    const migration = await readFile(path.join(migrationsDir, file), 'utf8');
    const localSql = migration.replace(
      /^create extension if not exists "pgcrypto";\s*$/gm,
      '-- local harness only: PostgreSQL 17 provides gen_random_uuid natively',
    );
    await apply(localSql, `supabase/migrations/${file}`);
  }

  // The supabase_admin-side owner operation: removes client maintenance and
  // sequence defaults for objects the postgres-run migration cannot touch.
  // Kept as a checked-in owner-operation (not part of the migration chain)
  // for the same reason it is separate on hosted projects.
  await admin.query('set role supabase_admin');
  try {
    await apply(
      await readFile(path.join(root, 'supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql'), 'utf8'),
      'supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql',
    );
  } finally {
    await admin.query('reset role');
  }

  const counts = await admin.query(
    `select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as functions,
            (select count(*)::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables`,
  );
  console.log(`schema replayed: ${migrationFiles.length} migrations; ${counts.rows[0].tables} tables, ${counts.rows[0].functions} public functions`);

  await admin.end();
  admin = undefined;

  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/${dbName}`;
  const env = {
    ...process.env,
    READINESS_DB_URL: connectionString,
    THROTTLE_DB_URL: connectionString,
    CI: 'true',
  };
  delete env.DATABASE_URL;

  console.log(`Running ${INTEGRATION_SUITES.length} PostgreSQL-gated suites against the disposable database.`);
  // These files share this database, and one replays migrations with DDL
  // locks. Serialize files to avoid inter-suite deadlocks; tests explicitly
  // exercising concurrency still use multiple clients within each file.
  await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...INTEGRATION_SUITES], env);
  console.log('All PostgreSQL-gated integration suites passed.');
} catch (error) {
  console.error(`INTEGRATION-DB FAILURE: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  if (admin) await admin.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
}
