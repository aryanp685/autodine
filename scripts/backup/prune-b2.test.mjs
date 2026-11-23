import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  planRetention, listAllRemoteObjects, buildInventory, executePrune,
  validateManifestStructure, verifyArtifactCandidate, assertArtifactUnchanged, parseListSizes, parseListingTruncated,
} from './prune-b2.mjs';
import { encryptBuffer, sha256 } from './lib-crypto.mjs';

const item = (key, createdAt, extra = {}) => ({
  key: `autodine-backups/${key}`,
  manifestKey: `autodine-backups/${key.replace(/\.sql\.gz\.enc$/, '.manifest.json')}`,
  createdAt,
  sha256: '0'.repeat(64),
  size: null,
  ...extra,
});

// A structurally valid manifest for `base`, as backup-logical.mjs writes it.
const goodManifest = (base, overrides = {}) => ({
  format: 'autodine-logical-1',
  bytes: 1234,
  sha256: 'a'.repeat(64),
  file: base,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// A real encrypted artifact (real magic/framing), as backup-logical.mjs writes it.
const realArtifact = () => encryptBuffer(Buffer.from('select 1; -- a real backup payload'), 'test-passphrase-long-enough');

test('retention boundaries: 14 daily + weekly/monthly representatives survive a 220-day daily history', () => {
  const items = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 220; i += 1) {
    const d = new Date(start + i * 86400000);
    items.push(item(`autodine-x-${d.toISOString().slice(0, 10)}.sql.gz.enc`, d.toISOString()));
  }
  const { keep, expire, newestKey } = planRetention(items);
  assert.equal(newestKey, items[items.length - 1].key);
  const keptDays = new Set(keep.map((k) => k.createdAt.slice(0, 10)));
  // The newest 14 calendar days are all kept.
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(start + (219 - i) * 86400000).toISOString().slice(0, 10);
    assert.ok(keptDays.has(d), `daily tier missing ${d}`);
  }
  // Kept set stays bounded: 14 daily days + at most 8 week reps + 6 month reps
  // (one item per day in this fixture, so kept count is bounded by kept days).
  assert.ok(keep.length <= 14 + 8 + 6, `kept ${keep.length}`);
  assert.ok(expire.length > 150, 'the bulk of a 220-day history must expire');
  // An old day that is neither newest-14 nor a week/month representative expires:
  const day100 = new Date(start + 100 * 86400000).toISOString().slice(0, 10);
  const kept100 = keep.some((k) => k.createdAt.slice(0, 10) === day100);
  const firstOfThatMonthKept = keep.some((k) => k.createdAt.slice(0, 7) === day100.slice(0, 7) && k.createdAt.slice(8, 10) <= '07');
  assert.ok(!kept100 || firstOfThatMonthKept);
});

test('the newest backup survives even a zero retention policy', () => {
  const items = [item('autodine-a-1.sql.gz.enc', '2026-01-01T00:00:00Z'), item('autodine-a-2.sql.gz.enc', '2026-01-02T00:00:00Z')];
  const { keep, expire, newestKey } = planRetention(items, { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 });
  assert.equal(newestKey, items[1].key);
  assert.deepEqual(keep.map((k) => k.key), [items[1].key]);
  assert.deepEqual(expire.map((k) => k.key), [items[0].key]);
});

test('multiple backups on one day are kept or expired together', () => {
  const items = [
    item('autodine-a-1.sql.gz.enc', '2026-01-01T01:00:00Z'),
    item('autodine-a-2.sql.gz.enc', '2026-01-01T23:00:00Z'),
    item('autodine-a-3.sql.gz.enc', '2026-03-01T01:00:00Z'),
  ];
  const { keep, expire } = planRetention(items, { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 });
  const dayOne = items.slice(0, 2).map((i) => i.key);
  const keptCount = dayOne.filter((k) => keep.some((x) => x.key === k)).length;
  assert.ok(keptCount === 0 || keptCount === 2, 'same-day backups must never be split');
  assert.equal(expire.filter((x) => dayOne.includes(x.key)).length, 2 - keptCount);
});

test('listing refuses missing, invalid or ambiguous truncation flags before retention', async () => {
  assert.equal(parseListingTruncated('<IsTruncated>false</IsTruncated>'), false);
  assert.equal(parseListingTruncated('<IsTruncated>true</IsTruncated>'), true);
  for (const xml of ['', '<IsTruncated>unknown</IsTruncated>', '<IsTruncated>true</IsTruncated><IsTruncated>false</IsTruncated>']) {
    assert.throws(() => parseListingTruncated(xml), /invalid truncation/);
  }
  await assert.rejects(() => listAllRemoteObjects(async () => ({ entries: [], truncated: undefined })), /invalid truncation/);
});

test('listing: pagination completes, truncation without token aborts, repeated token aborts, HTTP failure aborts', async () => {
  const pages = new Map([
    [null, { entries: [{ key: 'a' }], nextToken: 't1', truncated: true }],
    ['t1', { entries: [{ key: 'b' }], nextToken: null, truncated: false }],
  ]);
  const all = await listAllRemoteObjects(async (token) => pages.get(token));
  assert.equal(all.length, 2);

  await assert.rejects(() => listAllRemoteObjects(async () => ({ entries: [], nextToken: null, truncated: true })), /truncated without/);
  await assert.rejects(() => listAllRemoteObjects(async () => ({ entries: [], nextToken: 'loop', truncated: true })), /repeated/);
  await assert.rejects(() => listAllRemoteObjects(async () => { throw new Error('HTTP 500'); }), /HTTP 500/);
});

test('listing sizes: parseListSizes extracts per-key byte sizes', () => {
  const xml = `<ListBucketResult>
    <Contents><Key>autodine-backups/a.sql.gz.enc</Key><Size>12345</Size></Contents>
    <Contents><Key>autodine-backups/b.sql.gz.enc</Key><Size>0</Size></Contents>
    <Contents><Key>autodine-backups/c.sql.gz.enc</Key></Contents>
  </ListBucketResult>`;
  const sizes = parseListSizes(xml);
  assert.equal(sizes.get('autodine-backups/a.sql.gz.enc'), 12345);
  assert.equal(sizes.get('autodine-backups/b.sql.gz.enc'), 0);
  assert.equal(sizes.has('autodine-backups/c.sql.gz.enc'), false);
});

test('inventory: missing manifest, bad or future timestamps, and foreign keys all fail closed', async () => {
  const good = { key: 'autodine-backups/autodine-a-1.sql.gz.enc', lastModified: '' };
  const load = async () => goodManifest('autodine-a-1.sql.gz.enc');
  const ok = await buildInventory([good, { key: 'autodine-backups/notes.txt', lastModified: '' }], load, { now: new Date('2026-06-01') });
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].sha256, 'a'.repeat(64));
  assert.deepEqual(ok.ignored, ['autodine-backups/notes.txt']);

  await assert.rejects(() => buildInventory([good], async () => { throw new Error('404'); }), /deleting nothing/);
  await assert.rejects(() => buildInventory([good], async () => goodManifest('autodine-a-1.sql.gz.enc', { createdAt: 'not-a-date' })), /parseable createdAt/);
  await assert.rejects(() => buildInventory([good], load, { now: new Date('2025-01-01') }), /implausibly in the future/);
  await assert.rejects(() => buildInventory([{ key: 'other-prefix/autodine-a.sql.gz.enc', lastModified: '' }], load), /outside the backup prefix/);
});

test('inventory: structurally invalid or tampered manifests fail closed', async () => {
  const good = { key: 'autodine-backups/autodine-a-1.sql.gz.enc', lastModified: '2026-01-01T00:05:00Z' };
  const base = 'autodine-a-1.sql.gz.enc';
  const variants = [
    ['null manifest', null],
    ['array manifest', []],
    ['string manifest', 'not-an-object'],
    ['missing sha256', goodManifest(base, { sha256: undefined })],
    ['short sha256', goodManifest(base, { sha256: 'abc123' })],
    ['uppercase sha256', goodManifest(base, { sha256: 'A'.repeat(64) })],
    ['non-hex sha256', goodManifest(base, { sha256: 'z'.repeat(64) })],
    ['missing file', goodManifest(base, { file: undefined })],
    ['tampered file name', goodManifest(base, { file: 'autodine-a-2.sql.gz.enc' })],
    ['zero bytes', goodManifest(base, { bytes: 0 })],
    ['negative bytes', goodManifest(base, { bytes: -10 })],
    ['fractional bytes', goodManifest(base, { bytes: 12.5 })],
    ['string bytes', goodManifest(base, { bytes: '1234' })],
    ['missing format', goodManifest(base, { format: undefined })],
    ['empty format', goodManifest(base, { format: '' })],
  ];
  for (const [label, manifest] of variants) {
    await assert.rejects(
      () => buildInventory([good], async () => manifest, { now: new Date('2026-06-01') }),
      /deleting nothing/,
      label,
    );
  }
  // The structural validator itself returns the integrity fields it checked.
  assert.deepEqual(validateManifestStructure(goodManifest(base), base), { sha256: 'a'.repeat(64), plaintextBytes: 1234 });
});

test('inventory: createdAt later than the server upload time fails closed (tamper/skew)', async () => {
  const entry = { key: 'autodine-backups/autodine-a-1.sql.gz.enc', lastModified: '2026-01-01T00:05:00Z' };
  // Manifest claims creation a day AFTER the object was uploaded: impossible
  // for an honest create-then-upload flow.
  await assert.rejects(
    () => buildInventory([entry], async () => goodManifest('autodine-a-1.sql.gz.enc', { createdAt: '2026-01-03T00:00:00Z' }), { now: new Date('2026-06-01') }),
    /claims creation after the object's upload time/,
  );
  // Created minutes before upload: the normal scheduled flow, accepted.
  const ok = await buildInventory([entry], async () => goodManifest('autodine-a-1.sql.gz.enc'), { now: new Date('2026-06-01') });
  assert.equal(ok.items.length, 1);
  // A listed size is carried through for the download-size check.
  const sized = await buildInventory([{ ...entry, size: 4321 }], async () => goodManifest('autodine-a-1.sql.gz.enc'), { now: new Date('2026-06-01') });
  assert.equal(sized.items[0].size, 4321);
});

test('integrity gate: a genuine artifact verifies against manifest, metadata and size', async () => {
  const bytes = realArtifact();
  const digest = sha256(bytes);
  const candidate = item('autodine-a-1.sql.gz.enc', '2026-01-01T00:00:00Z', { sha256: digest, size: bytes.length });
  const result = await verifyArtifactCandidate(candidate, async () => ({
    body: bytes, metadataSha256: digest, contentLength: bytes.length,
  }));
  assert.deepEqual(result, { key: candidate.key, bytes: bytes.length, sha256: digest });

  // Streaming bodies (what the CLI passes from fetch) verify identically.
  async function* stream() { yield bytes.subarray(0, 10); yield bytes.subarray(10); }
  const streamed = await verifyArtifactCandidate(candidate, async () => ({ body: stream(), metadataSha256: digest }));
  assert.equal(streamed.bytes, bytes.length);
});

test('integrity gate: adversarial artifacts and manifests are all rejected', async () => {
  const bytes = realArtifact();
  const digest = sha256(bytes);
  const candidate = item('autodine-a-1.sql.gz.enc', '2026-01-01T00:00:00Z', { sha256: digest, size: bytes.length });
  const goodFetch = async () => ({ body: bytes, metadataSha256: digest, contentLength: bytes.length });

  // Incorrect SHA-256 in the manifest (tampered manifest / wrong pairing).
  await assert.rejects(
    () => verifyArtifactCandidate({ ...candidate, sha256: 'b'.repeat(64) }, goodFetch),
    /SHA-256 does not match its manifest/,
  );
  // Tampered artifact bytes (single flipped byte) no longer match the manifest.
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] ^= 0xff;
  await assert.rejects(
    () => verifyArtifactCandidate(candidate, async () => ({ body: tampered, metadataSha256: digest })),
    /SHA-256 does not match its manifest/,
  );
  // Metadata mismatch: upload-time metadata names different bytes.
  await assert.rejects(
    () => verifyArtifactCandidate(candidate, async () => ({ body: bytes, metadataSha256: 'c'.repeat(64) })),
    /does not match its upload-time metadata/,
  );
  // Metadata missing entirely: provenance unverifiable, fail closed.
  await assert.rejects(
    () => verifyArtifactCandidate(candidate, async () => ({ body: bytes, metadataSha256: null })),
    /no trustworthy upload-time SHA-256 metadata/,
  );
  await assert.rejects(
    () => verifyArtifactCandidate(candidate, async () => ({ body: bytes, metadataSha256: 'not-a-hash' })),
    /no trustworthy upload-time SHA-256 metadata/,
  );
  // Incorrect size: listing disagrees with the downloaded byte count.
  await assert.rejects(
    () => verifyArtifactCandidate({ ...candidate, size: bytes.length + 1 }, goodFetch),
    /size mismatch.*listing reports/,
  );
  // Incorrect size: Content-Length disagrees with the downloaded byte count.
  await assert.rejects(
    () => verifyArtifactCandidate(candidate, async () => ({ body: bytes, metadataSha256: digest, contentLength: bytes.length - 5 })),
    /size mismatch.*Content-Length/,
  );
  // Missing artifact: the GET fails (404 etc.) before any deletion.
  await assert.rejects(
    () => verifyArtifactCandidate(candidate, async () => { throw new Error('artifact GET failed with HTTP 404'); }),
    /artifact missing or unreadable/,
  );
  // Not an AutoDine backup at all — even with a self-consistent hash, the
  // magic check rejects bytes that were never produced by the pipeline.
  const foreign = Buffer.alloc(200, 9);
  await assert.rejects(
    () => verifyArtifactCandidate(
      { ...candidate, sha256: sha256(foreign), size: foreign.length },
      async () => ({ body: foreign, metadataSha256: sha256(foreign) }),
    ),
    /not a recognisable AutoDine backup/,
  );
  // Truncated artifact (valid prefix, cut short).
  const truncatedBytes = bytes.subarray(0, 30);
  await assert.rejects(
    () => verifyArtifactCandidate(
      { ...candidate, sha256: sha256(truncatedBytes), size: truncatedBytes.length },
      async () => ({ body: truncatedBytes, metadataSha256: sha256(truncatedBytes) }),
    ),
    /not a recognisable AutoDine backup/,
  );
});

test('execution: dry-run deletes and verifies nothing; the cap refuses before any verification or deletion', async () => {
  const items = [
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z'),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z'),
  ];
  let verifyCalls = 0; let recheckCalls = 0; let deleteCalls = 0;
  const verifyCandidate = async () => { verifyCalls += 1; };
  const recheckCandidate = async () => { recheckCalls += 1; };
  const deleteObject = async () => { deleteCalls += 1; };
  const zeroPolicy = { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 };

  const dry = await executePrune({ items, deleteObject, verifyCandidate, recheckCandidate, confirm: false, policy: zeroPolicy });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.verified, 0);
  assert.equal(verifyCalls, 0);
  assert.equal(recheckCalls, 0);
  assert.equal(deleteCalls, 0);

  await assert.rejects(
    () => executePrune({ items, deleteObject, verifyCandidate, recheckCandidate, confirm: true, maxDelete: 0, policy: zeroPolicy }),
    /refusing to delete/,
  );
  assert.equal(verifyCalls, 0, 'cap refusal must happen before any download/verification');
  assert.equal(recheckCalls, 0);
  assert.equal(deleteCalls, 0);
});

test('execution: confirm without an integrity verifier (or without a recheck) refuses to delete anything', async () => {
  const items = [
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z'),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z'),
  ];
  const deleted = [];
  const deleteObject = async (k) => { deleted.push(k); };
  const zeroPolicy = { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 };
  await assert.rejects(
    () => executePrune({ items, deleteObject, confirm: true, policy: zeroPolicy }),
    /refusing to delete unverified/,
  );
  await assert.rejects(
    () => executePrune({ items, deleteObject, verifyCandidate: async () => ({}), confirm: true, policy: zeroPolicy }),
    /refusing to delete without a pre-delete recheck/,
  );
  assert.deepEqual(deleted, []);

  // Nothing expiring => nothing to verify or recheck => confirm succeeds.
  const kept = await executePrune({ items: [items[1]], deleteObject, confirm: true, policy: zeroPolicy });
  assert.equal(kept.deleted, 0);
  assert.deepEqual(deleted, []);
});

test('execution: ALL candidates are verified before the first DELETE; one failure deletes nothing', async () => {
  const items = [
    item('autodine-a-oldest.sql.gz.enc', '2025-12-30T00:00:00Z'),
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z'),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z'),
  ];
  const order = [];
  const okVerifier = async (candidate) => { order.push(`verify:${path.basename(candidate.key)}`); return { sha256: 'd'.repeat(64), bytes: 100 }; };
  const okRecheck = async (candidate) => { order.push(`recheck:${path.basename(candidate.key)}`); };
  const deleter = async (key) => { order.push(`delete:${path.basename(key)}`); };
  const zeroPolicy = { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 };

  const done = await executePrune({ items, deleteObject: deleter, verifyCandidate: okVerifier, recheckCandidate: okRecheck, confirm: true, policy: zeroPolicy });
  assert.equal(done.deleted, 2);
  assert.equal(done.verified, 2);
  // Every verify:* precedes every recheck:*/delete:*; each pair is then
  // rechecked immediately before its own deletes (recheck, artifact,
  // manifest).
  const firstDelete = order.findIndex((e) => e.startsWith('delete:'));
  const verifyIdx = order.map((e, i) => (e.startsWith('verify:') ? i : -1)).filter((i) => i >= 0);
  assert.equal(verifyIdx.length, 2);
  assert.ok(Math.max(...verifyIdx) < firstDelete, order.join(','));
  const oldest = 'autodine-a-oldest.sql.gz.enc';
  const recheckIdx = order.indexOf(`recheck:${oldest}`);
  assert.deepEqual(order.slice(recheckIdx, recheckIdx + 3), [
    `recheck:${oldest}`,
    `delete:${oldest}`,
    'delete:autodine-a-oldest.manifest.json',
  ], order.join(','));

  // Second candidate fails verification => ZERO deletions, even though the
  // first candidate verified cleanly.
  order.length = 0;
  let calls = 0;
  const flakyVerifier = async (candidate) => {
    calls += 1; order.push(`verify:${path.basename(candidate.key)}`);
    if (calls === 2) throw new Error('artifact SHA-256 does not match its manifest');
  };
  await assert.rejects(
    () => executePrune({ items, deleteObject: deleter, verifyCandidate: flakyVerifier, recheckCandidate: okRecheck, confirm: true, policy: zeroPolicy }),
    /integrity verification failed.*aborting before any deletion/,
  );
  assert.equal(order.filter((e) => e.startsWith('delete:')).length, 0);
});

test('execution: a failed artifact DELETE leaves the pair intact and stops the run', async () => {
  const items = [
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z'),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z'),
  ];
  const attempted = [];
  await assert.rejects(
    () => executePrune({
      items: [...items, item('autodine-a-older.sql.gz.enc', '2025-12-31T00:00:00Z')],
      deleteObject: async (key) => { attempted.push(key); throw new Error('HTTP 503'); },
      verifyCandidate: async () => ({ sha256: 'd'.repeat(64), bytes: 1 }),
      recheckCandidate: async () => {},
      confirm: true,
      policy: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
    }),
    /DELETE failed for artifact.*pair left intact/,
  );
  // Exactly one delete attempted (the artifact); its manifest was never
  // touched, so the pair survives whole for a clean re-run.
  assert.equal(attempted.length, 1);
  assert.ok(attempted[0].endsWith('.sql.gz.enc'));
});

test('execution: manifest DELETE is retried once; persistent failure names the orphan', async () => {
  const bytes = realArtifact();
  const digest = sha256(bytes);
  const mkItems = () => [
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z', { sha256: digest, size: bytes.length }),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z', { sha256: digest, size: bytes.length }),
  ];
  const verify = (candidate) => verifyArtifactCandidate(candidate, async () => ({ body: bytes, metadataSha256: digest }));
  const recheck = (candidate, evidence) => assertArtifactUnchanged(candidate, evidence, async () => ({ metadataSha256: digest, contentLength: bytes.length }));
  const zeroPolicy = { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 };

  // Transient manifest failure: one retry recovers, pair fully deleted.
  const deletedTransient = [];
  let manifestAttempts = 0;
  const doneTransient = await executePrune({
    items: mkItems(),
    verifyCandidate: verify,
    recheckCandidate: recheck,
    deleteObject: async (key) => {
      if (key.endsWith('.manifest.json')) { manifestAttempts += 1; if (manifestAttempts === 1) throw new Error('HTTP 503'); }
      deletedTransient.push(key);
    },
    confirm: true,
    policy: zeroPolicy,
  });
  assert.equal(doneTransient.deleted, 1);
  assert.equal(manifestAttempts, 2);
  assert.deepEqual(deletedTransient.sort(), ['autodine-backups/autodine-a-old.manifest.json', 'autodine-backups/autodine-a-old.sql.gz.enc'].sort());

  // Persistent manifest failure: artifact is gone, abort names the orphan.
  const deletedPersistent = [];
  await assert.rejects(
    () => executePrune({
      items: mkItems(),
      verifyCandidate: verify,
      recheckCandidate: recheck,
      deleteObject: async (key) => {
        if (key.endsWith('.manifest.json')) throw new Error('HTTP 503');
        deletedPersistent.push(key);
      },
      confirm: true,
      policy: zeroPolicy,
    }),
    /orphaned manifest autodine-backups\/autodine-a-old\.manifest\.json remains/,
  );
  assert.deepEqual(deletedPersistent, ['autodine-backups/autodine-a-old.sql.gz.enc']);
});

test('recheck: an object changed since verification is never deleted', async () => {
  const bytes = realArtifact();
  const digest = sha256(bytes);
  const candidate = item('autodine-a-1.sql.gz.enc', '2026-01-01T00:00:00Z', { sha256: digest, size: bytes.length });
  const evidence = { key: candidate.key, bytes: bytes.length, sha256: digest };

  // Unchanged: HEAD still shows the verified metadata + size.
  assert.equal(await assertArtifactUnchanged(candidate, evidence, async () => ({ metadataSha256: digest, contentLength: bytes.length })), true);
  // Overwritten since verification: metadata now names different bytes.
  await assert.rejects(
    () => assertArtifactUnchanged(candidate, evidence, async () => ({ metadataSha256: 'e'.repeat(64), contentLength: bytes.length })),
    /changed since verification/,
  );
  // Size drifted.
  await assert.rejects(
    () => assertArtifactUnchanged(candidate, evidence, async () => ({ metadataSha256: digest, contentLength: bytes.length + 1 })),
    /size changed since verification/,
  );
  // Metadata vanished (object replaced without upload metadata).
  await assert.rejects(
    () => assertArtifactUnchanged(candidate, evidence, async () => ({ metadataSha256: null, contentLength: bytes.length })),
    /no trustworthy upload-time SHA-256 metadata/,
  );
  // HEAD itself fails (object gone).
  await assert.rejects(
    () => assertArtifactUnchanged(candidate, evidence, async () => { throw new Error('HEAD failed with HTTP 404'); }),
    /could not read/,
  );
  // No evidence (verifier returned nothing): refuse rather than guess.
  await assert.rejects(
    () => assertArtifactUnchanged(candidate, null, async () => ({ metadataSha256: digest })),
    /no verification evidence/,
  );

  // Integration: recheck fails on the SECOND pair — first pair is already
  // deleted (counted in the error), the changed pair is untouched.
  const items = [
    item('autodine-a-oldest.sql.gz.enc', '2025-12-30T00:00:00Z', { sha256: digest, size: bytes.length }),
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z', { sha256: digest, size: bytes.length }),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z', { sha256: digest, size: bytes.length }),
  ];
  const deleted = [];
  let rechecks = 0;
  await assert.rejects(
    () => executePrune({
      items,
      verifyCandidate: verify2 => verifyArtifactCandidate(verify2, async () => ({ body: bytes, metadataSha256: digest })),
      recheckCandidate: async (candidate, ev) => {
        rechecks += 1;
        if (rechecks === 2) throw new Error('object changed since verification (simulated overwrite)');
        return assertArtifactUnchanged(candidate, ev, async () => ({ metadataSha256: digest, contentLength: bytes.length }));
      },
      deleteObject: async (key) => { deleted.push(key); },
      confirm: true,
      policy: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
    }),
    /pre-delete recheck failed for autodine-a-oldest\.sql\.gz\.enc after 1 artifact\(s\) deleted/,
  );
  assert.deepEqual(deleted.sort(), ['autodine-backups/autodine-a-old.manifest.json', 'autodine-backups/autodine-a-old.sql.gz.enc'].sort());
});

test('execution: end-to-end — expired pair verifies, rechecks, then deletes; newest is untouchable', async () => {
  const bytes = realArtifact();
  const digest = sha256(bytes);
  const items = [
    item('autodine-a-old.sql.gz.enc', '2026-01-01T00:00:00Z', { sha256: digest, size: bytes.length }),
    item('autodine-a-new.sql.gz.enc', '2026-01-02T00:00:00Z', { sha256: digest, size: bytes.length }),
  ];
  const deleted = [];
  const done = await executePrune({
    items,
    verifyCandidate: (candidate) => verifyArtifactCandidate(candidate, async () => ({ body: bytes, metadataSha256: digest })),
    recheckCandidate: (candidate, evidence) => assertArtifactUnchanged(candidate, evidence, async () => ({ metadataSha256: digest, contentLength: bytes.length })),
    deleteObject: async (key) => { deleted.push(key); },
    confirm: true,
    policy: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
  });
  assert.equal(done.deleted, 1);
  assert.equal(done.verified, 1);
  assert.deepEqual(deleted.sort(), ['autodine-backups/autodine-a-old.manifest.json', 'autodine-backups/autodine-a-old.sql.gz.enc'].sort());
});

test('CLI rejects a malformed --max-delete before anything else', () => {
  const script = path.join(import.meta.dirname, 'prune-b2.mjs');
  for (const argv of [['--max-delete=abc'], ['--max-delete=-1'], ['--max-delete=1e9'], ['--max-delete='], ['--confirm', '--max-delete=2.5']]) {
    const run = spawnSync(process.execPath, [script, ...argv], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(run.status, 2, argv.join(' '));
    assert.match(run.stderr, /--max-delete must be a non-negative integer/);
  }
});

test('CLI fails closed with missing-config NAMES only (no B2 contact, no deletion)', () => {
  const script = path.join(import.meta.dirname, 'prune-b2.mjs');
  for (const argv of [[], ['--confirm']]) {
    const run = spawnSync(process.execPath, [script, ...argv], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, B2_SECRET_ACCESS_KEY: 'SENTINEL-SECRET-DO-NOT-LEAK' },
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /B2_BUCKET/);
    assert.ok(!run.stderr.includes('SENTINEL-SECRET-DO-NOT-LEAK'));
    assert.ok(!run.stdout.includes('SENTINEL-SECRET-DO-NOT-LEAK'));
  }
});
