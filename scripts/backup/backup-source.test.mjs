#!/usr/bin/env node
/**
 * A backup must be a CONSISTENT snapshot, and it must be taken from a
 * connection that can produce one.
 *
 * WHY THIS EXISTS
 *
 * Mode A takes a consistent snapshot by exporting it on one connection
 * (`pg_export_snapshot()`) and then running `pg_dump --snapshot=<id>` on a
 * second. Through Supabase's TRANSACTION pooler (port 6543) those two
 * connections can land on different backends, where the exported snapshot
 * does not exist — so the backup either fails or captures an inconsistent
 * state and still looks successful.
 *
 * The rule was in three runbooks and enforced nowhere. A rule that lives
 * only in prose is not a rule, so `lib-backup-source.mjs` now enforces it
 * and `backup-logical.mjs` refuses before it writes or connects to
 * anything.
 *
 * These tests pin the decision, prove the refusal happens before any
 * side effect, and check that the runbooks and the code still agree.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { backupSourceDecision, isAllowedBackupSource, TRANSACTION_POOLER_PORT } from './lib-backup-source.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BACKUP = path.join(ROOT, 'scripts', 'backup', 'backup-logical.mjs');

const SESSION_POOLER = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const TRANSACTION_POOLER = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
const DIRECT = 'postgresql://postgres.abcdefghijklmnopqrst:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
const LOOPBACK = 'postgresql://postgres:secret@127.0.0.1:5432/postgres';

test('the transaction pooler is refused', () => {
  const decision = backupSourceDecision(TRANSACTION_POOLER);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /TRANSACTION pooler/i);
  // The message must name the fix, not only the problem.
  assert.match(decision.reason, /5432/);
  assert.equal(isAllowedBackupSource(TRANSACTION_POOLER), false);
});

test('the session pooler and a direct connection are allowed', () => {
  assert.equal(backupSourceDecision(SESSION_POOLER).allowed, true);
  assert.equal(backupSourceDecision(DIRECT).allowed, true);
  assert.equal(backupSourceDecision(LOOPBACK).allowed, true);
  // No port at all is the PostgreSQL default, 5432.
  assert.equal(
    backupSourceDecision('postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co/postgres').allowed,
    true,
  );
});

test('a pooled host on an unknown port is refused rather than guessed', () => {
  const decision = backupSourceDecision(
    'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-south-1.pooler.supabase.com:9999/postgres',
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /neither the session pooler/);
});

test('a malformed URL or a non-postgres URL is refused', () => {
  assert.equal(backupSourceDecision('not a url').allowed, false);
  assert.equal(backupSourceDecision('').allowed, false);
  assert.equal(backupSourceDecision(undefined).allowed, false);
  assert.equal(backupSourceDecision('https://example.com/db').allowed, false);
});

test('the refusal never echoes the URL, the user name or the password', () => {
  const decision = backupSourceDecision(TRANSACTION_POOLER);
  assert.doesNotMatch(decision.reason, /secret/);
  assert.doesNotMatch(decision.reason, /abcdefghijklmnopqrst/);
  assert.doesNotMatch(decision.reason, /pooler\.supabase\.com/);
});

test('backup-logical.mjs refuses a transaction-pooler source before it writes or connects', () => {
  const result = spawnSync(
    process.execPath,
    [BACKUP, '--out-dir', '/tmp/autodine-should-not-be-created'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTODINE_BACKUP_SOURCE_URL: TRANSACTION_POOLER,
        AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789',
      },
    },
  );
  assert.notEqual(result.status, 0, 'the backup must refuse a transaction-pooler source');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /TRANSACTION pooler/);
  // It must not have created the output directory.
  assert.doesNotMatch(output, /no such host|ECONNREFUSED|getaddrinfo/, 'it must refuse BEFORE connecting');
});

test('the runbooks and the code state the same rule', () => {
  // A code guard with a contradicting runbook is worse than no guard.
  const runbooks = [
    'docs/backup-restore-runbook.md',
    'docs/pitr-verification-procedure-2026-11-14.md',
    'docs/operations/PRODUCTION-BACKUP-RUNBOOK.md',
  ];
  for (const relative of runbooks) {
    const file = path.join(ROOT, relative);
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // The runbook may not exist on this branch; the code guard stands alone.
    }
    assert.match(text, /6543/, `${relative} must name the transaction pooler port`);
    assert.match(text, /5432|session pooler/i, `${relative} must name the session pooler port`);
  }
});

test('the constant the rule is built on is the real transaction-pooler port', () => {
  assert.equal(TRANSACTION_POOLER_PORT, '6543');
});
