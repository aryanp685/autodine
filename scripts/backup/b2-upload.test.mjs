import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deriveSigningKey, parseB2ListXml, pickNewestArtifactKey, b2ListContinuationToken, decodeB2XmlEntities, b2ConfigFromEnv, b2ObjectKey, signB2Request, sha256Hex } from './lib-b2.mjs';

test('SigV4 signing key matches the published AWS derivation vector', () => {
  // AWS documentation example: secret/date/region/service -> known kSigning.
  const key = deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  assert.equal(key.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
});

test('signed B2 request scopes the credential to the bucket region', () => {
  const headers = signB2Request({
    method: 'PUT',
    url: 'https://s3.us-west-004.backblazeb2.com/autodine-backups/autodine-backups/autodine-x.sql.gz.enc',
    payloadHash: sha256Hex(Buffer.from('ciphertext')),
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'test-secret-not-real',
    region: 'us-west-004',
    extraHeaders: { 'x-amz-meta-sha256': sha256Hex(Buffer.from('ciphertext')) },
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260101\/us-west-004\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256, Signature=[0-9a-f]{64}$/);
  assert.equal(headers['x-amz-date'], '20260101T000000Z');
});

test('config derives the S3 endpoint from the region and reports missing NAMES only', () => {
  const secretSentinel = 'SENTINEL-SECRET-DO-NOT-LEAK';
  const partial = b2ConfigFromEnv({ B2_SECRET_ACCESS_KEY: secretSentinel });
  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes('B2_BUCKET'));
  assert.ok(partial.missing.includes('B2_ACCESS_KEY_ID'));
  assert.ok(partial.missing.includes('B2_ENDPOINT|B2_REGION'));
  assert.ok(!JSON.stringify(partial).includes(secretSentinel));

  const full = b2ConfigFromEnv({
    B2_BUCKET: 'autodine-backups',
    B2_ACCESS_KEY_ID: 'id',
    B2_SECRET_ACCESS_KEY: secretSentinel,
    B2_REGION: 'us-west-004',
  });
  assert.equal(full.ok, true);
  assert.equal(full.endpoint, 'https://s3.us-west-004.backblazeb2.com');
  assert.equal(full.region, 'us-west-004');
  assert.ok(!JSON.stringify(full).includes(secretSentinel));

  const explicit = b2ConfigFromEnv({
    B2_BUCKET: 'autodine-backups',
    B2_ACCESS_KEY_ID: 'id',
    B2_SECRET_ACCESS_KEY: secretSentinel,
    B2_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
  });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.region, 'eu-central-003');
});

test('object keys use basenames only (no path traversal)', () => {
  assert.equal(b2ObjectKey('/tmp/../etc/autodine-a.sql.gz.enc'), 'autodine-backups/autodine-a.sql.gz.enc');
  assert.equal(b2ObjectKey('autodine-a.sql.gz.enc', ''), 'autodine-a.sql.gz.enc');
});

test('B2 list parsing picks the newest artifact and ignores manifests', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Contents><Key>autodine-backups/autodine-a-20260101T000000.sql.gz.enc</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
    <Contents><Key>autodine-backups/autodine-a-20260101T000000.manifest.json</Key><LastModified>2026-01-01T00:00:01.000Z</LastModified></Contents>
    <Contents><Key>autodine-backups/autodine-a-20260102T000000.sql.gz.enc</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified></Contents>
  </ListBucketResult>`;
  const entries = parseB2ListXml(xml);
  assert.equal(entries.length, 3);
  assert.equal(pickNewestArtifactKey(entries), 'autodine-backups/autodine-a-20260102T000000.sql.gz.enc');
  assert.equal(pickNewestArtifactKey([]), null);
  assert.equal(b2ListContinuationToken(xml), null);
  assert.equal(
    b2ListContinuationToken('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok123</NextContinuationToken></ListBucketResult>'),
    'tok123',
  );
});

test('B2 list parsing decodes XML entities in keys and continuation tokens exactly once', () => {
  const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;en+1</NextContinuationToken>
    <Contents><Key>autodine-backups/autodine-a&amp;b-20260101T000000.sql.gz.enc</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
    <Contents><Key>autodine-backups/literal-&amp;lt;-name.sql.gz.enc</Key><LastModified>2026-01-02T00:00:00.000Z</LastModified></Contents>
  </ListBucketResult>`;
  const entries = parseB2ListXml(xml);
  // `&amp;` in the wire format is a literal `&` in the real key.
  assert.equal(entries[0].key, 'autodine-backups/autodine-a&b-20260101T000000.sql.gz.enc');
  // `&amp;lt;` is the literal text `&lt;` — decoded once, never to `<`.
  assert.equal(entries[1].key, 'autodine-backups/literal-&lt;-name.sql.gz.enc');
  assert.equal(b2ListContinuationToken(xml), 'tok&en+1');
  assert.equal(decodeB2XmlEntities('a&lt;b&gt;c&quot;d&apos;e&#38;f&#x26;g'), 'a<b>c"d\'e&f&g');
  assert.equal(decodeB2XmlEntities('plain-key_1.2'), 'plain-key_1.2');
});

test('download CLI fails closed with missing-config NAMES only', () => {
  const script = path.join(import.meta.dirname, 'download-b2.mjs');
  const run = spawnSync(process.execPath, [script, '--out-dir', '/tmp/autodine-b2-dl-test'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, B2_SECRET_ACCESS_KEY: 'SENTINEL-SECRET-DO-NOT-LEAK' },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /B2_BUCKET/);
  assert.ok(!run.stderr.includes('SENTINEL-SECRET-DO-NOT-LEAK'));
});

test('verify-restored refuses any non-loopback target before connecting', () => {
  const script = path.join(import.meta.dirname, 'verify-restored-db.mjs');
  const run = spawnSync(process.execPath, [script, '--manifest', import.meta.filename, '--artifact', import.meta.filename], {
    encoding: 'utf8',
    env: { ...process.env, AUTODINE_RESTORE_TARGET_URL: 'postgresql://user:pass@db.example.invalid:5432/prod' },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /REFUSING non-disposable target/);
  assert.ok(!run.stderr.includes('user:pass'), 'refusal must not echo credentials');
});

test('upload CLI dry-run verifies manifest SHA-256 and refuses mismatches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-b2-test-'));
  try {
    const artifact = path.join(dir, 'autodine-test-20260101T000000.sql.gz.enc');
    const body = Buffer.from('encrypted-fixture-bytes');
    writeFileSync(artifact, body);
    const manifest = { file: path.basename(artifact), sha256: sha256Hex(body), format: 'autodine-logical-1' };
    writeFileSync(path.join(dir, 'autodine-test-20260101T000000.manifest.json'), JSON.stringify(manifest));

    const script = path.join(import.meta.dirname, 'upload-b2.mjs');
    const ok = spawnSync(process.execPath, [script, '--file', artifact, '--dry-run'], { encoding: 'utf8', env: { ...process.env, B2_BUCKET: '', B2_ACCESS_KEY_ID: '', B2_SECRET_ACCESS_KEY: '', B2_ENDPOINT: '', B2_REGION: '' } });
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.equal(report.sha256, manifest.sha256);
    assert.equal(report.manifestChecked, true);
    assert.equal(report.destination, 'B2 not configured');

    writeFileSync(path.join(dir, 'autodine-test-20260101T000000.manifest.json'), JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }));
    const bad = spawnSync(process.execPath, [script, '--file', artifact, '--dry-run'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /INTEGRITY FAILURE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
