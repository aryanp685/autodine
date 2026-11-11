#!/usr/bin/env node
/** Disposable native PostgreSQL verification. Never accepts a remote server.
 * Usage: READINESS_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
 * Creates/drops only its own randomly named database; no app environment is read. */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyRestore } from './verify-restore.mjs';
import { seedLegacyFinancialFixture, snapshotFinancialUpgrade, checkFinancialUpgrade } from './verify-financial-upgrade.mjs';
// Last migration of the recorded financial baseline. Legacy-flow fixture rows are
// seeded immediately after it, before any later migration can forbid that flow.
const FINANCIAL_BASELINE = '20261108006000_restore_public_order_session_attach.sql';
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
    const bundle = await readFile('scripts/staging/approved-upgrade.sql', 'utf8');
    await db.query(bundle);
    // The bundle names every migration it contains. Use that list, never a version
    // cut-off: later work can carry OLDER version numbers than the newest bundled
    // file (20261108007000-010000 do), and a cut-off skips those files silently.
    const bundled = [...bundle.matchAll(/^-- SOURCE (\S+) SHA256 [0-9a-f]{64}/gm)].map(match => match[1]);
    if (!bundled.length) throw new Error('Staging bundle has no SOURCE manifest');
    for (const file of bundled) alreadyApplied.add(file);
  }
  let financialBefore;
  let financialChecked = false;
  let financialSeeded = false;
  if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && (alreadyApplied.size || process.env.READINESS_STAGING_BUNDLE === '1')) throw new Error('Financial upgrade drill requires clean repository history');
  for (const file of migrations.filter(file => !alreadyApplied.has(file))) {
    if (financialBefore && file === '20261110000300_shared_wifi_scan_limits.sql') {
      await checkFinancialUpgrade(db, financialBefore);
      financialChecked = true;
    }
    if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && !financialSeeded && file > FINANCIAL_BASELINE) {
      await seedLegacyFinancialFixture(db);
      financialSeeded = true;
      console.log(`SEEDED legacy financial fixture before ${file}`);
    }
    if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && file === '20261110000100_counter_payment_lock_order.sql') {
      financialBefore = await snapshotFinancialUpgrade(db);
    }
    await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
    console.log(`APPLIED ${file}`);
  }
  if (process.env.READINESS_FINANCIAL_UPGRADE === '1') {
    if (!financialBefore) throw new Error('Financial upgrade boundary was not reached');
    if (!financialChecked) await checkFinancialUpgrade(db, financialBefore);
  }
  console.log(alreadyApplied.size ? `Verified forward upgrade to ${migrations.length} repository migrations from observed staging baseline.` : `Replayed ${migrations.length} migrations without application-table scaffolds.`);
  await db.end(); db = null;
  const result = spawnSync('npx', ['vitest', 'run', 'lib/db/readiness.integration.test.ts', 'lib/db/phase0-security.integration.test.ts', 'lib/db/subscription-billing.integration.test.ts', 'app/menu/throttle-db.integration.test.tsx'], {
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
