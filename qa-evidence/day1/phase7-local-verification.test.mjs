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
  assert.match(
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    /not installed/,
    'Chromium is installed now, so the record must be corrected',
  );
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

test('the record references only files that exist', () => {
  const referenced = [...source.matchAll(/`((?:app|lib|scripts|components|e2e|qa-evidence|docs)\/[^`]+\.(?:ts|tsx|mjs|md|sh))`/g)]
    .map((match) => match[1]);
  const missing = referenced.filter((relative) => {
    if (existsSync(path.join(ROOT, relative))) return false;
    // A file merged into main but not yet into this branch is still a real
    // file, and citing it is honest as long as the record says where it is.
    const onMain = spawnSync('git', ['cat-file', '-e', `origin/main:${relative}`], { cwd: ROOT });
    return onMain.status !== 0;
  });
  assert.deepEqual(missing, [], `the record references files that do not exist: ${missing.join(', ')}`);
});

test('the record says plainly that no migration was applied and no collision resolved', () => {
  assert.match(source, /No collision was resolved and no migration was applied/);
});
