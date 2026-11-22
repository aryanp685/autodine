#!/usr/bin/env node
/**
 * Restore an AutoDine backup into an EMPTY database.
 *
 *   AUTODINE_RESTORE_TARGET_URL=postgresql://... \
 *   AUTODINE_BACKUP_PASSPHRASE=... \
 *   node scripts/backup/restore-logical.mjs --file backups/autodine-....sql.gz.enc --confirm-empty-db
 *
 * Safety, in order:
 *   - refuses to run unless the target has zero tables in the restored
 *     schema, unless --allow-non-empty is passed;
 *   - refuses a target that is not a loopback disposable database unless a
 *     scratch opt-in AND an approved project ref are both present, and
 *     refuses a Production project outright (see lib-restore-target.mjs);
 *   - never prints the target URL, the user name or the password.
 * After restore it prints a verification report (table/function/policy counts
 * and row totals) — treat it as a smoke check, not as proof of completeness.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { decryptBuffer, sha256 } from './lib-crypto.mjs';
import { restoreTargetDecision } from './lib-restore-target.mjs';
import { resolvePgClient } from './lib-pg-client.mjs';
import { pgServiceFields, withPgService } from './lib-pg-service.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1';
}
const quoteIdent = (s) => '"' + String(s).replaceAll('"', '""') + '"';
const fail = (msg) => { process.stderr.write(`restore: FAILED: ${msg}\n`); process.exit(1); };
// Only locally constructed, fixed diagnostics may cross the resource scope.
class RestoreFailure extends Error {}
const file = opt.file;
if (!file) fail('missing --file');
if (opt['target-url']) fail('refusing --target-url; set AUTODINE_RESTORE_TARGET_URL instead');
const targetUrl = process.env.AUTODINE_RESTORE_TARGET_URL;
if (!targetUrl) fail('set AUTODINE_RESTORE_TARGET_URL (never on the command line)');

// Target guard, BEFORE anything is decrypted or connected to.
//
// A restore replays a dump into whatever it is pointed at. The hosted drill
// must only ever reach the runner's own disposable loopback container, so a
// hosted target needs an explicit scratch opt-in plus an approved project
// ref, and a Production project is refused outright — no flag unlocks it.
// The decision names the host and project ref only: never the URL, the
// user name or the password.
const targetDecision = restoreTargetDecision({
  targetUrl,
  expectedRef: process.env.AUTODINE_RESTORE_EXPECTED_REF,
  allowScratch: opt['allow-scratch'] === '1' || process.env.AUTODINE_RESTORE_ALLOW_SCRATCH === '1',
  productionRefs: (process.env.AUTODINE_RESTORE_PRODUCTION_REFS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
});
if (!targetDecision.allowed) fail(targetDecision.reason.startsWith('refusing to restore into the PRODUCTION project ') ? 'refusing the PRODUCTION project' : 'refusing the restore target; target guard did not approve it');
process.stderr.write('restore: target accepted by target guard\n');
const passphrase = process.env.AUTODINE_BACKUP_PASSPHRASE;
if (!passphrase) fail('set AUTODINE_BACKUP_PASSPHRASE');
const confirmEmpty = opt['confirm-empty-db'] === '1' || opt['confirm-empty-db'] === true;
const allowNonEmpty = opt['allow-non-empty'] === '1';
if (!confirmEmpty && !allowNonEmpty) {
  fail('refusing to guess intent — pass --confirm-empty-db (safe) or --allow-non-empty (advanced: you know the target holds data you intend to keep)');
}
const schema = opt.schema || 'public';
if (file.endsWith('.dump.enc')) {
  try { pgServiceFields(targetUrl); } catch { fail('restore target connection format is not supported by the PostgreSQL client'); }
}

const encrypted = readFileSync(file);
process.stderr.write(`restore: file sha256 = ${sha256(encrypted)}\n`);
let plaintext;
try {
  plaintext = decryptBuffer(encrypted, passphrase);
} catch {
  fail('could not decrypt the backup; check the passphrase and artifact integrity');
}

const client = new pg.Client({ connectionString: targetUrl, application_name: 'autodine-logical-restore' });
try {
  try {
    await client.connect();
  } catch {
    throw new RestoreFailure('could not connect to the approved restore target; inspect connection configuration');
  }
  const tableCount = await client.query('select count(*)::int as n from pg_tables where schemaname = $1', [schema]);
  if (tableCount.rows[0].n > 0 && !allowNonEmpty) {
    throw new RestoreFailure('target database already has tables in the selected schema; refusing to overwrite (use --allow-non-empty only if the restore will coexist with existing objects)');
  }
  const isDump = file.endsWith('.dump.enc');
  if (isDump) {
    // pg_dump custom format requires pg_restore.
    const tmp = mkdtempSync(path.join(tmpdir(), 'autodine-restore-'));
    try {
      const dumpPath = path.join(tmp, 'restore.dump');
      writeFileSync(dumpPath, plaintext, { flag: 'wx', mode: 0o600 });
      // Resolve pg_restore to the binary that will actually run.
      //
      // The reader must be the same major version as the writer: a dump
      // written by a newer pg_dump carries an archive format an older
      // pg_restore refuses outright. The runner image ships an older
      // client that can shadow the pinned one on PATH, so when the
      // composite action has pinned a directory the absolute path of the
      // VERIFIED binary is used and the version is re-checked here.
      const pgRestore = resolvePgClient('pg_restore', { required: true });
      // Client stderr and Node's command error may contain a target URL.
      // Fail on the first restore error and expose only a safe exit status;
      // the disposable target can be partial and must be discarded.
      try {
        withPgService(targetUrl, ({ env, dbname }) => {
          execFileSync(pgRestore.path, ['--exit-on-error', '--no-owner', `--schema=${schema}`, '--dbname', dbname, dumpPath], { stdio: ['ignore', 'ignore', 'pipe'], env });
        });
      } catch (error) {
        const status = Number.isInteger(error?.status) ? ` (exit ${error.status})` : '';
        throw new RestoreFailure(`pg_restore failed${status}; target may be partially restored`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    const sql = plaintext.toString('utf8');
    try {
      await client.query(sql);
    } catch (error) {
      // A fixed, non-sensitive hint for the known bare PostgreSQL scaffold
      // failure; never forward arbitrary SQL errors or row contents.
      const hint = error?.code === '3F000' && error?.message === 'schema "auth" does not exist'
        ? ': schema "auth" does not exist' : '';
      throw new RestoreFailure(`replay failed${hint}; target may be partially restored — discard the disposable target before retrying`);
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
} catch (error) {
  // Do not expose raw database or child errors, which can contain data or
  // credentials. Only diagnostics constructed locally are forwarded.
  const safe = error instanceof RestoreFailure
    ? error.message : 'restore or verification failed; target may be partially restored';
  process.stderr.write(`restore: FAILED: ${safe}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
