/** Application diagnostics may keep a database error class, never its text,
 * request arguments, rows, details or hint. Transport errors sometimes embed
 * the request URL or full payload in those fields. */
export function dbErrorReference(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code) ? code : 'unclassified';
}
