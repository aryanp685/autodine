/**
 * The rule for WHERE a backup may be taken from.
 *
 * WHY THIS EXISTS
 *
 * A Supabase project offers two pooler ports, and they are not
 * interchangeable:
 *
 *   5432 — the SESSION pooler. A client keeps one backend connection for
 *           the life of the connection.
 *   6543 — the TRANSACTION pooler. Each transaction may be handed to a
 *           different backend, and a connection is returned to the pool
 *           between transactions.
 *
 * Mode A (the `pg_dump` path) takes a consistent snapshot by exporting it
 * on ONE connection (`pg_export_snapshot()`) and then running `pg_dump
 * --snapshot=<id>` on a SECOND connection. Through the transaction pooler
 * those two connections can land on different backends, where the exported
 * snapshot does not exist — so the backup either fails outright or, worse,
 * captures an inconsistent state and looks successful. A copy-pasted
 * `6543` from a dashboard is exactly the kind of mistake that produces
 * that.
 *
 * The rule was already written down in three runbooks
 * (`docs/backup-restore-runbook.md`,
 * `docs/pitr-verification-procedure-2026-11-14.md`,
 * `docs/operations/PRODUCTION-BACKUP-RUNBOOK.md`). A rule that lives only
 * in prose is not a rule, so it is enforced here instead.
 *
 * The RESTORE target is deliberately NOT subject to this rule:
 * `pg_restore` imports no snapshot, so it works through either pooler.
 * That asymmetry is why this module exists on the backup side only.
 */

/** The Supabase transaction-pooler port. Never valid for a backup source. */
export const TRANSACTION_POOLER_PORT = '6543';

/** The Supabase session-pooler port, and the default PostgreSQL port. */
const ALLOWED_PORTS = new Set(['5432', '']);

/** Pooler hosts, direct Supabase hosts and anything else that is not pooled. */
const POOLER_HOST_RE = /^(?:[a-z0-9-]+\.)*pooler\.supabase\.com$/;

/**
 * Decide whether a backup source URL is one a consistent snapshot can be
 * taken from.
 *
 * @returns {{ allowed: true } | { allowed: false, reason: string }}
 */
export function backupSourceDecision(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(String(sourceUrl ?? ''));
  } catch {
    return { allowed: false, reason: 'the backup source URL is not a URL' };
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { allowed: false, reason: 'the backup source URL must be a postgres:// URL' };
  }
  const port = parsed.port;
  const host = parsed.hostname.toLowerCase();
  // Only a POOLED host can be in transaction mode; a direct connection
  // (db.<ref>.supabase.co) is one backend and is always safe.
  if (POOLER_HOST_RE.test(host) && port === TRANSACTION_POOLER_PORT) {
    return {
      allowed: false,
      reason:
        `the backup source is the Supabase TRANSACTION pooler (port ${TRANSACTION_POOLER_PORT}). ` +
        'A consistent snapshot is exported on one connection and imported on a second, ' +
        'and the transaction pooler may hand those to different backends. ' +
        'Use the SESSION pooler (port 5432) or a direct connection instead.',
    };
  }
  if (POOLER_HOST_RE.test(host) && !ALLOWED_PORTS.has(port)) {
    return {
      allowed: false,
      reason:
        `the backup source is a pooled host on port ${port}, which is neither the session ` +
        `pooler (5432) nor a known-safe port. Use the SESSION pooler (port 5432) or a direct connection.`,
    };
  }
  return { allowed: true };
}

/** True when a backup may be taken from this URL. */
export function isAllowedBackupSource(sourceUrl) {
  return backupSourceDecision(sourceUrl).allowed;
}
