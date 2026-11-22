#!/usr/bin/env node
/**
 * Local rehearsal of the production apply.
 *
 * WHY THIS EXISTS
 *
 * Production's schema is not "this chain replayed from empty": it is the subset
 * its ledger records, applied by the CLI and by a handful of out-of-band
 * corrections. A migration can replay perfectly from empty and still fail on
 * that subset. This builds exactly that subset locally, then applies the pending
 * files in order and runs the same verification the release plan prints.
 *
 *   node scripts/local-pg/rehearse-prod-apply.mjs --ledger <file> [--dry-run]
 *
 * The ledger is a pipe-separated list of versions (the output of
 * `select string_agg(version, '|' order by version) from
 * supabase_migrations.schema_migrations`). Versions with no repository file are
 * reported and skipped: that is what "applied out of band" means.
 *
 * Exit 0 = every pending migration applied to a production-shaped database and
 * the verification queries returned the expected shape. It proves nothing about
 * production itself; it removes the "does it even fit" question.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[i + 1]?.startsWith('--') ? '1' : (args[++i] ?? '1');
}
const ledgerPath = opt.ledger;
if (!ledgerPath || !existsSync(ledgerPath)) {
  console.error('usage: rehearse-prod-apply.mjs --ledger <pipe-separated versions> [--dry-run]');
  process.exit(2);
}
const root = process.cwd();
const dir = path.join(root, 'supabase/migrations');
const ledger = readFileSync(ledgerPath, 'utf8').trim().split('|').filter(Boolean).sort();

async function main() {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const byVersion = new Map(files.map((f) => [f.slice(0, 14), f]));

  const appliedNow = ledger.filter((v) => byVersion.has(v));
  const outOfBand = ledger.filter((v) => !byVersion.has(v));
  const pending = files.filter((f) => !ledger.includes(f.slice(0, 14)));

  console.log(`ledger rows:            ${ledger.length}`);
  console.log(`replayable from ledger: ${appliedNow.length}`);
  console.log(`applied out of band:    ${outOfBand.length} (no repository file; skipped)`);
  console.log(`pending:                ${pending.length}`);
  if (opt['dry-run']) {
    console.log('\n--dry-run: nothing applied');
    for (const f of pending) console.log(`  ${f}`);
    return;
  }

  const port = 20000 + Math.floor(Math.random() * 20000);
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join('/tmp', `autodine-rehearsal-${port}`),
    user: 'postgres',
    password: 'rehearsal',
    port,
    persistent: false,
  });
  await cluster.initialise();
  await cluster.start();
  const url = `postgresql://postgres:rehearsal@127.0.0.1:${port}/postgres`;
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const failures = [];
  try {
    await db.query(readFileSync(path.join(root, 'scripts/local-pg/000_supabase_shim.sql'), 'utf8'));
    // Statements the hosted platform provides and the local shim does not need.
    await db.query('set check_function_bodies = off');

    const apply = async (file, phase) => {
      const sql = readFileSync(path.join(dir, file), 'utf8');
      try {
        await db.query('begin');
        await db.query(sql);
        await db.query('commit');
        return true;
      } catch (error) {
        await db.query('rollback').catch(() => {});
        failures.push({ file, phase, message: error.message.split('\n')[0].slice(0, 220) });
        return false;
      }
    };

    for (const version of appliedNow.sort()) {
      const ok = await apply(byVersion.get(version), 'ledger-replay');
      if (!ok) break; // the production baseline itself must fit before the pending set means anything
    }
    const baselineFailures = failures.length;
    console.log(`\nproduction baseline: ${appliedNow.length - failures.length}/${appliedNow.length} replayed`);
    if (!baselineFailures) {
      for (const file of pending) {
        const ok = await apply(file, 'pending');
        if (!ok) break;
      }
      const appliedPending = pending.length - failures.filter((f) => f.phase === 'pending').length;
      console.log(`pending applied:     ${appliedPending}/${pending.length}`);
    }

    // The release plan's verification queries, plus the shape they must return.
    if (!failures.length) {
      const checks = await db.query(`
        select
          (select count(*) from information_schema.tables where table_schema = 'public'
             and table_name in ('restaurant_gst_buyers','restaurant_gst_number_namespaces',
                                'restaurant_irp_jobs','irp_routes','irp_dispatches',
                                'restaurant_direct_fulfilments','outlet_live_revisions',
                                'order_operation_history','sitting_table_moves')) as gst_irp_tables,
          (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'table_qr_codes_one_active_per_table') as qr_index,
          (select count(*) from pg_proc where proname in ('rotate_table_qr_code','retire_table_qr_code')
             and position('pg_advisory_xact_lock' in pg_get_functiondef(oid)) > 0) as advisory_functions,
          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'record_counter_payment') as counter_payment_signatures
      `);
      const row = checks.rows[0];
      console.log(`verification:        ${JSON.stringify(row)}`);
      const problems = [];
      if (Number(row.gst_irp_tables) !== 9) problems.push(`GST/IRP tables missing: ${row.gst_irp_tables}/9`);
      if (Number(row.qr_index) !== 1) problems.push('one-live-card index missing');
      if (Number(row.advisory_functions) !== 2) problems.push('advisory lock missing from rotate/retire');
      if (Number(row.counter_payment_signatures) !== 1) problems.push('counter payment signature is not unique');
      for (const p of problems) failures.push({ file: '(verification)', phase: 'verify', message: p });
    }
  } finally {
    await db.end().catch(() => {});
    await cluster.stop().catch(() => {});
  }

  if (failures.length) {
    console.error('\nREHEARSAL FAILED');
    for (const f of failures) console.error(`  [${f.phase}] ${f.file}: ${f.message}`);
    process.exit(1);
  }
  console.log('\nREHEARSAL OK: every pending migration applied to a production-shaped database');
}

await main();
