#!/usr/bin/env node
/**
 * Upload one encrypted backup artifact (+ its manifest) to Backblaze B2 and
 * verify integrity end-to-end with SHA-256:
 *
 *   1. The artifact's SHA-256 must equal its backup manifest's `sha256`
 *      (the manifest written by backup-logical.mjs) — checked before upload.
 *   2. The PUT carries `x-amz-meta-sha256` and the payload hash.
 *   3. A signed HEAD afterwards must return the same SHA-256 metadata.
 *
 *   node scripts/backup/upload-b2.mjs --file /path/autodine-....sql.gz.enc [--manifest <path>] [--dry-run]
 *
 * Configuration (environment only; values are never printed):
 *   B2_BUCKET, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY, and an endpoint from
 *   B2_ENDPOINT or B2_REGION. See lib-b2.mjs.
 *
 * Exit codes: 0 = uploaded+verified (or dry-run integrity OK); 1 = integrity
 * or transfer failure; 2 = usage / missing configuration (names only).
 * --dry-run performs the local manifest/SHA-256 verification and prints the
 * intended destination (bucket/key) without any network access.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { b2ConfigFromEnv, b2ObjectKey, signB2Request, sha256Hex } from './lib-b2.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (key === '--dry-run') { opt.dryRun = true; i -= 1; continue; }
  if (!key?.startsWith('--') || args[i + 1] === undefined) {
    process.stderr.write('usage: upload-b2.mjs --file <artifact.enc> [--manifest <manifest.json>] [--dry-run]\n');
    process.exit(2);
  }
  opt[key.slice(2)] = args[i + 1];
}

const file = opt.file;
if (!file || !existsSync(file)) {
  process.stderr.write('upload-b2: --file must name an existing backup artifact\n');
  process.exit(2);
}

const manifestPath = opt.manifest ?? file.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json');
const bytes = readFileSync(file);
// Never upload an arbitrary plaintext file under a backup key. The scheduled
// pipeline separately authenticates and decrypts the artifact before upload.
if (!/\.(sql\.gz|dump)\.enc$/.test(file) || bytes.length < 52 || !bytes.subarray(0, 7).equals(Buffer.from('ADBK01\n'))) {
  process.stderr.write('upload-b2: invalid encrypted backup framing or filename; refusing to upload\n');
  process.exit(1);
}
const actualSha = sha256Hex(bytes);

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {
  process.stderr.write('upload-b2: manifest is missing or invalid; refusing to upload\n');
  process.exit(1);
}
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
    typeof manifest.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.sha256) ||
    manifest.sha256 !== actualSha || typeof manifest.file !== 'string' ||
    manifest.file !== path.basename(file)) {
  process.stderr.write('upload-b2: INTEGRITY FAILURE — manifest must name the artifact and its exact SHA-256; refusing to upload\n');
  process.exit(1);
}

const config = b2ConfigFromEnv(process.env);
const key = b2ObjectKey(file);
const manifestKey = b2ObjectKey(manifestPath);

if (opt.dryRun) {
  process.stdout.write(JSON.stringify({
    dryRun: true,
    file: path.basename(file),
    bytes: bytes.length,
    sha256: actualSha,
    manifestChecked: Boolean(manifest),
    destination: config.ok ? { bucket: config.bucket, key, manifestKey } : 'B2 not configured',
    missingConfig: config.ok ? [] : config.missing,
  }, null, 2) + '\n');
  process.exit(0);
}

if (!config.ok) {
  process.stderr.write(`upload-b2: B2 is not configured; missing environment variables: ${config.missing.join(', ')}\n`);
  process.stderr.write('upload-b2: provide them from your secret store (values are never printed). See docs/backup-restore-runbook.md.\n');
  process.exit(2);
}

const access = {
  accessKeyId: process.env.B2_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.B2_SECRET_ACCESS_KEY?.trim(),
};

async function signedFetch(method, objectKey, body, extraHeaders = {}) {
  const url = `${config.endpoint}/${config.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const headers = signB2Request({ method, url, payloadHash, ...access, region: config.region, extraHeaders });
  return fetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120000) });
}

try {
  const put = await signedFetch('PUT', key, bytes, {
    'content-type': 'application/octet-stream',
    'x-amz-meta-sha256': actualSha,
  });
  if (!put.ok) {
    process.stderr.write(`upload-b2: artifact PUT failed with HTTP ${put.status}; remote state is unverified\n`);
    process.exit(1);
  }
  if (manifest) {
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const putManifest = await signedFetch('PUT', manifestKey, manifestBody, { 'content-type': 'application/json' });
    if (!putManifest.ok) {
      process.stderr.write(`upload-b2: manifest PUT failed with HTTP ${putManifest.status}; remote pair is unverified and may be partial\n`);
      process.exit(1);
    }
  }
  const head = await signedFetch('HEAD', key);
  if (!head.ok) {
    process.stderr.write(`upload-b2: HEAD verification failed with HTTP ${head.status}\n`);
    process.exit(1);
  }
  const remoteSha = head.headers.get('x-amz-meta-sha256');
  if (remoteSha !== actualSha) {
    process.stderr.write('upload-b2: INTEGRITY FAILURE — remote SHA-256 metadata does not match the local artifact\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    uploaded: true,
    verified: true,
    bucket: config.bucket,
    key,
    manifestKey: manifest ? manifestKey : null,
    bytes: bytes.length,
    sha256: actualSha,
  }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`upload-b2: transfer failed (${error?.name ?? 'Error'}); see network/endpoint configuration — no credentials were printed\n`);
  process.exit(1);
}
