#!/usr/bin/env node
/** Disposable native PostgreSQL verification. Never accepts a remote server.
 * Usage: READINESS_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
 * Creates/drops only its own randomly named database; no app environment is read. */
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyRestore } from './verify-restore.mjs';
import { seedLegacyFinancialFixture, snapshotFinancialUpgrade, checkFinancialUpgrade } from './verify-financial-upgrade.mjs';
import { proveAccountLinkWasClientMutable } from './verify-account-link-guard.mjs';
import { seedPreClassificationPublish, seedGstUpgrade, seedClosedLegacyGst, checkClosedLegacyGst, checkGstUpgrade, seedGstWorkstreamUpgrade, checkGstWorkstreamUpgrade, seedGstClosureUpgrade, checkGstClosureUpgrade, seedGstParticularsUpgrade, checkGstParticularsUpgrade, checkGstFiscalRollover, seedIrpExecutionUpgrade, checkIrpExecutionUpgrade } from './verify-gst-upgrade.mjs';
// Last migration of the recorded financial baseline. Legacy-flow fixture rows are
// seeded immediately after it, before any later migration can forbid that flow.
const FINANCIAL_BASELINE = '20261108006000_restore_public_order_session_attach.sql';
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
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  await db.query('set role supabase_admin');
  try {
    await db.query(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
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
  let financialSeeded = false;
  // Exact observed *nonproduction* historical path, not a fresh-schema shortcut.
  // Clean verification has only four tiny synthetic ACL-owner relations;
  // application tables are scaffolded only in this explicit baseline branch.
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
  if (process.env.READINESS_FINANCIAL_UPGRADE === '1' && (alreadyApplied.size || process.env.READINESS_STAGING_BUNDLE === '1')) throw new Error('Financial upgrade drill requires clean repository history');
  const gstUpgrade = process.env.READINESS_GST_UPGRADE === '1';
  if (gstUpgrade && (alreadyApplied.size || process.env.READINESS_STAGING_BUNDLE === '1')) throw new Error('GST upgrade drill requires clean repository history');
  let preClassificationCatalog;
  let gstBefore;
  let closedGstBefore;
  let workstreamGstBefore;
  let closureGstBefore;
  let particularsGstBefore;
  let irpExecutionBefore;
  let guestCheckoutBefore;
  let realtimeBefore;
  const guestMigration = '20261118002000_guest_checkout_integrity.sql';
  const realtimeMigration = '20261118002100_operational_realtime.sql';
  const apiCatalog = async () => (await db.query(`select p.oid::regprocedure::text signature, p.proacl::text acl,
      p.proowner::regrole::text owner, p.prosecdef, p.proconfig,
      case when p.proname <> 'place_public_order_attempt' then pg_get_functiondef(p.oid) end body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' order by 1`)).rows;
  for (const file of migrations.filter(file => !alreadyApplied.has(file))) {
    if (gstUpgrade && file === '20261114000101_gst_b2b_einvoice_readiness.sql') {
      preClassificationCatalog = await seedPreClassificationPublish(db);
      console.log(`SEEDED legacy publish under migration history preceding ${file}`);
    }
    if (gstUpgrade && file === '20261118000200_gst_configuration_boundary.sql') {
      gstBefore = await seedGstUpgrade(db, preClassificationCatalog);
      console.log(`SEEDED populated GST fixture after 20261118000100 and before ${file}`);
    }
    if (gstUpgrade && file === '20261118000600_gst_ca_onboarding.sql') {
      closedGstBefore = await seedClosedLegacyGst(db);
      console.log(`SEEDED closed-unissued GST fixture after 20261118000500 and before ${file}`);
    }
    if (gstUpgrade && file === '20261118000800_gst_outlet_activation.sql') {
      workstreamGstBefore = await seedGstWorkstreamUpgrade(db);
      console.log(`SEEDED CA-profile INV/RBL/CN fixture before ${file}`);
    }
    if (gstUpgrade && file === '20261118001200_gst_review_lifecycle.sql') {
      closureGstBefore = await seedGstClosureUpgrade(db);
      console.log(`SEEDED populated activation, buyer, held preflight, paid sittings and share before ${file}`);
    }
    if (gstUpgrade && file === '20261118001600_gst_document_particulars.sql') {
      particularsGstBefore = await seedGstParticularsUpgrade(db);
      console.log(`SEEDED populated SAC-less Composition BOS/note/share and paid open sitting before ${file}`);
    }
    if (gstUpgrade && file === '20261118001800_irp_execution.sql') {
      irpExecutionBefore = await seedIrpExecutionUpgrade(db);
      console.log(`SEEDED 114-migration predecessor with an offline preflight and private rehearsal before ${file}`);
    }
    if (gstUpgrade && file === guestMigration) {
      await checkIrpExecutionUpgrade(db, irpExecutionBefore);
      guestCheckoutBefore = { rows: await irpExecutionBefore.capture(), functions: await apiCatalog() };
    }
    if (gstUpgrade && file === realtimeMigration) {
      realtimeBefore = { rows: await irpExecutionBefore.capture(), functions: await apiCatalog() };
    }
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
    if (file === '20261110000900_converge_qr_verification_attempts.sql') {
      if (await seedLegacyQrUpgradeAttempts(db)) {
        console.log('Seeded six synthetic legacy QR attempts for the state-preserving QR convergence test.');
      }
    }
    if (file === '20261112000200_immutable_restaurant_account_link.sql') {
      await proveAccountLinkWasClientMutable(db);
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
  if (gstUpgrade) {
    assert.ok(guestCheckoutBefore, 'Guest checkout migration not replayed');
    // Compare 116 → 117 at the 117 boundary itself; later migrations may add
    // functions or replace one on purpose, and are checked on their own below.
    assert.ok(realtimeBefore, 'Operationally realtime migration not replayed');
    assert.deepEqual(realtimeBefore.rows, guestCheckoutBefore.rows, '116 → 117 must preserve full financial and IRP rows');
    assert.deepEqual(realtimeBefore.functions, guestCheckoutBefore.functions, '116 → 117 must not change any function ACL or other body');
    console.log('Guest checkout 116 → 117 populated replay: 22 tables byte-preserved, public function bodies/grants unchanged except the checkout wrapper body.');
    assert.deepEqual(await irpExecutionBefore.capture(), realtimeBefore.rows, '117 → 118 must byte-preserve every populated financial, GST and IRP row');
    // The candidate adds functions and replaces these four on purpose. Any
    // other existing signature changing body, ACL or owner is a failure.
    const intentional = new Set(['get_public_order(text,text,uuid)', 'resolve_table_waiter_call(uuid)',
      'current_restaurant_ids()', 'is_member(uuid)']);
    const before = new Map(realtimeBefore.functions.map(fn => [fn.signature, fn]));
    const changed = (await apiCatalog()).filter(fn => before.has(fn.signature)
      && JSON.stringify(fn) !== JSON.stringify(before.get(fn.signature)) && !intentional.has(fn.signature));
    assert.deepEqual(changed, [], '117 → 118 changed an unintended existing function');
    console.log('Operational realtime 117 → 118 populated replay: all populated rows preserved; only the four documented function replacements changed.');
    await checkGstUpgrade(db, gstBefore);
    await checkClosedLegacyGst(db, closedGstBefore);
    await checkGstWorkstreamUpgrade(db, workstreamGstBefore);
    await checkGstClosureUpgrade(db, closureGstBefore);
    await checkGstParticularsUpgrade(db, particularsGstBefore);
  }
  console.log(alreadyApplied.size ? `Verified forward upgrade to ${migrations.length} repository migrations from observed staging baseline.` : `Replayed ${migrations.length} migrations without application-table scaffolds.`);
  await db.end(); db = null;
  if (process.env.READINESS_GST_FISCAL_CLOCK_ONLY === '1') {
    if (alreadyApplied.size || gstUpgrade || !process.env.FAKETIME_TIMESTAMP_FILE) {
      throw new Error('Fiscal clock-only drill requires a fresh disposable replay and a controlled native clock.');
    }
    db = new Client({ connectionString: url.href }); await db.connect();
    await checkGstFiscalRollover(db, process.env.FAKETIME_TIMESTAMP_FILE);
  } else {
    const result = spawnSync('npx', ['vitest', 'run', 'lib/db/gst-two-mode.integration.test.ts', 'lib/db/irp-execution.integration.test.ts', 'lib/db/readiness.integration.test.ts', 'lib/db/report-sales.integration.test.ts', 'lib/db/phase0-security.integration.test.ts', 'lib/db/subscription-billing.integration.test.ts', 'lib/db/restaurant-account-link.integration.test.ts', 'lib/db/credit-debit-notes.integration.test.ts', 'lib/db/order-read-boundary.integration.test.ts', 'app/menu/throttle-db.integration.test.tsx'], {
      stdio: 'inherit', env: { ...process.env, READINESS_DB_URL: url.href, THROTTLE_DB_URL: url.href },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    if (result.status === 0 && process.env.READINESS_VERIFY_RESTORE === '1') await verifyRestore(url.href, admin);
  }
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
