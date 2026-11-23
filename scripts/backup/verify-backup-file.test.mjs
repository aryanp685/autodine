/** Synthetic-fixture tests for verify-backup-file.mjs — no database required. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { encryptBuffer, sha256 } from './lib-crypto.mjs';

const DIR = mkdtempSync(path.join(tmpdir(), 'autodine-verify-test-'));
const SCRIPT = path.resolve('scripts/backup/verify-backup-file.mjs');
const PASSPHRASE = 'test-passphrase-0123456789';

const sqlPayload = '-- AutoDine logical dump\ncreate table "public"."probe" (id int);\n';
const goodName = 'autodine-test-20261114T030000.sql.gz.enc';
const goodPath = path.join(DIR, goodName);

const writeGoodBackup = () => {
  const enc = encryptBuffer(Buffer.from(sqlPayload, 'utf8'), PASSPHRASE);
  writeFileSync(goodPath, enc);
  writeFileSync(
    goodPath.replace(/\.sql\.gz\.enc$/, '.manifest.json'),
    JSON.stringify({ format: 'autodine-logical-1', file: goodName, createdAt: new Date().toISOString(), bytes: sqlPayload.length, sha256: sha256(enc), schema: 'public' }, null, 2),
  );
};

const run = (file, env = {}) =>
  spawnSync(process.execPath, [SCRIPT, file], {
    env: { ...process.env, AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE, ...env },
    encoding: 'utf8',
  });

before(writeGoodBackup);
after(() => rmSync(DIR, { recursive: true, force: true }));

test('a well-formed backup passes and reports provenance', () => {
  const result = run(goodPath);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.format, 'autodine-logical-1');
  assert.equal(typeof summary.payloadBytes, 'number');
});

test('a wrong passphrase fails, and tampering is detected', () => {
  const wrong = run(goodPath, { AUTODINE_BACKUP_PASSPHRASE: 'not-the-passphrase-0000' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /FAIL/);

  // Flip a byte in the ciphertext of a copy.
  const copy = path.join(DIR, 'autodine-test-20261114T040000.sql.gz.enc');
  const enc = encryptBuffer(Buffer.from(sqlPayload, 'utf8'), PASSPHRASE);
  enc[enc.length - 1] ^= 0x01;
  writeFileSync(copy, enc);
  writeFileSync(
    copy.replace(/\.sql\.gz\.enc$/, '.manifest.json'),
    JSON.stringify({ format: 'autodine-logical-1', file: path.basename(copy), bytes: sqlPayload.length, sha256: sha256(enc) }),
  );
  const tampered = run(copy);
  assert.equal(tampered.status, 1);
});

test('a sha256 mismatch against the manifest fails before decryption', () => {
  const copy = path.join(DIR, 'autodine-test-20261114T050000.sql.gz.enc');
  const enc = encryptBuffer(Buffer.from(sqlPayload, 'utf8'), PASSPHRASE);
  writeFileSync(copy, enc);
  writeFileSync(
    copy.replace(/\.sql\.gz\.enc$/, '.manifest.json'),
    JSON.stringify({ format: 'autodine-logical-1', file: path.basename(copy), bytes: sqlPayload.length, sha256: '0'.repeat(64) }),
  );
  const result = run(copy);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sha256 mismatch/i);
});

test('manifest length, format and exact filename must match the decrypted payload', () => {
  const name = 'autodine-test-20261114T070000.sql.gz.enc';
  const file = path.join(DIR, name);
  const manifestPath = file.replace(/\.sql\.gz\.enc$/, '.manifest.json');
  const enc = encryptBuffer(Buffer.from(sqlPayload), PASSPHRASE);
  writeFileSync(file, enc);
  const base = { format: 'autodine-logical-1', file: name, bytes: Buffer.byteLength(sqlPayload), sha256: sha256(enc) };
  for (const [change, message] of [
    [{ bytes: base.bytes + 1 }, /payload length/],
    [{ bytes: undefined }, /positive integer/],
    [{ file: undefined }, /name this artifact/],
    [{ file: `other/${name}` }, /name this artifact/],
    [{ format: 'pg_dump-custom' }, /format or filename/],
  ]) {
    writeFileSync(manifestPath, JSON.stringify({ ...base, ...change }));
    const result = run(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});

test('a missing manifest fails closed', () => {
  const copy = path.join(DIR, 'autodine-test-20261114T060000.sql.gz.enc');
  writeFileSync(copy, encryptBuffer(Buffer.from(sqlPayload, 'utf8'), PASSPHRASE));
  const result = run(copy);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest/i);
});
