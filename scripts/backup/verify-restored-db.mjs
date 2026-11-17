#!/usr/bin/env node
/**
 * Post-restore verification for the hosted restore rehearsal. Connects ONLY
 * to AUTODINE_RESTORE_TARGET_URL (the disposable drill target — the workflow
 * guarantees a loopback host; this script refuses anything else) and compares
 * the restored database against the backup manifest:
 *
 *   schema fingerprint   pg_tables / pg_policies / pg_proc counts in `public`
 *   row counts           total rows across public tables vs manifest.counts.rows
 *   financial spot check sum(amount_paise) for payments / subscription_payments
 *                        (reported as aggregates; null when a table is absent)
 *
 *   AUTODINE_RESTORE_TARGET_URL=... node scripts/backup/verify-restored-db.mjs --manifest <manifest.json>
 *
 * Prints one JSON report (counts and sums only — no row data, no connection
 * string). Exit 0 = every manifest comparison matches; 1 = mismatch/failure;
 * 2 = usage / non-loopback target refused.
 */
import { readFileSync } from 'node:fs';
// NOTE: `pg` is imported lazily, AFTER the loopback refusal below — the
// production-connection guard must fire even in a bare environment where
// dependencies were never installed.

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!key?.startsWith('--') || args[i + 1] === undefined) {
    process.stderr.write('usage: verify-restored-db.mjs --manifest <manifest.json>\n');
    process.exit(2);
  }
  opt[key.slice(2)] = args[i + 1];
}

const targetUrl = process.env.AUTODINE_RESTORE_TARGET_URL;
if (!targetUrl || !opt.manifest) {
  process.stderr.write('verify-restored: set AUTODINE_RESTORE_TARGET_URL and pass --manifest <path>\n');
  process.exit(2);
}
let host;
try { host = new URL(targetUrl).hostname; } catch {
  process.stderr.write('verify-restored: AUTODINE_RESTORE_TARGET_URL is not a valid URL\n');
  process.exit(2);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  process.stderr.write(`verify-restored: REFUSING non-disposable target host "${host}" — restores are verified only on loopback drill targets\n`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(opt.manifest, 'utf8'));
const expected = manifest.counts ?? {};

const { default: pg } = await import('pg');

const client = new pg.Client({ connectionString: targetUrl, application_name: 'autodine-verify-restored' });
await client.connect();
try {
  const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
  const tables = await one(`select count(*)::int as n from pg_tables where schemaname = 'public'`);
  const policies = await one(`select count(*)::int as n from pg_policies where schemaname = 'public'`);
  const functions = await one(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
  const tableNames = (await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((r) => r.tablename);
  let totalRows = 0;
  for (const t of tableNames) {
    const r = await one(`select count(*)::bigint as n from public."${t.replaceAll('"', '""')}"`);
    totalRows += Number(r.n);
  }
  const sumIfPresent = async (table) => {
    if (!tableNames.includes(table)) return null;
    const r = await one(`select coalesce(sum(amount_paise), 0)::bigint as s from public."${table}"`);
    return Number(r.s);
  };

  const report = {
    verifiedAt: new Date().toISOString(),
    schema: { tables: tables.n, policies: policies.n, functions: functions.n },
    totalRows,
    financialSpotChecks: {
      payments_amount_paise: await sumIfPresent('payments'),
      subscription_payments_amount_paise: await sumIfPresent('subscription_payments'),
    },
    manifestExpectations: expected,
    matches: {
      tables: expected.tables === undefined ? null : tables.n === expected.tables,
      policies: expected.policies === undefined ? null : policies.n === expected.policies,
      functions: expected.functions === undefined ? null : functions.n === expected.functions,
      totalRows: expected.rows === undefined ? null : totalRows === expected.rows,
    },
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  const failed = Object.values(report.matches).some((v) => v === false);
  if (failed) {
    process.stderr.write('verify-restored: MISMATCH against backup manifest (see report above)\n');
    process.exit(1);
  }
} finally {
  await client.end();
}
