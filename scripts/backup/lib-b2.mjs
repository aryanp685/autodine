/**
 * Backblaze B2 (S3-compatible API) destination support for the backup
 * pipeline. B2 replaced Cloudflare R2 as the approved provider (2026-11-16).
 *
 * Configuration comes only from the environment; this module never prints,
 * logs or returns secret values. `b2ConfigFromEnv` reports the NAMES of
 * missing variables so an operator can see exactly what to provide:
 *
 *   B2_REGION             bucket region, e.g. us-west-004 (endpoint derived
 *                         as https://s3.<region>.backblazeb2.com)
 *   B2_ENDPOINT           optional explicit S3 endpoint override
 *   B2_BUCKET             bucket name
 *   B2_ACCESS_KEY_ID      B2 application keyID (S3 access key)
 *   B2_SECRET_ACCESS_KEY  B2 application key (S3 secret key)
 *
 * Signing is AWS Signature Version 4 (service `s3`) with the bucket's real
 * region — B2 does not accept R2's `auto` region. Implemented with
 * node:crypto only — no SDK dependency.
 */
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

export const B2_ENV_VARS = [
  'B2_BUCKET',
  'B2_ACCESS_KEY_ID',
  'B2_SECRET_ACCESS_KEY',
];

const REGION_RE = /^[a-z]{2}-[a-z]+-\d{3}$/;
const ENDPOINT_REGION_RE = /^s3\.([a-z]{2}-[a-z]+-\d{3})\.backblazeb2\.com$/;

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
 * Resolve B2 configuration from an env-like object.
 * Returns { ok, missing: string[], endpoint?, bucket?, region? } — never
 * secret values. An endpoint requires B2_ENDPOINT or B2_REGION; a signing
 * region requires B2_REGION or a standard B2 endpoint hostname.
 */
export function b2ConfigFromEnv(env) {
  const missing = [];
  for (const name of B2_ENV_VARS) {
    if (!env[name] || !String(env[name]).trim()) missing.push(name);
  }
  if (env.B2_BUCKET && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{5,49}$/.test(String(env.B2_BUCKET).trim())) missing.push('B2_BUCKET (malformed)');
  let endpoint = env.B2_ENDPOINT?.trim() || null;
  let region = env.B2_REGION?.trim() || null;
  if (region && !REGION_RE.test(region)) missing.push('B2_REGION (malformed)');
  if (!endpoint && region && REGION_RE.test(region)) {
    endpoint = `https://s3.${region}.backblazeb2.com`;
  }
  if (!endpoint) missing.push('B2_ENDPOINT|B2_REGION');
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      const endpointRegion = url.hostname.match(ENDPOINT_REGION_RE)?.[1];
      if (url.protocol !== 'https:' || !endpointRegion || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
        missing.push('B2_ENDPOINT (must be an official HTTPS B2 S3 endpoint)');
      } else if (region && endpointRegion !== region) {
        missing.push('B2_REGION (does not match B2_ENDPOINT)');
      } else if (!region) {
        region = endpointRegion;
      }
    } catch { missing.push('B2_ENDPOINT (malformed)'); }
  }
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length > 0) return { ok: false, missing: uniqueMissing };
  return {
    ok: true,
    missing: [],
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket: env.B2_BUCKET.trim(),
    region,
  };
}

/** Object key for a backup artifact; basename only, so no path traversal. */
export function b2ObjectKey(fileName, prefix = 'autodine-backups') {
  const base = path.basename(String(fileName));
  const cleanPrefix = String(prefix).replace(/^\/+|\/+$/g, '');
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode XML entities in S3 response text (keys, continuation tokens).
 * B2/S3 escape `&`, `<`, `>` etc. in object keys; without decoding, a key
 * containing `&` would surface literally as `&amp;` and downstream key
 * derivation (manifest lookup, deletes) would address the wrong object.
 * Single pass with a replacer function, so `&amp;lt;` decodes to the
 * literal text `&lt;` exactly once — never double-decoded.
 */
export function decodeB2XmlEntities(text) {
  return String(text).replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (match, name, dec, hex) => {
    if (dec !== undefined || hex !== undefined) {
      const codePoint = dec !== undefined ? Number(dec) : parseInt(hex, 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return XML_ENTITIES[name] ?? match;
  });
}

/** Parse an S3 ListObjectsV2 response into [{ key, lastModified }]. */
export function parseB2ListXml(xml) {
  const entries = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let block;
  while ((block = contentsRe.exec(String(xml))) !== null) {
    const key = block[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
    const lastModified = block[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1];
    if (key) entries.push({ key: decodeB2XmlEntities(key), lastModified: lastModified ?? '' });
  }
  return entries;
}

/** Continuation token from a truncated ListObjectsV2 response, else null. */
export function b2ListContinuationToken(xml) {
  const text = String(xml);
  if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) return null;
  const token = text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null;
  return token === null ? null : decodeB2XmlEntities(token);
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
 * Sign an S3 request for B2. Returns the headers to merge into the request
 * (host, x-amz-date, x-amz-content-sha256, authorization). The payload hash
 * is the hex SHA-256 of the exact bytes that will be sent.
 */
export function signB2Request({ method, url, payloadHash, accessKeyId, secretAccessKey, region, extraHeaders = {}, now = new Date() }) {
  const parsed = new URL(url);
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);
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
