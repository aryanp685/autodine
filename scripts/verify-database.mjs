#!/usr/bin/env node
/** Disposable native PostgreSQL verification. Never accepts a remote server.
 * Usage: READINESS_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
 * Creates/drops only its own randomly named database; no app environment is read. */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyRestore } from './verify-restore.mjs';
import { prepareFinancialUpgrade, checkFinancialUpgrade } from './verify-financial-upgrade.mjs';
const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
const LEGACY_QR_UPGRADE_IP = 'c'.repeat(64);
const LEGACY_QR_UPGRADE_SLUG = 'readiness-qr-legacy-upgrade';

async function seedLegacyQrUpgradeAttempts(client) {
  const columns = await client.query(`
    select
      exists(select 1 from pg_attribute where attrelid='public.qr_verification_attempts'::regclass and attname='attempted_at' and not attisdropped) legacy_event_shape,
      exists(select 1 from pg_attribute where attrelid='public.qr_verification_attempts'::regclass and attname='attempt_count' and not attisdropped) state_shape`);
  if (!columns.rows[0].legacy_event_shape || columns.rows[0].state_shape) return false;

  const restaurant = (await client.query(`
    insert into public.restaurants (slug,name,tax_rate_bps)
    values ($1,'Synthetic QR migration fixture',0) returning id`,
  [LEGACY_QR_UPGRADE_SLUG])).rows[0].id;
  const table = (await client.query(`
    insert into public.dining_tables (restaurant_id,label)
    values ($1,'Synthetic QR migration fixture') returning id`, [restaurant])).rows[0].id;
  const qr = (await client.query(
    'select id from public.table_qr_codes where table_id=$1 and revoked_at is null', [table])).rows[0];
  if (!qr) throw new Error('Could not create the synthetic QR migration fixture');
  await client.query(`
    insert into public.qr_verification_attempts(qr_code_id,ip_hash,attempted_at)
    select $1,$2,
      case when n <= 4
        then statement_timestamp() - (n * interval '20 seconds')
        else statement_timestamp() - interval '30 minutes'
      end
    from generate_series(1,6) n`, [qr.id, LEGACY_QR_UPGRADE_IP]);
  return true;
}

async function seedAclOwnerFixtures(client) {
  await client.query('create table public.acl_existing_postgres(id uuid primary key)');
  await client.query('create sequence public.acl_existing_postgres_seq');
  await client.query('set role supabase_admin');
  try {
    await client.query('create table public.acl_existing_supabase_admin(id uuid primary key)');
    await client.query('create sequence public.acl_existing_supabase_admin_seq');
  } finally {
    await client.query('reset role');
  }
}

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
  // Emulate the inspected Supabase default grants for both public-object
  // owners. This is a synthetic catalog setup, not a hosted connection.
  await db.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  await db.query('set role supabase_admin');
  try {
    await db.query(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  } finally {
    await db.query('reset role');
  }
  // Synthetic pre-existing relations ensure current ACL cleanup is exercised
  // for both relevant owners, in addition to the future-object tests.
  await seedAclOwnerFixtures(db);
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  const alreadyApplied = new Set();
  let financialBefore;
  let financialChecked = false;
  // Exact observed *nonproduction* historical path, not a fresh-schema shortcut.
  // Clean verification has only four tiny synthetic ACL-owner relations;
  // application tables are scaffolded only in this explicit baseline branch.
  if (process.env.READINESS_REPLAY_BASELINE === 'staging_scaffold') {
    const baseline = ['20261019000001_init.sql','20261019000002_public_read.sql',
      '../../scripts/local-pg/005_scaffold_missing_tables.sql','20261020000004_counter_payment.sql',
      '20261021000005_public_place_order.sql','20261021000006_table_qr_verification.sql','20261021000007_table_qr_provisioning.sql'];
    for (const file of baseline) {
      if (financialBefore && file === '20261110000300_shared_wifi_scan_limits.sql') {
      await checkFinancialUpgrade(db, financialBefore);
      financialChecked = true;
    }
    if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && file === '20261110000100_counter_payment_lock_order.sql') {
      financialBefore = await prepareFinancialUpgrade(db);
    }
    await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
      alreadyApplied.add(file);
    }
    console.log('Recreated observed historical staging baseline (including its scaffold); testing forward upgrade, NOT clean-replay evidence.');
  }
  if (process.env.READINESS_STAGING_BUNDLE === '1') {
    if (!alreadyApplied.size) throw new Error('Staging bundle requires explicit staging_scaffold baseline');
    await db.query(await readFile('scripts/staging/approved-upgrade.sql', 'utf8'));
  }
  if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && (alreadyApplied.size || process.env.READINESS_STAGING_BUNDLE === '1')) throw new Error('Financial upgrade drill requires clean repository history');
  for (const file of migrations.filter(file => (process.env.READINESS_STAGING_BUNDLE !== '1' || file > '20261109000900_staff_tts_budget.sql') && !alreadyApplied.has(file))) {
    if (financialBefore && file === '20261110000300_shared_wifi_scan_limits.sql') {
      await checkFinancialUpgrade(db, financialBefore);
      financialChecked = true;
    }
    if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && file === '20261110000100_counter_payment_lock_order.sql') {
      financialBefore = await prepareFinancialUpgrade(db);
    }
    if (file === '20261110000600_qr_attempt_budget_compat.sql') {
      if (await seedLegacyQrUpgradeAttempts(db)) {
        console.log('Seeded six synthetic legacy QR attempts for the forward-compatibility migration test.');
      }
    }
    await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
    console.log(`APPLIED ${file}`);
  }
  // The hosted migration connection cannot change supabase_admin defaults.
  // Exercise the separate owner-correct operator step only in this disposable
  // local cluster, with the simulated owner active.
  await db.query('set role supabase_admin');
  try {
    await db.query(await readFile('supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql', 'utf8'));
  } finally {
    await db.query('reset role');
  }
  console.log('Applied the owner-correct supabase_admin ACL operation in the disposable local database.');
  if (process.env.READINESS_FINANCIAL_UPGRADE === '1') {
    if (!financialBefore) throw new Error('Financial upgrade boundary was not reached');
    if (!financialChecked) await checkFinancialUpgrade(db, financialBefore);
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
