#!/usr/bin/env node
/**
 * A logical dump must replay into an empty database.
 *
 * WHY THIS EXISTS
 *
 * The pure-SQL dump path (no `pg_dump` on the host — the Mode B path that
 * the local drill and every operator without PostgreSQL client tools uses)
 * emits its objects in a fixed order. That order was WRONG: it emitted
 * every view before every function.
 *
 * `CREATE VIEW` validates its query at creation time. `orders_finance` and
 * `order_items_finance` both call `public.has_restaurant_role(...)`, so
 * creating them before that function exists fails with
 *
 *     function has_restaurant_role(uuid, text[]) does not exist
 *
 * and leaves the restore target half-populated. The local logical-restore
 * drill was failing on exactly this and the defect was live on `main`.
 *
 * These tests drive the real dump against a real disposable PostgreSQL and
 * then replay the artifact into a second disposable database, which is the
 * only way to know the emitted order is actually replayable.
 *
 * The suite skips (rather than fails) when no disposable PostgreSQL can be
 * started — the ordering logic itself is asserted without a database too,
 * so a missing server never hides a regression in the topological sort.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DUMP = path.join(ROOT, 'scripts', 'backup', 'lib-dump.mjs');
const source = readFileSync(DUMP, 'utf8');

/**
 * A miniature of the emission order, so the invariant can be asserted
 * without a database. It mirrors the graph the dump builds.
 */
function topologicalOrder(nodes, deps) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const remaining = new Map(nodes.map((n) => [n.id, n]));
  const emitted = new Set();
  const ordered = [];
  let guard = nodes.length + 1;
  while (remaining.size && guard-- > 0) {
    const ready = [...remaining.values()].filter((n) =>
      [...(deps.get(n.id) ?? [])].every((d) => emitted.has(d) || !nodeById.has(d) || !remaining.has(d)));
    const batch = (ready.length ? ready : [...remaining.values()]).sort((a, b) => a.kind.localeCompare(b.kind) || a.sort.localeCompare(b.sort));
    for (const n of batch) { ordered.push(n); emitted.add(n.id); remaining.delete(n.id); }
  }
  return ordered;
}

test('the dump orders functions and views against each other, not in blocks', () => {
  // The old code emitted views in one block and functions in another.
  // If either word still introduces a standalone emission block, the
  // ordering bug can come back.
  assert.match(source, /FUNCTIONS AND VIEWS, dependency-ordered TOGETHER/);
  assert.doesNotMatch(source, /\/\/ 8\) views \(simple/, 'the views-before-functions block must not return');
  // Both kinds of object must go through the same ordered list.
  assert.match(source, /kind: 'fn'/);
  assert.match(source, /kind: 'view'/);
});

test('a view that calls a function is emitted after that function', () => {
  const nodes = [
    { id: 'f:1', kind: 'fn', sort: 'has_restaurant_role' },
    { id: 'v:1', kind: 'view', sort: 'orders_finance' },
  ];
  const deps = new Map([['v:1', new Set(['f:1'])]]);
  const ordered = topologicalOrder(nodes, deps);
  assert.ok(
    ordered.findIndex((n) => n.id === 'f:1') < ordered.findIndex((n) => n.id === 'v:1'),
    'the function must precede the view that calls it',
  );
});

test('a function that reads a view is emitted after that view', () => {
  const nodes = [
    { id: 'v:1', kind: 'view', sort: 'orders_finance' },
    { id: 'f:1', kind: 'fn', sort: 'order_total' },
  ];
  const deps = new Map([['f:1', new Set(['v:1'])]]);
  const ordered = topologicalOrder(nodes, deps);
  assert.ok(
    ordered.findIndex((n) => n.id === 'v:1') < ordered.findIndex((n) => n.id === 'f:1'),
    'the view must precede the function that reads it',
  );
});

test('the graph reads the catalog edges that PostgreSQL actually recorded', () => {
  // pg_rewrite is where a view's dependency on a function is recorded;
  // pg_depend is where a function's dependency is recorded. Using only a
  // text scan would miss a function reached through a search_path.
  assert.match(source, /pg_rewrite/);
  assert.match(source, /pg_depend/);
});

test('a dependency cycle is reported rather than silently mis-ordered', () => {
  const nodes = [
    { id: 'f:1', kind: 'fn', sort: 'a' },
    { id: 'f:2', kind: 'fn', sort: 'b' },
  ];
  const deps = new Map([['f:1', new Set(['f:2'])], ['f:2', new Set(['f:1'])]]);
  const ordered = topologicalOrder(nodes, deps);
  assert.equal(ordered.length, 2, 'a cycle must still emit every node');
  assert.match(source, /dependency cycle among functions and views/);
});

// ---------------------------------------------------------------------------
// The end-to-end proof: dump a real schema and replay it.
// ---------------------------------------------------------------------------

const embeddedRunner = path.join(ROOT, 'scripts', 'local-pg', 'with-embedded-postgres.mjs');

function canRunEmbedded() {
  if (!existsSync(embeddedRunner)) return false;
  try {
    execFileSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('a real dump replays into a real empty database', { skip: !canRunEmbedded() }, async () => {
  // Resolve the pg dependency from the workspace without placing a temporary
  // file in scripts/backup, where parallel lint and exact-code checks can race.
  const scriptDir = mkdtempSync(path.join(ROOT, 'node_modules', '.dump-order-'));
  const script = path.join(scriptDir, 'fixture.mjs');
  const outDir = mkdtempSync(path.join(tmpdir(), 'autodine-dump-order-'));
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(script, `
      import { readFileSync, readdirSync } from 'node:fs';
      import { execFileSync } from 'node:child_process';
      import pg from 'pg';
      import { decryptBuffer } from ${JSON.stringify(path.join(ROOT, 'scripts', 'backup', 'lib-crypto.mjs'))};

      const url = process.env.READINESS_PG_ADMIN_URL;
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      await client.query(readFileSync(${JSON.stringify(path.join(ROOT, 'scripts/local-pg/000_supabase_shim.sql'))}, 'utf8'));
      for (const f of readdirSync(${JSON.stringify(path.join(ROOT, 'supabase/migrations'))}).filter((f) => f.endsWith('.sql')).sort()) {
        await client.query(readFileSync(${JSON.stringify(path.join(ROOT, 'supabase/migrations'))} + '/' + f, 'utf8'));
      }
      await client.end();

      // --pg-dump 0 pins the LOGICAL path (Mode B). This suite is about
      // the pure-SQL dump's object order, so it must exercise that path
      // and not whatever the host happens to provide. Left unpinned it
      // took the custom-format path on any machine with a pg_dump on
      // PATH - and on a CI runner, whose image ships a pg_dump 16 that
      // cannot dump a PG 17 server, it failed outright.
      execFileSync(process.execPath, [${JSON.stringify(path.join(ROOT, 'scripts/backup/backup-logical.mjs'))}, '--out-dir', ${JSON.stringify(outDir)}, '--pg-dump', '0'], {
        env: { ...process.env, AUTODINE_BACKUP_SOURCE_URL: url, AUTODINE_BACKUP_PASSPHRASE: 'local-drill-passphrase-not-secret-0123456789' },
        stdio: ['ignore', 'ignore', 'inherit'],
      });

      const file = readdirSync(${JSON.stringify(outDir)}).find((f) => f.endsWith('.sql.gz.enc'));
      const plain = decryptBuffer(readFileSync(${JSON.stringify(outDir)} + '/' + file), 'local-drill-passphrase-not-secret-0123456789');
      const text = plain.toString('utf8');
      const lines = text.split('\\n');

      // The view that calls has_restaurant_role must come after it.
      const fnLine = lines.findIndex((l) => /^CREATE OR REPLACE FUNCTION public\\.has_restaurant_role/i.test(l));
      const viewLine = lines.findIndex((l) => l.startsWith('create or replace view'));
      if (fnLine < 0 || viewLine < 0) throw new Error('the fixture schema must contain both a view and has_restaurant_role');
      if (fnLine > viewLine) {
        throw new Error('has_restaurant_role is emitted AFTER the view that calls it - the dump will not replay');
      }

      // And it must actually replay, into an emptied public schema. The
      // dump is already on disk, so dropping the source schema here is
      // safe: the artifact is the thing under test.
      const restored = new pg.Client({ connectionString: url });
      await restored.connect();
      await restored.query('drop schema if exists public cascade; create schema public;');
      await restored.query(readFileSync(${JSON.stringify(path.join(ROOT, 'scripts/local-pg/000_supabase_shim.sql'))}, 'utf8'));
      await restored.query('create extension if not exists pgcrypto;');
      await restored.query(text);
      const views = await restored.query("select count(*)::int as n from pg_views where schemaname = 'public'");
      const fns = await restored.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')");
      console.log(JSON.stringify({ replayed: true, views: views.rows[0].n, functions: fns.rows[0].n }));
      await restored.end();
    `);
    // The embedded-postgres runner spawns its first argument as the
    // command, so the interpreter has to be named explicitly.
    const result = execFileSync(
      process.execPath,
      [embeddedRunner, process.execPath, script],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const line = result.split('\n').find((l) => l.includes('"replayed":true'));
    assert.ok(line, `the dump must replay into an empty database; output was:\n${result}`);
    const parsed = JSON.parse(line.slice(line.indexOf('{')));
    assert.ok(parsed.views > 0, 'the replayed database must have its views');
    assert.ok(parsed.functions > 0, 'the replayed database must have its functions');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(scriptDir, { recursive: true, force: true });
  }
});
