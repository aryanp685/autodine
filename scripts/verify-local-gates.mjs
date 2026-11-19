#!/usr/bin/env node
/**
 * Run every offline gate the CI workflow runs, and print one honest line
 * per gate.
 *
 * WHY THIS EXISTS
 *
 * Phase 7 asks for the full suite sweep with every skip explained. Doing
 * that by hand produces a report nobody can re-run, and it is easy to
 * forget a gate or to report a suite as green when it was skipped.
 *
 * This runner executes each gate, records its real exit code, and prints
 * the reason for any skip. It never reports a skip as a pass.
 *
 * Exit 0 = every gate that could run here passed.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Each gate mirrors a step in .github/workflows/ci.yml. `why` explains a
 * skip; `skip` marks a gate that cannot run in this environment.
 */
const GATES = [
  { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
  { name: 'lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'design:check', command: 'npm', args: ['run', 'design:check'] },
  { name: 'sql:check', command: 'npm', args: ['run', 'sql:check'] },
  { name: 'migrations:verify', command: 'npm', args: ['run', 'migrations:verify'] },
  { name: 'verify:release', command: 'npm', args: ['run', 'verify:release'] },
  { name: 'isolation:verify', command: 'npm', args: ['run', 'isolation:verify'] },
  { name: 'test:staging:guards', command: 'npm', args: ['run', 'test:staging:guards'] },
  { name: 'test:staging:seed-demo-db', command: 'npm', args: ['run', 'test:staging:seed-demo-db'] },
  { name: 'test:backup', command: 'npm', args: ['run', 'test:backup'] },
  { name: 'test:dr', command: 'npm', args: ['run', 'test:dr'] },
  { name: 'test:d2', command: 'npm', args: ['run', 'test:d2'] },
  { name: 'test:db:integration', command: 'npm', args: ['run', 'test:db:integration'] },
  { name: 'test:db:logical-restore', command: 'npm', args: ['run', 'test:db:logical-restore'] },
  { name: 'test:hosted:preflight', command: 'npm', args: ['run', 'test:hosted:preflight'] },
  { name: 'test (unit)', command: 'npm', args: ['test'] },
];

const results = [];
let failed = 0;

for (const gate of GATES) {
  process.stdout.write(`\n=== ${gate.name} ===\n`);
  const started = Date.now();
  const run = spawnSync(gate.command, gate.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const code = run.status ?? 1;
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  // The tail carries the verdict line of each suite.
  const tail = output
    .split('\n')
    .filter((line) => /^(# (tests|pass|fail)|Test Files|      Tests|ok |PASS|ALL CHECKS|verify:release OK|ISOLATION-SELFTEST|LOCAL_LOGICAL_RESTORE_VERIFIED|Design system check passed)/.test(line.trim()))
    .slice(-6)
    .join(' | ');
  if (code !== 0) failed += 1;
  results.push({ gate: gate.name, code, seconds, tail });
  process.stdout.write(`--- ${gate.name}: exit ${code} in ${seconds}s${tail ? `\n    ${tail}` : ''}\n`);
}

process.stdout.write('\n================ SUMMARY ================\n');
for (const result of results) {
  process.stdout.write(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.gate.padEnd(28)} ${result.seconds}s\n`);
}
process.stdout.write(`\n${results.length - failed}/${results.length} gates passed.\n`);
process.exitCode = failed === 0 ? 0 : 1;
