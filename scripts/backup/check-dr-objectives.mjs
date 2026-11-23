#!/usr/bin/env node
/**
 * Executable RPO/RTO verification for the backup directory.
 *
 *   node scripts/backup/check-dr-objectives.mjs \
 *     --backup-dir /backups/autodine --rpo-minutes 1440 \
 *     [--restore-report LOCAL_RESTORE_VERIFIED.txt] [--rto-minutes 240]
 *
 * What it proves (and what it does not)
 *
 *   RPO: the NEWEST backup in the directory is younger than --rpo-minutes.
 *        This checks the artifact that exists, not the schedule that was
 *        supposed to produce it; pair it with the cron/alert that runs it.
 *   RTO: when a restore-report is supplied, the measured restore duration is
 *        within --rto-minutes. The report may be either the raw stdout of
 *        scripts/verify-restore.mjs (a "LOCAL_RESTORE_VERIFIED {json}" line)
 *        or a plain {"elapsedMs": N} JSON file. Without a report it prints
 *        rto: "unverified" — it never invents a number.
 *
 * Exit 0 = objectives met (or RTO explicitly unverified but RPO met, reported
 * as such). Exit 1 = objective missed. Exit 2 = usage error.
 * On failure, if DR_ALERT_WEBHOOK or BACKUP_ALERT_WEBHOOK is set, a one-line
 * JSON alert is POSTed; alerting never masks the exit code.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1';
}
const fail = (msg, code = 2) => { process.stderr.write(`dr-objectives: ${msg}\n`); process.exit(code); };

const backupDir = opt['backup-dir'];
const rpoMinutes = Number(opt['rpo-minutes']);
const rtoMinutes = opt['rto-minutes'] ? Number(opt['rto-minutes']) : null;
const restoreReport = opt['restore-report'] ?? null;
if (!backupDir) fail('missing --backup-dir');
if (!Number.isFinite(rpoMinutes) || rpoMinutes <= 0) fail('missing or invalid --rpo-minutes');
if (rtoMinutes !== null && (!Number.isFinite(rtoMinutes) || rtoMinutes <= 0)) fail('invalid --rto-minutes');

const notify = async (text) => {
  const hook = process.env.DR_ALERT_WEBHOOK || process.env.BACKUP_ALERT_WEBHOOK;
  if (!hook) return;
  try {
    const response = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `AutoDine DR objective missed (${new Date().toISOString()}): ${text}`.slice(0, 400) }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('alert rejected');
  } catch {
    // Never log a webhook URL, response body, or exception; preserve the
    // original objective failure and make failure to alert visible.
    process.stderr.write('dr-objectives: alert delivery failed\n');
  }
};

let names = [];
let directoryUnreadable = false;
try {
  names = readdirSync(backupDir).filter((f) => /^autodine-.*\.(sql\.gz\.enc|dump\.enc)$/.test(f));
} catch {
  directoryUnreadable = true;
}

const result = { backupDir, rpo: null, rto: null, ok: true };
const problems = [];

if (directoryUnreadable) {
  result.rpo = { ok: false, reason: 'backup_directory_unreadable' };
  problems.push('backup directory cannot be read');
} else if (names.length === 0) {
  result.rpo = { ok: false, reason: 'no_backups_found' };
  problems.push('no autodine-* backups in directory');
} else {
  let newest = null;
  let invalidEntry = false;
  for (const name of names) {
    try {
      const entry = lstatSync(path.join(backupDir, name));
      if (!entry.isFile() || !Number.isFinite(entry.mtimeMs)) { invalidEntry = true; break; }
      if (!newest || entry.mtimeMs > newest.mtime) newest = { name, mtime: entry.mtimeMs };
    } catch { invalidEntry = true; break; }
  }
  if (invalidEntry || !newest) {
    result.rpo = { ok: false, reason: 'backup_entry_unreadable_or_not_regular' };
    problems.push('a backup entry is unreadable or not a regular file');
  } else {
    const ageMinutes = (Date.now() - newest.mtime) / 60000;
    if (ageMinutes < 0) {
      result.rpo = { ok: false, reason: 'backup_timestamp_in_future', newest: newest.name };
      problems.push('newest backup timestamp is in the future');
    } else {
      result.rpo = {
        ok: ageMinutes <= rpoMinutes,
        newest: newest.name,
        ageMinutes: Math.round(ageMinutes * 10) / 10,
        budgetMinutes: rpoMinutes,
      };
      if (!result.rpo.ok) problems.push(`newest backup is ${Math.round(ageMinutes)}min old, RPO budget is ${rpoMinutes}min`);
    }
  }
}

if (restoreReport) {
  let elapsedMs;
  let reportReadable = true;
  try {
    const raw = readFileSync(restoreReport, 'utf8');
    const line = raw.split('\n').find((l) => l.includes('LOCAL_RESTORE_VERIFIED'));
    if (line) {
      elapsedMs = JSON.parse(line.slice(line.indexOf('{')))?.elapsedMs;
    } else {
      elapsedMs = JSON.parse(raw)?.elapsedMs;
    }
  } catch {
    reportReadable = false;
    result.rto = { ok: false, reason: 'restore_report_unreadable' };
    problems.push('restore report could not be read or parsed');
  }
  if (reportReadable) {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      result.rto = { ok: false, reason: 'restore_report_has_no_elapsedMs' };
      problems.push('restore report does not carry elapsedMs');
    } else if (rtoMinutes === null) {
      result.rto = { ok: null, elapsedMs, note: 'no --rto-minutes budget supplied; duration reported but not asserted' };
    } else {
      result.rto = { ok: elapsedMs <= rtoMinutes * 60000, elapsedMs, budgetMs: rtoMinutes * 60000 };
      if (!result.rto.ok) problems.push(`restore took ${Math.round(elapsedMs / 1000)}s, RTO budget is ${rtoMinutes}min`);
    }
  }
} else {
  result.rto = { ok: null, note: 'unverified — pass --restore-report with a LOCAL_RESTORE_VERIFIED line to assert RTO' };
}

result.ok = problems.length === 0;
if (!result.ok) {
  process.stderr.write(`dr-objectives: MISSED: ${problems.join('; ')}\n`);
  await notify(problems.join('; '));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
