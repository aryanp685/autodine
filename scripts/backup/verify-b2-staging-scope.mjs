#!/usr/bin/env node
/**
 * Read-only Backblaze authorization preflight for the hosted staging drill.
 *
 * It proves the configured application key is restricted to the designated
 * staging bucket ID/name and carries the minimum read/write/list capabilities.
 * No bucket listing, object read/write, mutation, or secret output occurs.
 */

const required = ['B2_ACCESS_KEY_ID', 'B2_SECRET_ACCESS_KEY', 'B2_BUCKET', 'B2_EXPECTED_BUCKET_ID', 'AUTODINE_STAGING_B2_BUCKET'];
if (required.some((name) => !process.env[name])) {
  console.error('B2 staging scope verification failed: required configuration is missing.');
  process.exit(2);
}

const expectedName = process.env.AUTODINE_STAGING_B2_BUCKET;
const expectedId = process.env.B2_EXPECTED_BUCKET_ID;
if (process.env.B2_BUCKET !== expectedName) {
  console.error('B2 staging scope verification failed: configured and designated bucket names differ.');
  process.exit(1);
}

const fail = () => {
  console.error('B2 staging scope verification failed; inspect the restricted key privately.');
  process.exit(1);
};

try {
  const basic = Buffer.from(`${process.env.B2_ACCESS_KEY_ID}:${process.env.B2_SECRET_ACCESS_KEY}`).toString('base64');
  const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { authorization: `Basic ${basic}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail();
  const body = await response.json();
  const allowed = body?.allowed;
  if (!allowed || typeof allowed !== 'object') fail();

  // B2 v2/v3 expose bucketId/bucketName; v4 may expose a buckets array.
  const scopes = Array.isArray(allowed.buckets)
    ? allowed.buckets.map((bucket) => ({ id: bucket?.id ?? bucket?.bucketId, name: bucket?.name ?? bucket?.bucketName }))
    : [{ id: allowed.bucketId, name: allowed.bucketName }];
  if (scopes.length !== 1 || scopes[0].id !== expectedId || scopes[0].name !== expectedName) fail();

  const capabilities = new Set(Array.isArray(allowed.capabilities) ? allowed.capabilities : []);
  for (const capability of ['listFiles', 'readFiles', 'writeFiles']) {
    if (!capabilities.has(capability)) fail();
  }
  const prefix = allowed.namePrefix;
  if (prefix != null && prefix !== '' && prefix !== 'autodine-backups/') fail();

  console.log(`B2 staging scope verified: bucket=${expectedName} bucket_id=${expectedId} prefix=${prefix || 'bucket-wide'}.`);
} catch {
  fail();
}
