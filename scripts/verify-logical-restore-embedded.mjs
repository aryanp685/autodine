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
 * The backup path is pinned with `--pg-dump 0`, so this drill proves the
 * LOGICAL path on every machine. It used to depend on the machine: with
 * a system pg_dump on PATH it took the custom-format path instead, so
 * the same script verified different things locally and in CI while
 * reporting the logical format either way.
 *
 * What it does NOT prove:
 *   - the custom-format path (pg_dump/pg_restore). That is the CI
 *     native-database job, which replays it against real PostgreSQL 15,
 *     17 and 18.
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

  // The logical dump covers the public schema only; auth/storage belong to the
// platform. Compare the same scope.
const before = await fingerprint(urlFor(source), { schemas: ['public'] });
  console.log(`source fingerprint: ${before.snapshots.length} tables, ${before.policies.length} policies, ${before.functions.length} functions`);

  const outDir = path.join(scratch, 'backups');
  // `--pg-dump 0` pins the LOGICAL path (Mode B) explicitly.
  //
  // This drill proves one thing: that the repository's own snapshot can
  // dump the migrated schema and replay it identically. Whether it
  // proved that depended on the machine it ran on — with a system
  // pg_dump on PATH it silently took the custom-format path instead,
  // so the same script verified different things locally and in CI, and
  // reported the logical format either way. On a CI runner shipping a
  // pg_dump too old for the server, it failed outright with
  // "aborting because of server version mismatch".
  //
  // The custom-format path is verified where it belongs: the CI
  // `native-database` job replays it with pg_dump/pg_restore against real
  // PostgreSQL 15, 17 and 18. This drill is the logical one, so it says
  // so.
  execFileSync(process.execPath, ['scripts/backup/backup-logical.mjs', '--out-dir', outDir, '--pg-dump', '0'], {
    env: sh({ AUTODINE_BACKUP_SOURCE_URL: urlFor(source), AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789' }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // Mode A (pg_dump custom format) writes a .dump.enc artifact; Mode B
  // (the logical snapshot) writes .sql.gz.enc. Accept either; downstream
  // restore picks the matching pg_restore/replay path from the suffix.
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
  if (diff.length) { console.error('DIVERGENCE REPORT:\n' + diff.slice(0, 20).join('\n')); throw new Error(`restored catalog diverged from the source (${diff.length} entries)`); }
  console.log(`LOCAL_LOGICAL_RESTORE_VERIFIED ${JSON.stringify({
    pgVersion: 17,
    migrations: migrationCount,
    tables: before.snapshots.length,
    policies: before.policies.length,
    functions: before.functions.length,
    backupFormat: manifest.format,
    productionBackupClaim: false,
    ciCustomFormatDrill: 'not-run-here — the custom-format path is verified by the native-database job (PG 15/17/18)',
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
