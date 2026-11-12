#!/usr/bin/env node
/**
 * Migration reconciliation harness -- disposable and loopback-only.
 *
 * WHY THIS EXISTS
 *
 * The hosted production ledger stops at 20261108000200 while the repository
 * carries later migrations. A ledger is a list of names, not a schema: SQL can
 * be recorded and later drifted, or run by hand and never recorded. This tool
 * therefore assumes NEITHER "applied" NOR "unapplied". It establishes, on a
 * throwaway PostgreSQL, everything that can be known without a hosted database:
 *
 *   evidence     replays the repository one file at a time and reports which
 *                step reproduces each function hash previously captured from
 *                production (scripts/reconcile/evidence/*.json).
 *   converge     for every migration with no ledger record: what it changes,
 *                whether it can be run twice, and whether running it again
 *                AFTER later migrations would silently undo them. Also proves
 *                the set applies to a populated pre-upgrade database without
 *                losing a row, and self-tests the classifier below.
 *   classify     takes the jsonb produced by scripts/reconcile/catalog-probe.sql
 *                (a read-only catalog query) and says, per migration, whether
 *                its effects are PRESENT, absent (APPLY) or drifted (REVIEW).
 *   integration  three-way catalog comparison of migration chains from git
 *                refs, so two branches that both redefine one object are
 *                reported instead of silently "last file wins".
 *   staging      rebuilds the staging project's actual history (six early
 *                migrations, the local stand-in for tables the repository never
 *                created, then the reviewed bundle) and applies what the bundle
 *                does not contain. Reports files a version cut-off would skip,
 *                bundled files edited afterwards, and every catalog difference
 *                from a clean replay.
 *
 * It never reads application environment and refuses any non-loopback server.
 *
 *   node scripts/reconcile/reconcile-migrations.mjs [all|evidence|converge|staging]
 *   node scripts/reconcile/reconcile-migrations.mjs classify --probe=<probe.json>
 *   node scripts/reconcile/reconcile-migrations.mjs integration --base=<ref> --main=<ref> --pr=<ref>
 *   options: --json=<report file>   RECONCILE_PG_ADMIN_URL=<loopback admin url> (default: embedded)
 *            --emit-probe=<file>    (staging) write that database's catalog probe, for `classify`
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { prepareFinancialUpgrade } from '../verify-financial-upgrade.mjs';

const root = process.cwd();
const MIGRATIONS = path.join(root, 'supabase/migrations');
const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith('--')) ?? 'all';
const MODES = ['all', 'evidence', 'converge', 'staging', 'classify', 'capture', 'integration'];
if (!MODES.includes(mode)) { console.error(`Unknown mode "${mode}". Use one of: ${MODES.join(', ')}`); process.exit(2); }
if (mode === 'classify' && !argv.some((a) => a.startsWith('--probe='))) { console.error('classify needs --probe=<json produced by scripts/reconcile/catalog-probe.sql>'); process.exit(2); }
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));
const evidence = JSON.parse(await readFile(path.join(root, opt.evidence ?? 'scripts/reconcile/evidence/production-2026-11-10.json'), 'utf8'));
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const PROBE_SQL = await readFile(path.join(root, 'scripts/reconcile/catalog-probe.sql'), 'utf8');

const localize = (sql) => sql.replace(/^create extension if not exists "pgcrypto";\s*$/gm, '-- local harness: gen_random_uuid is built in');
const treeSource = { label: 'working tree', list: async () => (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort(), read: (f) => readFile(path.join(MIGRATIONS, f), 'utf8') };
const refSource = (ref) => ({
  label: ref,
  list: async () => execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'supabase/migrations'], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql')).map((f) => path.basename(f)).sort(),
  read: async (f) => execFileSync('git', ['show', `${ref}:supabase/migrations/${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 }),
});

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startCluster() {
  if (process.env.RECONCILE_PG_ADMIN_URL) {
    const admin = new URL(process.env.RECONCILE_PG_ADMIN_URL);
    if (!LOOPBACK.includes(admin.hostname)) throw new Error('Refusing non-loopback PostgreSQL target');
    return { urlFor: (db) => { const u = new URL(admin.href); u.pathname = `/${db}`; return u.href; }, stop: async () => {} };
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'autodine-reconcile-'));
  const port = await unusedPort();
  const password = `local-${randomUUID().replaceAll('-', '')}`;
  const server = new EmbeddedPostgres({ databaseDir: path.join(dataDir, 'cluster'), port, user: 'postgres', password, persistent: false, onLog: () => {}, onError: (e) => process.stderr.write(`${e?.message ?? e}\n`) });
  await server.initialise();
  await server.start();
  const base = `postgresql://postgres:${password}@127.0.0.1:${port}`;
  return { urlFor: (db) => `${base}/${db}`, stop: async () => { await server.stop().catch(() => {}); await rm(dataDir, { recursive: true, force: true }); } };
}

const cluster = await startCluster();
const created = new Set();
async function withDb(name, fn) {
  const client = new pg.Client({ connectionString: cluster.urlFor(name) });
  await client.connect();
  client.on('notice', () => {});
  try { return await fn(client); } finally { await client.end(); }
}
async function createDb(template) {
  const name = `reconcile_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await withDb('postgres', (c) => c.query(`create database "${name}"${template ? ` template "${template}"` : ''}`));
  created.add(name);
  return name;
}
async function dropDb(name) {
  await withDb('postgres', (c) => c.query(`drop database if exists "${name}"`));
  created.delete(name);
}
/** The portable fingerprint: exactly what scripts/reconcile/catalog-probe.sql returns. */
async function probe(client) { return (await client.query(PROBE_SQL)).rows[0].catalog ?? {}; }
async function applyFiles(client, files, source) {
  for (const file of files) {
    try { await client.query(localize(await source.read(file))); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
}

const FP = {
  functions: `select p.oid::regprocedure::text as k, concat_ws('|', md5(p.prosrc), p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), ''), coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), 'default-acl')) as v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
  policies: `select schemaname || '.' || tablename || '/' || policyname as k, concat_ws('|', permissive, array_to_string(roles, ','), cmd, coalesce(qual, ''), coalesce(with_check, '')) as v from pg_policies where schemaname in ('public', 'storage')`,
  relations: `select c.relname::text as k, concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity, coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), 'default-acl')) as v from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p')`,
  columns: `select table_name || '.' || column_name as k, concat_ws('|', data_type, udt_name, is_nullable, coalesce(column_default, '')) as v from information_schema.columns where table_schema = 'public'`,
  columnAcls: `select c.relname || '.' || a.attname as k, (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x) as v from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and a.attacl is not null and not a.attisdropped`,
  constraints: `select conrelid::regclass::text || '/' || conname as k, pg_get_constraintdef(oid) as v from pg_constraint where connamespace = 'public'::regnamespace`,
  indexes: `select tablename || '/' || indexname as k, indexdef as v from pg_indexes where schemaname = 'public'`,
  triggers: `select n.nspname || '.' || c.relname || '/' || t.tgname as k, pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text as v from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')`,
  views: `select viewname::text as k, definition as v from pg_views where schemaname = 'public'`,
  enums: `select t.typname::text as k, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace group by 1`,
  publications: `select pubname || '/' || schemaname || '.' || tablename as k, 'member' as v from pg_publication_tables`,
};
async function fingerprint(client) {
  const out = {};
  for (const [section, sql] of Object.entries(FP)) out[section] = Object.fromEntries((await client.query(sql)).rows.map((r) => [r.k, r.v]));
  return out;
}
function diff(a, b) {
  const changes = [];
  for (const section of Object.keys(FP)) {
    for (const key of new Set([...Object.keys(a[section]), ...Object.keys(b[section])])) {
      if (a[section][key] !== b[section][key]) changes.push({ section, key, left: a[section][key] ?? null, right: b[section][key] ?? null });
    }
  }
  return changes;
}

/** One reusable template holding only the local Supabase shim and platform-style default grants. */
const shimTemplate = await createDb();
await withDb(shimTemplate, async (c) => {
  await c.query(await readFile(path.join(root, 'scripts/local-pg/000_supabase_shim.sql'), 'utf8'));
  await c.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
});
async function replay(source, files) {
  const name = await createDb(shimTemplate);
  const fp = await withDb(name, async (c) => { await applyFiles(c, files, source); return fingerprint(c); });
  return { name, fp };
}

const report = { generatedBy: 'scripts/reconcile/reconcile-migrations.mjs', hostedDatabaseContacted: false, mode };
let failed = false;
const fail = (message) => { failed = true; console.error(`FAIL ${message}`); };

/* ----------------------------------------------------------- ledger view */
const allFiles = await treeSource.list();
const facts = evidence.catalogFacts;
const unmatched = evidence.repositoryFilesWithoutSameNamedEntry;
const noRecord = new Set(unmatched.newerThanLastRecordedVersion);
// "pending" = no same-named ledger entry, or written after the evidence was captured.
// It is the set whose hosted state is UNKNOWN, not a claim that it is unapplied.
const pending = allFiles.filter((f) => noRecord.has(f) || f.split('_')[0] > evidence.capturedThroughRepositoryVersion);
const unrecordedLegacy = allFiles.filter((f) => unmatched.olderThanLastRecordedVersion.includes(f));
const baseline = allFiles.filter((f) => !pending.includes(f));
report.ledger = { repositoryMigrations: allFiles.length, ledgerEntries: evidence.ledgerSummary.entries, fullLedgerRetained: evidence.ledgerSummary.fullListRetained, lastRecordedVersion: evidence.lastRecordedVersion, pending, unrecordedLegacy };
console.log(`ledger: ${allFiles.length} repository migrations; ${pending.length} with no ledger record (hosted state unknown); ${unrecordedLegacy.length} older files have no same-named ledger entry`);

try {
  /* -------------------------------------------------------------- evidence */
  if (mode === 'evidence' || mode === 'all') {
    const tracked = [...new Set([...Object.keys(facts.functionSourceMd5), ...facts.functionsAbsent, 'place_order', 'hit_rate_limit', 'current_table_session', 'mark_order_session_paid', 'close_order_session_and_issue_receipt'])];
    const name = await createDb(shimTemplate);
    const timeline = [];
    await withDb(name, async (c) => {
      let seen = new Map();
      for (const file of allFiles) {
        await applyFiles(c, [file], treeSource);
        const { rows } = await c.query(`select p.oid::regprocedure::text as sig, p.proname::text as name, md5(p.prosrc) as md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`, [tracked]);
        const now = new Map(rows.map((r) => [r.sig, r]));
        for (const [sig, r] of now) if (seen.get(sig)?.md5 !== r.md5) timeline.push({ file, signature: sig, name: r.name, md5: r.md5 });
        for (const [sig, r] of seen) if (!now.has(sig)) timeline.push({ file, signature: sig, name: r.name, md5: null });
        seen = now;
      }
    });
    const matches = {};
    for (const [fn, hash] of Object.entries(facts.functionSourceMd5)) {
      const history = timeline.filter((e) => e.name === fn);
      const hit = history.filter((e) => e.md5 === hash);
      const laterEdits = hit.length ? history.filter((e) => e.file > hit[hit.length - 1].file && e.signature === hit[hit.length - 1].signature).map((e) => e.file) : [];
      matches[fn] = hit.length
        ? { productionBodyEquals: hit[hit.length - 1].file, signature: hit[hit.length - 1].signature, laterRepositoryRedefinitionsNotInProduction: laterEdits }
        : { productionBodyEquals: null, note: 'No repository migration reproduces this body: production holds a drifted variant.', repositoryDefinitions: [...new Set(history.map((e) => e.file))] };
    }
    const absent = Object.fromEntries(facts.functionsAbsent.map((fn) => [fn, { firstCreatedBy: timeline.find((e) => e.name === fn && e.md5)?.file ?? null }]));
    report.evidence = { functionBodyMatches: matches, functionsAbsentInProduction: absent, trackedTimeline: timeline };
    for (const [fn, m] of Object.entries(matches)) console.log(`evidence: ${fn} -> ${m.productionBodyEquals ?? 'NO MATCH (drift)'}${m.laterRepositoryRedefinitionsNotInProduction?.length ? `; not yet in production: ${m.laterRepositoryRedefinitionsNotInProduction.join(', ')}` : ''}`);
    for (const [fn, m] of Object.entries(absent)) console.log(`evidence: ${fn} absent in production; first created by ${m.firstCreatedBy}`);
  }

  /* ------------------------------------------------- converge and classify */
  if (mode === 'converge' || mode === 'classify' || mode === 'all') {
    const clean = await replay(treeSource, allFiles);
    const baselineDb = await createDb(shimTemplate);
    await withDb(baselineDb, (c) => applyFiles(c, baseline, treeSource));

    /** Re-applies one file to a copy of `templateDb`; reports whether the catalog moved. */
    const rerun = async (templateDb, file, expected) => {
      const copy = await createDb(templateDb);
      try {
        const after = await withDb(copy, async (c) => { await applyFiles(c, [file], treeSource); return fingerprint(c); });
        const delta = diff(expected, after);
        return delta.length ? { result: 'changes-catalog', objects: delta.length, examples: delta.slice(0, 4).map((d) => `${d.section} ${d.key}`) } : { result: 'no-op' };
      } catch (error) {
        return { result: 'fails', error: error.message.slice(0, 220) };
      } finally { await dropDb(copy); }
    };

    // Roll the pending set forward one file at a time on top of the recorded baseline.
    const states = [await withDb(baselineDb, probe)];
    const markers = {};
    const perFile = [];
    for (const file of pending) {
      const before = states[states.length - 1];
      const [after, exact] = await withDb(baselineDb, async (c) => { await applyFiles(c, [file], treeSource); return [await probe(c), await fingerprint(c)]; });
      states.push(after);
      markers[file] = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((key) => before[key] !== after[key]).sort()
        .map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
      perFile.push({ file, catalogObjectsChanged: Object.keys(markers[file]).length, rerunAtOwnPosition: await rerun(baselineDb, file, exact), rerunAfterFullChain: await rerun(clean.name, file, clean.fp) });
    }
    const forwardDelta = diff(clean.fp, await withDb(baselineDb, fingerprint));
    if (forwardDelta.length) fail(`recorded baseline + pending set differs from a clean replay in ${forwardDelta.length} place(s), e.g. ${forwardDelta[0].section} ${forwardDelta[0].key}`);

    // For each catalog object: the chain of values it takes across the pending set.
    const history = {};
    for (const file of pending) for (const [key, value] of Object.entries(markers[file])) {
      history[key] ??= { values: [value.before], files: [] };
      history[key].values.push(value.after);
      history[key].files.push(file);
    }
    const classify = (catalog) => pending.map((file) => {
      const keys = Object.keys(markers[file]);
      const tally = { present: 0, absent: 0, superseded: 0, drift: 0 };
      const driftObjects = [];
      for (const key of keys) {
        const position = history[key].files.indexOf(file) + 1;
        const found = history[key].values.lastIndexOf(catalog[key] ?? null);
        if (found === -1) { tally.drift += 1; driftObjects.push(key); }
        else if (found < position) tally.absent += 1;
        else if (found === position) tally.present += 1;
        else tally.superseded += 1;
      }
      const verdict = !keys.length ? 'NO FOOTPRINT: changes no catalog object; decide from its content'
        : tally.drift ? 'REVIEW: live objects match neither the before nor the after state'
          : tally.absent && (tally.present || tally.superseded) ? 'REVIEW: only part of its effects are present'
            : tally.absent ? 'APPLY: none of its effects are present'
              : 'PRESENT: record as applied, do not run it again';
      return { file, objects: keys.length, ...tally, verdict, driftObjects: driftObjects.slice(0, 12) };
    });

    if (mode !== 'classify') {
      // The classifier must name the true state for every prefix of the pending set.
      const mismatches = [];
      states.forEach((catalog, applied) => {
        for (const row of classify(catalog)) {
          const expected = pending.indexOf(row.file) < applied ? 'PRESENT' : 'APPLY';
          if (row.objects && !row.verdict.startsWith(expected)) mismatches.push({ pendingFilesApplied: applied, file: row.file, verdict: row.verdict });
        }
      });
      if (mismatches.length) fail(`classifier self-test: ${mismatches.length} wrong verdict(s), e.g. ${JSON.stringify(mismatches[0])}`);

      // A DRIFTED database must be named as one. Synthesise one drifted
      // catalog per pending migration -- an object whose value no migration in
      // the repository ever produces -- and require a REVIEW verdict. Without
      // this, a drifted database would be classified PRESENT and the
      // migration that would repair it would be recorded as already applied.
      const driftProbes = [];
      for (const file of pending) {
        const keys = Object.keys(markers[file]);
        if (!keys.length) continue;
        const catalog = { ...states[pending.indexOf(file) + 1] };
        catalog[keys[0]] = `drifted:${keys[0]}:value-no-migration-produces`;
        const row = classify(catalog).find((r) => r.file === file);
        if (!(row.drift > 0 || row.verdict.startsWith('REVIEW'))) driftProbes.push({ file, verdict: row.verdict });
      }
      if (driftProbes.length) fail(`drift self-test: ${driftProbes.length} synthesised drift state(s) were not reported as drift, e.g. ${JSON.stringify(driftProbes[0])}`);
      const driftTested = pending.filter((file) => Object.keys(markers[file]).length).length;
      console.log(`self-test: ${driftTested} synthesised drift state(s), every one reported as REVIEW/drift`);

      // A populated pre-upgrade database must take the whole pending set without losing a row.
      let populated;
      const seededDb = await createDb(shimTemplate);
      try {
        populated = await withDb(seededDb, async (c) => {
          await applyFiles(c, baseline, treeSource);
          await prepareFinancialUpgrade(c);
          const count = async () => Object.fromEntries((await c.query(`select t, n from (values
            ('orders', (select count(*)::int from orders)), ('order_items', (select count(*)::int from order_items)),
            ('payments', (select count(*)::int from payments)), ('payment_audit_events', (select count(*)::int from payment_audit_events)),
            ('restaurant_invoices', (select count(*)::int from restaurant_invoices)), ('restaurant_payment_receipts', (select count(*)::int from restaurant_payment_receipts))) as v(t, n)`)).rows.map((r) => [r.t, r.n]));
          const before = await count();
          await applyFiles(c, pending, treeSource);
          const after = await count();
          return { rowCountsBefore: before, rowCountsAfter: after, rowsPreserved: JSON.stringify(before) === JSON.stringify(after) };
        });
        if (!populated.rowsPreserved) fail('the pending set changed financial row counts on a populated database');
      } catch (error) { populated = { error: error.message }; fail(`populated pre-upgrade database: ${error.message}`); }

      report.converge = { cleanReplayMigrations: allFiles.length, recordedBaselineMigrations: baseline.length, forwardFromBaselineEqualsCleanReplay: forwardDelta.length === 0, pendingSet: perFile, classifierSelfTest: { statesChecked: states.length, wrongVerdicts: mismatches }, populatedPreUpgradeDatabase: populated };
      console.log(`converge: baseline(${baseline.length}) + pending(${pending.length}) ${forwardDelta.length ? 'DIFFERS from' : 'equals'} clean replay(${allFiles.length}); classifier self-test ${states.length} states, ${mismatches.length} wrong verdicts; populated ${JSON.stringify(populated)}`);
      const show = (r) => (r.result === 'no-op' ? 'no-op' : r.result === 'fails' ? `FAILS (${r.error})` : `CHANGES ${r.objects} object(s): ${r.examples.join('; ')}`);
      for (const row of perFile) console.log(`pending ${row.file} | changes ${row.catalogObjectsChanged} | re-run in place: ${show(row.rerunAtOwnPosition)} | re-run after full chain: ${show(row.rerunAfterFullChain)}`);
    }

    if (mode === 'classify') {
      let catalog = JSON.parse(await readFile(path.resolve(root, opt.probe), 'utf8'));
      if (Array.isArray(catalog)) catalog = catalog[0];
      if (catalog && typeof catalog === 'object' && catalog.catalog) catalog = catalog.catalog;
      const rows = classify(catalog);
      report.classify = { probe: opt.probe, objectsInProbe: Object.keys(catalog).length, migrations: rows };
      // Objects that no pending migration touches are invisible to the verdicts
      // above, yet later migrations rely on them: an ON CONFLICT needs its unique
      // key, and `create table if not exists` never reshapes a table that is
      // already there. Compare those with what the recorded baseline should hold.
      const baselineOnly = await createDb(shimTemplate);
      const baselineCatalog = await withDb(baselineOnly, async (c) => { await applyFiles(c, baseline, treeSource); return probe(c); });
      const finalCatalog = await withDb(clean.name, (c) => probe(c));
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const baselineDrift = Object.keys(finalCatalog)
        .filter((key) => same(baselineCatalog[key], finalCatalog[key]) && !same(catalog[key], finalCatalog[key]))
        .map((key) => `${key} ${key in catalog ? '(differs)' : '(missing)'}`).sort();
      const notInRepository = Object.keys(catalog).filter((key) => !(key in finalCatalog)).sort();
      report.classify.baselineDrift = baselineDrift;
      report.classify.notInRepository = notInRepository;
      const some = (list) => `${list.slice(0, 40).join('; ')}${list.length > 40 ? '; ...' : ''}`;
      // Drift is a decision, not an exit code: a REVIEW that nobody has
      // recorded is a migration-safety debt, so it fails until it is
      // acknowledged on purpose.
      const findings = [
        ...rows.filter((r) => r.drift > 0 || r.verdict.startsWith('REVIEW'))
          .map((r) => `${r.file}: ${r.verdict}${r.driftObjects.length ? ` (${r.driftObjects.length} object(s), e.g. ${r.driftObjects[0]})` : ''}`),
        ...baselineDrift.map((key) => `untouched-but-different: ${key}`),
        ...notInRepository.map((key) => `in-the-database-but-not-in-the-repository: ${key}`),
      ];
      report.classify.driftFindings = findings;
      report.classify.driftAcknowledged = Boolean(opt['ack-drift']);
      if (findings.length) {
        for (const finding of findings) console.log(`drift: ${finding}`);
        if (!opt['ack-drift']) {
          fail(`${findings.length} unacknowledged drift finding(s). Record each as a migration-safety decision (a forward migration that converges it, or a written reason not to), then re-run with --ack-drift.`);
        } else {
          console.log(`classify: ${findings.length} drift finding(s) acknowledged with --ack-drift; they remain open in the report`);
        }
      }
      console.log(baselineDrift.length
        ? `baseline: REVIEW ${baselineDrift.length} object(s) that no pending migration touches do not match the repository: ${some(baselineDrift)}`
        : 'baseline: every object the pending migrations leave alone matches the repository');
      if (notInRepository.length) console.log(`baseline: REVIEW ${notInRepository.length} object(s) exist in the probe but in no repository migration: ${some(notInRepository)}`);
      for (const row of rows) console.log(`${row.file} | ${row.verdict} | present ${row.present}, absent ${row.absent}, superseded ${row.superseded}, drift ${row.drift}${row.driftObjects.length ? ` | ${row.driftObjects.join('; ')}` : ''}`);
    }
  }

  /* --------------------------------------------------------------- capture */
  // Read-only snapshot of every function body, taken BEFORE a migration
  // replaces one. Nothing is written to the target database: the whole
  // capture runs inside a READ ONLY transaction.
  if (mode === 'capture') {
    const url = process.env.RECONCILE_PG_ADMIN_URL;
    if (!url) {
      fail('capture needs RECONCILE_PG_ADMIN_URL=<loopback admin url>; it records what a database has before anything is replaced');
    } else {
      const admin = new URL(url);
      if (!LOOPBACK.includes(admin.hostname)) throw new Error('Refusing non-loopback PostgreSQL target');
      const sqlText = await readFile(path.join(root, 'scripts/reconcile/capture-function-bodies.sql'), 'utf8');
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query('begin read only');
        const { rows } = await client.query(sqlText);
        await client.query('commit');
        report.capture = {
          capturedAt: new Date().toISOString(),
          source: 'scripts/reconcile/capture-function-bodies.sql',
          transaction: 'read only',
          functions: rows.length,
          bodies: rows,
        };
        console.log(`capture: ${rows.length} function definition(s) recorded in a READ ONLY transaction; nothing was changed`);
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        await client.end().catch(() => {});
      }
    }
  }

  /* ----------------------------------------------------------- integration */
  /* --------------------------------------------- staging-shaped history */
  if (mode === 'staging' || mode === 'all') {
    // The staging project was not built by replaying this directory. Its history
    // is six early migrations, hosted tables the repository never created (stood
    // in for by scripts/local-pg/005_scaffold_missing_tables.sql), then one
    // reviewed bundle holding verbatim copies of the migrations that existed when
    // it was built. Whatever the bundle does not contain is pending THERE,
    // whatever its version number says.
    const bundleSql = await readFile(path.join(root, 'scripts/staging/approved-upgrade.sql'), 'utf8');
    const sources = [...bundleSql.matchAll(/^-- SOURCE (\S+) SHA256 ([0-9a-f]{64})/gm)].map((m) => ({ file: m[1], sha256: m[2] }));
    const builder = await readFile(path.join(root, 'scripts/staging/build-upgrade.mjs'), 'utf8');
    const stagingBaseline = ((builder.match(/new Set\(\[([^\]]*)\]/)?.[1] ?? '').match(/\d{14}_[a-z0-9_]+\.sql/g) ?? []).sort();
    if (!sources.length || !stagingBaseline.includes('20261019000002_public_read.sql')) {
      fail('staging: could not read the bundle manifest or the builder baseline');
    } else {
      const bundled = new Set(sources.map((s) => s.file));
      const lastBundled = [...bundled].sort().at(-1);
      const stagingPending = allFiles.filter((f) => !bundled.has(f) && !stagingBaseline.includes(f));
      const olderThanBundle = stagingPending.filter((f) => f < lastBundled);
      const edited = [];
      for (const source of sources) {
        if (!allFiles.includes(source.file)) { edited.push({ file: source.file, problem: 'is no longer in the repository' }); continue; }
        const current = createHash('sha256').update(await treeSource.read(source.file)).digest('hex');
        if (current !== source.sha256) edited.push({ file: source.file, problem: 'was edited after it was bundled' });
      }
      const scaffold = await readFile(path.join(root, 'scripts/local-pg/005_scaffold_missing_tables.sql'), 'utf8');
      const clean = await replay(treeSource, allFiles);
      const stagingDb = await createDb(shimTemplate);
      let shaped = null;
      try {
        shaped = await withDb(stagingDb, async (c) => {
          for (const file of stagingBaseline) {
            await applyFiles(c, [file], treeSource);
            if (file === '20261019000002_public_read.sql') await c.query(scaffold);
          }
          await c.query(localize(bundleSql));
          await applyFiles(c, stagingPending, treeSource);
          return { fp: await fingerprint(c), catalog: await probe(c) };
        });
      } catch (error) {
        fail(`staging: the staging-shaped history does not accept the pending migrations (${error.message})`);
      }
      const delta = shaped ? diff(shaped.fp, clean.fp) : [];
      const bySection = {};
      for (const d of delta) {
        (bySection[d.section] ??= []).push(`${d.key} ${d.left === null ? '(missing)' : d.right === null ? '(extra)' : '(differs)'}`);
      }
      report.staging = {
        note: 'Local reconstruction. The scaffold is an approximation of hosted tables, so a difference is a question to put to the real project with catalog-probe.sql, not a finding about it.',
        bundledMigrations: sources.length, newestBundled: lastBundled, baselineMigrations: stagingBaseline,
        pendingOnStaging: stagingPending, pendingButOlderThanNewestBundled: olderThanBundle, bundledThenEdited: edited,
        acceptsPendingMigrations: Boolean(shaped), differencesFromCleanReplay: bySection, differenceCount: delta.length,
      };
      console.log(`staging: bundle holds ${sources.length} migrations through ${lastBundled}; ${stagingPending.length} repository file(s) are pending there`);
      if (olderThanBundle.length) console.log(`staging: REVIEW ${olderThanBundle.length} pending file(s) are OLDER than the newest bundled migration; an "apply what is newer" rule skips them: ${olderThanBundle.join(', ')}`);
      for (const e of edited) console.log(`staging: REVIEW ${e.file} ${e.problem}; a database built from the bundle ran the earlier text`);
      if (shaped) {
        console.log(`staging: staging-shaped history + pending files ${delta.length ? `DIFFERS from the clean replay in ${delta.length} object(s)` : 'equals the clean replay'}`);
        for (const [section, keys] of Object.entries(bySection)) console.log(`staging: REVIEW ${section}: ${keys.join('; ')}`);
        const emit = argv.find((a) => a.startsWith('--emit-probe='))?.slice('--emit-probe='.length);
        if (emit) await writeFile(emit, JSON.stringify(shaped.catalog));
      }
    }
  }

  if (mode === 'integration') {
    if (!opt.base || !opt.main || !opt.pr) throw new Error('integration mode needs --base=<ref> --main=<ref> --pr=<ref>');
    const chains = {};
    for (const [label, source] of [['base', refSource(opt.base)], ['main', refSource(opt.main)], ['pr', refSource(opt.pr)], ['candidate', treeSource]]) {
      const files = await source.list();
      chains[label] = { files: files.length, ...(await replay(source, files)) };
    }
    const rows = [];
    for (const section of Object.keys(FP)) {
      const keys = new Set(Object.values(chains).flatMap((c) => Object.keys(c.fp[section])));
      for (const key of keys) {
        const [o, a, b, c] = ['base', 'pr', 'main', 'candidate'].map((l) => chains[l].fp[section][key] ?? null);
        if (a === b && b === c) continue;
        const prChanged = a !== o; const mainChanged = b !== o;
        const kind = prChanged && mainChanged && a !== b ? 'BOTH-CHANGED' : prChanged && !mainChanged ? 'pr-only' : mainChanged && !prChanged ? 'main-only' : 'other';
        const expected = kind === 'pr-only' ? a : kind === 'main-only' ? b : null;
        const candidate = c === a ? 'pr' : c === b ? 'main' : c === o ? 'base' : 'new';
        rows.push({ section, key, kind, candidateEquals: candidate, ok: expected === null ? kind !== 'BOTH-CHANGED' && candidate !== 'base' : c === expected });
      }
    }
    if (opt.dump) {
      const { mkdir } = await import('node:fs/promises');
      const wanted = rows.filter((r) => r.section === 'functions' && (r.kind === 'BOTH-CHANGED' || !r.ok)).map((r) => r.key);
      for (const label of ['base', 'pr', 'main', 'candidate']) {
        await mkdir(path.join(opt.dump, label), { recursive: true });
        await withDb(chains[label].name, async (c) => {
          for (const sig of wanted) {
            const { rows: def } = await c.query(`select pg_get_functiondef(to_regprocedure($1)) as d`, [sig]);
            await writeFile(path.join(opt.dump, label, `${sig.replace(/[^a-z0-9_]+/gi, '_')}.sql`), `${def[0]?.d ?? '-- absent'}\n`);
          }
        });
      }
    }
    for (const r of rows) if (r.section !== 'functions' && (r.kind === 'BOTH-CHANGED' || !r.ok)) Object.assign(r, { base: chains.base.fp[r.section][r.key] ?? null, pr: chains.pr.fp[r.section][r.key] ?? null, main: chains.main.fp[r.section][r.key] ?? null, candidate: chains.candidate.fp[r.section][r.key] ?? null });
    report.integration = { changed: rows.map((r) => `${r.kind} ${r.section} ${r.key}`).sort(), chains: Object.fromEntries(Object.entries(chains).map(([l, c]) => [l, c.files])), bothChanged: rows.filter((r) => r.kind === 'BOTH-CHANGED'), unexpected: rows.filter((r) => !r.ok && r.kind !== 'BOTH-CHANGED'), summary: rows.reduce((acc, r) => { acc[`${r.kind}:${r.candidateEquals}`] = (acc[`${r.kind}:${r.candidateEquals}`] ?? 0) + 1; return acc; }, {}) };
    console.log(`integration: chains ${JSON.stringify(report.integration.chains)}; summary ${JSON.stringify(report.integration.summary)}`);
    for (const r of report.integration.bothChanged) console.log(`BOTH-CHANGED ${r.section} ${r.key} -> candidate has ${r.candidateEquals}`);
    for (const r of report.integration.unexpected) console.log(`UNEXPECTED ${r.section} ${r.key} (${r.kind}) -> candidate has ${r.candidateEquals}`);
  }
} finally {
  if (process.env.RECONCILE_PG_ADMIN_URL) for (const name of [...created]) await dropDb(name).catch(() => {});
  await cluster.stop();
}
if (opt.json) await writeFile(path.resolve(root, opt.json), `${JSON.stringify(report, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
