import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatBackupAlert } from './lib-schedule.mjs';

test('scheduled alert formatter discards arbitrary stage and detail inputs', () => {
  const secret = 'synthetic-secret-alert';
  const text = formatBackupAlert(secret, secret, secret);
  assert.doesNotMatch(text, /synthetic-secret-alert/);
  assert.match(text, /FAILED at unknown.*operation failed/);
  assert.match(formatBackupAlert('verify', 'child', 17), /verify.*backup verification failed \(exit 17\)/);
});

test('scheduled failure paths never log or alert injected child, path, filename or response secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-scheduled-mock-'));
  try {
    const preload = path.join(dir, 'preload.mjs');
    const alerts = path.join(dir, 'alerts.jsonl');
    const secret = 'synthetic-secret-scheduled';
    writeFileSync(preload, `
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const secret = process.env.MOCK_SECRET;
const originalRead = fs.readdirSync, originalStat = fs.statSync;
let reads = 0;
fs.readdirSync = function (p, ...args) {
  if (String(p) !== process.env.MOCK_DIR) return originalRead.call(this, p, ...args);
  reads++;
  if ((process.env.MOCK_STAGE === 'verify-dir' && reads === 1) || (process.env.MOCK_STAGE === 'upload-dir' && reads === 2)) throw Error(secret);
  if ((process.env.MOCK_STAGE === 'verify-missing' && reads === 1) || (process.env.MOCK_STAGE === 'upload-missing' && reads === 2)) return [];
  return ['autodine-' + secret + '.sql.gz.enc'];
};
fs.statSync = function (p, ...args) {
  if (String(p).startsWith(process.env.MOCK_DIR + '/')) return { mtimeMs: Date.now() };
  return originalStat.call(this, p, ...args);
};
cp.spawnSync = function (_node, args, options) {
  const script = String(args[0]);
  const stage = script.endsWith('/backup-logical.mjs') ? 'backup' : script.endsWith('/verify-backup-file.mjs') ? 'verify' : script.endsWith('/check-dr-objectives.mjs') ? 'objectives' : script.endsWith('/upload-b2.mjs') ? 'upload' : script.endsWith('/prune-b2.mjs') ? 'prune' : 'unexpected';
  if (stage === 'unexpected' || options.stdio !== 'ignore' || options.env.BACKUP_ALERT_WEBHOOK || options.env.DR_ALERT_WEBHOOK) process.stderr.write(secret);
  if (process.env.MOCK_STAGE === stage + '-throw') throw new Error(secret);
  return { status: process.env.MOCK_STAGE === stage + '-status' ? secret : stage === process.env.MOCK_STAGE ? 7 : 0, stdout: secret, stderr: secret, error: new Error(secret) };
};
syncBuiltinESMExports();
globalThis.fetch = async (_url, options) => {
  fs.appendFileSync(process.env.MOCK_ALERTS, options.body + '\\n');
  if (process.env.MOCK_HTTP === 'network') throw new Error(secret);
  return { ok: process.env.MOCK_HTTP !== 'reject', status: 503, body: secret };
};
`);
    const script = path.join(import.meta.dirname, 'run-scheduled.mjs');
    for (const stage of ['backup', 'backup-throw', 'backup-status', 'verify-dir', 'verify-missing', 'verify', 'objectives', 'upload-dir', 'upload-missing', 'upload', 'prune', 'prune-requires']) {
      for (const http of ['ok', 'reject', 'network']) {
        writeFileSync(alerts, '');
        const out = path.join(dir, secret);
        const args = ['--import', preload, script, '--out-dir', out, '--prune-b2'];
        if (stage !== 'prune-requires') args.push('--b2');
        const result = spawnSync(process.execPath, args, {
          encoding: 'utf8', timeout: 10000,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, MOCK_DIR: out, MOCK_STAGE: stage, MOCK_HTTP: http, MOCK_SECRET: secret, MOCK_ALERTS: alerts, BACKUP_ALERT_WEBHOOK: `https://example.invalid/${secret}` },
        });
        assert.equal(result.status, 1, `stage ${stage}/${http} must fail`);
        const payload = readFileSync(alerts, 'utf8');
        assert.ok(payload, `stage ${stage}/${http} should attempt an alert`);
        assert.ok(!(result.stdout + result.stderr + payload).includes(secret), `stage ${stage}/${http} leaked synthetic material`);
        const expectedStage = stage.startsWith('backup') ? 'backup' : stage.startsWith('verify') ? 'verify' : stage.startsWith('upload') ? 'upload' : stage.startsWith('prune') ? 'prune' : 'objectives';
        assert.ok(result.stderr.includes(`run-scheduled: FAILED at ${expectedStage}:`));
        assert.ok(payload.includes(`FAILED at ${expectedStage}`));
        if (['backup', 'verify', 'objectives', 'upload', 'prune'].includes(stage)) assert.match(result.stderr, /\(exit 7\)/);
        if (stage === 'backup-throw') assert.doesNotMatch(result.stderr, /\(exit/);
        if (http !== 'ok') assert.match(result.stderr, /alert delivery failed/);
        else assert.doesNotMatch(result.stderr, /alert delivery failed/);
      }
    }
    writeFileSync(alerts, '');
    const out = path.join(dir, secret);
    const success = spawnSync(process.execPath, ['--import', preload, script, '--out-dir', out, '--b2', '--prune-b2', '--skip-verify', '--skip-dr-objectives'], {
      encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, MOCK_DIR: out, MOCK_STAGE: 'success', MOCK_HTTP: 'ok', MOCK_SECRET: secret, MOCK_ALERTS: alerts },
    });
    assert.equal(success.status, 0);
    assert.match(success.stdout, /"uploaded":true,"verified":true/);
    assert.match(success.stdout, /backup verification skipped, DR objectives skipped/);
    assert.ok(!(success.stdout + success.stderr).includes(secret));
    assert.equal(readFileSync(alerts, 'utf8'), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
