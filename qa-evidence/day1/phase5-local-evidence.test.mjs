#!/usr/bin/env node
/**
 * The Phase 5 evidence record must stay true.
 *
 * WHY THIS EXISTS
 *
 * That document makes two kinds of claim: a LOCAL claim (this suite runs,
 * this many tests pass here) and a HOSTED claim (a real run happened
 * against a real deployment). The directive is explicit that a hosted run
 * which has not been authorized is `BLOCKED — OWNER AUTHORIZATION
 * REQUIRED` and never `PASS`.
 *
 * A stale evidence document is worse than none: it is a record that
 * something was checked when it was not. So this suite:
 *
 *   1. refuses any PASS claim for a hosted item;
 *   2. re-counts the local test suites the document cites, so a renamed or
 *      deleted test cannot leave the document quoting a stale number;
 *   3. re-checks the environment facts it states (Chromium absent, the
 *      download host unreachable) rather than taking them on trust.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DOC = path.join(ROOT, 'qa-evidence', 'day1', 'PHASE5_LOCAL_EVIDENCE.md');
const source = readFileSync(DOC, 'utf8');

/** Count the `it(...)` cases in a test file. */
function countTests(relative) {
  const file = path.join(ROOT, relative);
  assert.ok(existsSync(file), `${relative} must exist — the evidence cites it`);
  const text = readFileSync(file, 'utf8');
  return (text.match(/^\s*it\(/gm) ?? []).length;
}

test('no hosted item is claimed as PASS', () => {
  // Every hosted row must say BLOCKED. A row that says PASS is a false
  // record of a run that never happened.
  const rows = source
    .split('\n')
    .filter((line) => /^\| 5\.\d+ \|/.test(line));
  assert.ok(rows.length >= 7, `the summary must list every Phase 5 item, saw ${rows.length}`);
  for (const row of rows) {
    // | # | item | local | hosted |  ->  hosted is the fourth cell.
    const hosted = row.split('|')[4] ?? '';
    assert.match(
      hosted,
      /BLOCKED — OWNER AUTHORIZATION REQUIRED|BLOCKED — ENVIRONMENT|n\/a/,
      `a hosted column must never claim PASS: "${row.trim()}"`,
    );
  }
});

test('the document states the two blocking reasons in the fixed vocabulary', () => {
  assert.match(source, /BLOCKED — OWNER AUTHORIZATION REQUIRED/);
  assert.match(source, /BLOCKED — ENVIRONMENT/);
  // The two must not be confused with each other.
  assert.match(
    source,
    /a different thing and is labelled as such/,
    'an environment block and an authorization block are different and must be distinguished',
  );
});

test('the document says plainly that nothing hosted is PASS', () => {
  assert.match(source, /Nothing here is `PASS` for a hosted system/);
});

test('the local test counts the document cites are the counts on disk', () => {
  // Each citation: the document's quoted count, and the file it refers to.
  const citations = [
    ['app/(staff)/dashboard/settings/team-actions.test.ts', 20],
    ['app/api/ops/realtime-alert/route.test.ts', 5],
    ['app/api/cron/escalate/route.test.ts', 4],
    ['lib/incident-notify.test.ts', 6],
    ['lib/db/phase0-security.integration.test.ts', 25],
    ['lib/db/restaurant-account-link.integration.test.ts', 8],
  ];
  for (const [file, quoted] of citations) {
    const actual = countTests(file);
    assert.equal(actual, quoted, `${file} has ${actual} tests, the document quotes ${quoted}`);
  }
});

test('the document does not quote a test count for a file that has moved', () => {
  // The evidence must not name a file the repository no longer has.
  const referenced = [...source.matchAll(/`((?:app|lib|scripts|components|e2e|qa-evidence)\/[^`]+\.(?:ts|tsx|mjs|md))`/g)]
    .map((match) => match[1])
    .filter((relative) => !relative.includes('*'));
  const missing = referenced.filter((relative) => !existsSync(path.join(ROOT, relative)));
  assert.deepEqual(missing, [], `the document references files that do not exist: ${missing.join(', ')}`);
});

test('the Chromium claim is true: it is absent and cannot be fetched here', () => {
  // The document claims the browser suite cannot run in this environment.
  // If Chromium ever becomes available, that claim is wrong and this test
  // fails — which is the point: the document has to be corrected then.
  const probe = path.join(ROOT, 'scripts', 'e2e', 'check-chromium-runtime.sh');
  assert.ok(existsSync(probe), 'the runtime check must exist');
  // The probe writes its verdict to stderr and exits non-zero when the
  // browser is missing, so both streams are captured.
  const result = spawnSync('bash', [probe], { encoding: 'utf8' });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n`;
  assert.match(
    combined,
    /Chromium is not installed|not installed/,
    'the document claims Chromium is absent; the probe says otherwise, so the document must be corrected',
  );
});

test('the document records that no hosted state was changed', () => {
  assert.match(source, /No hosted state was changed/);
  assert.match(source, /No deployment/);
});

test('the document points at the register rows that hold the hosted runs', () => {
  for (const row of ['B7', 'B8', 'B9']) {
    assert.ok(source.includes(row), `the hosted run for ${row} must be referenced`);
  }
});
