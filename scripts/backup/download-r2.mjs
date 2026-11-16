#!/usr/bin/env node
/**
 * Download the newest backup artifact (+ manifest) from Cloudflare R2 and
 * verify integrity before anything touches it:
 *
 *   - artifact SHA-256 must equal the downloaded manifest's `sha256`;
 *   - when the object carries `x-amz-meta-sha256` (upload-r2.mjs sets it),
 *     that must match too.
 *
 *   node scripts/backup/download-r2.mjs --out-dir /path/to/dir
 *
 * Configuration is environment-only (see lib-r2.mjs); values are never
 * printed. Exit codes: 0 = downloaded + verified; 1 = integrity/transfer
 * failure or no artifact; 2 = usage / missing configuration (names only).
 * The printed report contains names, sizes and hashes only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { r2ConfigFromEnv, parseR2ListXml, pickNewestArtifactKey, signR2Request, sha256Hex } from './lib-r2.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!key?.startsWith('--') || args[i + 1] === undefined) {
    process.stderr.write('usage: download-r2.mjs --out-dir <dir>\n');
    process.exit(2);
  }
  opt[key.slice(2)] = args[i + 1];
}
const outDir = opt['out-dir'];
if (!outDir) {
  process.stderr.write('usage: download-r2.mjs --out-dir <dir>\n');
  process.exit(2);
}

const config = r2ConfigFromEnv(process.env);
if (!config.ok) {
  process.stderr.write(`download-r2: R2 is not configured; missing environment variables: ${config.missing.join(', ')}\n`);
  process.exit(2);
}
const access = {
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
};

async function signedFetch(method, urlString, body) {
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const headers = signR2Request({ method, url: urlString, payloadHash, ...access });
  return fetch(urlString, { method, headers, body, signal: AbortSignal.timeout(120000) });
}

const objectUrl = (key) => `${config.endpoint}/${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

try {
  const listUrl = `${config.endpoint}/${config.bucket}?list-type=2&prefix=${encodeURIComponent('autodine-backups/')}`;
  const list = await signedFetch('GET', listUrl);
  if (!list.ok) {
    process.stderr.write(`download-r2: LIST failed with HTTP ${list.status}\n`);
    process.exit(1);
  }
  const key = pickNewestArtifactKey(parseR2ListXml(await list.text()));
  if (!key) {
    process.stderr.write('download-r2: no backup artifact found in the bucket prefix autodine-backups/\n');
    process.exit(1);
  }
  const manifestKey = key.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json');

  const [artifactRes, manifestRes] = await Promise.all([
    signedFetch('GET', objectUrl(key)),
    signedFetch('GET', objectUrl(manifestKey)),
  ]);
  if (!artifactRes.ok) {
    process.stderr.write(`download-r2: artifact GET failed with HTTP ${artifactRes.status}\n`);
    process.exit(1);
  }
  if (!manifestRes.ok) {
    process.stderr.write(`download-r2: manifest GET failed with HTTP ${manifestRes.status}; refusing an unverifiable artifact\n`);
    process.exit(1);
  }
  const artifact = Buffer.from(await artifactRes.arrayBuffer());
  const manifest = JSON.parse(await manifestRes.text());
  const actualSha = sha256Hex(artifact);
  if (manifest.sha256 !== actualSha) {
    process.stderr.write('download-r2: INTEGRITY FAILURE — artifact SHA-256 does not match its manifest; refusing to use it\n');
    process.exit(1);
  }
  const metaSha = artifactRes.headers.get('x-amz-meta-sha256');
  if (metaSha && metaSha !== actualSha) {
    process.stderr.write('download-r2: INTEGRITY FAILURE — artifact SHA-256 does not match remote object metadata\n');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const fileName = path.basename(key);
  writeFileSync(path.join(outDir, fileName), artifact);
  writeFileSync(path.join(outDir, path.basename(manifestKey)), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    downloaded: true,
    verified: true,
    file: fileName,
    bytes: artifact.length,
    sha256: actualSha,
    manifestCreatedAt: manifest.createdAt ?? null,
    manifestCounts: manifest.counts ?? null,
  }, null, 2) + '\n');
} catch (error) {
  if (error instanceof SyntaxError) {
    process.stderr.write('download-r2: downloaded manifest is not valid JSON; refusing to use the artifact\n');
  } else {
    process.stderr.write(`download-r2: transfer failed (${error?.name ?? 'Error'}); no credentials were printed\n`);
  }
  process.exit(1);
}
