/** Fixture tests for check-dr-objectives.mjs — no database required. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const DIR = mkdtempSync(path.join(tmpdir(), 'autodine-dr-test-'));
const SCRIPT = path.resolve('scripts/backup/check-dr-objectives.mjs');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

before(() => {
  writeFileSync(path.join(DIR, 'autodine-test-20261114T030000.sql.gz.enc'), Buffer.from('fixture'));
  const now = Date.now() / 1000;
  utimesSync(path.join(DIR, 'autodine-test-20261114T030000.sql.gz.enc'), now, now);
});
after(() => rmSync(DIR, { recursive: true, force: true }));

test('a fresh backup inside the RPO budget passes', () => {
  const result = run(['--backup-dir', DIR, '--rpo-minutes', '1440']);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.rpo.ok, true);
  assert.equal(body.rto.ok, null); // never invented
});

test('a stale backup misses the RPO budget and exits 1', () => {
  const old = path.join(DIR, 'autodine-test-20200101T000000.sql.gz.enc');
  writeFileSync(old, Buffer.from('fixture'));
  // Make BOTH backups ancient so the newest is older than 1 minute of budget.
  const past = new Date('2020-01-01');
  for (const f of ['autodine-test-20261114T030000.sql.gz.enc', 'autodine-test-20200101T000000.sql.gz.enc']) {
    utimesSync(path.join(DIR, f), past, past);
  }
  const result = run(['--backup-dir', DIR, '--rpo-minutes', '1']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MISSED/);
});

test('an empty directory fails, never silently passes', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'autodine-dr-empty-'));
  const result = run(['--backup-dir', empty, '--rpo-minutes', '60']);
  assert.equal(result.status, 1);
  rmSync(empty, { recursive: true, force: true });
});

test('a restore report within the RTO budget passes; beyond it fails', () => {
  const reportPath = path.join(DIR, 'restore-report.txt');
  writeFileSync(reportPath, `LOCAL_RESTORE_VERIFIED ${JSON.stringify({ tables: 1, policies: 1, functions: 1, archiveBytes: 10, elapsedMs: 30_000 })}\n`);
  const pass = run(['--backup-dir', DIR, '--rpo-minutes', '100000000', '--restore-report', reportPath, '--rto-minutes', '240']);
  // RPO passes only if newest mtime OK — both fixtures may be ancient from the
  // previous test, so use a very large RPO budget.
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(pass.stdout).rto.ok, true);

  const fail = run(['--backup-dir', DIR, '--rpo-minutes', '100000000', '--restore-report', reportPath, '--rto-minutes', '0.1']);
  assert.equal(fail.status, 1);
});

test('an unreadable restore report is reported, not ignored', () => {
  const reportPath = path.join(DIR, 'garbage.txt');
  writeFileSync(reportPath, 'not json at all');
  const result = run(['--backup-dir', DIR, '--rpo-minutes', '100000000', '--restore-report', reportPath]);
  assert.equal(result.status, 1);
});
