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

/**
 * A temporary bin dir populated with the requested client version.
 *
 * ALL THREE tools are created by default: psql, pg_dump and pg_restore.
 * pg_dump is the binary that WRITES the archive and pg_restore is the one
 * that READS it, so the pair that decides whether a backup is restorable
 * is the writer/reader pair — verifying only psql and pg_restore left the
 * writer unchecked.
 */
function makeBinDir(version = '17.6', { psql = true, pgDump = true, pgRestore = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgclient-'));
  if (psql) clientBinary(dir, 'psql', version);
  if (pgDump) clientBinary(dir, 'pg_dump', version);
  if (pgRestore) clientBinary(dir, 'pg_restore', version);
  return dir;
}

/**
 * A throwaway GITHUB_ENV / GITHUB_PATH pair.
 *
 * WHY THIS EXISTS
 *
 * The composite action publishes the pinned client directory through
 * $GITHUB_ENV. A test that inherits the job's real $GITHUB_ENV writes
 * into it — and the directory it publishes is a temp dir the test then
 * deletes. So every LATER step in the CI job inherits
 * PG_CLIENT_BIN_DIR pointing at a directory that no longer exists, and
 * `resolvePgClient` finds no client there at all.
 *
 * That is how a job's later steps start behaving differently from a
 * clean environment, and it is invisible: the leak shows up as an
 * unrelated failure much further down the job.
 *
 * So every invocation of the verify step gets its own pair of files.
 */
function sandboxGithubEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-github-env-'));
  const envFile = path.join(dir, 'github-env');
  const pathFile = path.join(dir, 'github-path');
  writeFileSync(envFile, '');
  writeFileSync(pathFile, '');
  return { dir, envFile, pathFile, env: { GITHUB_ENV: envFile, GITHUB_PATH: pathFile } };
}

/** Runs the verify step the way the composite action runs it. */
function runVerify({ binDir, version = '17', env = {} } = {}) {
  const sandbox = sandboxGithubEnv();
  const result = spawnSync('bash', [VERIFY, version, binDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...sandbox.env,
      ...env,
    },
  });
  return { ...result, githubPath: sandbox.pathFile, githubEnv: sandbox.envFile };
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

test('verify-client.sh verifies ALL THREE binaries: psql, pg_dump and pg_restore', () => {
  const binDir = makeBinDir('17.6');
  try {
    const result = runVerify({ binDir });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    for (const tool of ['psql', 'pg_dump', 'pg_restore']) {
      assert.match(
        result.stdout,
        new RegExp(`${tool.replace('_', '\\u005f')}`),
        `the verification must name ${tool}`,
      );
    }
    // Each of the three must be reported as the requested major version.
    const verified = result.stdout.match(/is PostgreSQL \d+/g) ?? [];
    assert.equal(verified.length, 3, `all three binaries must be verified, saw: ${verified.join(', ')}`);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses when pg_dump is missing', () => {
  // pg_dump is the binary that WRITES the archive. If it is unverified, a
  // dump can be written in a format the restore side cannot read.
  const binDir = makeBinDir('17.6', { pgDump: false });
  try {
    const result = runVerify({ binDir });
    assert.notEqual(result.status, 0, 'a missing pg_dump must fail the job');
    assert.match(result.stderr, /pg_dump is missing or not executable/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses when pg_dump is a different major version', () => {
  const binDir = makeBinDir('17.6');
  try {
    // Replace only pg_dump with an older client.
    clientBinary(binDir, 'pg_dump', '16.4');
    const result = runVerify({ binDir, version: '17' });
    assert.notEqual(result.status, 0, 'a mismatched pg_dump must fail the job');
    assert.match(result.stderr, /is PostgreSQL 16, expected 17/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses when pg_restore is missing', () => {
  const binDir = makeBinDir('17.6', { pgRestore: false });
  try {
    const result = runVerify({ binDir });
    assert.notEqual(result.status, 0, 'a missing pg_restore must fail the job');
    assert.match(result.stderr, /pg_restore is missing or not executable/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses a client that is a different major version', () => {
  const binDir = makeBinDir('16.4');
  // Every tool in the dir is 16.4, so the very first one is refused.
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

test('verify-client.sh resolves each tool to the verified binary, not a shadow', () => {
  // The pinned directory is published first, so the binaries that RUN are
  // the verified ones even when an older client sits earlier on PATH.
  const binDir = makeBinDir('17.6');
  const shadow = mkdtempSync(path.join(tmpdir(), 'autodine-pgshadow-'));
  try {
    for (const tool of ['psql', 'pg_dump', 'pg_restore']) clientBinary(shadow, tool, '16.4');
    const sandbox = sandboxGithubEnv();
    const result = spawnSync('bash', [VERIFY, '17', binDir], {
      encoding: 'utf8',
      env: { ...process.env, ...sandbox.env, PATH: `${shadow}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    // The resolution proof must name all three tools.
    for (const tool of ['psql', 'pg_dump', 'pg_restore']) {
      assert.match(result.stdout, new RegExp(`which -a ${tool}`), `${tool} must be resolved and printed`);
    }
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(shadow, { recursive: true, force: true });
  }
});

test('verify-client.sh writes its findings to PG_CLIENT_LOG', () => {
  // The CI job turns this file into an annotation. A version mismatch that
  // never reaches the log is a failure nobody can read.
  const binDir = makeBinDir('16.4');
  try {
    const logFile = path.join(binDir, 'pg-client-install.log');
    const result = runVerify({ binDir, version: '17', env: { PG_CLIENT_LOG: logFile } });
    assert.notEqual(result.status, 0);
    const logged = readFileSync(logFile, 'utf8');
    assert.match(logged, /is PostgreSQL 16, expected 17/, 'the failure must be captured in the log');
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('the action publishes the pinned directory and version for later steps', () => {
  // The backup and restore scripts resolve pg_dump / pg_restore by ABSOLUTE
  // path from PG_CLIENT_BIN_DIR, so PATH shadowing cannot change which
  // client runs after the action has verified it.
  const binDir = makeBinDir('17.6');
  try {
    const githubEnv = path.join(binDir, '..', 'github-env');
    writeFileSync(githubEnv, '');
    const result = spawnSync('bash', [VERIFY, '17', binDir], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_PATH: githubEnv, GITHUB_ENV: githubEnv },
    });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    const published = readFileSync(githubEnv, 'utf8');
    assert.match(published, new RegExp(`PG_CLIENT_BIN_DIR=${binDir}`));
    assert.match(published, /PG_CLIENT_VERSION=17/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('verify-client.sh refuses an empty or root binary directory', () => {
  for (const bad of ['', '/']) {
    const sandbox = sandboxGithubEnv();
    const result = spawnSync('bash', [VERIFY, '17', bad], {
      encoding: 'utf8',
      env: { ...process.env, ...sandbox.env },
    });
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

  // Mock curl: write to the path the script actually asked for. The script
  // downloads the PGDG key to a temporary file, so honouring --output keeps
  // the flow faithful: the later "install" step must find a real source
  // file, and would fail if the download never happened.
  writeFileSync(
    path.join(bin, 'curl'),
    `#!/bin/sh\nprev=""; for arg in "$@"; do case "$prev" in --output) printf 'mock key material\\n' > "$arg" || exit 1;; esac; prev="$arg"; done\necho "curl $*" >> "${log}"\nexit 0\n`,
  );
  chmodSync(path.join(bin, 'curl'), 0o755);

  // Mock install: record the call, and behave like the real one about its
  // source file — a missing or empty source is an error, never a silent
  // success. Never writes to a real system path.
  writeFileSync(
    path.join(bin, 'install'),
    `#!/bin/sh\nargs=""; for a in "$@"; do args="$args $a"; done; echo "install $args" >> "${log}"\npos=""; skip=""; for a in "$@"; do if [ -n "$skip" ]; then skip=""; continue; fi; case "$a" in -m) skip=1; continue;; -*) continue;; esac; pos="$pos $a"; done\ncount=$(echo $pos | wc -w)\nif [ "$count" -ge 2 ]; then src=$(echo $pos | awk '{print $(NF-1)}'); if [ ! -f "$src" ]; then echo "install: cannot stat '$src'" >&2; exit 1; fi; if [ ! -s "$src" ]; then echo "install: '$src' is empty" >&2; exit 1; fi; fi\nexit 0\n`,
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

test('the install is non-interactive, so an unattended job cannot hang on a prompt', () => {
  const body = readFileSync(INSTALL, 'utf8');
  assert.match(body, /DEBIAN_FRONTEND=noninteractive/);
});

test('the PGDG signing key is downloaded and then installed with an explicit mode', () => {
  const system = mockSystem();
  try {
    const result = spawnSync('bash', [INSTALL, '17'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${system.bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    const log = readFileSync(system.log, 'utf8');
    assert.match(log, /install\s+-m 0644/, 'the key must be installed with an explicit mode');
    assert.match(log, /apt.postgresql.org.asc/, 'the key must land at the apt keyring path');
    assert.match(log, /pgdg\.list/, 'the PGDG repository list must be written');
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
