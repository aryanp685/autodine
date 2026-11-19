#!/usr/bin/env node
/**
 * The CI diagnostics must actually say what failed.
 *
 * WHY THIS EXISTS
 *
 * A failing CI step writes the reason into stdout, and nowhere else.
 * When the step log endpoint is unreachable — as it is from the
 * operator's environment — that reason is invisible: the check fails
 * and says only "exit code 1". `print-error-annotation.mjs` fixes that
 * by republishing the log's TAIL, which is right for a crash but wrong
 * for a test suite: the tail of a test run is its summary, and the
 * failing assertion can be hundreds of lines earlier in the file.
 *
 * So `print-test-failure-annotation.mjs` reads the TAP stream and
 * pulls out the failing blocks. This suite pins that behaviour, because
 * a diagnostics script that silently finds nothing is worse than none:
 * it makes a failure look unexplained.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'print-test-failure-annotation.mjs');

function runWith(logText) {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-annot-'));
  const file = path.join(dir, 'tap.log');
  if (logText !== null) writeFileSync(file, logText);
  return execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
}

test('it names the failing test and quotes its diagnostic', () => {
  const log = [
    'TAP version 13',
    '# Subtest: a passing test',
    'ok 1 - a passing test',
    '# Subtest: the migration chain claim is the chain that is actually there',
    'not ok 2 - the migration chain claim is the chain that is actually there',
    '  ---',
    '  duration_ms: 0.2',
    "  error: 'the record must quote the real chain (101 files, 101 unique versions)'",
    '  expected: true',
    '  actual: false',
    '  ...',
    '1..2',
    '# tests 2',
    '# pass 1',
    '# fail 1',
  ].join('\n');

  const out = runWith(log);
  assert.match(out, /not ok 2 - the migration chain claim/);
  assert.match(out, /the record must quote the real chain/);
  // The diagnostic must survive GitHub's annotation escaping.
  assert.match(out, /%0A/, 'the multi-line diagnostic must be escaped');
  assert.match(out, /::error::/, 'the failure must be published as an error annotation');
});

test('it reports every failure, not only the first', () => {
  const log = [
    'not ok 1 - first failure',
    '  error: first',
    '  ...',
    'not ok 2 - second failure',
    '  error: second',
    '  ...',
    '1..2',
  ].join('\n');

  const out = runWith(log);
  assert.match(out, /first failure/);
  assert.match(out, /second failure/);
});

test('it stops a failure block at the next top-level test', () => {
  // The block must not swallow the following test's result.
  const log = [
    'not ok 1 - the failing one',
    '  error: only mine',
    '  ...',
    'ok 2 - the next one',
    '  duration_ms: 1',
    '  ...',
    '1..2',
  ].join('\n');

  const out = runWith(log);
  assert.match(out, /only mine/);
  assert.doesNotMatch(out, /the next one/, 'the next test must not be pulled into the failure block');
});

test('a log with no failure says so rather than staying silent', () => {
  const out = runWith(['TAP version 13', 'ok 1 - fine', '1..1', '# fail 0'].join('\n'));
  assert.match(out, /no failing test was found/);
  assert.match(out, /::error::/, 'even "nothing found" must be an annotation, not silence');
});

test('a missing log file never fails the diagnostics step', () => {
  // This step runs with `if: failure()`. If it could fail, it would mask
  // the real failure it is meant to explain.
  const out = runWith(null);
  assert.match(out, /is missing/);
  assert.match(out, /::error::/);
});

test('it exits 0 in every case', () => {
  // execFileSync throws on a non-zero exit, so reaching here at all is
  // the assertion; this makes the intent explicit.
  for (const log of [null, 'not ok 1 - x\n  error: y\n', 'ok 1 - fine\n']) {
    assert.doesNotThrow(() => runWith(log));
  }
});
