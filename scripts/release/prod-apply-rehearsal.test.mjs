#!/usr/bin/env node
/**
 * Keeps the production-apply rehearsal honest.
 *
 * The snapshot is production's migration ledger as recorded read-only on
 * 2026-11-21 (versions only — nothing from the database contents). The release
 * plan and the rehearsal both read it, so a change in the inventory that
 * silently changes what production is missing fails here.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const LEDGER = path.join(ROOT, 'qa-evidence/day1/PRODUCTION_LEDGER_2026-11-21.txt');
const run = (...args) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });

test('the production snapshot is a version list, and the plan reads it', () => {
  const plan = JSON.parse(run('scripts/release/production-apply-plan.mjs', '--ledger', LEDGER, '--json'));
  assert.equal(plan.applied.length + plan.outOfBand.length, 160, 'ledger row count changed');
  assert.equal(plan.outOfBand.length, 52, 'out-of-band count changed');
});

test('production is 22 migrations behind this branch, and the rehearsal agrees', () => {
  const plan = JSON.parse(run('scripts/release/production-apply-plan.mjs', '--ledger', LEDGER, '--json'));
  assert.equal(plan.pending.length, 22, `pending changed: ${plan.pending.map((p) => p.file).join(', ')}`);
  const dry = run('scripts/local-pg/rehearse-prod-apply.mjs', '--ledger', LEDGER, '--dry-run');
  assert.match(dry, /pending:\s+22/);
  assert.match(dry, /replayable from ledger: 108/);
});

test('the two QR files production lacks are the renumbered ones, not the colliding versions', () => {
  const plan = JSON.parse(run('scripts/release/production-apply-plan.mjs', '--ledger', LEDGER, '--json'));
  const files = plan.pending.map((p) => p.file);
  assert.ok(files.includes('20261122000400_qr_one_active_cleanup.sql'));
  assert.ok(files.includes('20261122000500_qr_one_active_per_table.sql'));
  assert.ok(!files.some((f) => f.startsWith('20261122000100')), '20261122000100 belongs to main');
  assert.ok(!files.some((f) => f.startsWith('20261122000200')), '20261122000200 belongs to main');
});
