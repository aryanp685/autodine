/**
 * Unit tests for the scheduled-backup orchestrator's decision logic and
 * fail-closed guard rails. No database, no network — the real steps are
 * covered by selftest.mjs / verify-backup-file.test.mjs / check-dr-objectives.test.mjs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectNewestBackup, ageMinutes, formatBackupAlert, BACKUP_NAME_RE } from './lib-schedule.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

describe('selectNewestBackup', () => {
  it('picks the newest matching artifact and ignores foreign files', () => {
    const now = Date.now();
    const entries = [
      { name: 'autodine-db-20261110T030000.sql.gz.enc', mtimeMs: now - 5 * 24 * 3600 * 1000 },
      { name: 'autodine-db-20261114T030000.sql.gz.enc', mtimeMs: now - 20 * 3600 * 1000 },
      { name: 'autodine-db-20261114T030000.manifest.json', mtimeMs: now + 10_000 },
      { name: 'notes.txt', mtimeMs: now + 10_000 },
      { name: 'autodine-thing.dump.enc', mtimeMs: now - 1000 },
    ];
    const newest = selectNewestBackup(entries);
    assert.equal(newest.name, 'autodine-thing.dump.enc');
    assert.equal(ageMinutes(newest.mtimeMs, now), 0);
  });

  it('returns null when there is nothing backup-shaped', () => {
    assert.equal(selectNewestBackup([]), null);
    assert.equal(selectNewestBackup([{ name: 'README.md', mtimeMs: Date.now() }]), null);
    assert.equal(selectNewestBackup([{ name: 'autodine-x.sql.gz.enc', mtimeMs: NaN }]), null);
  });

  it('requires the autodine- prefix and supported suffixes', () => {
    assert.ok(BACKUP_NAME_RE.test('autodine-a-b-c.sql.gz.enc'));
    assert.ok(BACKUP_NAME_RE.test('autodine-a.dump.enc'));
    assert.ok(!BACKUP_NAME_RE.test('other-a.sql.gz.enc'));
    assert.ok(!BACKUP_NAME_RE.test('autodine-a.sql.gz'));
  });
});

describe('ageMinutes', () => {
  it('is never negative and rounds to whole minutes', () => {
    const now = Date.now();
    assert.equal(ageMinutes(now + 60_000, now), 0);
    assert.equal(ageMinutes(now - 90_000, now), 2);
  });
});

describe('formatBackupAlert', () => {
  it('caps the detail, strips control chars and redacts connection strings', () => {
    const text = formatBackupAlert('verify', `bad\x00 input postgresql://postgres:s3cret@host.pooler.supabase.com:6543/postgres ${'x'.repeat(500)}`);
    assert.ok(!text.includes('s3cret'));
    assert.ok(!text.includes('\x00'));
    assert.ok(text.length < 400);
    assert.ok(text.startsWith('AutoDine scheduled backup FAILED at verify'));
  });
});

describe('run-scheduled.mjs fail-closed guards', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [path.join(scriptDir, 'run-scheduled.mjs'), ...args], {
    env: { ...process.env, ...env, BACKUP_ALERT_WEBHOOK: '', DR_ALERT_WEBHOOK: '' },
    encoding: 'utf8',
    timeout: 30_000,
  });

  it('exits 2 with usage when --out-dir is missing', () => {
    const result = run([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage/);
  });

  it('exits 1 when the backup step cannot run (no source configured), before any verify', () => {
    const result = run(['--out-dir', '/tmp/autodine-run-scheduled-test-nosrc'], {
      AUTODINE_BACKUP_SOURCE_URL: '',
      AUTODINE_BACKUP_PASSPHRASE: '',
      AUTODINE_BACKUP_OUT_DIR: '',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAILED at backup/);
  });
});
