#!/usr/bin/env node
/**
 * The backup path must be chosen explicitly, and the logical drill must
 * always take the logical path.
 *
 * WHY THIS EXISTS
 *
 * A drill that claims to verify the logical restore used to verify
 * whatever path the machine happened to offer. With no `pg_dump` on PATH
 * it took the logical path; with one it silently took the custom-format
 * path — and reported the logical format either way. So the same script
 * proved different things locally and in CI, and on a CI runner whose
 * image ships a `pg_dump` too old for the server it failed outright with
 * "aborting because of server version mismatch".
 *
 * The mode choice is now named and tested, and the drill pins it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { BACKUP_MODES, selectBackupMode } from './lib-backup-mode.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const drill = readFileSync(path.join(ROOT, 'scripts', 'verify-logical-restore-embedded.mjs'), 'utf8');
const backup = readFileSync(path.join(ROOT, 'scripts', 'backup', 'backup-logical.mjs'), 'utf8');

test('an explicit --pg-dump 0 always takes the logical path', () => {
  assert.equal(selectBackupMode('0', true), 'logical');
  assert.equal(selectBackupMode('0', false), 'logical');
});

test('an explicit --pg-dump 1 takes the custom-format path, or fails loudly', () => {
  assert.equal(selectBackupMode('1', true), 'pg_dump');
  assert.equal(selectBackupMode('1', false), 'missing_client');
});

test('with no explicit request, a client is used and its absence is survivable', () => {
  assert.equal(selectBackupMode(undefined, true), 'pg_dump');
  assert.equal(selectBackupMode(undefined, false), 'logical');
});

test('the mode names are the formats the manifests carry', () => {
  assert.equal(BACKUP_MODES.pg_dump, 'pg_dump-custom');
  assert.equal(BACKUP_MODES.logical, 'autodine-logical-1');
  // The tool must use these names, not spell them out a third time.
  assert.ok(backup.includes('autodine-logical-1'), 'the logical format name must be the one the manifest carries');
  assert.ok(backup.includes('pg_dump-custom'), 'the custom-format name must be the one the manifest carries');
});

test('the logical drill pins the logical path, so it never depends on a system pg_dump', () => {
  assert.ok(
    /'--pg-dump',\s*'0'/.test(drill),
    'the embedded logical drill must pass --pg-dump 0; otherwise it verifies whatever path the machine happens to offer',
  );
});

test('the drill still claims nothing about Production', () => {
  assert.ok(drill.includes('productionBackupClaim: false'));
});
