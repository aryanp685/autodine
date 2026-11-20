import test from 'node:test';
import assert from 'node:assert/strict';
import { safeBackupError } from './lib-backup-error.mjs';

test('backup failure diagnostics retain only exact fixed safe messages', () => {
  for (const message of [
    'pg_dump failed (exit 9); inspect client configuration',
    'backup evidence payments_amount_paise is not a non-negative safe integer',
    'PostgreSQL connection has invalid query encoding',
  ]) assert.equal(safeBackupError(new Error(message)), message);
  for (const message of [
    'database failure: synthetic private row and partial-password',
    'pg_dump failed (exit 9); inspect client configuration synthetic-secret',
    'backup evidence payments_amount_paise is not a non-negative safe integer synthetic-secret',
    'PostgreSQL connection has invalid query encoding synthetic-secret',
  ]) assert.equal(safeBackupError(new Error(message)), 'backup failed; inspect source, output and client configuration');
  assert.equal(safeBackupError(null), 'backup failed; inspect source, output and client configuration');
});

test('hostile error message getters are suppressed', () => {
  const hostile = { get message() { throw new Error('synthetic private'); } };
  assert.equal(safeBackupError(hostile), 'backup failed; inspect source, output and client configuration');
});
