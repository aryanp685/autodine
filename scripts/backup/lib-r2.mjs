/**
 * Cloudflare R2 (S3-compatible) destination support for the backup pipeline.
 *
 * Configuration comes only from the environment; this module never prints,
 * logs or returns secret values. `r2ConfigFromEnv` reports the NAMES of
 * missing variables so an operator can see exactly what to provide:
 *
 *   CLOUDFLARE_ACCOUNT_ID   account id (endpoint = https://<id>.r2.cloudflarestorage.com)
 *   R2_ENDPOINT             optional explicit endpoint override
 *   R2_BUCKET               bucket name
 *   R2_ACCESS_KEY_ID        R2 S3 access key id
 *   R2_SECRET_ACCESS_KEY    R2 S3 secret access key
 *
 * Signing is AWS Signature Version 4 (service `s3`, region `auto`, as R2
 * requires), implemented with node:crypto only — no SDK dependency.
 */
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

export const R2_ENV_VARS = [
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

/** AWS SigV4 signing-key derivation (kDate -> kRegion -> kService -> kSigning). */
export function deriveSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Resolve R2 configuration from an env-like object.
 * Returns { ok, missing: string[], endpoint?, bucket? } — never secret values.
 * An endpoint requires R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID; the missing list
 * names 'R2_ENDPOINT|CLOUDFLARE_ACCOUNT_ID' when neither is set.
 */
export function r2ConfigFromEnv(env) {
  const missing = [];
  for (const name of R2_ENV_VARS) {
    if (!env[name] || !String(env[name]).trim()) missing.push(name);
  }
  let endpoint = env.R2_ENDPOINT?.trim() || null;
  if (!endpoint && env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`;
  }
  if (!endpoint) missing.push('R2_ENDPOINT|CLOUDFLARE_ACCOUNT_ID');
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    missing: [],
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket: env.R2_BUCKET.trim(),
  };
}

/** Object key for a backup artifact; basename only, so no path traversal. */
export function r2ObjectKey(fileName, prefix = 'autodine-backups') {
  const base = path.basename(String(fileName));
  const cleanPrefix = String(prefix).replace(/^\/+|\/+$/g, '');
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
}

/** Parse an S3 ListObjectsV2 response into [{ key, lastModified }]. */
export function parseR2ListXml(xml) {
  const entries = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let block;
  while ((block = contentsRe.exec(String(xml))) !== null) {
    const key = block[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
    const lastModified = block[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1];
    if (key) entries.push({ key, lastModified: lastModified ?? '' });
  }
  return entries;
}

/** Continuation token from a truncated ListObjectsV2 response, else null. */
export function r2ListContinuationToken(xml) {
  const text = String(xml);
  if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) return null;
  return text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null;
}

/** Newest backup artifact key from a list result, or null when none exists. */
export function pickNewestArtifactKey(entries) {
  const artifacts = entries
    .filter((e) => /\.(sql\.gz\.enc|dump\.enc)$/.test(e.key))
    .sort((a, b) => String(a.lastModified).localeCompare(String(b.lastModified)));
  return artifacts.length ? artifacts[artifacts.length - 1].key : null;
}

const amzDate = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

/**
 * Sign an S3 request for R2. Returns the headers to merge into the request
 * (host, x-amz-date, x-amz-content-sha256, authorization). The payload hash
 * is the hex SHA-256 of the exact bytes that will be sent.
 */
export function signR2Request({ method, url, payloadHash, accessKeyId, secretAccessKey, extraHeaders = {}, now = new Date() }) {
  const parsed = new URL(url);
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const headers = {
    host: parsed.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const canonicalRequest = [
    method.toUpperCase(),
    parsed.pathname,
    parsed.search ? parsed.search.slice(1) : '',
    canonicalHeaders,
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`,
  };
}
