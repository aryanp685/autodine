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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encryptBuffer, passphraseProblem, sha256 } from './lib-crypto.mjs';
import { dumpDatabase, openBackupSnapshot } from './lib-dump.mjs';
import { backupSourceDecision } from './lib-backup-source.mjs';
import { selectBackupMode } from './lib-backup-mode.mjs';
import { resolvePgClient } from './lib-pg-client.mjs';
import { pgServiceFields, withPgService } from './lib-pg-service.mjs';
import { safeBackupError } from './lib-backup-error.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1';
}
const fail = async (msg) => {
  // Client errors can include the connection string or even an argument list.
  // Redact before writing either logs or alerts; never print webhook details.
  let clean = String(msg).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted database URL]');
  const source = process.env.AUTODINE_BACKUP_SOURCE_URL || opt['source-url'];
  const sensitive = [source, process.env.AUTODINE_BACKUP_PASSPHRASE];
  try {
    const password = new URL(source).password;
    if (password) sensitive.push(password, decodeURIComponent(password));
  } catch { /* malformed or absent source */ }
  for (const value of sensitive) if (value) clean = clean.replaceAll(value, '[redacted]');
  clean = clean.replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 500);
  process.stderr.write(`backup: FAILED: ${clean}\n`);
  const hook = process.env.BACKUP_ALERT_WEBHOOK;
  if (hook) {
    try {
      const response = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `AutoDine backup FAILED (${new Date().toISOString()}): ${clean.slice(0, 300)}` }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('alert rejected');
    } catch { process.stderr.write('backup: alert delivery failed\n'); }
  }
  process.exit(1);
};

const outDir = opt['out-dir'];
if (!outDir) await fail('missing --out-dir');
if (opt['source-url']) await fail('refusing --source-url; set AUTODINE_BACKUP_SOURCE_URL instead');
const sourceUrl = process.env.AUTODINE_BACKUP_SOURCE_URL;
if (!sourceUrl) await fail('set AUTODINE_BACKUP_SOURCE_URL (never pass the URL on the command line; it leaks into shell history)');
// A consistent snapshot cannot be taken through the transaction pooler, so
// refuse that source BEFORE anything is written or connected to. The rule
// used to live only in the runbooks; a rule in prose is not a rule.
const sourceDecision = backupSourceDecision(sourceUrl);
if (!sourceDecision.allowed) await fail(sourceDecision.reason);
const passphrase = process.env.AUTODINE_BACKUP_PASSPHRASE;
// Refuse a passphrase that violates the encryption contract before any
// connection is opened or any byte is written: failing here costs nothing,
// failing after a long dump costs a whole run and teaches an operator nothing.
const passphraseProblemText = passphraseProblem(passphrase);
if (passphraseProblemText) await fail(passphraseProblemText);
const schema = opt.schema || 'public';
const keepDaily = Number(opt['keep-daily'] ?? 14);
const keepWeekly = Number(opt['keep-weekly'] ?? 8);
const keepMonthly = Number(opt['keep-monthly'] ?? 6);
if (![keepDaily, keepWeekly, keepMonthly].every((n) => Number.isSafeInteger(n) && n >= 0) || !(keepDaily || keepWeekly || keepMonthly)) {
  await fail('retention budgets must be non-negative safe integers with at least one positive');
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const host = new URL(sourceUrl).hostname.split('.')[0].replace(/[^a-z0-9-]/gi, '') || 'db';
const base = `autodine-${host}-${stamp}`;

try {
  mkdirSync(outDir, { recursive: true });
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
  const mode = selectBackupMode(opt['pg-dump'], pgDump !== null);
  if (mode === 'missing_client') {
    await fail('--pg-dump was requested but no PostgreSQL client is available');
  }
  const usePgDump = mode === 'pg_dump';

  if (usePgDump) {
    // Check representability and reject target overrides before the snapshot
    // connection is opened, not only when the client is later spawned.
    pgServiceFields(sourceUrl);
    // Mode A: pg_dump custom format. Scoped to the same schema Mode B and the
    // restore target cover — the shim/managed scaffold (auth.*, storage.*,
    // roles) already exists on the restore side and must not be replayed.
    // pg_dump must write plaintext briefly. A private directory and file
    // limit exposure; all ordinary errors remove it, including dump failure.
    // An uncatchable termination can still leave the directory behind.
    const tempDir = mkdtempSync(path.join(outDir, '.autodine-plaintext-'));
    const sqlPath = path.join(tempDir, 'backup.dump');
    try {
      writeFileSync(sqlPath, '', { mode: 0o600, flag: 'wx' });
      // Counts and the dump use the same exported repeatable-read snapshot.
      const snapshot = await openBackupSnapshot(sourceUrl, { schema });
      let evidence;
      try {
        evidence = await snapshot.collectCounts();
        // Do not inherit client stderr or rethrow Node's command string: both
        // can contain credentials. Keep an actionable exit code, not raw text.
        try {
          withPgService(sourceUrl, ({ env, dbname }) => {
            execFileSync(pgDump.path, ['--format=custom', '--no-owner', `--schema=${schema}`, `--snapshot=${snapshot.snapshotId}`, `--file=${sqlPath}`, '--dbname', dbname], { stdio: ['ignore', 'ignore', 'pipe'], env });
          });
        } catch (error) {
          const status = Number.isInteger(error?.status) ? ` (exit ${error.status})` : '';
          throw new Error(`pg_dump failed${status}; inspect client configuration`);
        }
      } finally {
        await snapshot.close();
      }
      const plaintext = readFileSync(sqlPath);
      outFile = `${base}.dump.enc`;
      writeFileSync(path.join(outDir, outFile), enc(plaintext, passphrase), { flag: 'wx', mode: 0o600 });
      manifest = { format: 'pg_dump-custom', bytes: plaintext.length, sha256: sha256(readFileSync(path.join(outDir, outFile))), counts: evidence.counts, financialSpotChecks: evidence.financialSpotChecks };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } else {
    // Mode B: built-in consistent snapshot (REPEATABLE READ READ ONLY).
    const { sql, counts, financialSpotChecks } = await dumpDatabase(sourceUrl, { schema, log: () => {} });
    const plaintext = Buffer.from(sql, 'utf8');
    writeFileSync(path.join(outDir, `${base}.sql.gz.enc`), enc(plaintext, passphrase), { flag: 'wx', mode: 0o600 });
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
  writeFileSync(path.join(outDir, `${base}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

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
  keep.add(outFile); // the artifact just created must survive local retention
  let pruned = 0;
  for (const f of files) {
    if (!keep.has(f)) {
      unlinkSync(path.join(outDir, f));
      const m = path.join(outDir, f.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json'));
      try { unlinkSync(m); } catch {}
      pruned += 1;
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, bytes: statSync(full).size, pruned, format: manifest.format, sha256: manifest.sha256 }, null, 2) + '\n');
} catch (err) {
  // Do not forward arbitrary database/filesystem/client text to logs or alerts.
  await fail(safeBackupError(err));
}
