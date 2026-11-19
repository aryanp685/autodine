#!/usr/bin/env node
/**
 * Post-restore verification for the hosted restore rehearsal. Connects ONLY
 * to AUTODINE_RESTORE_TARGET_URL (the disposable drill target — the workflow
 * guarantees a loopback host; this script refuses anything else) and compares
 * the restored database against the backup manifest:
 *
 *   artifact pairing     manifest.file names the artifact AND the artifact's
 *                        SHA-256 equals manifest.sha256 (before connecting)
 *   schema fingerprint   tables / policies / functions counts in the schema
 *   row counts           total rows across tables vs manifest.counts.rows
 *   financial spot check sum(amount_paise) for payments / subscription_payments
 *                        vs manifest.financialSpotChecks (measured at backup
 *                        time from the source — never invented here)
 *
 *   AUTODINE_RESTORE_TARGET_URL=... node scripts/backup/verify-restored-db.mjs \
 *     --manifest <manifest.json> --artifact <artifact.enc>
 *
 * FAIL CLOSED: a manifest that is unreadable, malformed, of an unknown
 * format, or missing the verification contract (`counts` with tables /
 * policies / functions / rows, and `financialSpotChecks` — both written by
 * every current backup, see backup-logical.mjs) exits 1 BEFORE connecting.
 * There is no "skip comparison when absent" path: a drill that cannot
 * compare has not verified anything. Backups taken before the contract
 * existed must be re-taken, not waved through.
 *
 * Prints one JSON report (counts and sums only — no row data, no connection
 * string). Exit 0 = every comparison matches; 1 = mismatch / insufficient
 * evidence; 2 = usage / non-loopback target refused.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// NOTE: `pg` is imported lazily, AFTER the loopback refusal below — the
// production-connection guard must fire even in a bare environment where
// dependencies were never installed.

const KNOWN_FORMATS = new Set(['autodine-logical-1', 'pg_dump-custom']);
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FINANCIAL_KEYS = ['payments_amount_paise', 'subscription_payments_amount_paise'];

const fail = (msg) => { process.stderr.write(`verify-restored: FAILED: ${msg}\n`); process.exit(1); };

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!key?.startsWith('--') || args[i + 1] === undefined) {
    process.stderr.write('usage: verify-restored-db.mjs --manifest <manifest.json> --artifact <artifact.enc>\n');
    process.exit(2);
  }
  opt[key.slice(2)] = args[i + 1];
}

const targetUrl = process.env.AUTODINE_RESTORE_TARGET_URL;
if (!targetUrl || !opt.manifest || !opt.artifact) {
  process.stderr.write('verify-restored: set AUTODINE_RESTORE_TARGET_URL and pass --manifest <path> --artifact <path>\n');
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

// --- Manifest: must exist, parse, and carry the full verification contract.
let manifest;
try {
  manifest = JSON.parse(readFileSync(opt.manifest, 'utf8'));
} catch {
  fail(`manifest is missing or not valid JSON: ${path.basename(opt.manifest)}`);
}
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest is not a JSON object');
if (!KNOWN_FORMATS.has(manifest.format)) fail(`manifest format is missing or unknown (${JSON.stringify(manifest.format ?? null)}); refusing to verify against unrecognised evidence`);
if (typeof manifest.file !== 'string' || manifest.file.length === 0) fail('manifest does not name its artifact (file)');
if (typeof manifest.sha256 !== 'string' || !SHA256_HEX_RE.test(manifest.sha256)) fail('manifest has no well-formed sha256');
if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0) fail('manifest has no positive integer byte count');
if (typeof manifest.createdAt !== 'string' || Number.isNaN(new Date(manifest.createdAt).getTime())) fail('manifest has no parseable createdAt');
const schema = manifest.schema === undefined ? 'public' : manifest.schema;
if (typeof schema !== 'string' || !IDENT_RE.test(schema)) fail(`manifest schema is not a safe identifier (${JSON.stringify(manifest.schema ?? null)})`);

const counts = manifest.counts;
if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
  fail('manifest carries no counts — it predates the verification contract and cannot support a restore drill; re-take the backup');
}
for (const key of ['tables', 'policies', 'functions', 'rows']) {
  if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) fail(`manifest counts.${key} is missing or invalid; refusing to verify on incomplete evidence`);
}
const expectedFinancial = manifest.financialSpotChecks;
if (!expectedFinancial || typeof expectedFinancial !== 'object' || Array.isArray(expectedFinancial)) {
  fail('manifest carries no financialSpotChecks — it predates the verification contract and cannot support a restore drill; re-take the backup');
}
for (const key of FINANCIAL_KEYS) {
  const v = expectedFinancial[key];
  if (!(v === null || (Number.isSafeInteger(v) && v >= 0))) fail(`manifest financialSpotChecks.${key} is missing or invalid; refusing to verify on incomplete evidence`);
}

// --- Pairing: the manifest must name THIS artifact, and the artifact bytes
// must hash to the manifest's sha256. Checked before any database contact.
let artifactBytes;
try {
  artifactBytes = readFileSync(opt.artifact);
} catch {
  fail(`artifact is missing or unreadable: ${path.basename(opt.artifact)}`);
}
if (path.basename(manifest.file) !== path.basename(opt.artifact)) {
  fail(`manifest names ${manifest.file}, not ${path.basename(opt.artifact)} — artifact/manifest pairing mismatch`);
}
const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
if (artifactSha256 !== manifest.sha256) {
  fail('artifact SHA-256 does not match its manifest — artifact/manifest pairing mismatch');
}

const { default: pg } = await import('pg');

const client = new pg.Client({ connectionString: targetUrl, application_name: 'autodine-verify-restored' });
await client.connect();
try {
  const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
  // The same count definitions the backup manifest producers use
  // (lib-dump.mjs): tables = pg_class relkind 'r', functions = prokind f/p.
  const tables = await one(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'r'`, [schema]);
  const policies = await one(`select count(*)::int as n from pg_policies where schemaname = $1`, [schema]);
  const functions = await one(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.prokind in ('f','p')`, [schema]);
  const tableNames = (await client.query(`select c.relname as tablename from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'r' order by c.relname`, [schema])).rows.map((r) => r.tablename);
  let totalRows = 0;
  for (const t of tableNames) {
    const r = await one(`select count(*)::bigint as n from "${schema.replaceAll('"', '""')}"."${t.replaceAll('"', '""')}"`);
    totalRows += Number(r.n);
  }
  const sumIfPresent = async (table) => {
    if (!tableNames.includes(table)) return null;
    const col = await one(`select 1 as ok from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = 'amount_paise'`, [schema, table]);
    if (!col) return null;
    const r = await one(`select coalesce(sum(amount_paise), 0)::bigint as s from "${schema.replaceAll('"', '""')}"."${table}"`);
    return Number(r.s);
  };
  const financialSpotChecks = {
    payments_amount_paise: await sumIfPresent('payments'),
    subscription_payments_amount_paise: await sumIfPresent('subscription_payments'),
  };

  const matches = {
    tables: tables.n === counts.tables,
    policies: policies.n === counts.policies,
    functions: functions.n === counts.functions,
    totalRows: totalRows === counts.rows,
    payments_amount_paise: financialSpotChecks.payments_amount_paise === expectedFinancial.payments_amount_paise,
    subscription_payments_amount_paise: financialSpotChecks.subscription_payments_amount_paise === expectedFinancial.subscription_payments_amount_paise,
  };
  const report = {
    verifiedAt: new Date().toISOString(),
    schema,
    artifact: path.basename(opt.artifact),
    artifactSha256,
    schemaFingerprint: { tables: tables.n, policies: policies.n, functions: functions.n },
    totalRows,
    financialSpotChecks,
    manifestExpectations: { counts, financialSpotChecks: expectedFinancial },
    matches,
    verified: Object.values(matches).every(Boolean),
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.verified) {
    process.stderr.write('verify-restored: MISMATCH against backup manifest (see report above)\n');
    process.exit(1);
  }
} finally {
  await client.end();
}
