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

/** The one-line failure alert; capped, fixed shape, no payload bytes. */
export function formatBackupAlert(stage, detail) {
  const clean = String(detail ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/postgresql:\/\/\S+/gi, 'postgresql://<redacted>')
    .trim()
    .slice(0, 220);
  return `AutoDine scheduled backup FAILED at ${stage} (${new Date().toISOString()}): ${clean}`;
}
