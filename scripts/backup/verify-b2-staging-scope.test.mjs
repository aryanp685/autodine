#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./verify-b2-staging-scope.mjs', import.meta.url);
const base = {
  B2_ACCESS_KEY_ID: 'test-id',
  B2_SECRET_ACCESS_KEY: 'test-secret',
  B2_BUCKET: 'autodine-staging-db-backups',
  B2_EXPECTED_BUCKET_ID: 'd209a0cc2db8f17fac100514',
  AUTODINE_STAGING_B2_BUCKET: 'autodine-staging-db-backups',
};

function run(payload, overrides = {}) {
  const bootstrap = `
    globalThis.fetch = async () => ({ ok: true, json: async () => (${JSON.stringify(payload)}) });
    await import(${JSON.stringify(script.href)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...base, ...overrides },
  });
}

const good = {
  allowed: {
    bucketId: 'd209a0cc2db8f17fac100514',
    bucketName: 'autodine-staging-db-backups',
    namePrefix: 'autodine-backups/',
    capabilities: ['listFiles', 'readFiles', 'writeFiles'],
  },
};

test('accepts exactly the designated bucket and required capabilities without exposing credentials', () => {
  const result = run(good);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bucket_id=d209a0cc2db8f17fac100514/);
  assert.doesNotMatch(result.stdout + result.stderr, /test-secret|test-id/);
});

test('accepts the v4 single-bucket representation', () => {
  const result = run({ allowed: { buckets: [{ id: base.B2_EXPECTED_BUCKET_ID, name: base.B2_BUCKET }], capabilities: ['writeFiles', 'readFiles', 'listFiles'] } });
  assert.equal(result.status, 0, result.stderr);
});

test('refuses an account-wide key', () => {
  const result = run({ allowed: { bucketId: null, bucketName: null, capabilities: ['listFiles', 'readFiles', 'writeFiles'] } });
  assert.equal(result.status, 1);
});

test('refuses a wrong bucket id or name', () => {
  assert.equal(run({ allowed: { ...good.allowed, bucketId: 'wrong' } }).status, 1);
  assert.equal(run({ allowed: { ...good.allowed, bucketName: 'production' } }).status, 1);
});

test('refuses missing capabilities and prefixes outside the backup namespace', () => {
  assert.equal(run({ allowed: { ...good.allowed, capabilities: ['listFiles', 'readFiles'] } }).status, 1);
  assert.equal(run({ allowed: { ...good.allowed, namePrefix: 'other/' } }).status, 1);
});

test('refuses disagreement between the configured and designated bucket before network access', () => {
  const result = run(good, { B2_BUCKET: 'other' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /names differ/);
});
