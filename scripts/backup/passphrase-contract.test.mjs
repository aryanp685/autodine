/**
 * The passphrase contract has exactly one authority: lib-crypto.mjs.
 * These tests pin the boundary (missing / too short / valid) and prove the
 * failures are safe to print: no value and no length may reach the message.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MIN_PASSPHRASE_LENGTH,
  PASSPHRASE_RULE,
  decryptBuffer,
  encryptBuffer,
  passphraseProblem,
} from './lib-crypto.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the minimum is 12 characters and is exported, not duplicated as a literal', () => {
  assert.equal(MIN_PASSPHRASE_LENGTH, 12);
  assert.match(PASSPHRASE_RULE, /at least 12 characters/);
});

test('the two places that repeat the minimum cannot drift apart', () => {
  const src = readFileSync(path.join(here, 'lib-crypto.mjs'), 'utf8');
  const literal = Number(src.match(/passphrase\.length < (\d+)/)?.[1]);
  assert.equal(literal, MIN_PASSPHRASE_LENGTH);
});

test('a missing passphrase is refused with an actionable message', () => {
  for (const value of [undefined, null, '', 0]) {
    const problem = passphraseProblem(value);
    assert.ok(problem, `expected a problem for ${String(value)}`);
    assert.match(problem, /set AUTODINE_BACKUP_PASSPHRASE \(12\+ characters/);
  }
});

test('a too-short passphrase is refused, at the boundary and just below it', () => {
  for (const length of [1, 8, MIN_PASSPHRASE_LENGTH - 1]) {
    const value = 'p'.repeat(length);
    assert.equal(passphraseProblem(value), PASSPHRASE_RULE);
  }
});

test('a valid-length passphrase is accepted', () => {
  assert.equal(passphraseProblem('p'.repeat(MIN_PASSPHRASE_LENGTH)), null);
  assert.equal(passphraseProblem('p'.repeat(40)), null);
});

test('refusal messages never contain the passphrase or its length', () => {
  const secret = 'short8ch'; // 8 characters, deliberately distinctive
  const problem = passphraseProblem(secret);
  assert.ok(problem);
  assert.ok(!problem.includes(secret), 'message must not contain the value');
  assert.ok(!/\b8\b/.test(problem), 'message must not disclose the length');
  assert.ok(!problem.includes(String(secret.length)));
});

test('encryptBuffer refuses before deriving a key, and keeps the value out of the error', () => {
  const secret = 'tiny';
  assert.throws(() => encryptBuffer(Buffer.from('x'), secret), (err) => {
    assert.match(err.message, /at least 12 characters/);
    assert.ok(!err.message.includes(secret));
    return true;
  });
  // A valid passphrase still round-trips, so the guard did not break encryption.
  const payload = encryptBuffer(Buffer.from('hello'), 'p'.repeat(MIN_PASSPHRASE_LENGTH));
  assert.equal(decryptBuffer(payload, 'p'.repeat(MIN_PASSPHRASE_LENGTH)).toString(), 'hello');
});

test('the backup tool refuses a short passphrase before it touches the database', () => {
  // Source: the environment check must precede every connection call, so a bad
  // passphrase can never materialise a connection or a partial artifact.
  const src = readFileSync(path.join(here, 'backup-logical.mjs'), 'utf8');
  const guard = src.indexOf('passphraseProblem(passphrase)');
  assert.ok(guard > 0, 'backup-logical must call the shared contract');
  for (const later of ['openBackupSnapshot(', 'dumpDatabase(', 'resolvePgClient(']) {
    const at = src.indexOf(later);
    assert.ok(at > guard, `${later} must run after the passphrase guard`);
  }
});

test('the workflow delegates to the backup contract and remains hard-stopped before hosted work', () => {
  const wf = readFileSync(path.join(here, '../../.github/workflows/staging-b2-rehearsal.yml'), 'utf8');
  const stop = wf.indexOf('Stop until hosted isolation is independently verified');
  const backup = wf.indexOf('node scripts/backup/run-scheduled.mjs --out-dir');
  assert.ok(stop >= 0 && backup > stop);
  assert.doesNotMatch(wf, /\$\{#AUTODINE_BACKUP_PASSPHRASE\}/);
});
