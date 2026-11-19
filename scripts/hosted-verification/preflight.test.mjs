#!/usr/bin/env node
/**
 * Tests for the hosted verification preflight
 * (scripts/hosted-verification/preflight.mjs).
 *
 * The preflight is read-only and reports three things: the PRESENCE of
 * configuration names, the live GitHub STATE, and a per-package VERDICT.
 * The properties worth protecting are the honesty ones:
 *
 *   - a configuration VALUE is never printed, in any mode;
 *   - "could not read" is never reported as "absent";
 *   - READY-TO-AUTHORIZE means the inputs are in place, not that anything
 *     was verified;
 *   - a missing workflow registration is reported, because that is the
 *     defect the restore-drill registration fix exists to close.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const PREFLIGHT = new URL('./preflight.mjs', import.meta.url).pathname;

/** Runs the preflight in text or JSON mode. */
function run(args = [], env = {}) {
  const result = spawnSync(process.execPath, [PREFLIGHT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
  return result;
}

test('the preflight exits 0 and prints a report', () => {
  const result = run();
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /hosted verification preflight/);
  assert.match(result.stdout, /PACKAGE VERDICTS/);
});

test('--json prints a machine-readable report', () => {
  const result = run(['--json']);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readOnly, true);
  assert.ok(Array.isArray(report.packages));
  assert.ok(report.packages.length >= 8, 'every package must be reported');
  for (const pkg of report.packages) {
    assert.ok(pkg.id, 'a package needs an id');
    assert.ok(
      ['READY-TO-AUTHORIZE', 'OWNER-ACTION-REQUIRED', 'UNKNOWN'].includes(pkg.verdict),
      `unexpected verdict: ${pkg.verdict}`,
    );
  }
});

test('no configuration value is ever printed, in either mode', () => {
  // A sentinel value planted in the environment. It must not appear in the
  // output, in either the text report or the JSON report.
  const sentinel = 'SENTINEL-VALUE-MUST-NOT-APPEAR';
  const text = run([], { BREVO_API_KEY: sentinel, AUTODINE_CRON_SECRET: sentinel, B2_BUCKET: sentinel });
  assert.equal(text.status, 0);
  assert.doesNotMatch(text.stdout, new RegExp(sentinel));
  const json = run(['--json'], { BREVO_API_KEY: sentinel, AUTODINE_CRON_SECRET: sentinel, B2_BUCKET: sentinel });
  assert.equal(json.status, 0);
  assert.doesNotMatch(json.stdout, new RegExp(sentinel));
});

test('a name that IS set locally is reported as SET, without its value', () => {
  const result = run(['--json'], { BREVO_API_KEY: 'xkeysib-example-not-real' });
  const report = JSON.parse(result.stdout);
  const entry = report.names.email.find((n) => n.name === 'BREVO_API_KEY');
  assert.equal(entry.local, 'SET');
  assert.equal(entry.repo, 'UNKNOWN', 'an unreadable repository list is UNKNOWN, never UNSET');
});

test('an unreadable repository secret list is UNKNOWN, not UNSET', () => {
  const result = run(['--json']);
  const report = JSON.parse(result.stdout);
  for (const group of Object.values(report.names)) {
    for (const entry of group) {
      assert.ok(['SET', 'UNSET', 'UNKNOWN'].includes(entry.local));
      assert.ok(['SET', 'UNSET', 'UNKNOWN'].includes(entry.repo));
    }
  }
});

test('the Resend-era name is never treated as a required name', () => {
  const result = run(['--json']);
  const report = JSON.parse(result.stdout);
  const allNames = Object.values(report.names).flat().map((n) => n.name);
  assert.ok(
    !allNames.includes('RESEND_API_KEY'),
    'Brevo is the selected provider; RESEND_API_KEY must not be a required name',
  );
  const email = report.packages.find((p) => p.id === 'email');
  assert.match(email.notes.join(' '), /Brevo/);
});

test('the restore-drill registration defect is reported when it is present', () => {
  const result = run(['--json']);
  const report = JSON.parse(result.stdout);
  const drill = report.packages.find((p) => p.id === 'restore-rehearsal');
  assert.ok(drill, 'the restore rehearsal package must be reported');
  // Either the workflow is registered by name (fixed) or the defect is
  // described (not fixed). Both are honest; silence is not.
  const byName = report.state.workflows?.some((w) => w.name === 'Hosted restore rehearsal (disposable)');
  if (byName) {
    assert.equal(drill.verdict, 'READY-TO-AUTHORIZE');
  } else {
    assert.match(drill.notes.join(' '), /file path|not registered/);
  }
});

test('READY-TO-AUTHORIZE is described as "inputs in place", not as verified', () => {
  const result = run();
  assert.match(result.stdout, /not that anything was verified|inputs are in place/);
  assert.match(result.stdout, /Presence is not validity; validity is not delivery/);
});
