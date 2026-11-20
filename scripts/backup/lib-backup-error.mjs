/** Safe operator diagnostics for failures originating in database, filesystem or client code. */
const SERVICE_ERRORS = new Set([
  'PostgreSQL connection contains an unsupported service-file value',
  'PostgreSQL connection URL is invalid',
  'PostgreSQL connection URL is incomplete or unsupported',
  'PostgreSQL connection URL has invalid encoding',
  'PostgreSQL connection contains an unsupported host or database name',
  'PostgreSQL connection has ambiguous query encoding',
  'PostgreSQL connection has invalid query encoding',
  'PostgreSQL connection has unsupported or duplicate query options',
  'PostgreSQL connection has a service-file value that is too long',
]);

export function safeBackupError(error) {
  // Error text from the database, filesystem and clients can contain data,
  // URLs or other credentials. Only reproduce exact, fixed diagnostics.
  let message = '';
  try { if (typeof error?.message === 'string') message = error.message; } catch { /* untrusted getter */ }
  if (SERVICE_ERRORS.has(message)) return message;
  if (/^pg_dump failed(?: \(exit \d{1,3}\))?; inspect client configuration$/.test(message)) return message;
  if (/^backup evidence (?:table rows|total rows|payments_amount_paise|subscription_payments_amount_paise) is not a non-negative safe integer$/.test(message)) return message;
  return 'backup failed; inspect source, output and client configuration';
}
