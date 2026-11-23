#!/usr/bin/env node
/**
 * Tests for the PostgreSQL client resolver (scripts/backup/lib-pg-client.mjs).
 *
 * WHY THIS LAYER EXISTS
 *
 * The composite action verifies that psql, pg_dump and pg_restore are the
 * pinned major version, and publishes the pinned directory on PATH. That is
 * not enough on its own: the runner image ships an older PostgreSQL client
 * that can shadow the pinned one, and a later step that writes to GITHUB_PATH
 * can reorder PATH again. "The right version is installed" and "the right
 * version is what runs" are different claims.
 *
 * So the backup and the restore resolve pg_dump / pg_restore by ABSOLUTE
 * path inside the pinned directory whenever the action has published one,
 * and re-check the version at the moment of use. This suite proves that a
 * shadowing binary on PATH cannot be substituted, and that a missing or
 * mismatched client fails closed instead of silently falling back.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clientMajorVersion, resolvePgClient, resolvePgClients, PG_CLIENT_TOOLS } from './lib-pg-client.mjs';

/** A stand-in PostgreSQL client binary reporting `version`. */
function clientBinary(dir, name, version) {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    version === '' ? '#!/bin/sh\necho "no version here"\n' : `#!/bin/sh\necho "${name} (PostgreSQL) ${version}"\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

/** A temporary bin dir holding all three clients at `version`. */
function makeBinDir(version = '17.6') {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgresolve-'));
  for (const tool of PG_CLIENT_TOOLS) clientBinary(dir, tool, version);
  return dir;
}

test('the client tool set is psql, pg_dump and pg_restore', () => {
  // pg_dump WRITES the archive and pg_restore READS it. The writer is the
  // binary that decides the archive format, so it must be in the set.
  assert.deepEqual([...PG_CLIENT_TOOLS], ['psql', 'pg_dump', 'pg_restore']);
});

test('clientMajorVersion reads the major version', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgver-'));
  try {
    assert.equal(clientMajorVersion(clientBinary(dir, 'pg_dump', '17.6')), '17');
    assert.equal(clientMajorVersion(clientBinary(dir, 'pg_restore', '16.4 (Debian 16.4-1)')), '16');
    assert.equal(clientMajorVersion(clientBinary(dir, 'psql', '')), null, 'an unreadable version is null');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pinned directory is used by ABSOLUTE path, even when PATH would resolve another copy', () => {
  const pinned = makeBinDir('17.6');
  const shadow = mkdtempSync(path.join(tmpdir(), 'autodine-pgshadow-'));
  const originalPath = process.env.PATH;
  try {
    // An older client of the SAME major version sits first on PATH. Only
    // the path can tell the two apart — the version string cannot.
    for (const tool of PG_CLIENT_TOOLS) clientBinary(shadow, tool, '17.9');
    process.env.PATH = `${shadow}:${originalPath}`;

    const resolved = resolvePgClient('pg_dump', { binDir: pinned, expectedVersion: '17' });
    assert.equal(resolved.path, path.join(pinned, 'pg_dump'));
    assert.equal(resolved.source, 'pinned');
    assert.equal(resolved.version, '17');
  } finally {
    process.env.PATH = originalPath;
    rmSync(pinned, { recursive: true, force: true });
    rmSync(shadow, { recursive: true, force: true });
  }
});

test('a pinned directory with the wrong version fails closed', () => {
  const pinned = makeBinDir('16.4');
  try {
    assert.throws(
      () => resolvePgClient('pg_dump', { binDir: pinned, expectedVersion: '17' }),
      /is PostgreSQL 16, expected 17/,
      'a mismatched pinned client must refuse, not fall back',
    );
  } finally {
    rmSync(pinned, { recursive: true, force: true });
  }
});

test('a pinned directory missing the tool fails closed', () => {
  const pinned = makeBinDir('17.6');
  try {
    rmSync(path.join(pinned, 'pg_restore'));
    assert.throws(
      () => resolvePgClient('pg_restore', { binDir: pinned, expectedVersion: '17', required: true }),
      /missing from the pinned directory/,
    );
    // Not required -> reported as missing rather than throwing.
    assert.equal(resolvePgClient('pg_restore', { binDir: pinned, expectedVersion: '17' }), null);
  } finally {
    rmSync(pinned, { recursive: true, force: true });
  }
});

test('a pinned binary that is not executable is refused', () => {
  const pinned = makeBinDir('17.6');
  try {
    chmodSync(path.join(pinned, 'pg_dump'), 0o644);
    assert.throws(
      () => resolvePgClient('pg_dump', { binDir: pinned, expectedVersion: '17', required: true }),
      /missing from the pinned directory/,
    );
  } finally {
    rmSync(pinned, { recursive: true, force: true });
  }
});

test('with no pinned directory the resolution falls back to PATH', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgpath-'));
  const originalPath = process.env.PATH;
  try {
    clientBinary(dir, 'pg_dump', '17.6');
    process.env.PATH = `${dir}:${originalPath}`;
    const resolved = resolvePgClient('pg_dump', { binDir: '', expectedVersion: '' });
    assert.equal(resolved.path, 'pg_dump');
    assert.equal(resolved.source, 'path');
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tool that is absent everywhere is reported as missing, not as a version error', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgempty-'));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = dir;
    assert.equal(resolvePgClient('pg_dump', { binDir: '' }), null);
    assert.throws(() => resolvePgClient('pg_dump', { binDir: '', required: true }), /was not found on PATH/);
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePgClients reports exactly what is missing', () => {
  const pinned = makeBinDir('17.6');
  try {
    rmSync(path.join(pinned, 'pg_dump'));
    const { tools, missing } = resolvePgClients(PG_CLIENT_TOOLS, { binDir: pinned, expectedVersion: '17' });
    assert.deepEqual(missing, ['pg_dump']);
    assert.ok(tools.psql, 'psql must still resolve');
    assert.ok(tools.pg_restore, 'pg_restore must still resolve');
  } finally {
    rmSync(pinned, { recursive: true, force: true });
  }
});

test('the backup and restore scripts resolve the client through this module', () => {
  // A regression guard: the scripts must not shell out to a bare
  // 'pg_dump' / 'pg_restore' by name, which is exactly how a shadowing
  // PATH entry takes over.
  const root = process.cwd();
  for (const [file, tool] of [
    ['scripts/backup/backup-logical.mjs', 'pg_dump'],
    ['scripts/backup/restore-logical.mjs', 'pg_restore'],
  ]) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /from '\.\/lib-pg-client\.mjs'/, `${file} must import the resolver`);
    assert.doesNotMatch(
      source,
      new RegExp(`execFileSync\\('${tool}'`),
      `${file} must not exec ${tool} by name — that is how a shadow wins`,
    );
  }
});
