/**
 * Resolve a PostgreSQL client binary to the one that will actually run.
 *
 * WHY THIS EXISTS
 *
 * The backup and the restore drill must use the SAME PostgreSQL major
 * version. A custom-format dump written by pg_dump 17 carries an archive
 * format that pg_restore 16 refuses outright ("unsupported version"), so a
 * version mismatch between the two sides is not a nuisance — it is a
 * backup that cannot be restored.
 *
 * The GitHub runner image ships an older client that can SHADOW the pinned
 * one on PATH. The composite action (.github/actions/postgres-client)
 * installs and version-verifies the pinned client and puts its directory
 * first on PATH, but "the right version is installed" and "the right
 * version is what runs" are different claims, and a later step that writes
 * to GITHUB_PATH can reorder PATH again.
 *
 * So the resolution is by ABSOLUTE PATH whenever the pinned directory is
 * known. The action exports PG_CLIENT_BIN_DIR and PG_CLIENT_VERSION; the
 * scripts that run pg_dump / pg_restore use this module to find the exact
 * binary that was verified, and to re-check its version at the moment it
 * is used. PATH shadowing then cannot change which binary runs.
 *
 * With no pinned directory (a developer's laptop, a local test), the
 * resolution falls back to PATH exactly as before — and a missing tool is
 * reported as missing rather than as a version error.
 *
 * Pure and dependency-free: no network, no database, no secrets.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';

/** The client tools a backup/restore pair needs. */
export const PG_CLIENT_TOOLS = Object.freeze(['psql', 'pg_dump', 'pg_restore']);

/**
 * The major version a client binary reports, or null when it reports
 * nothing parseable.
 *
 * "pg_dump (PostgreSQL) 17.6 (Debian 17.6-1)" -> "17".
 */
export function clientMajorVersion(binary) {
  let output = '';
  try {
    output = execFileSync(binary, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
  const match = String(output).match(/(\d+)(?:\.\d+)?/);
  return match ? match[1] : null;
}

/** True when the path exists and is executable. */
function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves one client tool.
 *
 * @param {string} tool            e.g. 'pg_dump'
 * @param {object} [options]
 * @param {string} [options.binDir]        the pinned directory (defaults to
 *                                         PG_CLIENT_BIN_DIR)
 * @param {string} [options.expectedVersion] the pinned major version
 *                                         (defaults to PG_CLIENT_VERSION)
 * @param {boolean} [options.required]     when true, a missing tool is an
 *                                         error; when false (the default)
 *                                         it is reported as null
 * @returns {{path: string, version: string|null, source: 'pinned'|'path'}|null}
 */
export function resolvePgClient(tool, options = {}) {
  const binDir = String(options.binDir ?? process.env.PG_CLIENT_BIN_DIR ?? '').trim();
  const expected = String(options.expectedVersion ?? process.env.PG_CLIENT_VERSION ?? '').trim();
  const required = options.required === true;

  if (binDir) {
    const candidate = path.join(binDir, tool);
    if (!existsSync(candidate) || !isExecutable(candidate)) {
      if (!required) return null;
      throw new Error(
        `the PostgreSQL client ${tool} is missing from the pinned directory ${binDir} — ` +
          'the pinned PostgreSQL client is required, and no other copy may be substituted',
      );
    }
    const version = clientMajorVersion(candidate);
    if (version === null) {
      if (!required) return null;
      throw new Error(`the PostgreSQL client ${tool} at ${binDir} reported no readable version`);
    }
    if (expected && version !== expected) {
      throw new Error(
        `the PostgreSQL client ${tool} at ${binDir} is PostgreSQL ${version}, expected ${expected} — ` +
          'refusing to run a client that is not the pinned major version',
      );
    }
    return { path: candidate, version, source: 'pinned' };
  }

  // No pinned directory: resolve through PATH, as before.
  const version = clientMajorVersion(tool);
  if (version === null) {
    if (!required) return null;
    throw new Error(`the PostgreSQL client ${tool} was not found on PATH`);
  }
  if (expected && version !== expected) {
    throw new Error(
      `the PostgreSQL client ${tool} on PATH is PostgreSQL ${version}, expected ${expected} — ` +
        'refusing to run a client that is not the pinned major version',
    );
  }
  return { path: tool, version, source: 'path' };
}

/**
 * Resolves every tool a backup/restore pair needs.
 *
 * @returns {{tools: Record<string, {path: string, version: string|null, source: string}>, missing: string[]}}
 */
export function resolvePgClients(tools = PG_CLIENT_TOOLS, options = {}) {
  const resolved = {};
  const missing = [];
  for (const tool of tools) {
    const found = resolvePgClient(tool, { ...options, required: false });
    if (found) resolved[tool] = found;
    else missing.push(tool);
  }
  return { tools: resolved, missing };
}
