#!/usr/bin/env node
/**
 * Download the newest backup artifact (+ manifest) from Backblaze B2 and
 * verify integrity before anything touches it:
 *
 *   - artifact SHA-256 must equal the downloaded manifest's `sha256`;
 *   - object `x-amz-meta-sha256` (set by upload-b2.mjs) must match too.
 *   - bounded retries re-read interrupted responses; no partial artifact is saved.
 *
 *   node scripts/backup/download-b2.mjs --out-dir /path/to/dir
 *
 * Configuration is environment-only (see lib-b2.mjs); values are never
 * printed. Exit codes: 0 = downloaded + verified; 1 = integrity/transfer
 * failure or no artifact; 2 = usage / missing configuration (names only).
 * The printed report contains names, sizes and hashes only.
 */
import { linkSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { b2ConfigFromEnv, parseB2ListXml, pickNewestArtifactKey, b2ListContinuationToken, signB2Request, sha256Hex } from './lib-b2.mjs';
import { readB2WithRetry } from './lib-b2-read.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!key?.startsWith('--') || args[i + 1] === undefined) {
    process.stderr.write('usage: download-b2.mjs --out-dir <dir>\n');
    process.exit(2);
  }
  opt[key.slice(2)] = args[i + 1];
}
const outDir = opt['out-dir'];
if (!outDir) {
  process.stderr.write('usage: download-b2.mjs --out-dir <dir>\n');
  process.exit(2);
}

const config = b2ConfigFromEnv(process.env);
if (!config.ok) {
  process.stderr.write(`download-b2: B2 is not configured; missing environment variables: ${config.missing.join(', ')}\n`);
  process.exit(2);
}
const access = {
  accessKeyId: process.env.B2_ACCESS_KEY_ID,
  secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
};

async function signedFetch(method, urlString, body) {
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const headers = signB2Request({ method, url: urlString, payloadHash, ...access, region: config.region });
  return fetch(urlString, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120000) });
}

const objectUrl = (key) => `${config.endpoint}/${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

try {
  const entries = [];
  const seen = new Set();
  let continuation = null;
  for (let page = 0; ; page += 1) {
    if (page >= 100) throw new Error('listing exceeds page limit');
    const query = continuation
      ? `continuation-token=${encodeURIComponent(continuation)}&list-type=2&prefix=${encodeURIComponent('autodine-backups/')}`
      : `list-type=2&prefix=${encodeURIComponent('autodine-backups/')}`;
    const result = await readB2WithRetry(() => signedFetch('GET', `${config.endpoint}/${config.bucket}?${query}`));
    const xml = result.bytes.toString('utf8');
    const truncated = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/)?.[1];
    if (!truncated) throw new Error('invalid listing pagination');
    const pageEntries = parseB2ListXml(xml);
    if (pageEntries.some((entry) => !entry.key.startsWith('autodine-backups/'))) throw new Error('listing escaped backup prefix');
    entries.push(...pageEntries);
    if (truncated === 'false') break;
    const next = b2ListContinuationToken(xml);
    if (!next || seen.has(next)) throw new Error('listing has missing or repeated continuation token');
    seen.add(next);
    continuation = next;
  }
  const key = pickNewestArtifactKey(entries);
  if (!key) {
    process.stderr.write('download-b2: no backup artifact found in the bucket prefix autodine-backups/\n');
    process.exit(1);
  }
  const manifestKey = key.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json');

  const [artifactRes, manifestRes] = await Promise.all([
    readB2WithRetry(() => signedFetch('GET', objectUrl(key))),
    readB2WithRetry(() => signedFetch('GET', objectUrl(manifestKey))),
  ]);
  const artifact = artifactRes.bytes;
  const manifest = JSON.parse(manifestRes.bytes.toString('utf8'));
  const actualSha = sha256Hex(artifact);
  if (!manifest || manifest.file !== path.basename(key) || manifest.sha256 !== actualSha) {
    process.stderr.write('download-b2: INTEGRITY FAILURE — artifact/manifest name or SHA-256 mismatch; refusing to use it\n');
    process.exit(1);
  }
  if (artifactRes.metadataSha256 !== actualSha) {
    process.stderr.write('download-b2: INTEGRITY FAILURE — missing or mismatched remote SHA-256 metadata\n');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const fileName = path.basename(key);
  const finalManifest = path.join(outDir, path.basename(manifestKey));
  const staging = mkdtempSync(path.join(outDir, '.b2-download-'));
  let manifestPublished = false;
  try {
    const temporaryArtifact = path.join(staging, fileName);
    const temporaryManifest = path.join(staging, path.basename(manifestKey));
    writeFileSync(temporaryArtifact, artifact, { mode: 0o600 });
    writeFileSync(temporaryManifest, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    // Hard links fail rather than overwrite an existing file. Publish the
    // manifest first, then the complete artifact; on failure remove only our
    // own manifest. Network failures never leave partial download files.
    linkSync(temporaryManifest, finalManifest);
    manifestPublished = true;
    linkSync(temporaryArtifact, path.join(outDir, fileName));
  } catch (error) {
    if (manifestPublished) unlinkSync(finalManifest);
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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
    process.stderr.write('download-b2: downloaded manifest is not valid JSON; refusing to use the artifact\n');
  } else {
    process.stderr.write('download-b2: transfer failed; inspect network/endpoint configuration\n');
  }
  process.exit(1);
}
