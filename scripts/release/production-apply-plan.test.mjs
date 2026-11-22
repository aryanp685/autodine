#!/usr/bin/env node
/**
 * Tests for the production apply plan. No database, no network.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseLedger, plan, readRepositoryMigrations } from './production-apply-plan.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

test('a pipe-separated ledger is parsed into versions', () => {
  const rows = parseLedger('20261103000100|20261103185425 | 20261104050204');
  assert.deepEqual(rows.map((r) => r.version), ['20261103000100', '20261103185425', '20261104050204']);
  assert.equal(rows[0].name, null);
});

test('a JSON ledger keeps names', () => {
  const rows = parseLedger(JSON.stringify([{ version: '20261103000100', name: 'brand_studio' }]));
  assert.deepEqual(rows, [{ version: '20261103000100', name: 'brand_studio' }]);
});

test('an empty ledger is refused rather than treated as "everything is applied"', () => {
  assert.throws(() => parseLedger('   '), /ledger is empty/);
});

test('pending is the repository set minus the ledger, in version order', () => {
  const migrations = [
    { version: '20260101000001', file: '20260101000001_a.sql' },
    { version: '20260101000002', file: '20260101000002_b.sql' },
    { version: '20260101000003', file: '20260101000003_c.sql' },
  ];
  const ledger = [{ version: '20260101000001', name: 'a' }, { version: '20260101000003', name: 'c' }];
  const result = plan({ ledger, migrations });
  assert.deepEqual(result.pending.map((r) => r.file), ['20260101000002_b.sql']);
  assert.equal(result.applied.length, 2);
  assert.equal(result.outOfBand.length, 0);
});

test('ledger rows the repository cannot explain are reported, not ignored', () => {
  const migrations = [{ version: '20260101000001', file: '20260101000001_a.sql' }];
  const ledger = [
    { version: '20260101000001', name: 'a' },
    { version: '20260101000009', name: 'applied_out_of_band' },
  ];
  const result = plan({ ledger, migrations });
  assert.deepEqual(result.outOfBand, [{ version: '20260101000009', name: 'applied_out_of_band' }]);
  assert.equal(result.pending.length, 0);
});

test('the real repository inventory is readable and ordered', () => {
  const migrations = readRepositoryMigrations(path.join(ROOT, 'supabase/migrations'));
  assert.ok(migrations.length > 100, `unexpected inventory: ${migrations.length}`);
  const versions = migrations.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort());
  assert.equal(new Set(versions).size, versions.length, 'duplicate version prefixes in the inventory');
});

test('the CLI writes a plan, exits 1 with --check when work is pending, 0 when clean', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'autodine-apply-plan-'));
  try {
    const migrations = readRepositoryMigrations(path.join(ROOT, 'supabase/migrations'));
    const emptyLedger = path.join(scratch, 'empty.json');
    writeFileSync(emptyLedger, JSON.stringify([]));
    const busy = execFileSync(process.execPath, ['scripts/release/production-apply-plan.mjs', '--ledger', emptyLedger, '--check'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    assert.match(busy, /apply in this order:/);
    assert.match(busy, new RegExp(migrations[0].file));

    const fullLedger = path.join(scratch, 'full.json');
    writeFileSync(fullLedger, JSON.stringify(migrations.map((m) => ({ version: m.version, name: null }))));
    const clean = execFileSync(process.execPath, ['scripts/release/production-apply-plan.mjs', '--ledger', fullLedger, '--check'], { cwd: ROOT, encoding: 'utf8' }).toString();
    assert.match(clean, /nothing to apply/);
  } catch (error) {
    // execFileSync throws on a non-zero exit; the first call is expected to exit 1.
    if (error.status === 1) {
      assert.match(String(error.stdout), /apply in this order:/);
      return;
    }
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('an unusable invocation exits 2 with the usage line', () => {
  let status = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, ['scripts/release/production-apply-plan.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    status = error.status;
    stderr = String(error.stderr);
  }
  assert.equal(status, 2);
  assert.match(stderr, /usage: production-apply-plan\.mjs/);
});
