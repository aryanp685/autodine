#!/usr/bin/env node
/**
 * Restore an AutoDine backup into an EMPTY database.
 *
 *   AUTODINE_RESTORE_TARGET_URL=postgresql://... \
 *   AUTODINE_BACKUP_PASSPHRASE=... \
 *   node scripts/backup/restore-logical.mjs --file backups/autodine-....sql.gz.enc --confirm-empty-db
 *
 * Safety: refuses to run unless the target has zero tables in the restored
 * schema, unless --allow-non-empty is passed. Never prints the target URL.
 * After restore it prints a verification report (table/function/policy counts
 * and row totals) — treat it as a smoke check, not as proof of completeness.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { decryptBuffer, sha256 } from './lib-crypto.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1';
}
const quoteIdent = (s) => '"' + String(s).replaceAll('"', '""') + '"';
const fail = (msg) => { process.stderr.write(`restore: FAILED: ${msg}\n`); process.exit(1); };
const file = opt.file;
if (!file) fail('missing --file');
const targetUrl = process.env.AUTODINE_RESTORE_TARGET_URL || opt['target-url'];
if (!targetUrl) fail('set AUTODINE_RESTORE_TARGET_URL (never on the command line)');
const passphrase = process.env.AUTODINE_BACKUP_PASSPHRASE;
if (!passphrase) fail('set AUTODINE_BACKUP_PASSPHRASE');
const confirmEmpty = opt['confirm-empty-db'] === '1' || opt['confirm-empty-db'] === true;
const allowNonEmpty = opt['allow-non-empty'] === '1';
if (!confirmEmpty && !allowNonEmpty) {
  fail('refusing to guess intent — pass --confirm-empty-db (safe) or --allow-non-empty (advanced: you know the target holds data you intend to keep)');
}
const schema = opt.schema || 'public';

const encrypted = readFileSync(file);
process.stderr.write(`restore: file sha256 = ${sha256(encrypted)}\n`);
let plaintext;
try {
  plaintext = decryptBuffer(encrypted, passphrase);
} catch (err) {
  fail(err.message);
}

const client = new pg.Client({ connectionString: targetUrl, application_name: 'autodine-logical-restore' });
await client.connect();
try {
  const tableCount = await client.query('select count(*)::int as n from pg_tables where schemaname = $1', [schema]);
  if (tableCount.rows[0].n > 0 && !allowNonEmpty) {
    fail(`target database already has ${tableCount.rows[0].n} table(s) in schema ${schema}; refusing to overwrite (use --allow-non-empty only if the restore will coexist with existing objects)`);
  }
  const isDump = file.endsWith('.dump.enc');
  if (isDump) {
    // pg_dump custom format requires pg_restore.
    const tmp = mkdtempSync(path.join(tmpdir(), 'autodine-restore-'));
    try {
      const dumpPath = path.join(tmp, 'restore.dump');
      writeFileSync(dumpPath, plaintext);
      execFileSync('pg_restore', ['--no-owner', '--no-privileges', `--schema=${schema}`, '--dbname', targetUrl, dumpPath], { stdio: ['ignore', 'ignore', 'inherit'] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    const sql = plaintext.toString('utf8');
    try {
      await client.query(sql);
    } catch (err) {
      fail(`replay failed: ${err.message} (the target may be partially restored — drop and recreate the schema before retrying)`);
    }
  }
  // Verification report
  const report = {};
  const tables = await client.query('select count(*)::int as n from pg_tables where schemaname = $1', [schema]);
  const fns = await client.query('select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.prokind in (\'f\',\'p\')', [schema]);
  const pols = await client.query('select count(*)::int as n from pg_policies where schemaname=$1', [schema]);
  const triggers = await client.query('select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and not t.tgisinternal', [schema]);
  const rls = await client.query('select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind=\'r\' and c.relrowsecurity', [schema]);
  const userTables = await client.query('select tablename from pg_tables where schemaname=$1 order by tablename', [schema]);
  let exactRows = 0;
  if (userTables.rows.length <= 200) {
    for (const t of userTables.rows) {
      const c = await client.query('select count(*)::bigint as n from ' + quoteIdent(schema) + '.' + quoteIdent(t.tablename));
      exactRows += Number(c.rows[0].n);
    }
  }
  report.tables = tables.rows[0].n; report.functions = fns.rows[0].n; report.policies = pols.rows[0].n;
  report.triggers = triggers.rows[0].n; report.rlsTables = rls.rows[0].n; report.rows = userTables.rows.length <= 200 ? exactRows : 'skipped (>200 tables)';
  report.verdict = report.tables > 0 ? 'restored (smoke check only — compare row counts and run app-level checks against a restored copy before relying on it)' : 'EMPTY RESTORE — investigate';
  process.stdout.write(JSON.stringify({ ok: report.tables > 0, report }, null, 2) + '\n');
} finally {
  await client.end();
}
