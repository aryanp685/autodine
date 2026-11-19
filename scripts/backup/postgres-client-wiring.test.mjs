#!/usr/bin/env node
/**
 * Wiring test for the PostgreSQL client composite action.
 *
 * The action's own suite (postgres-client-action.test.mjs) proves the two
 * shell scripts behave. This suite proves they are WIRED correctly:
 *
 *   - both hosted workflows reference the action by its local path;
 *   - both pin the same major version, so a dump and its restore use one
 *     client (a custom-format dump from a newer pg_dump carries an archive
 *     format the older pg_restore refuses);
 *   - the action's inputs actually reach the scripts — the step bodies are
 *     executed here with the same substitutions GitHub performs;
 *   - the inputs travel through the environment, not spliced into the
 *     script text.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ACTION_DIR = path.join(ROOT, '.github', 'actions', 'postgres-client');
const ACTION_YML = path.join(ACTION_DIR, 'action.yml');
const HOSTED_WORKFLOWS = [
  path.join(ROOT, '.github', 'workflows', 'hosted-backup.yml'),
  path.join(ROOT, '.github', 'workflows', 'hosted-restore-drill.yml'),
];

/** The composite-action step in a hosted workflow, if present. */
function actionStep(workflowPath) {
  const doc = parseYaml(readFileSync(workflowPath, 'utf8'));
  const job = Object.values(doc.jobs ?? {})[0];
  const step = (job?.steps ?? []).find((s) => s.uses === './.github/actions/postgres-client');
  return step ? { step, workflowName: doc.name } : null;
}

test('both hosted workflows use the composite action by its local path', () => {
  for (const workflowPath of HOSTED_WORKFLOWS) {
    const found = actionStep(workflowPath);
    assert.ok(found, `${path.basename(workflowPath)} must install the PostgreSQL client`);
    assert.equal(found.step.with?.version, '17', `${path.basename(workflowPath)} must pin version 17`);
  }
});

test('both hosted workflows pin the SAME major version', () => {
  const versions = HOSTED_WORKFLOWS.map((p) => actionStep(p)?.step.with?.version);
  assert.equal(new Set(versions).size, 1, `the two workflows disagree: ${versions.join(' vs ')}`);
});

test('the action step runs after checkout, so $GITHUB_ACTION_PATH exists', () => {
  for (const workflowPath of HOSTED_WORKFLOWS) {
    const doc = parseYaml(readFileSync(workflowPath, 'utf8'));
    const steps = Object.values(doc.jobs ?? {})[0]?.steps ?? [];
    const checkout = steps.findIndex((s) => String(s.uses ?? '').startsWith('actions/checkout'));
    const action = steps.findIndex((s) => s.uses === './.github/actions/postgres-client');
    assert.ok(checkout >= 0, `${path.basename(workflowPath)} must check out the repository`);
    assert.ok(action > checkout, `${path.basename(workflowPath)} must check out before using a local action`);
  }
});

test('the action passes its inputs through the environment, not inline text', () => {
  const doc = parseYaml(readFileSync(ACTION_YML, 'utf8'));
  for (const step of doc.runs.steps) {
    const body = step.run ?? '';
    // No ${{ ... }} may be spliced into the shell text: an expression is
    // substituted before bash parses the line, so inlining would let a
    // crafted value break out of the quoting.
    assert.doesNotMatch(body, /\$\{\{/, `${step.name} must not inline an expression into shell text`);
    // The values the scripts need must arrive as environment variables.
    assert.ok(step.env?.PG_CLIENT_VERSION, `${step.name} must pass PG_CLIENT_VERSION through env`);
  }
});

test('the action scripts exist, are executable and are referenced by the action', () => {
  const doc = parseYaml(readFileSync(ACTION_YML, 'utf8'));
  const body = doc.runs.steps.map((s) => s.run ?? '').join('\n');
  for (const script of ['install-client.sh', 'verify-client.sh']) {
    const file = path.join(ACTION_DIR, script);
    assert.ok(body.includes(script), `the action must run ${script}`);
    const stat = spawnSync('test', ['-x', file]);
    assert.equal(stat.status, 0, `${script} must be executable (it is invoked directly)`);
  }
});

/**
 * Executes the action's verify step the way GitHub does: the step body is
 * read from action.yml, the inputs are substituted through the environment
 * exactly as the step declares them, and the body runs under bash.
 */
function runVerifyStep({ version, binDir }) {
  const doc = parseYaml(readFileSync(ACTION_YML, 'utf8'));
  const step = doc.runs.steps.find((s) => s.name.includes('Verify'));
  const githubPath = path.join(binDir, '..', 'github-path');
  writeFileSync(githubPath, '');
  const result = spawnSync('bash', ['-c', step.run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_ACTION_PATH: ACTION_DIR,
      GITHUB_PATH: githubPath,
      PG_CLIENT_VERSION: version,
      PG_CLIENT_BIN_DIR: binDir,
    },
  });
  return { ...result, githubPath };
}

/** A bin dir holding stand-in client binaries reporting `version`. */
function makeBinDir(version = '17.6') {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-pgwire-'));
  for (const tool of ['psql', 'pg_restore']) {
    const file = path.join(dir, tool);
    writeFileSync(file, `#!/bin/sh\necho "${tool} (PostgreSQL) ${version}"\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

test('the action\'s verify step, run as GitHub runs it, accepts the pinned version', () => {
  const binDir = makeBinDir('17.6');
  try {
    const result = runVerifyStep({ version: '17', binDir });
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    assert.match(result.stdout, /is PostgreSQL 17/);
    assert.ok(readFileSync(result.githubPath, 'utf8').includes(binDir));
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('the action\'s verify step, run as GitHub runs it, refuses a mismatch', () => {
  const binDir = makeBinDir('16.4');
  try {
    const result = runVerifyStep({ version: '17', binDir });
    assert.notEqual(result.status, 0, 'a mismatched client must fail the job');
    assert.match(result.stderr, /is PostgreSQL 16, expected 17/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('the action\'s default bin-dir matches the PGDG package layout', () => {
  const doc = parseYaml(readFileSync(ACTION_YML, 'utf8'));
  assert.equal(doc.inputs['bin-dir'].default, '/usr/lib/postgresql/17/bin');
  assert.equal(doc.inputs.version.default, '17');
});
