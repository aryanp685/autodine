#!/usr/bin/env node
/** Disposable native PostgreSQL verification. Never accepts a remote server.
 * Usage: READINESS_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
 * Creates/drops only its own randomly named database; no app environment is read. */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyRestore } from './verify-restore.mjs';
const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Refusing non-loopback PostgreSQL target');
const name = `autodine_check_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url.href });
await admin.connect();
let db;
try {
  await admin.query(`create database "${name}"`);
  url.pathname = `/${name}`;
  db = new Client({ connectionString: url.href }); await db.connect();
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
  // Emulate Supabase's platform default grants, not missing application tables.
  await db.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  const alreadyApplied = new Set();
  // Exact observed *nonproduction* historical path, not a fresh-schema shortcut.
  // Default verification above remains scaffold-free.
  if (process.env.READINESS_REPLAY_BASELINE === 'staging_scaffold') {
    const baseline = ['20261019000001_init.sql','20261019000002_public_read.sql',
      '../../scripts/local-pg/005_scaffold_missing_tables.sql','20261020000004_counter_payment.sql',
      '20261021000005_public_place_order.sql','20261021000006_table_qr_verification.sql','20261021000007_table_qr_provisioning.sql'];
    for (const file of baseline) {
      await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
      alreadyApplied.add(file);
    }
    console.log('Recreated observed historical staging baseline (including its scaffold); testing forward upgrade, NOT clean-replay evidence.');
  }
  if (process.env.READINESS_STAGING_BUNDLE === '1') {
    if (!alreadyApplied.size) throw new Error('Staging bundle requires explicit staging_scaffold baseline');
    await db.query(await readFile('scripts/staging/approved-upgrade.sql', 'utf8'));
  }
  for (const file of migrations.filter(file => (process.env.READINESS_STAGING_BUNDLE !== '1' || file > '20261109000900_staff_tts_budget.sql') && !alreadyApplied.has(file))) {
    await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
    console.log(`APPLIED ${file}`);
  }
  console.log(alreadyApplied.size ? `Verified forward upgrade to ${migrations.length} repository migrations from observed staging baseline.` : `Replayed ${migrations.length} migrations without application-table scaffolds.`);
  await db.end(); db = null;
  const result = spawnSync('npx', ['vitest', 'run', 'lib/db/readiness.integration.test.ts', 'app/menu/throttle-db.integration.test.tsx'], {
    stdio: 'inherit', env: { ...process.env, READINESS_DB_URL: url.href, THROTTLE_DB_URL: url.href },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0 && process.env.READINESS_VERIFY_RESTORE === '1') await verifyRestore(url.href, admin);
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
