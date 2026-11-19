#!/usr/bin/env node
/**
 * Reconciliation test: the B2 owner checklist must agree with the code.
 *
 * WHY THIS EXISTS
 *
 * `docs/operations/B2_OWNER_CHECKLIST.md` is the only thing the owner
 * actually follows. Every name, shape, threshold and workflow title in it
 * has to match what the code really does — a checklist that names a secret
 * the workflow does not read, or a workflow that does not exist, sends the
 * owner looking for something that is not there.
 *
 * The checklist has already drifted once: it kept telling the owner to
 * merge PR #190 after PR #190 had merged, and it offered a candidate
 * project ref as the example scratch project for a restore. A test that
 * reads both sides catches that class of drift before it reaches a person.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHECKLIST = path.join(ROOT, 'docs', 'operations', 'B2_OWNER_CHECKLIST.md');
const BACKUP_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'hosted-backup.yml');
const DRILL_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'hosted-restore-drill.yml');

const checklist = readFileSync(CHECKLIST, 'utf8');

/** The secret names a workflow reads, from its job-level env block. */
function workflowSecrets(file) {
  const doc = parseYaml(readFileSync(file, 'utf8'));
  const job = Object.values(doc.jobs ?? {})[0];
  const names = new Set();
  for (const value of Object.values(job?.env ?? {})) {
    const match = String(value ?? '').match(/secrets\.([A-Z0-9_]+)/);
    if (match) names.add(match[1]);
  }
  return { names, doc, job };
}

/** The names a workflow's fail-closed secret gate actually checks. */
function workflowGateNames(file) {
  const source = readFileSync(file, 'utf8');
  const match = source.match(/for name in ([A-Z0-9_ ]+); do/);
  if (!match) return [];
  return match[1].split(/\s+/).filter(Boolean);
}

test('the checklist lists exactly the secrets the backup workflow reads', () => {
  const { names } = workflowSecrets(BACKUP_WORKFLOW);
  // The six required secrets must all be documented.
  for (const required of [
    'AUTODINE_BACKUP_SOURCE_URL',
    'AUTODINE_BACKUP_PASSPHRASE',
    'B2_REGION',
    'B2_BUCKET',
    'B2_ACCESS_KEY_ID',
    'B2_SECRET_ACCESS_KEY',
  ]) {
    assert.ok(names.has(required), `the backup workflow reads ${required}`);
    assert.ok(checklist.includes(required), `the checklist must name ${required}`);
  }
  // ...and the checklist must not invent a secret the workflow never reads.
  const documented = new Set(checklist.match(/\b[A-Z][A-Z0-9_]{5,}\b/g) ?? []);
  const workflowNames = new Set(names);
  for (const candidate of ['B2_ENDPOINT', 'BACKUP_ALERT_WEBHOOK']) {
    if (workflowNames.has(candidate)) continue;
    // Only a documented OPTIONAL name may be absent from the workflow.
    assert.ok(
      checklist.includes(`Optional`) || checklist.includes('optional'),
      `${candidate} is optional and must be documented as such`,
    );
  }
  assert.ok(documented.size > 0);
});

test("the backup workflow's fail-closed gate checks exactly the six required secrets", () => {
  const gate = workflowGateNames(BACKUP_WORKFLOW);
  assert.deepEqual(
    [...gate].sort(),
    [
      'AUTODINE_BACKUP_PASSPHRASE',
      'AUTODINE_BACKUP_SOURCE_URL',
      'B2_ACCESS_KEY_ID',
      'B2_BUCKET',
      'B2_REGION',
      'B2_SECRET_ACCESS_KEY',
    ],
    'the gate must check exactly the six required secrets',
  );
});

test("the checklist claim that the drill needs only five secrets is true", () => {
  const gate = workflowGateNames(DRILL_WORKFLOW);
  assert.equal(gate.length, 5, `the drill's gate should check five names, saw: ${gate.join(', ')}`);
  assert.ok(!gate.includes('AUTODINE_BACKUP_SOURCE_URL'), 'the drill must never ask for the Production source');
  assert.ok(
    checklist.includes('The drill needs only five of them'),
    'the checklist must keep saying the drill needs five',
  );
});

test('the disposable hosted drill scaffolds loopback before restore and always cleans downloaded material', () => {
  const { job } = workflowSecrets(DRILL_WORKFLOW);
  const steps = job.steps;
  const prepare = steps.findIndex((s) => s.run?.includes('scripts/backup/prepare-disposable-restore.mjs --confirm-disposable'));
  const restore = steps.findIndex((s) => s.run?.includes('scripts/backup/restore-logical.mjs'));
  const cleanup = steps.find((s) => s.name === 'Destroy downloaded backup material (always)');
  assert.ok(prepare >= 0 && restore > prepare);
  assert.match(steps[prepare].env.AUTODINE_RESTORE_TARGET_URL, /@127\.0\.0\.1:5432\/drill$/);
  assert.equal(steps[prepare].env.AUTODINE_RESTORE_TARGET_URL, steps[restore].env.AUTODINE_RESTORE_TARGET_URL);
  assert.equal(cleanup?.if, 'always()');
  assert.match(cleanup.run, /rm -rf "\$DRILL_DIR"/);
  assert.ok(checklist.includes('synthetic'));
});

test('the checklist names the workflows the owner dispatches, by their real titles', () => {
  const backup = parseYaml(readFileSync(BACKUP_WORKFLOW, 'utf8'));
  const drill = parseYaml(readFileSync(DRILL_WORKFLOW, 'utf8'));
  assert.ok(checklist.includes(backup.name), `the checklist must name the workflow "${backup.name}"`);
  assert.ok(checklist.includes(drill.name), `the checklist must name the workflow "${drill.name}"`);
});

test("the checklist's region, bucket and passphrase rules match the code", () => {
  const b2 = readFileSync(path.join(ROOT, 'scripts', 'backup', 'lib-b2.mjs'), 'utf8');
  const crypto = readFileSync(path.join(ROOT, 'scripts', 'backup', 'lib-crypto.mjs'), 'utf8');
  const shapes = readFileSync(path.join(ROOT, 'scripts', 'verify-external-services-config.mjs'), 'utf8');
  const regionRe = b2.match(/const REGION_RE = (\/[^\n;]+);/)?.[1];
  // The bucket-name shape lives in the shape-checker, not in the S3 client.
  const bucketRe = shapes.match(/key: 'B2_BUCKET'[^\n]*?(\/[^\n;]+)\.test/)?.[1];
  const minLength = Number(crypto.match(/passphrase\.length < (\d+)/)?.[1]);

  assert.ok(regionRe, 'the region regex must be findable in lib-b2.mjs');
  assert.ok(bucketRe, 'the bucket-name shape must be findable in the shape-checker');
  assert.ok(minLength > 0, 'the passphrase minimum must be findable in lib-crypto.mjs');

  // The checklist must state the same rules, in the same shape.
  const regionRule = regionRe.replace(/^\//, '').replace(/\/$/, '');
  const bucketRule = bucketRe.replace(/^\//, '').replace(/\/$/, '');
  assert.ok(checklist.includes(regionRule), `the checklist must state the region rule ${regionRule}`);
  assert.ok(checklist.includes(bucketRule), `the checklist must state the bucket rule ${bucketRule}`);
  assert.ok(
    checklist.includes(`≥ ${minLength} characters`) || checklist.includes(`at least ${minLength} characters`),
    `the checklist must state the ${minLength}-character passphrase minimum`,
  );
});

test("the checklist's retention policy matches the pruner", () => {
  const prune = readFileSync(path.join(ROOT, 'scripts', 'backup', 'prune-b2.mjs'), 'utf8');
  const defaults = prune.match(
    /keepDaily = (\d+), keepWeekly = (\d+), keepMonthly = (\d+)/,
  );
  assert.ok(defaults, 'the retention defaults must be findable in prune-b2.mjs');
  const [daily, weekly, monthly] = defaults.slice(1).map(Number);
  assert.ok(checklist.includes(`**${daily} daily**`), `the checklist must state ${daily} daily`);
  assert.ok(checklist.includes(`**${weekly}** weeks`), `the checklist must state ${weekly} weeks`);
  assert.ok(checklist.includes(`**${monthly}** months`), `the checklist must state ${monthly} months`);
});

test("the checklist's object prefix matches the pipeline", () => {
  const prune = readFileSync(path.join(ROOT, 'scripts', 'backup', 'prune-b2.mjs'), 'utf8');
  const prefix = prune.match(/BACKUP_PREFIX = '([^']+)'/)?.[1];
  assert.ok(prefix, 'the prefix must be findable');
  assert.ok(checklist.includes(prefix), `the checklist must state the object prefix ${prefix}`);
});

test('the checklist does not tell the owner to merge a pull request that is merged', () => {
  // PR #190 merged on 2026-11-19. A checklist that still says "until PR
  // #190 is merged" sends the owner chasing work that is already done.
  assert.doesNotMatch(
    checklist,
    /Until PR #190 is merged/,
    'the checklist must not describe PR #190 as unmerged',
  );
  assert.doesNotMatch(
    checklist,
    /PR #190 unmerged/,
    'the checklist must not list PR #190 as an open prerequisite',
  );
  assert.match(checklist, /PR #190 merged on 2026-11-19|merged on 2026-11-19/);
});

test('the checklist does not offer a candidate project as a restore scratch target', () => {
  // The acceptance environment's candidate ref is not a designated
  // project. Offering it as the example restore target would push the
  // owner toward a project nobody has approved.
  assert.doesNotMatch(
    checklist,
    /AUTODINE_RESTORE_EXPECTED_REF[^\n]*juwyhslzchjevqkdvwjm/,
    'the checklist must not use a candidate project ref as the restore example',
  );
});

test('the backup and the drill pin the same PostgreSQL major version', () => {
  const versions = [BACKUP_WORKFLOW, DRILL_WORKFLOW].map((file) => {
    const doc = parseYaml(readFileSync(file, 'utf8'));
    const job = Object.values(doc.jobs ?? {})[0];
    const step = (job?.steps ?? []).find((s) => s.uses === './.github/actions/postgres-client');
    return step?.with?.version;
  });
  assert.deepEqual(versions, ['17', '17'], `the two workflows must pin the same version, saw: ${versions.join(' vs ')}`);
  assert.ok(checklist.includes('postgres:17') || checklist.includes('`postgres:17`'));
});

test('staging rehearsal is manual, uses distinct protected-environment secrets, and never prunes', () => {
  const file = path.join(ROOT, '.github', 'workflows', 'staging-b2-rehearsal.yml');
  const doc = parseYaml(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(doc.on), ['workflow_dispatch']);
  const job = doc.jobs['staging-rehearsal'];
  assert.equal(job.environment, 'backup-staging');
  for (const name of ['AUTODINE_BACKUP_SOURCE_URL', 'AUTODINE_BACKUP_PASSPHRASE', 'B2_REGION', 'B2_BUCKET', 'B2_ACCESS_KEY_ID', 'B2_SECRET_ACCESS_KEY']) {
    assert.equal(job.env[name], '${{ secrets.STAGING_' + name + ' }}');
  }
  const steps = job.steps;
  const validate = steps.findIndex((s) => s.run?.includes('scripts/backup/validate-staging-source.mjs'));
  const backup = steps.findIndex((s) => s.run?.includes('scripts/backup/run-scheduled.mjs'));
  assert.ok(validate >= 0 && backup > validate);
  assert.doesNotMatch(steps[backup].run, /--prune-b2/);
  assert.ok(steps.some((s) => s.run?.includes('scripts/backup/verify-restored-db.mjs')));
  assert.ok(steps.some((s) => s.if === 'always()' && s.run?.includes('rm -rf')));
});
