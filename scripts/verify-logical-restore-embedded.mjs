#!/usr/bin/env node
/**
 * LOCAL LOGICAL-RESTORE DRILL OF THE REAL MIGRATED SCHEMA.
 *
 * What this proves, end to end on a throwaway embedded PostgreSQL 17 cluster:
 * backup-logical (Mode B, the repo's own built-in snapshot) can dump the
 * schema produced by the full migration chain, and restore-logical can
 * recreate it with content, policies, RLS flags and function definitions
 * identical to the source. Exits non-zero on any mismatch.
 *
 * What it does NOT prove:
 *   - the CI native-database job (custom-format pg_dump/pg_restore). There is
 *     no pg_dump/pg_restore in this environment, and the embedded PG ships
 *     only initdb/pg_ctl/postgres. That drill runs only in CI.
 *   - anything about the hosted production database. No hosted target is
 *     involved at any point; the cluster is created and destroyed here.
 *   - application-level correctness after a restore (open a restored copy
 *     locally and run the app checks against it for that).
 */
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { fingerprint } from './verify-restore.mjs';

const scratch = mkdtempSync(path.join(tmpdir(), 'autodine-logical-restore-'));
const password = `local-${crypto.randomUUID().replaceAll('-', '')}`;
// Ask the OS for a free loopback port instead of guessing a range: a fixed
// range can collide with something already bound on a CI runner.
import net from 'node:net';
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const assigned = probe.address().port;
    probe.close(() => resolve(assigned));
  });
});

const server = new EmbeddedPostgres({ databaseDir: path.join(scratch, 'cluster'), port, user: 'postgres', password, persistent: false, onLog: () => {}, onError: () => {} });
const urlFor = (db) => `postgresql://postgres:${password}@127.0.0.1:${port}/${db}`;
const sh = (env) => ({ ...process.env, ...env });

let admin;
try {
  await server.initialise();
  await server.start();
  admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  const source = 'autodine_logical_source';
  const restored = 'autodine_logical_restored';
  for (const name of [source, restored]) await admin.query(`create database "${name}"`);

  // Source: shim + the full migration chain, exactly as verify-database replays.
  const applyAll = async (dbName, { withShim }) => {
    const client = new pg.Client({ connectionString: urlFor(dbName) });
    await client.connect();
    try {
      if (withShim) await client.query(readFileSync('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
      const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
      for (const file of migrations) await client.query(readFileSync(`supabase/migrations/${file}`, 'utf8'));
      return migrations.length;
    } finally {
      await client.end();
    }
  };
  const migrationCount = await applyAll(source, { withShim: true });
  // The target is an empty database that already carries the platform scaffold
  // (the Supabase-shaped shim: storage tables, auth schema, roles) — exactly
  // where an operator restores. No application tables; the dump recreates them.
  // pgcrypto is listed as a required extension by the dump notes; a restore
  // target receives it from the platform/operator, not the application dump,
  // so create it here before the restore.
  {
    const client = new pg.Client({ connectionString: urlFor(restored) });
    await client.connect();
    try {
      await client.query(readFileSync('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
      await client.query('create extension if not exists pgcrypto;');
    } finally {
      await client.end();
    }
  }

  // Data, not only catalog. The local harness seed is reused verbatim so the
  // drill recovers the same synthetic tenant the checks read: one restaurant,
  // one table with its card, one order. A catalog-only comparison cannot tell a
  // real restore from an empty one.
  const ROW_TABLES = ['restaurants', 'menus', 'dining_tables', 'table_qr_codes', 'orders'];
  const countRows = async (url) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const counts = {};
      for (const table of ROW_TABLES) {
        counts[table] = (await client.query(`select count(*)::int n from public.${table}`)).rows[0].n;
      }
      counts.restaurant_slug = (await client.query(
        "select slug from public.restaurants where slug = 'kings-of-kings'")).rows[0]?.slug ?? null;
      counts.first_order_code = (await client.query(
        'select code from public.orders order by placed_at limit 1')).rows[0]?.code ?? null;
      return counts;
    } finally {
      await client.end();
    }
  };
  {
    const client = new pg.Client({ connectionString: urlFor(source) });
    await client.connect();
    try {
      await client.query(readFileSync('scripts/local-pg/900_local_seed.sql', 'utf8'));
    } finally {
      await client.end();
    }
  }
  const rowsBefore = await countRows(urlFor(source));
  assert.ok(rowsBefore.restaurants > 0 && rowsBefore.orders > 0,
    `the drill needs data before it can prove data recovery: ${JSON.stringify(rowsBefore)}`);
  console.log(`source rows: ${JSON.stringify(rowsBefore)}`);

  // The logical dump covers the public schema only; auth/storage belong to the
  // platform. Compare the same scope, after the seed, so the fingerprint's row
  // counts and checksums describe the source state that is actually dumped.
const before = await fingerprint(urlFor(source), { schemas: ['public'] });
  console.log(`source fingerprint: ${before.snapshots.length} tables, ${before.policies.length} policies, ${before.functions.length} functions`);


  const outDir = path.join(scratch, 'backups');
  // --pg-dump 0 pins Mode B (the repository's own dump). Without it the drill
  // would verify whichever path the machine happens to offer — a system pg_dump
  // on PATH here, nothing there.
  execFileSync(process.execPath, ['scripts/backup/backup-logical.mjs', '--out-dir', outDir, '--pg-dump', '0'], {
    env: sh({ AUTODINE_BACKUP_SOURCE_URL: urlFor(source), AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789' }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // Mode A (system pg_dump present, e.g. CI with PGDG 17) writes a
  // .dump.enc custom-format artifact; Mode B (no pg_dump, e.g. local) writes
  // .sql.gz.enc. Accept either; downstream restore picks the matching
  // pg_restore/replay path from the suffix.
  const file = readdirSync(outDir).find((f) => f.endsWith('.sql.gz.enc') || f.endsWith('.dump.enc'));
  assert.ok(file, 'backup produced no .sql.gz.enc or .dump.enc artifact');
  const manifest = JSON.parse(readFileSync(path.join(outDir, file.replace(/\.(sql\.gz|dump)\.enc$/, '.manifest.json')), 'utf8'));
  console.log(`backup: ${manifest.format}, ${manifest.bytes} bytes, sha256 ${manifest.sha256.slice(0, 12)}…`);

  // The shim ran first, so the target is NOT empty; allow the restore onto it
  // explicitly. (In real operations the target is normally a fresh project that
  // already carries the platform scaffold.)
  execFileSync(process.execPath, ['scripts/backup/restore-logical.mjs', '--file', path.join(outDir, file), '--confirm-empty-db'], {
    env: sh({ AUTODINE_RESTORE_TARGET_URL: urlFor(restored), AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789' }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const after = await fingerprint(urlFor(restored), { schemas: ['public'] });
  const diff = [];
  for (const key of Object.keys(before)) {
    const b = before[key], a = after[key];
    if (Array.isArray(b)) {
      const bs = new Set(b.map((x) => JSON.stringify(x))), as = new Set(a.map((x) => JSON.stringify(x)));
      for (const x of bs) if (!as.has(x)) diff.push(`only-in-source ${key}: ${x}`);
      for (const x of as) if (!bs.has(x)) diff.push(`only-in-restored ${key}: ${x}`);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) diff.push(`value ${key}: ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
  }
  if (diff.length) {
    // Both sides of each differing table, so a failure names the difference
    // instead of only reporting that one exists.
    const pick = (list, table) => list.find((x) => x.table === table);
    const rowText = async (url, table) => {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        return (await client.query(`select to_jsonb(t)::text j from ${table} t order by 1`)).rows.map((r) => r.j);
      } finally { await client.end(); }
    };
    for (const entry of diff) {
      const table = JSON.parse(entry.split(': ').slice(1).join(': '))?.table;
      if (!table) continue;
      const [srcRows, dstRows] = await Promise.all([rowText(urlFor(source), table), rowText(urlFor(restored), table)]);
      const src = srcRows.find((row) => !dstRows.includes(row)) ?? srcRows[0];
      const dst = dstRows.find((row) => !srcRows.includes(row)) ?? dstRows[0];
      console.error(`  ${table}: source=${JSON.stringify(pick(before.snapshots, table))} restored=${JSON.stringify(pick(after.snapshots, table))}`);
      console.error(`    first differing row source: ${String(src).slice(0, 400)}`);
      console.error(`    first differing row restored: ${String(dst).slice(0, 400)}`);
    }
    console.error('DIVERGENCE REPORT:\n' + diff.slice(0, 20).join('\n'));
    throw new Error(`restored catalog diverged from the source (${diff.length} entries)`);
  }
  // Data recovery is a separate assertion from catalog equality.
  const rowsAfter = await countRows(urlFor(restored));
  assert.deepEqual(rowsAfter, rowsBefore,
    `restored rows differ from the source: ${JSON.stringify({ before: rowsBefore, after: rowsAfter })}`);
  console.log(`restored rows match the source: ${JSON.stringify(rowsAfter)}`);

  // Security after restore: a dump that restores rows but not the policies would
  // pass every check above and be catastrophic. Ask the restored database the
  // three questions the product depends on, as PostgREST would.
  const securityProbe = async (url) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const member = '00000000-0000-4000-8000-000000000001';
    const stranger = '00000000-0000-4000-8000-000000000002';
    try {
      await client.query('insert into public.profiles (id) values ($1), ($2) on conflict do nothing', [member, stranger]);
      await client.query(
        `insert into public.memberships (restaurant_id, user_id, role)
         select id, $1, 'owner' from public.restaurants where slug = 'kings-of-kings'
         on conflict do nothing`, [member]);
      const asUser = async (userId, work) => {
        await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
        await client.query('set role authenticated');
        try { return await work(); } finally {
          await client.query('reset role');
          await client.query("select set_config('request.jwt.claim.sub','',false)");
        }
      };
      const memberRows = await asUser(member, async () =>
        (await client.query('select count(*)::int n from public.table_qr_codes')).rows[0].n);
      const strangerRows = await asUser(stranger, async () =>
        (await client.query('select count(*)::int n from public.table_qr_codes')).rows[0].n);
      let anonDenied = false;
      await client.query('set role anon');
      try {
        await client.query('select count(*) from public.table_qr_codes');
      } catch (error) {
        anonDenied = error.code === '42501';
      } finally {
        await client.query('reset role');
      }
      return { memberRows, strangerRows, anonDenied };
    } finally {
      await client.end();
    }
  };
  const security = await securityProbe(urlFor(restored));
  assert.equal(security.memberRows, 1, `member must see the restored card: ${JSON.stringify(security)}`);
  assert.equal(security.strangerRows, 0, `a non-member must see nothing: ${JSON.stringify(security)}`);
  assert.equal(security.anonDenied, true, `anon must be refused outright: ${JSON.stringify(security)}`);
  console.log(`restored policies still enforce tenant isolation: ${JSON.stringify(security)}`);
  console.log(`LOCAL_LOGICAL_RESTORE_VERIFIED ${JSON.stringify({
    pgVersion: 17,
    migrations: migrationCount,
    tables: before.snapshots.length,
    policies: before.policies.length,
    functions: before.functions.length,
    backupFormat: manifest.format,
    rows: rowsAfter,
    dataRestoreVerified: true,
    securityRestoreVerified: security,
    productionBackupClaim: false,
    ciCustomFormatDrill: 'not-run-locally',
  })}`);
  process.exitCode = 0;
} catch (error) {
  console.error(`LOCAL LOGICAL RESTORE: FAILED: ${error?.message ?? error}`);
  if (error?.stack) console.error(error.stack);
  process.exitCode = 1;
} finally {
  // Close the admin client BEFORE stopping the server; otherwise the
  // administrator-command FATAL races shutdown and surfaces as an unhandled
  // 'error' event after the drill has already printed LOCAL_LOGICAL_RESTORE_VERIFIED.
  if (admin) await admin.end().catch(() => undefined);
  await server.stop().catch(() => undefined);
  rmSync(scratch, { recursive: true, force: true });
}
