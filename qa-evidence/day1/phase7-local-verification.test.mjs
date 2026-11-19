#!/usr/bin/env node
/**
 * The Phase 7 verification record must stay true.
 *
 * WHY THIS EXISTS
 *
 * The record makes claims a reader will act on: that 16 gates passed, that
 * the migration chain is 98 files, that the two PostgREST-only tests are
 * never executed, that the workflows are dispatch-only. A verification
 * document that has drifted is worse than none — it is a record that
 * something was checked when it was not.
 *
 * So this suite re-derives the claims that can be re-derived, and refuses
 * the ones that cannot. It also enforces the rule the directive states: a
 * hosted run that has not happened is BLOCKED, never PASS.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DOC = path.join(ROOT, 'qa-evidence', 'day1', 'PHASE7_LOCAL_VERIFICATION.md');
const source = readFileSync(DOC, 'utf8');

test('the record states every gate it claims, and claims no more than it has', () => {
  const gates = [
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['lint', 'npm', ['run', 'lint']],
    ['design:check', 'npm', ['run', 'design:check']],
    ['migrations:verify', 'npm', ['run', 'migrations:verify']],
    ['verify:release', 'npm', ['run', 'verify:release']],
    ['isolation:verify', 'npm', ['run', 'isolation:verify']],
    ['test:dr', 'npm', ['run', 'test:dr']],
  ];
  for (const [name, command, args] of gates) {
    assert.ok(source.includes(name), `the record must mention the ${name} gate`);
    const run = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(run.status, 0, `${name} must still pass`);
  }
});

test('the migration chain claim is the chain that is actually there', () => {
  const run = execFileSync('node', ['scripts/verify-migration-chain.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const files = Number(/(\d+) files/.exec(run)?.[1] ?? 0);
  const versions = Number(/(\d+) unique versions/.exec(run)?.[1] ?? 0);
  assert.ok(files > 0 && files === versions, 'the chain must have one version per file');
  assert.ok(
    source.includes(`${files} files, ${versions} unique versions`),
    `the record must quote the real chain (${files} files, ${versions} unique versions)`,
  );
});

test('the skipped-test accounting is exactly what vitest reports', () => {
  // The record quotes a per-file table and two totals. Re-derive all of it
  // by running the eleven database-gated files with no database: that is
  // the same state the plain unit run sees, and it takes about three
  // seconds.
  const rows = source
    .split('\n')
    .filter((line) => /^\| `[^`]+\.test\.(ts|tsx)` \| \d+ \| \d+ \|/.test(line));
  assert.ok(rows.length >= 11, `the record must break the skips down per file, saw ${rows.length}`);

  const files = rows.map((row) => row.split('|')[1].trim().replace(/`/g, ''));
  const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim());
    const file = cells[1].replace(/`/g, '');
    const runner = cells[4].replace(/`/g, '');
    assert.ok(existsSync(path.join(ROOT, file)), `${file} must exist`);
    assert.ok(
      Object.keys(scripts).some((name) => runner.includes(name)),
      `${file}'s runner "${runner}" must be a real npm script`,
    );
  }

  const run = spawnSync('npx', ['vitest', 'run', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  // Vitest colours its summary, so the escape codes sit between the number
  // and the word. Strip them before matching.
  const output = `${run.stdout ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  // The "Test Files" line also reads "N skipped (M)" — match the Tests
  // line specifically, or the file count is mistaken for the case count.
  const summary = /Tests\s+(\d+) skipped \((\d+)\)/.exec(output);
  assert.ok(summary, 'vitest must still report a skipped summary');
  const reportedSkipped = Number(summary[1]);
  const totalCases = Number(summary[2]);

  // Every per-file number in the record must be the one vitest prints.
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim());
    const file = cells[1].replace(/`/g, '');
    const cases = Number(cells[2]);
    const skipped = Number(cells[3]);
    const line = output
      .split('\n')
      .find((candidate) => candidate.includes(file) && candidate.includes('skipped'));
    assert.ok(line, `vitest must report a line for ${file}`);
    const match = /\((\d+) tests? \| (\d+) skipped\)/.exec(line);
    assert.ok(match, `vitest must report counts for ${file}`);
    assert.equal(Number(match[1]), cases, `${file}: the record says ${cases} cases`);
    assert.equal(Number(match[2]), skipped, `${file}: the record says ${skipped} skipped`);
  }

  const quotedTotal = Number((/\*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\*/.exec(source) ?? [])[1] ?? 0);
  const quotedSkipped = Number((/\*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\*/.exec(source) ?? [])[2] ?? 0);
  assert.equal(quotedTotal, totalCases, `the record's total must be ${totalCases}`);
  assert.equal(quotedSkipped, reportedSkipped, `the record's skipped total must be ${reportedSkipped}`);
});

test('the two PostgREST-only tests are still never executed', () => {
  // The claim is specific: PGRST_BIN is never wired into a vitest run, so
  // those two cases do not run in CI either.
  const workflows = readdirSync(path.join(ROOT, '.github', 'workflows'));
  for (const file of workflows) {
    const text = readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
    assert.doesNotMatch(
      text,
      /PGRST_BIN\s*[:=]/,
      `${file} now sets PGRST_BIN — the record's claim about the PostgREST tests must be updated`,
    );
  }
  assert.match(source, /never executed/);
});

test('the browser claim is still BLOCKED — ENVIRONMENT, never PASS', () => {
  assert.match(source, /BLOCKED — ENVIRONMENT/);
  assert.match(source, /113 tests in 16 files/);
  const probe = path.join(ROOT, 'scripts', 'e2e', 'check-chromium-runtime.sh');
  const result = spawnSync('bash', [probe], { encoding: 'utf8' });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  if (/not installed/.test(combined)) {
    // Chromium really is absent in this environment, so the record's
    // BLOCKED — ENVIRONMENT claim is exactly right and must not soften.
    assert.match(source, /BLOCKED — ENVIRONMENT/);
  } else {
    // Chromium IS available here — CI installs it for the browser jobs.
    // The record describes the LOCAL evidence run, so it has to say so:
    // an unscoped "Chromium is absent" would be false in this
    // environment, and a "PASS" would be false locally.
    assert.match(
      source,
      /locally|this machine|this workspace|in this environment/i,
      'the record must scope its browser claim to the environment it describes',
    );
    assert.match(source, /BLOCKED — ENVIRONMENT/);
  }
});

test('the record claims no hosted run', () => {
  assert.match(source, /No hosted system was touched/);
  assert.match(source, /BLOCKED — OWNER AUTHORIZATION REQUIRED/);
  // No gate row may claim a hosted PASS.
  const gateRows = source.split('\n').filter((line) => /^\| \d+ \| `/.test(line));
  assert.ok(gateRows.length >= 16, `every gate must be listed, saw ${gateRows.length}`);
  for (const row of gateRows) {
    // | # | gate | CI step | result | time |
    const result = row.split('|')[4] ?? '';
    assert.match(result, /\*\*PASS\*\*/, `a local gate row must state PASS: ${row.trim()}`);
    assert.doesNotMatch(
      result,
      /hosted/i,
      `a local gate row's RESULT must not claim a hosted run: ${row.trim()}`,
    );
  }
});

test('the record names the defects this phase actually fixed', () => {
  // The record claims the view-before-function defect was live on main and
  // that the drill now passes. Both are checkable.
  assert.match(source, /has_restaurant_role/);
  assert.match(source, /does not exist/);
  const drill = spawnSync('node', ['scripts/local-pg/with-embedded-postgres.mjs', 'node', 'scripts/verify-logical-restore-embedded.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.match(
    `${drill.stdout ?? ''}\n${drill.stderr ?? ''}`,
    /LOCAL_LOGICAL_RESTORE_VERIFIED/,
    'the logical restore drill must still verify',
  );
});

/**
 * Does this path exist in the repository?
 *
 * A record may legitimately cite a file that is merged into `main` but
 * not yet into this branch. That file is real, so the citation is
 * honest — but the check must NOT depend on one hard-coded ref name.
 *
 * It used to: `git cat-file -e origin/main:<path>`. A shallow CI
 * checkout has no `origin/main` ref at all, so the escape hatch failed
 * there and the guard reported a correct record as broken. That is the
 * exact failure this function exists to prevent.
 *
 * So the path is resolved against everything this clone actually knows:
 * the working tree, every ref it holds, and FETCH_HEAD. If none of them
 * has the path, the citation really is wrong.
 */
function existsInRepository(relative) {
  if (existsSync(path.join(ROOT, relative))) return true;

  const refs = spawnSync('git', ['for-each-ref', '--format=%(refname)'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const candidates = [
    ...`${refs.stdout ?? ''}`.split('\n').filter(Boolean),
    'FETCH_HEAD',
  ];
  for (const ref of candidates) {
    const probe = spawnSync('git', ['cat-file', '-e', `${ref}:${relative}`], { cwd: ROOT });
    if (probe.status === 0) return true;
  }
  return false;
}

test('the record references only files that exist', () => {
  const referenced = [...source.matchAll(/`((?:app|lib|scripts|components|e2e|qa-evidence|docs)\/[^`]+\.(?:ts|tsx|mjs|md|sh))`/g)]
    .map((match) => match[1]);

  const inBranch = referenced.filter((relative) => existsSync(path.join(ROOT, relative)));
  const crossBranch = referenced.filter((relative) => !existsSync(path.join(ROOT, relative)));

  const missing = crossBranch.filter((relative) => !existsInRepository(relative));
  assert.deepEqual(
    missing,
    [],
    `the record references files that this clone cannot find: ${missing.join(', ')}. Either the citation is wrong, or the clone lacks the ref that holds it (a shallow checkout needs "git fetch --depth=1 origin main:refs/remotes/origin/main")`,
  );

  // A cross-branch citation is only verifiable in CI if the CI checkout
  // actually has `main`. The workflow fetches it; assert that, so the
  // dependency is stated in code instead of living in a runner's
  // configuration.
  if (crossBranch.length > 0) {
    const ci = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(
      ci,
      /git fetch[^\n]*main:refs\/remotes\/origin\/main/,
      `the record cites files outside this branch (${crossBranch.join(', ')}), so ci.yml must fetch main or the shallow CI checkout cannot verify them`,
    );
  }
  assert.ok(inBranch.length > 0, 'the record must cite files that are in this branch');
});

test('the record says plainly that no migration was applied and no collision resolved', () => {
  assert.match(source, /No collision was resolved and no migration was applied/);
});
