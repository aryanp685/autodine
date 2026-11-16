import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deriveSigningKey, parseR2ListXml, pickNewestArtifactKey, r2ConfigFromEnv, r2ObjectKey, signR2Request, sha256Hex } from './lib-r2.mjs';

test('SigV4 signing key matches the published AWS derivation vector', () => {
  // AWS documentation example: secret/date/region/service -> known kSigning.
  const key = deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  assert.equal(key.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
});

test('signed R2 request carries a well-formed Authorization header', () => {
  const headers = signR2Request({
    method: 'PUT',
    url: 'https://account123.r2.cloudflarestorage.com/backups/autodine-backups/autodine-x.sql.gz.enc',
    payloadHash: sha256Hex(Buffer.from('ciphertext')),
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'test-secret-not-real',
    extraHeaders: { 'x-amz-meta-sha256': sha256Hex(Buffer.from('ciphertext')) },
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260101\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256, Signature=[0-9a-f]{64}$/);
  assert.equal(headers['x-amz-date'], '20260101T000000Z');
});

test('config resolution reports missing NAMES only, never values', () => {
  const secretSentinel = 'SENTINEL-SECRET-DO-NOT-LEAK';
  const partial = r2ConfigFromEnv({ R2_SECRET_ACCESS_KEY: secretSentinel });
  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes('R2_BUCKET'));
  assert.ok(partial.missing.includes('R2_ACCESS_KEY_ID'));
  assert.ok(partial.missing.includes('R2_ENDPOINT|CLOUDFLARE_ACCOUNT_ID'));
  assert.ok(!JSON.stringify(partial).includes(secretSentinel));

  const full = r2ConfigFromEnv({
    R2_BUCKET: 'autodine-backups',
    R2_ACCESS_KEY_ID: 'id',
    R2_SECRET_ACCESS_KEY: secretSentinel,
    CLOUDFLARE_ACCOUNT_ID: 'abc123',
  });
  assert.equal(full.ok, true);
  assert.equal(full.endpoint, 'https://abc123.r2.cloudflarestorage.com');
  assert.ok(!JSON.stringify(full).includes(secretSentinel));
});

test('object keys use basenames only (no path traversal)', () => {
  assert.equal(r2ObjectKey('/tmp/../etc/autodine-a.sql.gz.enc'), 'autodine-backups/autodine-a.sql.gz.enc');
  assert.equal(r2ObjectKey('autodine-a.sql.gz.enc', ''), 'autodine-a.sql.gz.enc');
});

test('R2 list parsing picks the newest artifact and ignores manifests', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Contents><Key>autodine-backups/autodine-a-20260101T000000.sql.gz.enc</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
    <Contents><Key>autodine-backups/autodine-a-20260101T000000.manifest.json</Key><LastModified>2026-01-01T00:00:01.000Z</LastModified></Contents>
    <Contents><Key>autodine-backups/autodine-a-20260102T000000.sql.gz.enc</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified></Contents>
  </ListBucketResult>`;
  const entries = parseR2ListXml(xml);
  assert.equal(entries.length, 3);
  assert.equal(pickNewestArtifactKey(entries), 'autodine-backups/autodine-a-20260102T000000.sql.gz.enc');
  assert.equal(pickNewestArtifactKey([]), null);
});

test('download CLI fails closed with missing-config NAMES only', () => {
  const script = path.join(import.meta.dirname, 'download-r2.mjs');
  const run = spawnSync(process.execPath, [script, '--out-dir', '/tmp/autodine-r2-dl-test'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, R2_SECRET_ACCESS_KEY: 'SENTINEL-SECRET-DO-NOT-LEAK' },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /R2_BUCKET/);
  assert.ok(!run.stderr.includes('SENTINEL-SECRET-DO-NOT-LEAK'));
});

test('verify-restored refuses any non-loopback target before connecting', () => {
  const script = path.join(import.meta.dirname, 'verify-restored-db.mjs');
  const run = spawnSync(process.execPath, [script, '--manifest', import.meta.filename], {
    encoding: 'utf8',
    env: { ...process.env, AUTODINE_RESTORE_TARGET_URL: 'postgresql://user:pass@db.example.invalid:5432/prod' },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /REFUSING non-disposable target/);
});

test('upload CLI dry-run verifies manifest SHA-256 and refuses mismatches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-r2-test-'));
  try {
    const artifact = path.join(dir, 'autodine-test-20260101T000000.sql.gz.enc');
    const body = Buffer.from('encrypted-fixture-bytes');
    writeFileSync(artifact, body);
    const manifest = { file: path.basename(artifact), sha256: sha256Hex(body), format: 'autodine-logical-1' };
    writeFileSync(path.join(dir, 'autodine-test-20260101T000000.manifest.json'), JSON.stringify(manifest));

    const script = path.join(import.meta.dirname, 'upload-r2.mjs');
    const ok = spawnSync(process.execPath, [script, '--file', artifact, '--dry-run'], { encoding: 'utf8', env: { ...process.env, R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_ENDPOINT: '', CLOUDFLARE_ACCOUNT_ID: '' } });
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.equal(report.sha256, manifest.sha256);
    assert.equal(report.manifestChecked, true);
    assert.equal(report.destination, 'R2 not configured');

    writeFileSync(path.join(dir, 'autodine-test-20260101T000000.manifest.json'), JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }));
    const bad = spawnSync(process.execPath, [script, '--file', artifact, '--dry-run'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /INTEGRITY FAILURE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
