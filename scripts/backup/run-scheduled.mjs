#!/usr/bin/env node
/**
 * Scheduled backup orchestration — one command an operator (or a cron job,
 * systemd timer or Task Scheduler entry) runs to do the whole job:
 *
 *   AUTODINE_BACKUP_SOURCE_URL=... AUTODINE_BACKUP_PASSPHRASE=... \
 *   node scripts/backup/run-scheduled.mjs --out-dir /mnt/backups/autodine \
 *     [--rpo-minutes 1440] [--rto-minutes 240] [--restore-report report.json]
 *
 * WHAT IT DOES, IN ORDER
 *
 *   1. BACKUP. Runs scripts/backup/backup-logical.mjs (which handles its own
 *      failure alert via BACKUP_ALERT_WEBHOOK when set).
 *   2. VERIFY (automated recovery check). Runs
 *      scripts/backup/verify-backup-file.mjs on the NEWEST artifact in
 *      --out-dir: magic, manifest sha256, full decrypt, payload sanity. A
 *      backup that was written but cannot be decrypted is worse than none.
 *   3. OBJECTIVES. Runs scripts/backup/check-dr-objectives.mjs
 *      (--rpo-minutes; plus --rto-minutes when --restore-report is supplied).
 *   4. UPLOAD (only with --b2). Runs scripts/backup/upload-b2.mjs on the
 *      newest artifact: SHA-256 vs manifest, signed PUT to Backblaze B2,
 *      signed HEAD verification. Without --b2 the pipeline is local-only,
 *      exactly as before; with --b2 a missing B2 configuration fails the
 *      run at the `upload` stage (exit 1) rather than passing silently.
 *
 * Exit 0 only when every step passes. On any failure it POSTs one line to
 * BACKUP_ALERT_WEBHOOK or DR_ALERT_WEBHOOK (if set) and exits 1. It never
 * prints the source URL or the passphrase; the alert text carries the stage
 * and a capped, redacted detail string only.
 *
 * USE IT FROM
 *
 *   cron:          17 3 * * *  cd /opt/autodine && node scripts/backup/run-scheduled.mjs --out-dir /mnt/backups/autodine >> /var/log/autodine-backup.log 2>&1
 *   systemd:       a .timer calling this unit's ExecStart with the two env vars from a root-only EnvironmentFile
 *   Task Scheduler: same shape on Windows with a stored environment
 *
 * Flags: --keep-daily/--keep-weekly/--keep-monthly are passed through to the
 * backup step. --skip-verify / --skip-dr-objectives exist for rehearsals and
 * are printed as skipped — they are never a silent pass.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNewestBackup, formatBackupAlert, BACKUP_NAME_RE } from './lib-schedule.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1';
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = opt['out-dir'];
if (!outDir) {
  process.stderr.write('run-scheduled: usage: run-scheduled.mjs --out-dir <dir> [--rpo-minutes 1440] [--rto-minutes N --restore-report path] [--keep-daily 14] [--keep-weekly 8] [--keep-monthly 6] [--skip-verify] [--skip-dr-objectives]\n');
  process.exit(2);
}
const rpoMinutes = Number(opt['rpo-minutes'] ?? 1440);
if (!Number.isFinite(rpoMinutes) || rpoMinutes <= 0) {
  process.stderr.write('run-scheduled: --rpo-minutes must be a positive number\n');
  process.exit(2);
}
const rtoMinutes = opt['rto-minutes'] ? Number(opt['rto-minutes']) : null;
const restoreReport = opt['restore-report'] ?? null;
const skipVerify = opt['skip-verify'] === '1';
const skipObjectives = opt['skip-dr-objectives'] === '1';
const uploadB2 = opt['b2'] === '1';
const pruneB2 = opt['prune-b2'] === '1';

const alertHook = process.env.BACKUP_ALERT_WEBHOOK || process.env.DR_ALERT_WEBHOOK || null;
const alert = async (stage, detail) => {
  if (!alertHook) return;
  try {
    await fetch(alertHook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: formatBackupAlert(stage, detail) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* alerting must never mask the exit code */ }
};
const die = async (stage, detail) => {
  process.stderr.write(`run-scheduled: FAILED at ${stage}: ${detail}\n`);
  await alert(stage, detail);
  process.exit(1);
};

// 1. Backup. backup-logical.mjs performs its own alert on failure; we add the
//    stage name so the operator knows where it broke.
const backupArgs = [path.join(scriptDir, 'backup-logical.mjs'), '--out-dir', outDir];
for (const key of ['keep-daily', 'keep-weekly', 'keep-monthly']) {
  if (opt[key]) backupArgs.push(`--${key}`, String(opt[key]));
}
const backup = spawnSync(process.execPath, backupArgs, { stdio: 'inherit', env: process.env });
if (backup.status !== 0) {
  await die('backup', `backup-logical.mjs exited ${backup.status ?? 'unknown'} — see its output above`);
}

// 2. Automated recovery check: the newest artifact must decrypt with the
//    configured passphrase and pass its manifest, right now, not at restore time.
if (skipVerify) {
  process.stderr.write('run-scheduled: backup verification SKIPPED by flag (--skip-verify)\n');
} else {
  let entries = [];
  try {
    entries = readdirSync(outDir)
      .filter((name) => BACKUP_NAME_RE.test(name))
      .map((name) => {
        try { return { name, mtimeMs: statSync(path.join(outDir, name)).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    await die('verify', `cannot read backup directory: ${outDir}`);
  }
  const newest = selectNewestBackup(entries);
  if (!newest) {
    await die('verify', `no autodine-* backup found in ${outDir} after the backup step`);
  }
  const verify = spawnSync(process.execPath, [path.join(scriptDir, 'verify-backup-file.mjs'), path.join(outDir, newest.name)], { stdio: 'inherit', env: process.env });
  if (verify.status !== 0) {
    await die('verify', `verify-backup-file.mjs exited ${verify.status ?? 'unknown'} for ${newest.name}`);
  }
}

// 3. DR objectives (RPO against the newest artifact; RTO when a restore
//    report is supplied). check-dr-objectives.mjs alerts on its own misses;
//    we propagate the stage for the operator's log line.
if (skipObjectives) {
  process.stderr.write('run-scheduled: DR objective check SKIPPED by flag (--skip-dr-objectives)\n');
} else {
  const objectiveArgs = [path.join(scriptDir, 'check-dr-objectives.mjs'), '--backup-dir', outDir, '--rpo-minutes', String(rpoMinutes)];
  if (rtoMinutes !== null) objectiveArgs.push('--rto-minutes', String(rtoMinutes));
  if (restoreReport) objectiveArgs.push('--restore-report', restoreReport);
  const objectives = spawnSync(process.execPath, objectiveArgs, { stdio: 'inherit', env: process.env });
  if (objectives.status !== 0) {
    process.stderr.write(`run-scheduled: FAILED at objectives: check-dr-objectives.mjs exited ${objectives.status ?? 'unknown'}\n`);
    process.exit(1);
  }
}

// 4. Optional B2 upload of the newest verified artifact. upload-b2.mjs
//    re-checks the artifact SHA-256 against its manifest, PUTs artifact +
//    manifest, and HEAD-verifies the remote SHA-256 metadata.
if (uploadB2) {
  let entries = [];
  try {
    entries = readdirSync(outDir)
      .filter((name) => BACKUP_NAME_RE.test(name))
      .map((name) => {
        try { return { name, mtimeMs: statSync(path.join(outDir, name)).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    await die('upload', `cannot read backup directory: ${outDir}`);
  }
  const newest = selectNewestBackup(entries);
  if (!newest) {
    await die('upload', `no autodine-* backup found in ${outDir} after the backup step`);
  }
  const upload = spawnSync(process.execPath, [path.join(scriptDir, 'upload-b2.mjs'), '--file', path.join(outDir, newest.name)], { stdio: 'inherit', env: process.env });
  if (upload.status !== 0) {
    await die('upload', `upload-b2.mjs exited ${upload.status ?? 'unknown'} for ${newest.name} — hosted backup is NOT verified`);
  }
}

// 5. Optional remote retention (only with --b2 --prune-b2, after a verified
//    upload). prune-b2.mjs enforces the 14/8/6 recovery-point policy in the
//    bucket and fails closed; the newest backup is always protected.
if (pruneB2) {
  if (!uploadB2) {
    await die('prune', '--prune-b2 requires --b2 (remote pruning follows a verified upload)');
  }
  const prune = spawnSync(process.execPath, [path.join(scriptDir, 'prune-b2.mjs'), '--confirm'], { stdio: 'inherit', env: process.env });
  if (prune.status !== 0) {
    await die('prune', `prune-b2.mjs exited ${prune.status ?? 'unknown'} — remote retention NOT enforced`);
  }
}

process.stdout.write(uploadB2
  ? 'run-scheduled: OK — backup taken, newest artifact verified, DR objectives checked, B2 upload remotely verified.\n'
  : 'run-scheduled: OK — backup taken, newest artifact verified, DR objectives checked.\n');
