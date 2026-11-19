#!/usr/bin/env node
/**
 * Tests for the PostgreSQL client composite action
 * (.github/actions/postgres-client).
 *
 * The action installs and verifies the PostgreSQL client tools so a hosted
 * backup and the hosted restore drill use the SAME major version — a
 * custom-format dump written by pg_dump 17 carries archive format 1.16,
 * which pg_restore 16 refuses outright.
 *
 * The action runs shell, so the suite drives the real scripts inside a mock
 * system:
 *
 *   - a temporary "bin dir" holding stand-in psql / pg_restore binaries
 *     that report a chosen version (or a broken version string);
 *   - a PATH whose first entry holds mock sudo / apt-get / curl / install,
 *     so the install path is exercised without touching the machine.
 *
 * The mocks resolve the REAL binaries by absolute path. A mock that called
 * "apt-get" by name would find itself first on PATH and recurse forever, so
 * the harness captures the real locations up front.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ACTION_DIR = path.join(import.meta.dirname, '..', '..', '.github', 'actions', 'postgres-client');
const VERIFY = path.join(ACTION_DIR, 'verify-client.sh');
const INSTALL = path.join(ACTION_DIR, 'install-client.sh');

/** Absolute locations of the real binaries, captured before PATH is changed. */
function realBinary(name) {
  const found = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  const resolved = found.stdout.trim();
  assert.ok(resolved, `the real '${name}' must exist for this suite to run`);
  return resolved;
}

/**
 * A stand-in PostgreSQL client binary reporting `version`.
 * `version` may be a real version ("17.6"), a wrong one ("16.4") or
 * garbage (""), which prints nothing parseable.
 */
function clientBinary(dir, name, version) {
  const file = path.join(dir, name);
  const body = version === ''
    ? '#!/bin/sh\necho "no version here"\n'
    : `#!/bin/sh\necho "${name} (PostgreSQL) ${version}"\n`;
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

/** A temporary bin dir populated with the requested client version. */
function makeBinDir(version = '17.6', { psql = true, pgRestore = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgclient-'));
  if (psql) clientBinary(dir, 'psql', version);
  if (pgRestore) clientBinary(dir, 'pg_restore', version);
  return dir;
}

/** Runs the verify step the way the composite action runs it. */
function runVerify({ binDir, version = '17', env = {} } = {}) {
  const githubPath = path.join(binDir, '..', 'github-path');
  writeFileSync(githubPath, '');
  const result = spawnSync('bash', [VERIFY, version, binDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_PATH: githubPath,
      ...env,
    },
  });
  return { ...result, githubPath };
}

test('verify-client.sh accepts the requested major version and publishes the bin dir', () => {
  const binDir = makeBinDir('17.6');
  try {
    const result = runVerify({ binDir });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    assert.match(result.stdout, /is PostgreSQL 17/);
    const published = readFileSync(result.githubPath, 'utf8');
    assert.ok(published.includes(binDir), 'the bin dir must be published on PATH');
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses a client that is a different major version', () => {
  const binDir = makeBinDir('16.4');
  try {
    const result = runVerify({ binDir, version: '17' });
    assert.notEqual(result.status, 0, 'a mismatched client must fail the job');
    assert.match(result.stderr, /is PostgreSQL 16, expected 17/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses a missing client binary', () => {
  const binDir = makeBinDir('17.6', { pgRestore: false });
  try {
    const result = runVerify({ binDir });
    assert.notEqual(result.status, 0, 'a missing pg_restore must fail the job');
    assert.match(result.stderr, /missing or not executable/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses a client whose version cannot be read', () => {
  const binDir = makeBinDir('');
  try {
    const result = runVerify({ binDir });
    assert.notEqual(result.status, 0, 'an unreadable version must fail the job');
    assert.match(result.stderr, /could not read a version/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses an empty or root binary directory', () => {
  for (const bad of ['', '/']) {
    const result = spawnSync('bash', [VERIFY, '17', bad], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `binary dir "${bad}" must be refused`);
    assert.match(result.stderr, /refusing an empty or root binary directory/);
  }
});

/**
 * The install path, driven through a mock system: mock sudo, mock apt-get,
 * mock curl and mock install. The mock sudo forwards to the REAL binary it
 * was asked to run (resolved absolutely, never by PATH lookup) so the
 * install script's own resolution is exercised without installing anything.
 */
function mockSystem() {
  const root = mkdtempSync(path.join(tmpdir(), 'autodine-pgsys-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);

  // The real binaries are resolved here so the mocks below can never be
  // mistaken for them, and so the harness fails loudly if the machine
  // lacks them.
  for (const name of ['sudo', 'apt-get', 'curl', 'install']) realBinary(name);

  // Mock sudo: run the command it was given. The script is invoked as
  // `sudo <absolute command> <args...>`, so "$@" is already the command —
  // there is no "sudo" word to shift off ("sudo" is $0 here, not $1).
  // The command is an absolute path, so running it directly cannot re-find
  // this mock on PATH.
  writeFileSync(
    path.join(bin, 'sudo'),
    '#!/bin/sh\nif [ "$#" -eq 0 ]; then echo "mock sudo: nothing to run" >&2; exit 1; fi\nexec "$@"\n',
  );
  chmodSync(path.join(bin, 'sudo'), 0o755);

  // Mock apt-get: never touches the machine; record the calls instead.
  const log = path.join(root, 'apt-get.log');
  writeFileSync(
    path.join(bin, 'apt-get'),
    `#!/bin/sh\necho "apt-get $*" >> "${log}"\nexit 0\n`,
  );
  chmodSync(path.join(bin, 'apt-get'), 0o755);

  // Mock curl: write a placeholder key file inside the sandbox instead of
  // downloading anything or writing to a real system path.
  writeFileSync(
    path.join(bin, 'curl'),
    `#!/bin/sh\nprev=""; for arg in "$@"; do case "$prev" in --output) : > "${root}/curl-output";; esac; prev="$arg"; done\necho "curl $*" >> "${log}"\nexit 0\n`,
  );
  chmodSync(path.join(bin, 'curl'), 0o755);

  // Mock install: record the call instead of creating real system paths.
  writeFileSync(
    path.join(bin, 'install'),
    `#!/bin/sh\nargs=""; for a in "$@"; do args="$args $a"; done; echo "install $args" >> "${log}"\nexit 0\n`,
  );
  chmodSync(path.join(bin, 'install'), 0o755);

  // Mock sh: the install script writes the PGDG repository list with
  // `sh -c`; record it rather than touching /etc/apt.
  writeFileSync(
    path.join(bin, 'sh'),
    `#!/bin/sh\necho "sh $*" >> "${log}"\nexit 0\n`,
  );
  chmodSync(path.join(bin, 'sh'), 0o755);

  return { root, bin, log };
}

test('install-client.sh installs the requested major version through PGDG', () => {
  const system = mockSystem();
  try {
    const result = spawnSync('bash', [INSTALL, '17'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${system.bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    const log = readFileSync(system.log, 'utf8');
    assert.match(log, /postgresql-client-17/, 'the pinned major version must be installed');
    assert.match(log, /apt-get update/, 'the package index must be refreshed');
  } finally {
    rmSync(system.root, { recursive: true, force: true });
  }
});

test('install-client.sh honours the requested major version, not a hard-coded one', () => {
  const system = mockSystem();
  try {
    const result = spawnSync('bash', [INSTALL, '16'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${system.bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    const log = readFileSync(system.log, 'utf8');
    assert.match(log, /postgresql-client-16/);
    assert.doesNotMatch(log, /postgresql-client-17/);
  } finally {
    rmSync(system.root, { recursive: true, force: true });
  }
});

test('both action scripts fail closed under "set -euo pipefail"', () => {
  for (const script of [VERIFY, INSTALL]) {
    const body = readFileSync(script, 'utf8');
    assert.match(body, /set -euo pipefail/, `${script} must fail closed`);
  }
});

test('the composite action pins version 17 and verifies before use', () => {
  const action = readFileSync(path.join(ACTION_DIR, 'action.yml'), 'utf8');
  assert.match(action, /using: 'composite'/);
  assert.match(action, /default: '17'/);
  assert.match(action, /verify-client\.sh/);
  assert.match(action, /install-client\.sh/);
});
