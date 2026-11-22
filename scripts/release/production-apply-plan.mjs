#!/usr/bin/env node
/**
 * Production apply plan — offline, read-only, no network.
 *
 * Given a hosted ledger dump, this prints exactly which repository migrations are
 * missing from that environment, in the order they must be applied, plus the
 * verification queries to run afterwards. It never connects to a database: the
 * ledger is read from a file the operator exports, so the tool cannot accidentally
 * become a deploy step.
 *
 * Usage
 *   node scripts/release/production-apply-plan.mjs --ledger <file> [--json] [--check]
 *
 * The ledger file is either
 *   * a JSON array of { version, name } (any order), or
 *   * a JSON object { versions: [{ version, name }] }, or
 *   * newline/pipe/comma separated versions ("20261103000100|20261103185425|…"),
 *     which is what `select string_agg(version,'|' order by version) from
 *     supabase_migrations.schema_migrations` returns.
 *
 * `--check` exits 1 when anything is pending, so it can gate an operator runbook
 * step ("nothing to apply") without applying anything.
 *
 * The version comparison uses the 14-digit prefix only: Supabase stamps a ledger
 * row with the version the tool used, and the hosted environments on 2026-11-21
 * show three rows whose version differs from the repository file that carries the
 * same change (20261120190546 vs 20261118002200 style). Those are reported
 * separately as `out-of-band` rather than silently treated as satisfied.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

export function parseLedger(raw) {
  const text = String(raw).trim();
  if (!text) throw new Error('ledger is empty');
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.versions;
    if (!Array.isArray(rows)) throw new Error('JSON ledger has no array of versions');
    return rows.map((row) => ({
      version: String(row.version ?? row).slice(0, 14),
      name: row.name ?? null,
    }));
  }
  const tokens = text.split(/[\s,|]+/).filter(Boolean);
  return tokens.map((token) => ({ version: String(token).slice(0, 14), name: null }));
}

export function readRepositoryMigrations(dir = join(root, 'supabase/migrations')) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({ version: file.slice(0, 14), file }));
}

/**
 * @returns {{ pending: object[], applied: object[], outOfBand: object[], ledgerSize: number, repoSize: number }}
 */
export function plan({ ledger, migrations }) {
  const ledgerVersions = new Set(ledger.map((row) => row.version));
  const repoVersions = new Set(migrations.map((row) => row.version));
  const pending = migrations.filter((row) => !ledgerVersions.has(row.version));
  const applied = migrations.filter((row) => ledgerVersions.has(row.version));
  // Ledger rows the repository cannot explain. A real hosted environment carries
  // some of these on purpose (owner operations, bundle replays); the point is that
  // they are named instead of ignored.
  const outOfBand = ledger
    .filter((row) => !repoVersions.has(row.version))
    .map((row) => ({ version: row.version, name: row.name }));
  return { pending, applied, outOfBand, ledgerSize: ledger.length, repoSize: migrations.length };
}

export const VERIFICATION_SQL = `-- run read-only after applying, one row per expectation
select (select count(*) from supabase_migrations.schema_migrations) as ledger_rows;
select indexname from pg_indexes where indexname = 'table_qr_codes_one_active_per_table';
select proname, position('pg_advisory_xact_lock' in pg_get_functiondef(oid)) > 0 as advisory_locked
  from pg_proc where proname in ('rotate_table_qr_code', 'retire_table_qr_code');`;

function renderText(result) {
  const lines = [];
  lines.push(`repository migrations: ${result.repoSize}`);
  lines.push(`ledger rows:            ${result.ledgerSize}`);
  lines.push(`already applied:        ${result.applied.length}`);
  lines.push(`pending:                ${result.pending.length}`);
  if (result.outOfBand.length) {
    lines.push('');
    lines.push(`ledger rows with no repository file (${result.outOfBand.length}) — explain these before applying anything:`);
    for (const row of result.outOfBand) lines.push(`  ${row.version}${row.name ? ' ' + row.name : ''}`);
  }
  if (result.pending.length) {
    lines.push('');
    lines.push('apply in this order:');
    for (const row of result.pending) lines.push(`  ${row.file}`);
    lines.push('');
    lines.push('then verify (read-only):');
    lines.push(VERIFICATION_SQL);
  } else {
    lines.push('');
    lines.push('nothing to apply: every repository migration is already in that ledger.');
  }
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const ledgerIndex = args.indexOf('--ledger');
  if (ledgerIndex === -1 || !args[ledgerIndex + 1]) {
    console.error('usage: production-apply-plan.mjs --ledger <file> [--json] [--check]');
    return 2;
  }
  const ledgerPath = args[ledgerIndex + 1];
  const asJson = args.includes('--json');
  const check = args.includes('--check');
  const result = plan({
    ledger: parseLedger(readFileSync(ledgerPath, 'utf8')),
    migrations: readRepositoryMigrations(),
  });
  console.log(asJson ? JSON.stringify(result, null, 2) : renderText(result));
  if (check && result.pending.length) return 1;
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv);
}
