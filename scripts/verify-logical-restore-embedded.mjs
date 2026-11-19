#!/usr/bin/env node
/**
 * LOCAL LOGICAL-RESTORE DRILL OF THE REAL MIGRATED SCHEMA.
 *
 * What this proves, end to end on a throwaway embedded PostgreSQL 17 cluster:
 * backup-logical (Mode B, the repo's own built-in snapshot) can dump the
 * schema produced by the full migration chain, and restore-logical can
 * recreate it with matching row fingerprints, policies and function
 * signatures/ACLs, plus manifest counts and financial checks. This does not
 * compare every function body or platform object. Exits non-zero on mismatch.
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
import { chmodSync, mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
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
  for (const name of [source, restored, 'autodine_logical_bare']) await admin.query(`create database "${name}"`);

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
  // Synthetic data only: includes two non-zero financial spot checks.
  {
    const client = new pg.Client({ connectionString: urlFor(source) });
    await client.connect();
    try {
      await client.query(readFileSync('scripts/local-pg/900_local_seed.sql', 'utf8'));
      // Synthetic types specifically guard against driver precision loss and
      // escaping errors, including JSON integers beyond JavaScript's range.
      await client.query(`create table public.rehearsal_roundtrip (
        id integer primary key, at_time timestamptz, payload jsonb,
        exact_value numeric, bytes bytea, labels text[], note text)`);
      await client.query(`insert into public.rehearsal_roundtrip values
        (1, '2024-01-02 03:04:05.123456+00', '{"large":9007199254740993}'::jsonb,
         12345678901234567890.123456789, decode('005c27ff','hex'),
         array['back\\slash', 'quote''s', null], 'line ' || chr(10) || 'back\\slash''s')`);
      await client.query(`do $$ declare v_rid uuid; v_oid uuid; v_acc uuid; begin
        select id into v_rid from public.restaurants limit 1;
        select id into v_oid from public.orders limit 1;
        insert into public.payments (order_id, restaurant_id, method, amount_paise, status, provider)
          values (v_oid, v_rid, 'upi', 12345, 'recorded', 'razorpay');
        insert into public.accounts (plan, plan_status) values ('starter','active') returning id into v_acc;
        insert into public.subscription_payments (account_id, plan, amount_paise, currency, status, provider)
          values (v_acc, 'starter', 49900, 'INR', 'succeeded', 'razorpay');
      end $$;`);
    } finally { await client.end(); }
  }
  // Inject a failing custom-format writer after it creates partial plaintext.
  // The writer checks the private file mode; no plaintext may remain after an
  // ordinary pg_dump failure. This is not a real custom-format restore test.
  {
    const binDir = path.join(scratch, 'failing-client');
    const failedOutput = path.join(scratch, 'failed-backup');
    mkdirSync(binDir);
    const writer = path.join(binDir, 'pg_dump');
    writeFileSync(writer, `#!/usr/bin/env node
const fs = require('fs');
if (process.argv[2] === '--version') { console.log('pg_dump (PostgreSQL) 17.1'); process.exit(0); }
const file = process.argv.find((v) => v.startsWith('--file=')).slice(7);
if ((fs.statSync(file).mode & 0o777) !== 0o600) process.exit(3);
fs.writeFileSync(file, 'synthetic partial plaintext');
process.exit(9);
`);
    chmodSync(writer, 0o700);
    const result = spawnSync(process.execPath, ['scripts/backup/backup-logical.mjs', '--out-dir', failedOutput, '--pg-dump', '1'], {
      env: sh({ AUTODINE_BACKUP_SOURCE_URL: urlFor(source), AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789', PG_CLIENT_BIN_DIR: binDir, PG_CLIENT_VERSION: '17', BACKUP_ALERT_WEBHOOK: '' }), encoding: 'utf8',
    });
    assert.equal(result.status, 1, 'injected writer failure must fail the backup');
    assert.match(result.stderr, /backup: FAILED/);
    assert.deepEqual(readdirSync(failedOutput), [], 'failed writer must leave no plaintext or backup material');
  }
  // Exercise exactly the initializer used by the hosted disposable workflow.
  execFileSync(process.execPath, ['scripts/backup/prepare-disposable-restore.mjs', '--confirm-disposable'], {
    env: sh({ AUTODINE_RESTORE_TARGET_URL: urlFor(restored) }), stdio: ['ignore', 'inherit', 'inherit'],
  });
  const refusal = spawnSync(process.execPath, ['scripts/backup/prepare-disposable-restore.mjs', '--confirm-disposable'], {
    env: sh({ AUTODINE_RESTORE_TARGET_URL: 'postgresql://user:password@db.example.com/drill' }), encoding: 'utf8',
  });
  assert.equal(refusal.status, 1, 'scaffold must reject hosted targets');
  assert.match(refusal.stderr, /loopback/);
  const override = spawnSync(process.execPath, ['scripts/backup/prepare-disposable-restore.mjs', '--confirm-disposable'], {
    env: sh({ AUTODINE_RESTORE_TARGET_URL: `${urlFor(restored)}?host=db.example.com` }), encoding: 'utf8',
  });
  assert.equal(override.status, 1, 'scaffold must reject query host overrides');
  const reprepare = spawnSync(process.execPath, ['scripts/backup/prepare-disposable-restore.mjs', '--confirm-disposable'], {
    env: sh({ AUTODINE_RESTORE_TARGET_URL: urlFor(restored) }), encoding: 'utf8',
  });
  assert.notEqual(reprepare.status, 0, 'scaffold must reject a previously prepared target');

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
  assert.equal(manifest.financialSpotChecks.payments_amount_paise, 12345);
  assert.equal(manifest.financialSpotChecks.subscription_payments_amount_paise, 49900);
  assert.ok(manifest.counts.rows > 0);
  const artifactPath = path.join(outDir, file);
  const manifestPath = path.join(outDir, file.replace(/\.(sql\.gz|dump)\.enc$/, '.manifest.json'));
  const drillEnv = sh({ AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789' });
  const verifiedFile = JSON.parse(execFileSync(process.execPath, ['scripts/backup/verify-backup-file.mjs', artifactPath, '--manifest', manifestPath], {
    env: drillEnv, encoding: 'utf8',
  }));
  assert.equal(verifiedFile.ok, true);
  const bare = spawnSync(process.execPath, ['scripts/backup/restore-logical.mjs', '--file', artifactPath, '--confirm-empty-db'], {
    env: { ...drillEnv, AUTODINE_RESTORE_TARGET_URL: urlFor('autodine_logical_bare') }, encoding: 'utf8',
  });
  assert.notEqual(bare.status, 0, 'bare PostgreSQL must not be mistaken for a Supabase scaffold');
  assert.match(bare.stderr, /schema "auth" does not exist/);
  const unsafe = spawnSync(process.execPath, ['scripts/backup/restore-logical.mjs', '--file', artifactPath, '--confirm-empty-db'], {
    env: { ...drillEnv, AUTODINE_RESTORE_TARGET_URL: 'postgresql://user:password@db.example.com/drill' }, encoding: 'utf8',
  });
  assert.notEqual(unsafe.status, 0, 'restore must reject unsafe targets');
  const corruptPath = path.join(scratch, file);
  const corrupt = Buffer.from(readFileSync(artifactPath));
  corrupt[corrupt.length - 1] ^= 1;
  writeFileSync(corruptPath, corrupt);
  const tamper = spawnSync(process.execPath, ['scripts/backup/verify-backup-file.mjs', corruptPath, '--manifest', manifestPath], {
    env: drillEnv, encoding: 'utf8',
  });
  assert.equal(tamper.status, 1, 'tampered backup must not verify');
  assert.match(tamper.stderr, /sha256 mismatch/i);
  const wrongKey = spawnSync(process.execPath, ['scripts/backup/verify-backup-file.mjs', artifactPath, '--manifest', manifestPath], {
    env: { ...drillEnv, AUTODINE_BACKUP_PASSPHRASE: 'incorrect-local-passphrase-012345' }, encoding: 'utf8',
  });
  assert.equal(wrongKey.status, 1, 'wrong passphrase must not verify');
  const restoreStart = performance.now();

  // The scaffold contains no public application tables, so the empty-public-
  // schema guard remains in force. Never use --allow-non-empty for the drill.
  execFileSync(process.execPath, ['scripts/backup/restore-logical.mjs', '--file', path.join(outDir, file), '--confirm-empty-db'], {
    env: sh({ AUTODINE_RESTORE_TARGET_URL: urlFor(restored), AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789' }),
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const restoreMs = Math.round(performance.now() - restoreStart);
  const report = JSON.parse(execFileSync(process.execPath, ['scripts/backup/verify-restored-db.mjs', '--manifest', manifestPath, '--artifact', artifactPath], {
    env: { ...drillEnv, AUTODINE_RESTORE_TARGET_URL: urlFor(restored) }, encoding: 'utf8',
  }));
  assert.equal(report.verified, true);
  assert.equal(report.financialSpotChecks.payments_amount_paise, 12345);
  assert.equal(report.financialSpotChecks.subscription_payments_amount_paise, 49900);
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
  const changed = new pg.Client({ connectionString: urlFor(restored) });
  await changed.connect();
  try { await changed.query('update public.payments set amount_paise = amount_paise + 1'); } finally { await changed.end(); }
  const mismatch = spawnSync(process.execPath, ['scripts/backup/verify-restored-db.mjs', '--manifest', manifestPath, '--artifact', artifactPath], {
    env: { ...drillEnv, AUTODINE_RESTORE_TARGET_URL: urlFor(restored) }, encoding: 'utf8',
  });
  assert.equal(mismatch.status, 1, 'financial mismatch must fail verification');
  assert.match(mismatch.stderr, /MISMATCH/);
  assert.equal(JSON.parse(mismatch.stdout).matches.payments_amount_paise, false);
  console.log(`LOCAL_LOGICAL_RESTORE_VERIFIED ${JSON.stringify({
    pgVersion: 17,
    migrations: migrationCount,
    tables: before.snapshots.length,
    policies: before.policies.length,
    functions: before.functions.length,
    backupFormat: manifest.format,
    rows: manifest.counts.rows,
    financialSpotChecks: manifest.financialSpotChecks,
    restoreMs,
    artifactSha256: manifest.sha256,
    negativeChecks: ['failed-pg-dump-cleanup', 'bare-target', 'unsafe-target', 'host-override', 'tamper', 'wrong-passphrase', 'financial-mismatch'],
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
  let stopped = true;
  await server.stop().catch(() => { stopped = false; process.exitCode = 1; console.error('LOCAL SERVER STOP FAILED'); });
  rmSync(scratch, { recursive: true, force: true });
  if (existsSync(scratch)) { console.error('LOCAL CLEANUP FAILED'); process.exitCode = 1; }
  else if (stopped) console.log('LOCAL_LOGICAL_RESTORE_CLEANUP_VERIFIED');
}
