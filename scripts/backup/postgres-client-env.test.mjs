#!/usr/bin/env node
/**
 * A test must not write into the CI job's own environment.
 *
 * WHY THIS EXISTS
 *
 * The composite action publishes the pinned PostgreSQL client directory
 * through `$GITHUB_ENV`. GitHub applies that file to every LATER step
 * in the job.
 *
 * So a test that runs the action's verify step while inheriting the
 * job's real `$GITHUB_ENV` publishes into it — and the directory it
 * publishes is a temp dir the test then deletes. Every later step
 * inherits `PG_CLIENT_BIN_DIR` pointing at a directory that no longer
 * exists, and `resolvePgClient` finds no client there at all.
 *
 * The symptom is not a leak you can see. It is a later step behaving
 * differently from a clean environment, reported as an unrelated
 * failure further down the job.
 *
 * This suite proves the property end to end: it runs the action's own
 * test file with a sentinel `$GITHUB_ENV` and asserts the sentinel is
 * untouched.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ACTION_TESTS = path.join(ROOT, 'scripts', 'backup', 'postgres-client-action.test.mjs');

test('the action test suite never publishes into the job environment', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-env-sentinel-'));
  const sentinel = path.join(dir, 'github-env');
  const sentinelPath = path.join(dir, 'github-path');
  writeFileSync(sentinel, 'SENTINEL-MUST-NOT-CHANGE\n');
  writeFileSync(sentinelPath, 'SENTINEL-MUST-NOT-CHANGE\n');

  // The suite's own result is not the point here; the sentinel is.
  //
  // NODE_TEST_CONTEXT must be cleared: a `node --test` child inherits
  // it, and a nested `node --test` that sees it runs the file as a
  // plain script — so the inner tests would never execute and the
  // sentinel would be untouched for the wrong reason. That is exactly
  // how a test like this passes without testing anything.
  const env = { ...process.env, GITHUB_ENV: sentinel, GITHUB_PATH: sentinelPath };
  delete env.NODE_TEST_CONTEXT;
  try {
    execFileSync('node', ['--test', ACTION_TESTS], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
  } catch {
    // A failure of the action suite is a different problem; the
    // sentinel below is checked either way.
  }

  assert.equal(
    readFileSync(sentinel, 'utf8'),
    'SENTINEL-MUST-NOT-CHANGE\n',
    'a test published into the job environment: the action suite must sandbox $GITHUB_ENV',
  );
  assert.equal(
    readFileSync(sentinelPath, 'utf8'),
    'SENTINEL-MUST-NOT-CHANGE\n',
    'a test published into the job PATH: the action suite must sandbox $GITHUB_PATH',
  );
});
