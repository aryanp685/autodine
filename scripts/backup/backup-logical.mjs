#!/usr/bin/env node
/**
 * AutoDine independent logical backup.
 *
 *   AUTODINE_BACKUP_SOURCE_URL=postgresql://... \
 *   AUTODINE_BACKUP_PASSPHRASE=... \
 *   node scripts/backup/backup-logical.mjs --out-dir /backups/autodine [--keep-daily 14] [--keep-weekly 8] [--keep-monthly 6]
 *
 * Never prints the connection string. Writes:
 *   <out-dir>/autodine-<host>-<yyyymmddThhmmss>.sql.gz.enc
 *   <out-dir>/autodine-<host>-<yyyymmddThhmmss>.manifest.json
 * and prunes own previous backups by the daily/weekly/monthly keep budget
 * (only files matching the autodine-*.{sql.gz.enc,manifest.json} pattern are
 * ever considered; foreign files are never touched).
 *
 * MANIFEST VERIFICATION CONTRACT (both formats, no exceptions):
 * every manifest carries `file`, `format`, `bytes` (plaintext length),
 * `sha256` (of the encrypted artifact), `createdAt`, `counts`
 * ({tables, rows, functions, policies} measured in the backup snapshot)
 * and `financialSpotChecks` ({payments_amount_paise,
 * subscription_payments_amount_paise}; null when a table/column is
 * absent). verify-restored-db.mjs refuses to verify against a manifest
 * that lacks any of these — a restore drill must never pass on missing
 * evidence. Mode A (pg_dump) measures its expectations inside the same
 * exported snapshot pg_dump reads (`--snapshot`), so the contract
 * describes the dump exactly even on a live source database.
 *
 * Exit code 0 = backup complete and verified; 1 = failed (webhook alerted when
 * BACKUP_ALERT_WEBHOOK is set).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encryptBuffer, sha256 } from './lib-crypto.mjs';
import { dumpDatabase, openBackupSnapshot } from './lib-dump.mjs';
import { backupSourceDecision } from './lib-backup-source.mjs';
import { resolvePgClient } from './lib-pg-client.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1';
}
const fail = async (msg) => {
  process.stderr.write(`backup: FAILED: ${msg}\n`);
  const hook = process.env.BACKUP_ALERT_WEBHOOK;
  if (hook) {
    try {
      await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `AutoDine backup FAILED (${new Date().toISOString()}): ${msg.slice(0, 300)}` }) });
    } catch { /* alerting must never mask the original failure */ }
  }
  process.exit(1);
};

const outDir = opt['out-dir'];
if (!outDir) fail('missing --out-dir');
const sourceUrl = process.env.AUTODINE_BACKUP_SOURCE_URL || opt['source-url'];
if (!sourceUrl) fail('set AUTODINE_BACKUP_SOURCE_URL (never pass the URL on the command line; it leaks into shell history)');
// A consistent snapshot cannot be taken through the transaction pooler, so
// refuse that source BEFORE anything is written or connected to. The rule
// used to live only in the runbooks; a rule in prose is not a rule.
const sourceDecision = backupSourceDecision(sourceUrl);
if (!sourceDecision.allowed) fail(sourceDecision.reason);
const passphrase = process.env.AUTODINE_BACKUP_PASSPHRASE;
if (!passphrase) fail('set AUTODINE_BACKUP_PASSPHRASE (12+ chars; store in a password manager)');
const schema = opt.schema || 'public';
const keepDaily = Number(opt['keep-daily'] ?? 14);
const keepWeekly = Number(opt['keep-weekly'] ?? 8);
const keepMonthly = Number(opt['keep-monthly'] ?? 6);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const host = new URL(sourceUrl).hostname.split('.')[0].replace(/[^a-z0-9-]/gi, '') || 'db';
const base = `autodine-${host}-${stamp}`;

mkdirSync(outDir, { recursive: true });

try {
  const started = Date.now();
  let outFile, manifest;
  const enc = encryptBuffer;
  // Resolve pg_dump to the binary that will actually run.
  //
  // The runner image ships an older pg_dump that can shadow the pinned one
  // on PATH, and the tool that WRITES the archive decides its format: a
  // dump written by a newer pg_dump is refused outright by an older
  // pg_restore. When the composite action has pinned a directory, the
  // absolute path of the VERIFIED binary is used, so PATH cannot change
  // which client runs, and the version is re-checked at the moment of use.
  const pgDump = resolvePgClient('pg_dump');
  if (opt['pg-dump'] === '1' && !pgDump) {
    await fail('--pg-dump was requested but no PostgreSQL client is available');
  }
  const usePgDump = opt['pg-dump'] === '1' || (opt['pg-dump'] === undefined && pgDump !== null);

  if (usePgDump) {
    // Mode A: pg_dump custom format. Scoped to the same schema Mode B and the
    // restore target cover — the shim/managed scaffold (auth.*, storage.*,
    // roles) already exists on the restore side and must not be replayed.
    const sqlPath = path.join(outDir, `${base}.dump`);
    // The manifest's counts/financial expectations are measured inside the
    // SAME exported snapshot pg_dump reads, so verification compares the
    // restored database against exactly what was dumped — concurrent writes
    // on a live source cannot make a good backup fail its drill (and a bad
    // one cannot pass: the snapshot is frozen for both readers).
    const snapshot = await openBackupSnapshot(sourceUrl, { schema });
    let evidence;
    try {
      evidence = await snapshot.collectCounts();
      execFileSync(pgDump.path, ['--format=custom', '--no-owner', `--schema=${schema}`, `--snapshot=${snapshot.snapshotId}`, `--file=${sqlPath}`, sourceUrl], { stdio: ['ignore', 'ignore', 'inherit'] });
    } finally {
      await snapshot.close();
    }
    const plaintext = readFileSync(sqlPath);
    writeFileSync(sqlPath + '.enc', enc(plaintext, passphrase));
    unlinkSync(sqlPath);
    outFile = `${base}.dump.enc`;
    manifest = { format: 'pg_dump-custom', bytes: plaintext.length, sha256: sha256(readFileSync(path.join(outDir, outFile))), counts: evidence.counts, financialSpotChecks: evidence.financialSpotChecks };
  } else {
    // Mode B: built-in consistent snapshot (REPEATABLE READ READ ONLY).
    const { sql, counts, financialSpotChecks } = await dumpDatabase(sourceUrl, { schema, log: (m) => process.stderr.write('  ' + m + '\n') });
    const plaintext = Buffer.from(sql, 'utf8');
    writeFileSync(path.join(outDir, `${base}.sql.gz.enc`), enc(plaintext, passphrase));
    outFile = `${base}.sql.gz.enc`;
    manifest = { format: 'autodine-logical-1', bytes: plaintext.length, sha256: sha256(readFileSync(path.join(outDir, outFile))), counts, financialSpotChecks };
  }

  const full = path.join(outDir, outFile);
  manifest.file = outFile;
  manifest.createdAt = new Date().toISOString();
  manifest.durationMs = Date.now() - started;
  manifest.schema = schema;
  manifest.retention = { keepDaily, keepWeekly, keepMonthly };
  manifest.notes = 'Logical backup. Does NOT cover: Supabase Auth schema (auth.*), Storage buckets, or platform-managed settings — those rely on the managed provider. Restore target must be empty.';
  writeFileSync(path.join(outDir, `${base}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');

  // Retention: bucket own files only.
  const files = readdirSync(outDir).filter((f) => /^autodine-.*\.(sql\.gz\.enc|dump\.enc)$/.test(f)).sort();
  const byDay = new Map();
  for (const f of files) {
    const day = f.match(/-(\d{8})T/)?.[1] ?? f;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(f);
  }
  const days = [...byDay.keys()].sort().reverse();
  const keep = new Set();
  const monthSeen = new Set(), weekSeen = new Set();
  days.forEach((day, i) => {
    const weekKey = day.slice(0, 6) + '-w' + Math.floor(Number(day.slice(6, 8)) / 7);
    const monthKey = day.slice(0, 6);
    const isDaily = i < keepDaily;
    const isWeekly = keepWeekly > 0 && !weekSeen.has(weekKey) && weekSeen.size < keepWeekly;
    const isMonthly = keepMonthly > 0 && !monthSeen.has(monthKey) && monthSeen.size < keepMonthly;
    if (isWeekly) weekSeen.add(weekKey);
    if (isMonthly) monthSeen.add(monthKey);
    if (isDaily || isWeekly || isMonthly) for (const f of byDay.get(day)) keep.add(f);
  });
  let pruned = 0;
  for (const f of files) {
    if (!keep.has(f)) {
      unlinkSync(path.join(outDir, f));
      const m = path.join(outDir, f.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json'));
      try { unlinkSync(m); } catch {}
      pruned += 1;
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, file: full, bytes: statSync(full).size, pruned, ...manifest }, null, 2) + '\n');
} catch (err) {
  await fail(err?.message ?? String(err));
}
