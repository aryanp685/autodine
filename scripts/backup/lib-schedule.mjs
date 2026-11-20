/**
 * Pure helpers for the scheduled-backup orchestrator.
 * Kept separate so unit tests can pin the decision logic without a network,
 * a filesystem beyond a tmp dir, or a database.
 */

export const BACKUP_NAME_RE = /^autodine-.*\.(sql\.gz\.enc|dump\.enc)$/;

/** Pick the newest backup entry, or null. Entries carry their own mtime. */
export function selectNewestBackup(entries) {
  let newest = null;
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !BACKUP_NAME_RE.test(entry.name)) continue;
    const mtime = Number(entry.mtimeMs);
    if (!Number.isFinite(mtime)) continue;
    if (!newest || mtime > newest.mtimeMs) newest = { name: entry.name, mtimeMs: mtime };
  }
  return newest;
}

/** Age of a backup in whole minutes, never negative. */
export function ageMinutes(mtimeMs, now = Date.now()) {
  return Math.max(0, Math.round((now - mtimeMs) / 60000));
}

// Only these fixed strings may be used for either logs or alerts. Never
// interpolate a caller-provided detail, path, object name, or exception.
const FAILURE_MESSAGES = Object.freeze({
  backup: Object.freeze({ child: 'backup step failed' }),
  verify: Object.freeze({ directory: 'backup directory could not be read', missing: 'no backup artifact was found', child: 'backup verification failed' }),
  objectives: Object.freeze({ child: 'DR objectives check failed' }),
  upload: Object.freeze({ directory: 'backup directory could not be read', missing: 'no backup artifact was found', child: 'upload failed; remote state is unverified' }),
  prune: Object.freeze({ requires_b2: 'remote retention requires an upload', child: 'remote retention failed; state may be partial' }),
});

export function scheduledFailure(stage, reason, exitCode) {
  const safeStage = typeof stage === 'string' && Object.hasOwn(FAILURE_MESSAGES, stage) ? stage : 'unknown';
  const reasons = FAILURE_MESSAGES[safeStage];
  const message = reasons && typeof reason === 'string' && Object.hasOwn(reasons, reason) ? reasons[reason] : 'operation failed';
  const status = Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? ` (exit ${exitCode})` : '';
  return { stage: safeStage, detail: message + status };
}

/** The alert uses only the same allowlisted fields as the stderr diagnostic. */
export function formatBackupAlert(stage, reason, exitCode) {
  const safe = scheduledFailure(stage, reason, exitCode);
  return `AutoDine scheduled backup FAILED at ${safe.stage} (${new Date().toISOString()}): ${safe.detail}`;
}
