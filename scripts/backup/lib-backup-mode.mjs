/**
 * Which backup path does a run take?
 *
 * WHY THIS IS SEPARATED
 *
 * The backup tool has two paths, and they are not interchangeable:
 *
 *   Mode A — `pg_dump --format=custom`. The archive's format is decided by
 *            the pg_dump that writes it, so it needs a client binary, and
 *            a dump written by a newer pg_dump is refused outright by an
 *            older pg_restore.
 *   Mode B — the repository's own logical snapshot (REPEATABLE READ READ
 *            ONLY), written and replayed by this codebase. No client
 *            binary, no format compatibility problem.
 *
 * Which one runs used to be decided by a single expression, which made
 * the decision invisible and untested. That mattered: a drill that
 * claims to verify the logical path would silently verify the
 * custom-format path on any machine that happened to have a `pg_dump`
 * on PATH — and on a CI runner, where the image ships a `pg_dump` too
 * old for the server, it would fail outright.
 *
 * So the choice is explicit, named, and testable.
 *
 *   requested = the raw `--pg-dump` option value:
 *     '1'       -> Mode A, and a missing client is an error
 *     '0'       -> Mode B, always
 *     undefined -> Mode A when a client is available, else Mode B
 *
 * The auto case is the hosted backup's default and is deliberate: with a
 * verified client it takes the custom format, and without one it still
 * produces a restorable logical snapshot rather than nothing.
 *
 * @param {'1'|'0'|undefined} requested
 * @param {boolean} pgDumpAvailable
 * @returns {'pg_dump'|'logical'|'missing_client'}
 */
export function selectBackupMode(requested, pgDumpAvailable) {
  if (requested === '1') return pgDumpAvailable ? 'pg_dump' : 'missing_client';
  if (requested === '0') return 'logical';
  return pgDumpAvailable ? 'pg_dump' : 'logical';
}

/** The human-readable names the tools use for each path. */
export const BACKUP_MODES = {
  pg_dump: 'pg_dump-custom',
  logical: 'autodine-logical-1',
};
