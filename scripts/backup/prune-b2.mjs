#!/usr/bin/env node
/**
 * Remote retention for the Backblaze B2 backup bucket.
 *
 * WHY NOT B2 LIFECYCLE RULES? Backblaze lifecycle rules are age-based only
 * (`daysFromUploadingToHiding`, `daysFromHidingToDeleting`, `fileNamePrefix`):
 * they can expire everything older than a fixed number of days, but they
 * cannot express the required recovery-point policy — the newest 14 daily
 * backups, one per week for 8 weeks, one per month for 6 months. This
 * pruner enforces that policy with authenticated S3 calls, mirroring the
 * day-grouping semantics of the local pipeline (backup-logical.mjs).
 *
 *   node scripts/backup/prune-b2.mjs              # dry-run: print the plan
 *   node scripts/backup/prune-b2.mjs --confirm    # execute deletions
 *
 * SAFETY (fail closed — any doubt deletes nothing):
 *   - Scope: only objects under the `autodine-backups/` prefix whose names
 *     match the backup artifact pattern are ever deletion candidates.
 *     Anything else in the prefix is reported as ignored, never touched;
 *     a listed key outside the prefix aborts the run.
 *   - Every artifact must have a structurally valid manifest (see
 *     `validateManifestStructure`): it must name this artifact and carry a
 *     well-formed SHA-256, a positive plaintext byte count and a format.
 *     A missing/corrupt manifest, an unparseable `createdAt`, a timestamp
 *     implausibly in the future, or a `createdAt` later than the object's
 *     server-side upload time aborts the run before any deletion.
 *   - Listing must complete: HTTP errors, truncation without a
 *     continuation token, a repeated token, or >100 pages abort the run.
 *   - The newest valid backup is always kept, regardless of policy.
 *   - Deleting more than --max-delete artifacts (default 50) aborts.
 *   - INTEGRITY GATE (before the first DELETE): every expiring artifact is
 *     downloaded in full and its SHA-256 recomputed. It must equal both
 *     the manifest's `sha256` and the upload-time `x-amz-meta-sha256`
 *     object metadata (upload-b2.mjs always sets it; its absence makes the
 *     artifact unverifiable here). The downloaded byte count must equal
 *     the listed object size (and Content-Length when provided), and the
 *     bytes must carry the AutoDine backup magic and minimum header size.
 *     HEAD metadata alone is never trusted — it is only a cross-check
 *     against the recomputed content hash. ALL candidates are verified
 *     before ANY deletion begins; one failure aborts with zero deletions.
 *     Immediately before each pair's DELETEs, a HEAD recheck must confirm
 *     the object still carries the verified SHA-256 metadata and size.
 *     The passphrase is never needed (and never read) by the pruner: the
 *     GCM tag cannot be checked without it, but the content hash binds the
 *     exact remote bytes to the manifest the backup pipeline produced.
 *   - A failed DELETE stops the run immediately and exits 1. Pair order is
 *     artifact-then-manifest (documented in executePrune): an artifact
 *     failure leaves the pair intact for a clean re-run; a manifest
 *     failure is retried once before the run aborts naming the orphan.
 *   - Configuration is environment-only (see lib-b2.mjs); values are never
 *     printed.
 *
 * Known limitations are documented in docs/backup-restore-runbook.md
 * ("Remote retention — known limitations"): no cross-process lock, orphan
 * manifests after a partial pair deletion, day-of-month week buckets, and
 * the residual trust placed in `createdAt` within its consistency bounds.
 *
 * Exit codes: 0 = plan printed (dry-run) or deletions completed;
 * 1 = aborted/failed (nothing or only the reported prefix deleted);
 * 2 = usage / missing configuration (names only).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b2ConfigFromEnv, parseB2ListXml, b2ListContinuationToken, decodeB2XmlEntities, signB2Request, sha256Hex } from './lib-b2.mjs';
import { BACKUP_NAME_RE } from './lib-schedule.mjs';

export const BACKUP_PREFIX = 'autodine-backups/';
const MAX_PAGES = 100;
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

// AutoDine encrypted-backup framing (lib-crypto.mjs): magic 'ADBK01\n'
// (7 bytes) + 16-byte salt + 12-byte IV + 16-byte GCM tag + ciphertext.
// A genuine artifact is therefore at least 52 bytes and starts with the magic.
const BACKUP_MAGIC = Buffer.from('ADBK01\n', 'utf8');
export const MIN_ARTIFACT_BYTES = BACKUP_MAGIC.length + 16 + 12 + 16 + 1;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

const dayKeyOf = (iso) => iso.slice(0, 10).replaceAll('-', '');

/**
 * Retention plan with the same day-grouping semantics as the local prune:
 * newest 14 days kept, then the first backup day of each new week bucket
 * (up to 8) and month bucket (up to 6) kept. The single newest backup is
 * always kept. Items: [{ key, manifestKey, createdAt }] (ISO strings).
 */
export function planRetention(items, { keepDaily = 14, keepWeekly = 8, keepMonthly = 6 } = {}) {
  const byDay = new Map();
  for (const item of items) {
    const day = dayKeyOf(item.createdAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  const days = [...byDay.keys()].sort().reverse();
  const keepDays = new Set();
  const monthSeen = new Set();
  const weekSeen = new Set();
  days.forEach((day, i) => {
    const weekKey = `${day.slice(0, 6)}-w${Math.floor(Number(day.slice(6, 8)) / 7)}`;
    const monthKey = day.slice(0, 6);
    const isDaily = i < keepDaily;
    const isWeekly = keepWeekly > 0 && !weekSeen.has(weekKey) && weekSeen.size < keepWeekly;
    const isMonthly = keepMonthly > 0 && !monthSeen.has(monthKey) && monthSeen.size < keepMonthly;
    if (isWeekly) weekSeen.add(weekKey);
    if (isMonthly) monthSeen.add(monthKey);
    if (isDaily || isWeekly || isMonthly) keepDays.add(day);
  });

  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newest = sorted[0] ?? null;
  const keep = [];
  const expire = [];
  for (const item of sorted) {
    if (item === newest || keepDays.has(dayKeyOf(item.createdAt))) keep.push(item);
    else expire.push(item);
  }
  return { keep, expire, newestKey: newest?.key ?? null };
}

/** Fetch every list page; any irregularity throws (caller deletes nothing). */
export async function listAllRemoteObjects(fetchPage) {
  const entries = [];
  const seenTokens = new Set();
  let token = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { entries: pageEntries, nextToken, truncated } = await fetchPage(token);
    entries.push(...pageEntries);
    if (!truncated) return entries;
    if (!nextToken) throw new Error('listing truncated without a continuation token — aborting');
    if (seenTokens.has(nextToken)) throw new Error('listing returned a repeated continuation token — aborting');
    seenTokens.add(nextToken);
    token = nextToken;
  }
  throw new Error(`listing exceeded ${MAX_PAGES} pages — aborting`);
}

/**
 * Extract { key -> size in bytes } from one ListObjectsV2 XML page.
 * Complements parseB2ListXml (lib-b2.mjs), which does not surface sizes;
 * the pruner needs the server-reported size to check downloads against.
 */
export function parseListSizes(xml) {
  const sizes = new Map();
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let block;
  while ((block = contentsRe.exec(String(xml))) !== null) {
    const key = block[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
    const size = Number(block[1].match(/<Size>(\d+)<\/Size>/)?.[1]);
    // Keys are entity-decoded exactly as parseB2ListXml decodes them, so a
    // size always joins to the same key string the inventory carries.
    if (key && Number.isSafeInteger(size) && size >= 0) sizes.set(decodeB2XmlEntities(key), size);
  }
  return sizes;
}

/**
 * Structural validation of one backup manifest against the artifact it
 * claims to describe. backup-logical.mjs (the only manifest producer)
 * always writes `file`, `sha256` (of the encrypted artifact bytes),
 * `bytes` (plaintext length), `format` and `createdAt`; anything missing
 * or malformed marks the pair corrupted/tampered and aborts the run.
 * Returns the integrity fields the pruner relies on.
 */
export function validateManifestStructure(manifest, artifactBase) {
  const fail = (why) => {
    throw new Error(`manifest for ${artifactBase} ${why} — aborting, deleting nothing`);
  };
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('is not a JSON object');
  }
  if (typeof manifest.sha256 !== 'string' || !SHA256_HEX_RE.test(manifest.sha256)) {
    fail('has no well-formed sha256');
  }
  if (typeof manifest.file !== 'string' || path.basename(manifest.file) !== artifactBase) {
    fail('does not name this artifact');
  }
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0) {
    fail('has no positive integer byte count');
  }
  if (typeof manifest.format !== 'string' || manifest.format.length === 0) {
    fail('has no format');
  }
  return { sha256: manifest.sha256, plaintextBytes: manifest.bytes };
}

/**
 * Build the validated inventory. Throws (fail closed) on: a key outside the
 * prefix, an artifact whose manifest is missing/unloadable/structurally
 * invalid, or an invalid/implausible createdAt — including a createdAt
 * later than the object's server-side LastModified (+24h skew), which no
 * honest create-then-upload flow can produce. Non-artifact objects inside
 * the prefix are returned as `ignored` and are never deletion candidates.
 * Items carry the manifest SHA-256 and listed size for the integrity gate.
 */
export async function buildInventory(entries, loadManifest, { now = new Date() } = {}) {
  const items = [];
  const ignored = [];
  for (const entry of entries) {
    if (!entry.key.startsWith(BACKUP_PREFIX)) {
      throw new Error(`listed key outside the backup prefix: ${entry.key} — aborting`);
    }
    const base = path.basename(entry.key);
    if (!BACKUP_NAME_RE.test(base)) { ignored.push(entry.key); continue; }
    const manifestKey = entry.key.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json');
    let manifest;
    try {
      manifest = await loadManifest(manifestKey);
    } catch {
      throw new Error(`manifest missing or unreadable for ${base} — aborting, deleting nothing`);
    }
    const { sha256 } = validateManifestStructure(manifest, base);
    const createdAt = manifest?.createdAt;
    const when = typeof createdAt === 'string' ? new Date(createdAt) : new Date(NaN);
    if (Number.isNaN(when.getTime())) {
      throw new Error(`manifest for ${base} has no parseable createdAt — aborting, deleting nothing`);
    }
    if (when.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      throw new Error(`manifest for ${base} is dated implausibly in the future — aborting, deleting nothing`);
    }
    const lastModified = entry.lastModified ? new Date(entry.lastModified) : null;
    if (lastModified && !Number.isNaN(lastModified.getTime())
      && when.getTime() > lastModified.getTime() + FUTURE_SKEW_MS) {
      throw new Error(`manifest for ${base} claims creation after the object's upload time — aborting, deleting nothing`);
    }
    const listedSize = Number(entry.size);
    items.push({
      key: entry.key,
      manifestKey,
      createdAt: when.toISOString(),
      sha256,
      // Note: manifest.bytes is the PLAINTEXT length; the encrypted artifact
      // is gzip+framing, so sizes are never equated — the artifact's own
      // byte count is checked against the server listing at download time.
      size: Number.isSafeInteger(listedSize) && listedSize >= 0 ? listedSize : null,
    });
  }
  return { items, ignored };
}

/**
 * INTEGRITY GATE for one expiring candidate. Downloads the artifact in
 * full (streaming, constant memory) and recomputes its SHA-256. Aborts —
 * deleting nothing — unless ALL of the following hold:
 *   - the artifact exists and downloads without error;
 *   - it carries the AutoDine backup magic and minimum header size;
 *   - the recomputed hash equals the manifest's `sha256` (item.sha256);
 *   - the upload-time `x-amz-meta-sha256` metadata is present and equals
 *     the recomputed hash (metadata is a cross-check, never the source of
 *     truth; upload-b2.mjs always sets it, so absence = unverifiable);
 *   - the downloaded byte count equals the listed object size and the
 *     Content-Length, whenever those are known.
 * fetchArtifact(key) resolves { body, metadataSha256?, contentLength? }
 * where body is a Buffer/Uint8Array or an (async) iterable of chunks.
 */
export async function verifyArtifactCandidate(item, fetchArtifact) {
  const base = path.basename(item.key);
  let fetched;
  try {
    fetched = await fetchArtifact(item.key);
  } catch (error) {
    throw new Error(`artifact missing or unreadable for ${base} (${error?.message ?? error}) — aborting, deleting nothing`);
  }
  const body = fetched?.body;
  const hash = createHash('sha256');
  let total = 0;
  let head = Buffer.alloc(0);
  const consume = (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buf);
    total += buf.length;
    if (head.length < BACKUP_MAGIC.length) {
      head = Buffer.concat([head, buf.subarray(0, BACKUP_MAGIC.length - head.length)]);
    }
  };
  try {
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      consume(body);
    } else if (body && (typeof body[Symbol.asyncIterator] === 'function' || typeof body[Symbol.iterator] === 'function')) {
      for await (const chunk of body) consume(chunk);
    } else {
      throw new Error(`artifact for ${base} could not be read — aborting, deleting nothing`);
    }
  } catch (error) {
    if (String(error?.message ?? '').includes('could not be read')) throw error;
    throw new Error(`artifact download failed for ${base} (${error?.message ?? error}) — aborting, deleting nothing`);
  }

  if (total < MIN_ARTIFACT_BYTES || !head.equals(BACKUP_MAGIC)) {
    throw new Error(`artifact for ${base} is not a recognisable AutoDine backup (bad magic or truncated) — aborting, deleting nothing`);
  }
  const digest = hash.digest('hex');
  if (digest !== item.sha256) {
    throw new Error(`artifact SHA-256 does not match its manifest for ${base} — aborting, deleting nothing`);
  }
  const metadataSha = typeof fetched.metadataSha256 === 'string' ? fetched.metadataSha256.trim().toLowerCase() : '';
  if (!SHA256_HEX_RE.test(metadataSha)) {
    throw new Error(`artifact for ${base} has no trustworthy upload-time SHA-256 metadata — aborting, deleting nothing`);
  }
  if (metadataSha !== digest) {
    throw new Error(`artifact SHA-256 does not match its upload-time metadata for ${base} — aborting, deleting nothing`);
  }
  if (item.size != null && total !== item.size) {
    throw new Error(`artifact size mismatch for ${base}: downloaded ${total} byte(s), listing reports ${item.size} — aborting, deleting nothing`);
  }
  const contentLength = Number(fetched.contentLength);
  if (Number.isSafeInteger(contentLength) && contentLength >= 0 && total !== contentLength) {
    throw new Error(`artifact size mismatch for ${base}: downloaded ${total} byte(s), Content-Length ${contentLength} — aborting, deleting nothing`);
  }
  return { key: item.key, bytes: total, sha256: digest };
}

/**
 * PRE-DELETE RECHECK for one candidate. The verification download and the
 * DELETE are separate requests, so a same-key overwrite in between (only
 * possible for a credentialed writer — keys embed host + timestamp) would
 * otherwise be deleted unverified. Immediately before the pair's DELETEs,
 * a HEAD must still show the upload-time SHA-256 metadata and byte size
 * that the verification phase established (`evidence` = the
 * verifyArtifactCandidate result). Any drift, missing metadata or HEAD
 * failure aborts the run; pairs already deleted stay deleted and are
 * counted in the error. This narrows the verify→delete window to the
 * HEAD→DELETE round-trip; it cannot close it atomically (S3 has no
 * conditional delete the pruner can rely on here) — see the runbook's
 * known-limitations section. fetchHead(key) resolves
 * { metadataSha256?, contentLength? }.
 */
export async function assertArtifactUnchanged(item, evidence, fetchHead) {
  const base = path.basename(item.key);
  if (!evidence || !SHA256_HEX_RE.test(evidence.sha256 ?? '') || !Number.isSafeInteger(evidence.bytes)) {
    throw new Error(`no verification evidence for ${base} — refusing to delete, aborting`);
  }
  let head;
  try {
    head = await fetchHead(item.key);
  } catch (error) {
    throw new Error(`pre-delete recheck could not read ${base} (${error?.message ?? error}) — aborting`);
  }
  const metadataSha = typeof head?.metadataSha256 === 'string' ? head.metadataSha256.trim().toLowerCase() : '';
  if (!SHA256_HEX_RE.test(metadataSha)) {
    throw new Error(`pre-delete recheck for ${base} found no trustworthy upload-time SHA-256 metadata — aborting`);
  }
  if (metadataSha !== evidence.sha256) {
    throw new Error(`pre-delete recheck for ${base}: object changed since verification (upload metadata no longer matches the verified bytes) — aborting`);
  }
  const contentLength = Number(head?.contentLength);
  if (Number.isSafeInteger(contentLength) && contentLength >= 0 && contentLength !== evidence.bytes) {
    throw new Error(`pre-delete recheck for ${base}: object size changed since verification (${contentLength} != ${evidence.bytes} byte(s)) — aborting`);
  }
  return true;
}

/**
 * Compute the plan and, only with confirm=true, execute it fail-closed.
 * With confirm=true and at least one expiration, `verifyCandidate(item)`
 * and `recheckCandidate(item, evidence)` are both MANDATORY: every
 * candidate is verified (in plan order) before the first DELETE is
 * issued, and any verification failure aborts with zero deletions.
 * Immediately before each pair's DELETEs, the recheck must confirm the
 * object still matches its verification evidence. The delete cap is
 * enforced before verification, so an over-cap plan performs no
 * downloads and no deletions either.
 *
 * Pair deletion is artifact-first on purpose: if the artifact DELETE
 * fails, the pair is left intact and a re-run retries it cleanly. If the
 * manifest DELETE then fails, it is retried once; a persistent failure
 * aborts with the orphaned manifest key named (orphans are inert — later
 * runs report them ignored and never treat them as backups).
 */
export async function executePrune({ items, deleteObject, verifyCandidate, recheckCandidate, confirm = false, maxDelete = 50, policy } = {}) {
  const plan = planRetention(items, policy);
  if (plan.expire.length > maxDelete) {
    throw new Error(`refusing to delete ${plan.expire.length} artifacts (limit ${maxDelete}) — investigate before raising --max-delete`);
  }
  if (!confirm) return { dryRun: true, kept: plan.keep.length, expired: plan.expire.length, deleted: 0, verified: 0, newestKept: plan.newestKey };
  if (plan.expire.length > 0 && typeof verifyCandidate !== 'function') {
    throw new Error('refusing to delete unverified artifacts: no integrity verifier configured — aborting, deleting nothing');
  }
  if (plan.expire.length > 0 && typeof recheckCandidate !== 'function') {
    throw new Error('refusing to delete without a pre-delete recheck: no recheck configured — aborting, deleting nothing');
  }
  const evidences = [];
  for (const item of plan.expire) {
    try {
      evidences.push((await verifyCandidate(item)) ?? null);
    } catch (error) {
      throw new Error(`integrity verification failed for ${path.basename(item.key)} — aborting before any deletion: ${error?.message ?? error}`);
    }
  }
  let deleted = 0;
  for (const [index, item] of plan.expire.entries()) {
    const base = path.basename(item.key);
    try {
      await recheckCandidate(item, evidences[index]);
    } catch (error) {
      throw new Error(`pre-delete recheck failed for ${base} after ${deleted} artifact(s) deleted — aborting: ${error?.message ?? error}`);
    }
    try {
      await deleteObject(item.key);
    } catch (error) {
      throw new Error(`DELETE failed for artifact ${base} after ${deleted} artifact(s) deleted — pair left intact, safe to re-run: ${error?.message ?? error}`);
    }
    try {
      await deleteObject(item.manifestKey);
    } catch {
      try {
        await deleteObject(item.manifestKey);
      } catch (error) {
        throw new Error(`artifact ${base} deleted but its manifest could not be deleted after a retry — orphaned manifest ${item.manifestKey} remains (ignored by later runs; safe to delete manually); ${deleted} artifact(s) fully deleted before it: ${error?.message ?? error}`);
      }
    }
    deleted += 1;
  }
  return { dryRun: false, kept: plan.keep.length, expired: plan.expire.length, deleted, verified: evidences.length, newestKept: plan.newestKey };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const maxDeleteRaw = args.find((a) => a.startsWith('--max-delete='))?.slice('--max-delete='.length);
  if (maxDeleteRaw !== undefined && !/^\d+$/.test(maxDeleteRaw)) {
    process.stderr.write('prune-b2: --max-delete must be a non-negative integer\n');
    process.exit(2);
  }
  const maxDelete = maxDeleteRaw === undefined ? 50 : Number(maxDeleteRaw);

  const config = b2ConfigFromEnv(process.env);
  if (!config.ok) {
    process.stderr.write(`prune-b2: B2 is not configured; missing environment variables: ${config.missing.join(', ')}\n`);
    process.exit(2);
  }
  const access = { accessKeyId: process.env.B2_ACCESS_KEY_ID, secretAccessKey: process.env.B2_SECRET_ACCESS_KEY };
  const objectUrl = (key) => `${config.endpoint}/${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  // Verification downloads stream whole artifacts; give them a generous
  // timeout so a large backup on a slow link fails safe (abort) only when
  // truly stuck, not at the 120s control-plane budget.
  const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 600000;
  async function signedFetch(method, urlString, body, timeoutMs = 120000) {
    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    const headers = signB2Request({ method, url: urlString, payloadHash, ...access, region: config.region });
    return fetch(urlString, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  }
  const headObject = async (key) => {
    const res = await signedFetch('HEAD', objectUrl(key));
    if (!res.ok) throw new Error(`HEAD failed with HTTP ${res.status}`);
    const contentLength = Number(res.headers.get('content-length'));
    return {
      metadataSha256: res.headers.get('x-amz-meta-sha256'),
      contentLength: Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null,
    };
  };

  try {
    const entries = await listAllRemoteObjects(async (token) => {
      const query = token
        ? `continuation-token=${encodeURIComponent(token)}&list-type=2&prefix=${encodeURIComponent(BACKUP_PREFIX)}`
        : `list-type=2&prefix=${encodeURIComponent(BACKUP_PREFIX)}`;
      const res = await signedFetch('GET', `${config.endpoint}/${config.bucket}?${query}`);
      if (!res.ok) throw new Error(`LIST failed with HTTP ${res.status}`);
      const xml = await res.text();
      const sizes = parseListSizes(xml);
      return {
        entries: parseB2ListXml(xml).map((e) => ({ ...e, size: sizes.get(e.key) ?? null })),
        nextToken: b2ListContinuationToken(xml),
        truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
      };
    });

    const { items, ignored } = await buildInventory(entries, async (manifestKey) => {
      const res = await signedFetch('GET', objectUrl(manifestKey));
      if (!res.ok) throw new Error(`manifest GET HTTP ${res.status}`);
      return JSON.parse(await res.text());
    });

    const report = await executePrune({
      items,
      confirm,
      maxDelete,
      verifyCandidate: (item) => verifyArtifactCandidate(item, async (key) => {
        const res = await signedFetch('GET', objectUrl(key), undefined, ARTIFACT_DOWNLOAD_TIMEOUT_MS);
        if (!res.ok) throw new Error(`artifact GET failed with HTTP ${res.status}`);
        const contentLength = Number(res.headers.get('content-length'));
        return {
          body: res.body,
          metadataSha256: res.headers.get('x-amz-meta-sha256'),
          contentLength: Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null,
        };
      }),
      recheckCandidate: (item, evidence) => assertArtifactUnchanged(item, evidence, headObject),
      deleteObject: async (key) => {
        const res = await signedFetch('DELETE', objectUrl(key));
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      },
    });
    process.stdout.write(JSON.stringify({ ...report, ignoredForeignObjects: ignored.length, bucket: config.bucket, prefix: BACKUP_PREFIX }, null, 2) + '\n');
    if (!confirm) process.stdout.write('prune-b2: dry-run only — re-run with --confirm to verify and delete the expired artifacts listed above (every candidate is integrity-verified before the first deletion).\n');
  } catch (error) {
    process.stderr.write(`prune-b2: ABORTED — ${error?.message ?? error}\n`);
    process.exit(1);
  }
}
