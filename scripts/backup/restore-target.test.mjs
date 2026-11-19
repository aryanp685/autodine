#!/usr/bin/env node
/**
 * Tests for the restore-target guard (scripts/backup/lib-restore-target.mjs)
 * and for the two scripts that use it.
 *
 * The guard decides, before any connection, whether a restore may proceed.
 * The hosted drill must only ever reach the runner's own disposable loopback
 * container. A Production project must be refused outright — no flag may
 * unlock it, because a Production restore needs its own explicit design
 * rather than being implied by a drill.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isLoopbackHost,
  knownProductionRefs,
  projectRefOf,
  projectRefKind,
  restoreTargetDecision,
} from './lib-restore-target.mjs';

const RESTORE = path.join(import.meta.dirname, 'restore-logical.mjs');
const VERIFY = path.join(import.meta.dirname, 'verify-restored-db.mjs');

const PRODUCTION_REFS = ['bdbaqpevwmgdvghszjno'];
const SCRATCH_REF = 'juwyhslzchjevqkdvwjm';

/** A loopback disposable target — the hosted drill's shape. */
const LOOPBACK = 'postgresql://postgres:drill@127.0.0.1:5432/drill';
/** A hosted Production project, direct connection. */
const PROD_DIRECT = `postgresql://postgres:${'p'.repeat(12)}@db.${PRODUCTION_REFS[0]}.supabase.co:5432/postgres`;
/** A hosted Production project, pooled connection (ref lives in the user name). */
const PROD_POOLED = `postgresql://postgres.${PRODUCTION_REFS[0]}:${'p'.repeat(12)}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
/** A hosted scratch project, direct connection. */
const SCRATCH_DIRECT = `postgresql://postgres:${'p'.repeat(12)}@db.${SCRATCH_REF}.supabase.co:5432/postgres`;

test('loopback hosts are recognised', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, `${host} must count as loopback`);
  }
  for (const host of ['10.0.0.1', 'db.example.supabase.co', '', '127.0.0.1.evil.test']) {
    assert.equal(isLoopbackHost(host), false, `${host} must not count as loopback`);
  }
});

test('the project ref is read from direct and pooled connections', () => {
  assert.equal(projectRefOf(SCRATCH_DIRECT), SCRATCH_REF);
  assert.equal(projectRefKind(SCRATCH_DIRECT), 'direct');
  assert.equal(projectRefOf(`postgresql://postgres.${SCRATCH_REF}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`), SCRATCH_REF);
  assert.equal(projectRefKind(`postgresql://postgres.${SCRATCH_REF}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`), 'pooled');
  assert.equal(projectRefOf(`postgresql://${SCRATCH_REF}.postgres:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`), SCRATCH_REF);
  assert.equal(projectRefOf(LOOPBACK), '');
});

test('a loopback disposable target is allowed with no extra ceremony', () => {
  const decision = restoreTargetDecision({ targetUrl: LOOPBACK, productionRefs: PRODUCTION_REFS });
  assert.equal(decision.allowed, true);
});

test('a hosted target is refused without a scratch opt-in', () => {
  const decision = restoreTargetDecision({
    targetUrl: SCRATCH_DIRECT,
    expectedRef: SCRATCH_REF,
    productionRefs: PRODUCTION_REFS,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /explicit scratch opt-in/);
});

test('a scratch opt-in alone is not enough — the approved ref must be present', () => {
  const decision = restoreTargetDecision({
    targetUrl: SCRATCH_DIRECT,
    allowScratch: true,
    productionRefs: PRODUCTION_REFS,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /approved project ref/);
});

test('a scratch opt-in with a mismatching ref is refused', () => {
  const decision = restoreTargetDecision({
    targetUrl: SCRATCH_DIRECT,
    allowScratch: true,
    expectedRef: 'aaaaaaaaaaaaaaaaaaaa',
    productionRefs: PRODUCTION_REFS,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not the approved project/);
});

test('a scratch opt-in with the matching ref is allowed', () => {
  const decision = restoreTargetDecision({
    targetUrl: SCRATCH_DIRECT,
    allowScratch: true,
    expectedRef: SCRATCH_REF,
    productionRefs: PRODUCTION_REFS,
  });
  assert.equal(decision.allowed, true);
});

test('a Production project is refused outright — no opt-in unlocks it', () => {
  for (const target of [PROD_DIRECT, PROD_POOLED]) {
    const decision = restoreTargetDecision({
      targetUrl: target,
      allowScratch: true,
      expectedRef: PRODUCTION_REFS[0],
      productionRefs: PRODUCTION_REFS,
    });
    assert.equal(decision.allowed, false, 'Production must never be restorable');
    assert.match(decision.reason, /PRODUCTION project/);
    assert.match(decision.reason, /its own explicit design/);
  }
});

test('a Production ref named as the expected ref still does not unlock it', () => {
  const decision = restoreTargetDecision({
    targetUrl: PROD_DIRECT,
    allowScratch: true,
    expectedRef: PRODUCTION_REFS[0],
    productionRefs: [],
  });
  // The known Production ref is refused from the repository's own source of
  // truth, so declaring it as the approved ref cannot unlock it either.
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /PRODUCTION project/);
});

test('the known Production refs come from the repository source of truth', () => {
  const file = JSON.parse(readFileSync(path.join(process.cwd(), 'lib/supabase/production-projects.json'), 'utf8'));
  for (const ref of file.productionProjectRefs) {
    assert.ok(
      knownProductionRefs().includes(ref),
      `the guard must refuse ${ref} without any environment variable`,
    );
  }
});

test('a hosted target whose ref cannot be determined fails closed', () => {
  const decision = restoreTargetDecision({
    targetUrl: 'postgresql://user:pw@db.example.invalid:5432/postgres',
    allowScratch: true,
    expectedRef: SCRATCH_REF,
    productionRefs: PRODUCTION_REFS,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /could not be determined/);
});

test('a malformed target is refused', () => {
  const decision = restoreTargetDecision({ targetUrl: 'not a url', productionRefs: PRODUCTION_REFS });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not a valid connection string/);
});

test('the refusal never carries the URL, the user name or the password', () => {
  const secret = 'sup3r-s3cret-passphrase';
  const decision = restoreTargetDecision({
    targetUrl: `postgresql://postgres:${secret}@db.${PRODUCTION_REFS[0]}.supabase.co:5432/postgres`,
    allowScratch: true,
    expectedRef: PRODUCTION_REFS[0],
    productionRefs: PRODUCTION_REFS,
  });
  assert.equal(decision.allowed, false);
  assert.doesNotMatch(decision.reason, new RegExp(secret));
  assert.doesNotMatch(decision.reason, /postgres:/);
  assert.doesNotMatch(decision.reason, /postgresql:\/\//);
});

/** Runs restore-logical.mjs far enough to exercise the target guard. */
function runRestore({ targetUrl, env = {}, args = [] }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-guard-'));
  const artifact = path.join(dir, 'backup.sql.gz.enc');
  // A file that is not a valid encrypted artifact: the guard must fire
  // BEFORE decryption, so the run fails with the guard's message and not
  // with a decryption error.
  writeFileSync(artifact, 'not-encrypted');
  const result = spawnSync(process.execPath, [RESTORE, '--file', artifact, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTODINE_RESTORE_TARGET_URL: targetUrl,
      AUTODINE_BACKUP_PASSPHRASE: 'unit-test-placeholder',
      ...env,
    },
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test('restore-logical.mjs refuses a Production target before decrypting anything', () => {
  const result = runRestore({ targetUrl: PROD_DIRECT });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PRODUCTION project/);
  assert.doesNotMatch(result.stderr, /sha256|decrypt|password/i);
});

test('restore-logical.mjs refuses a hosted target without the scratch opt-in', () => {
  const result = runRestore({ targetUrl: SCRATCH_DIRECT });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit scratch opt-in/);
});

test('restore-logical.mjs accepts a loopback disposable target', () => {
  // The guard passes, so the run proceeds and fails later on the (fake)
  // artifact — proving the guard did not block it.
  const result = runRestore({ targetUrl: LOOPBACK });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /refusing the hosted restore target/);
  assert.doesNotMatch(result.stderr, /PRODUCTION project/);
});

test('restore-logical.mjs never prints the target URL', () => {
  const result = runRestore({ targetUrl: PROD_DIRECT });
  assert.doesNotMatch(result.stderr, /supabase\.co\/|postgresql:\/\//);
  assert.doesNotMatch(result.stderr, /passphrase/);
});

/** Runs verify-restored-db.mjs far enough to exercise the target guard. */
function runVerify({ targetUrl, env = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-guard-verify-'));
  const manifest = path.join(dir, 'backup.manifest.json');
  const artifact = path.join(dir, 'backup.sql.gz.enc');
  writeFileSync(manifest, '{}');
  writeFileSync(artifact, 'not-encrypted');
  const result = spawnSync(process.execPath, [VERIFY, '--manifest', manifest, '--artifact', artifact], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTODINE_RESTORE_TARGET_URL: targetUrl,
      ...env,
    },
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test('verify-restored-db.mjs refuses a Production target with exit 2', () => {
  const result = runVerify({ targetUrl: PROD_DIRECT, env: { AUTODINE_RESTORE_PRODUCTION_REFS: PRODUCTION_REFS.join(',') } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REFUSING non-disposable target/);
  assert.match(result.stderr, /PRODUCTION project/);
});

test('verify-restored-db.mjs still refuses a non-loopback target with the original wording', () => {
  const result = runVerify({ targetUrl: 'postgresql://postgres:pw@db.somewhere.example:5432/postgres' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REFUSING non-disposable target/);
});
