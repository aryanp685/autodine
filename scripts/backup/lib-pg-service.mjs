/**
 * Private libpq service file for external PostgreSQL clients.
 * Connection details never appear in client argv or child environment. The
 * file lives in a 0700 directory and is 0600; ordinary success/failure paths
 * remove it. SIGKILL or host failure may leave it behind: use an ephemeral,
 * access-controlled runner and remove the runner's temporary directory.
 *
 * Fail closed on URI forms that cannot be represented unambiguously in the
 * service file. In particular, query options cannot change the guarded target.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const QUERY_KEYS = new Set([
  'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslcrl', 'sslcrldir',
  'channel_binding', 'connect_timeout', 'application_name', 'fallback_application_name',
  'keepalives', 'keepalives_idle', 'keepalives_interval', 'keepalives_count',
  'tcp_user_timeout', 'gssencmode', 'target_session_attrs', 'options',
]);

function safeValue(value) {
  // libpq's service-file parser trims whitespace and uses line boundaries.
  // Reject rather than change credentials or allow extra service entries.
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('PostgreSQL connection contains an unsupported service-file value');
  }
  return value;
}

export function pgServiceFields(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('PostgreSQL connection URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === '/' || url.hash) {
    throw new Error('PostgreSQL connection URL is incomplete or unsupported');
  }
  let user, password, database;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new Error('PostgreSQL connection URL has invalid encoding'); }
  const fields = {
    host: safeValue(url.hostname.replace(/^\[|\]$/g, '')),
    port: safeValue(url.port || '5432'),
    user: safeValue(user),
    dbname: safeValue(database),
  };
  if (password) fields.password = safeValue(password);
  // libpq may interpret an embedded conninfo/URI dbname as another connection.
  // Refuse any such expansion as well as multiple hosts.
  // An encoded or non-DNS hostname can be interpreted differently by the URL
  // parser and libpq (or the node-postgres snapshot connection). Refuse it.
  if (!/^[a-z0-9._:-]+$/i.test(fields.host) || fields.dbname !== decodeURI(url.pathname.slice(1)) || fields.dbname.includes('=') || /^(postgres(?:ql)?:\/\/)/i.test(fields.dbname)) {
    throw new Error('PostgreSQL connection contains an unsupported host or database name');
  }
  // URLSearchParams treats '+' as a space and silently substitutes invalid
  // percent encoding or UTF-8. Refuse these instead of changing a value.
  if (url.search.includes('+')) throw new Error('PostgreSQL connection has ambiguous query encoding');
  try {
    for (const part of url.search.slice(1).split(/[&=]/)) decodeURIComponent(part);
  } catch { throw new Error('PostgreSQL connection has invalid query encoding'); }
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!QUERY_KEYS.has(key) || seen.has(key)) throw new Error('PostgreSQL connection has unsupported or duplicate query options');
    seen.add(key);
    fields[key] = safeValue(value);
  }
  // PostgreSQL 17's service parser reads raw values (not conninfo quoting or
  // backslash escapes) with a 1024-byte fgets buffer. Account for key, '=',
  // and newline: strlen(line) must stay below 1023 bytes. Validate *every*
  // field before creating any temporary file.
  for (const [key, value] of Object.entries(fields)) {
    if (Buffer.byteLength(`${key}=${value}\n`, 'utf8') >= 1023) {
      throw new Error('PostgreSQL connection has a service-file value that is too long');
    }
  }
  return fields;
}

/** Synchronously invoke fn({env, dbname}) with a private service file. */
export function cleanPgClientEnv(source = process.env) {
  // An allowlist avoids passing unrelated secrets (for example cloud keys or
  // DATABASE_URL) as well as libpq target overrides to child processes.
  // PATH and OS profile/temp variables support tool discovery and startup;
  // locale/timezone affect diagnostics only. Never inherit loader overrides.
  const allowed = new Set(['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SYSTEMROOT', 'WINDIR']);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    value !== undefined && allowed.has(key.toUpperCase())));
}

export function withPgService(connectionString, fn) {
  const fields = pgServiceFields(connectionString);
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pg-service-'));
  try {
    const file = path.join(dir, 'service.conf');
    const content = '[autodine]\n' + Object.entries(fields).map(([key, value]) => `${key}=${value}\n`).join('');
    writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
    const emptyPassfile = path.join(dir, 'empty.pgpass');
    writeFileSync(emptyPassfile, '', { flag: 'wx', mode: 0o600 });
    // libpq environment and unrelated application secrets must not redirect the
    // connection, or be inherited by the external client unnecessarily.
    const env = cleanPgClientEnv();
    env.PGSERVICEFILE = file;
    env.PGPASSFILE = emptyPassfile; // do not fall back to a runner's ~/.pgpass
    return fn({ env, dbname: 'service=autodine' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
