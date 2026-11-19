import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

test('hermetic browser inventory and strict report gate agree with Playwright collection', () => {
  const workflow = parse(readFileSync('.github/workflows/e2e.yml', 'utf8'));
  const steps = workflow.jobs['staff-shell'].steps;
  const inventory = steps.find((step) => /^Expect \d+ hermetic tests$/.test(step.name ?? ''));
  const resultGate = steps.find((step) => /^Require all \d+ hermetic browser tests/.test(step.name ?? ''));
  assert.ok(inventory && resultGate, 'both explicit inventory and results gates must exist');
  const inventoryCount = Number(inventory.name.match(/\d+/)[0]);
  assert.ok(Number.isInteger(inventoryCount) && inventoryCount > 0);
  assert.match(inventory.run, new RegExp(`Total: ${inventoryCount} tests`));
  assert.match(resultGate.run, new RegExp(`assert-playwright-results\\.mjs playwright-report/results\\.json ${inventoryCount}\\s*$`));
  assert.match(resultGate.name, /without skips\/retries/);
  const projects = ['desktop', 'phone', 'guest', 'staff', 'brand', 'responsive'];
  for (const project of projects) {
    assert.ok(inventory.run.includes(`--project=${project}`));
    assert.ok(steps.find((step) => step.name === 'Browser tests').run.includes(`--project=${project}`));
  }
  const list = spawnSync(process.execPath, [path.resolve('node_modules/@playwright/test/cli.js'), 'test', ...projects.map((p) => `--project=${p}`), '--list'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  const actual = Number(list.stdout.match(/Total: (\d+) tests in \d+ files/)?.[1]);
  assert.equal(actual, inventoryCount, 'workflow must explicitly account for every collected hermetic test');
});

test('the report gate refuses missing tests, skips, failures and flakes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hermetic-evidence-'));
  try {
    const report = path.join(dir, 'results.json');
    const script = path.resolve('scripts/e2e/assert-playwright-results.mjs');
    const good = { expected: 65, skipped: 0, unexpected: 0, flaky: 0 };
    for (const [stats, code] of [
      [good, 0],
      [{ ...good, expected: 64 }, 1],
      [{ ...good, skipped: 1 }, 1],
      [{ ...good, unexpected: 1 }, 1],
      [{ ...good, flaky: 1 }, 1],
    ]) {
      writeFileSync(report, JSON.stringify({ stats, suites: [] }));
      const result = spawnSync(process.execPath, [script, report, '65'], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
      assert.equal(result.status, code, JSON.stringify(stats));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
