#!/usr/bin/env node
/**
 * Verify one backup artifact against its manifest — executable backup verification.
 *
 *   AUTODINE_BACKUP_PASSPHRASE=... node scripts/backup/verify-backup-file.mjs \
 *     /backups/autodine/autodine-db-20261114T030000.sql.gz.enc
 *
 * Checks, in order:
 *   1. the file exists, is non-trivial, and carries the AutoDine backup magic;
 *   2. the sibling manifest exists, names this file, and its sha256 matches;
 *   3. the passphrase decrypts the payload fully (authentication also covers
 *      tamper-evidence: a flipped byte fails here, not at restore time);
 *   4. the payload decompresses and looks like the expected dump format.
 *
 * Exit 0 = verified. Exit 1 = failed (reason on stderr; exit 2 = usage error).
 * Never prints the passphrase or any payload bytes.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { decryptBuffer, sha256 } from './lib-crypto.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const fail = (msg, code = 1) => { process.stderr.write(`verify-backup: FAIL: ${msg}\n`); process.exit(code); };

if (!file) fail('usage: verify-backup-file.mjs <backup-file> [--manifest <path>]', 2);
const manifestArg = args.includes('--manifest') ? args[args.indexOf('--manifest') + 1] : null;

const passphrase = process.env.AUTODINE_BACKUP_PASSPHRASE;
if (!passphrase) fail('set AUTODINE_BACKUP_PASSPHRASE (never pass it as an argument)', 2);

let bytes;
try {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size < 128) fail('file missing or suspiciously small');
  bytes = readFileSync(file);
} catch {
  fail(`cannot read ${file}`);
}

if (!bytes.subarray(0, 7).equals(Buffer.from('ADBK01\n'))) {
  fail('not an AutoDine backup file (bad magic)');
}

// Manifest: sibling by default.
const manifestPath = manifestArg ?? file.replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  fail(`manifest missing or unreadable: ${manifestPath}`);
}
if (manifest.file && path.basename(manifest.file) !== path.basename(file)) {
  fail(`manifest names ${manifest.file}, not ${path.basename(file)}`);
}
const actualSha = sha256(bytes);
if (manifest.sha256 !== actualSha) {
  fail('sha256 mismatch: the backup is not the bytes the manifest recorded');
}
if (typeof manifest.bytes === 'number' && manifest.bytes <= 0) {
  fail('manifest records a zero-length payload');
}

let plaintext;
try {
  plaintext = decryptBuffer(bytes, passphrase);
} catch (error) {
  fail(error.message);
}

// Payload sanity. Mode B dumps are SQL text; Mode A (pg_dump custom) starts
// with the PGDMP magic. Accept either, reject anything unrecognised.
const head = plaintext.subarray(0, 16);
const looksPgCustom = head.subarray(0, 5).equals(Buffer.from('PGDMP'));
const looksSql = /^(--|create|set|begin|drop|alter|insert|comment|\/\*)/i.test(head.toString('utf8').replace(/^\uFEFF/, ''));
if (!looksPgCustom && !looksSql) {
  fail('decrypted payload is not a recognisable dump (not SQL, not PGDMP)');
}

const summary = {
  ok: true,
  file: path.basename(file),
  format: manifest.format ?? 'unknown',
  sha256: actualSha,
  payloadBytes: plaintext.length,
  createdAt: manifest.createdAt ?? null,
  schema: manifest.schema ?? null,
  counts: manifest.counts ?? undefined,
};
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
