#!/usr/bin/env node
/**
 * The Chromium provisioning step must survive a transient download failure.
 *
 * WHY THIS EXISTS
 *
 * `playwright install --with-deps` downloads a browser build and installs its
 * Linux runtime libraries. Both halves talk to the network and both fail
 * intermittently on a shared runner. A job that dies there reports a red run
 * for a cause no code change can fix — and it does so at the FIRST step, so
 * every assertion in the job never runs.
 *
 * So the install is retried, with a BOUND: a genuine failure must still fail
 * the job, loudly, and the last attempt's exit code must be the job's exit
 * code. A retry that swallowed failures would be worse than no retry at all.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'e2e', 'install-chromium.sh');

/** A fake `npx` that fails the first `failTimes` times, then succeeds. */
function stubNpx(dir, failTimes) {
  const log = path.join(dir, 'npx.log');
  const stub = path.join(dir, 'npx');
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(log)}
count=$(wc -l < ${JSON.stringify(log)})
if [ "$count" -lt ${failTimes} ]; then echo "network error" >&2; exit 1; fi
echo "installed"
`,
  );
  // The stub has to be EXECUTABLE: bash skips a non-executable file when it
  // resolves a command on PATH and falls through to the real npx.
  chmodSync(stub, 0o755);
  return { stub, log, env: { PATH: `${dir}:${process.env.PATH}`, NPX_LOG: log } };
}

test('the install script exists and is executable', () => {
  const result = spawnSync('test', ['-x', SCRIPT]);
  assert.equal(result.status, 0, 'scripts/e2e/install-chromium.sh must be executable');
});

test('a transient failure is retried and the step still succeeds', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-chromium-'));
  const { log, env } = stubNpx(dir, 2);
  const result = spawnSync('bash', [SCRIPT, '3'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
  // The stub fails while it has been called fewer than 2 times, so the first
  // attempt fails and the second succeeds: two attempts, one retry.
  const attempts = readFileSync(log, 'utf8').trim().split('\n').length;
  assert.equal(attempts, 2, `expected 2 attempts (one failure then a success), saw ${attempts}`);
});

test('a genuine failure still fails the job, after the bounded number of attempts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-chromium-'));
  const { log, env } = stubNpx(dir, 99);
  const result = spawnSync('bash', [SCRIPT, '2'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.notEqual(result.status, 0, 'a Chromium install that never succeeds must fail the step');
  const attempts = readFileSync(log, 'utf8').trim().split('\n').length;
  assert.equal(attempts, 2, `the retry must be bounded at 2 attempts, saw ${attempts}`);
});

test('a nonsense attempt count is refused rather than retried forever', () => {
  const result = spawnSync('bash', [SCRIPT, '0'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'an attempt count of zero must be refused');
  assert.match(result.stderr, /positive integer/);
});

test('every browser workflow provisions Chromium through the retrying script', () => {
  // A workflow that still calls `npx playwright install` directly keeps the
  // transient failure this script exists to absorb.
  const workflows = ['e2e.yml', 'throttle-e2e.yml', 'staging-e2e.yml'];
  for (const file of workflows) {
    const text = readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
    assert.doesNotMatch(
      text,
      /npx playwright install/,
      `${file} installs Chromium directly — it must use scripts/e2e/install-chromium.sh`,
    );
    assert.match(
      text,
      /scripts\/e2e\/install-chromium\.sh/,
      `${file} must provision Chromium through the retrying script`,
    );
  }
});
