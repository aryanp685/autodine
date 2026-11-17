/**
 * Pure-SQL logical dump of one PostgreSQL database, taken inside a single
 * REPEATABLE READ READ ONLY transaction — one consistent snapshot.
 *
 * Emits, in restore-safe order:
 *   1. extension notes   4. data (PK order)    7. indexes
 *   2. CREATE TABLEs     5. deferred FKs       8. views
 *   3. sequences note    6. UNIQUE/CHECK       9. functions, triggers, policies, RLS flags
 *
 * Function bodies are emitted with pg_get_functiondef() (complete DDL).
 * Values round-trip through ::text casts, which is lossless for built-in
 * types (arrays, ranges, jsonb, inet…). Object-level GRANT/REVOKE and
 * default privileges are NOT reproduced — they are owned by the repo's
 * migration files (use pg_dump mode on hosts that have it for full fidelity).
 */
import pg from 'pg';

const quoteIdent = (s) => '"' + String(s).replaceAll('"', '""') + '"';
const quoteLit = (s) => "'" + String(s).replaceAll("'", "''") + "'";

export async function dumpDatabase(connectionString, { schema = 'public', log = () => {} } = {}) {
  // The whole dump is one read-only snapshot; statement_timeout disabled.
  const client = new pg.Client({ connectionString, application_name: 'autodine-logical-backup' });
  await client.connect();
  const out = [];
  const counts = { tables: 0, rows: 0, functions: 0, triggers: 0, policies: 0, indexes: 0, constraints: 0, views: 0, types: 0 };
  try {
    await client.query('begin isolation level repeatable read read only');
    await client.query('set local statement_timeout = 0');
    const meta = await client.query('select version() as version, current_database() as db, now() as taken_at');
    out.push('-- AutoDine logical backup v1');
    out.push(`-- database: ${meta.rows[0].db}`);
    out.push(`-- taken_at: ${meta.rows[0].taken_at.toISOString()}`);
    out.push(`-- server: ${meta.rows[0].version.split(' on ')[0]}`);
    out.push('-- restore into an EMPTY database; never over a live one.');
    out.push('');

    const exts = await client.query('select extname from pg_extension order by extname');
    out.push('-- required extensions (restore must create these as a superuser or a database owner with the right privileges): ' + exts.rows.map((r) => r.extname).join(', '));
    for (const r of exts.rows) out.push(`-- create extension if not exists ${quoteIdent(r.extname)};`);
    out.push('');

    const tables = await client.query(
      `select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r' order by c.relname`, [schema]);

    const colSql = `
      select a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as type,
             a.attnotnull, a.attidentity,
             pg_get_expr(d.adbin, d.adrelid) as default_expr
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped
       order by a.attnum`;
    const pkSql = `
      select a.attname
        from pg_constraint c join unnest(c.conkey) k(attnum) on true
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
       where c.conrelid = $1 and c.contype = 'p' order by array_position(c.conkey, a.attnum)`;

    // 0) user-defined types — tables reference them, so they come first.
    //    Enums and domains are recreated; composite types are reported as a
    //    WARNING rather than silently dropped.
    const enums = await client.query(
      `select t.typname,
              (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = t.oid) as labels
         from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = $1 and t.typtype = 'e' order by t.typname`, [schema]);
    for (const t of enums.rows) {
      out.push(`create type ${quoteIdent(schema)}.${quoteIdent(t.typname)} as enum (${t.labels});`);
      counts.types += 1;
    }
    const domains = await client.query(
      `select t.typname, format_type(t.typbasetype, t.typtypmod) as base,
              pg_get_expr(t.typdefaultbin, 0) as default_expr, t.typnotnull,
              (select count(*) from pg_constraint where contypid = t.oid and contype = 'c')::int as check_count
         from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = $1 and t.typtype = 'd' order by t.typname`, [schema]);
    for (const t of domains.rows) {
      let def = `create domain ${quoteIdent(schema)}.${quoteIdent(t.typname)} as ${t.base}`;
      if (t.default_expr) def += ` default ${t.default_expr}`;
      if (t.typnotnull) def += ' not null';
      out.push(def + ';');
      if (t.check_count > 0) out.push(`-- WARNING: domain ${t.typname} carries ${t.check_count} CHECK constraint(s) which this dump does NOT recreate; add them by hand`);
      counts.types += 1;
    }
    const composites = await client.query(
      `select t.typname
         from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = $1 and t.typtype = 'c'
          and not exists (select 1 from pg_class c where c.reltype = t.oid)
        order by t.typname`, [schema]);
    if (composites.rows.length) {
      out.push('-- WARNING: composite types NOT dumped: ' + composites.rows.map((r) => quoteIdent(r.typname)).join(', ') + ' — recreate these by hand before relying on the restore');
    }
    if (counts.types > 0 || composites.rows.length) out.push('');

    // 1) CREATE TABLE (PK inline; other constraints deferred)
    const fkDeferred = [], uniqueDeferred = [], checkDeferred = [];
    for (const t of tables.rows) {
      const cols = (await client.query(colSql, [t.oid])).rows;
      const pk = (await client.query(pkSql, [t.oid])).rows.map((r) => r.attname);
      const lines = cols.map((c) => {
        let def = `  ${quoteIdent(c.attname)} ${c.type}`;
        if (c.attidentity === 'a') def += ' generated always as identity';
        else if (c.attidentity === 'd') def += ' generated by default as identity';
        if (c.default_expr && !c.attidentity) def += ` default ${c.default_expr}`;
        if (c.attnotnull) def += ' not null';
        return def;
      });
      if (pk.length) lines.push(`  primary key (${pk.map(quoteIdent).join(', ')})`);
      out.push(`create table ${quoteIdent(schema)}.${quoteIdent(t.relname)} (\n${lines.join(',\n')}\n);`);
      counts.tables += 1;
      // collect deferrable constraints
      const cons = await client.query(
        `select conname, contype, pg_get_constraintdef(oid) as def
           from pg_constraint where conrelid = $1 and contype in ('f','u','c','x') order by contype, conname`, [t.oid]);
      for (const c of cons.rows) {
        const row = `alter table ${quoteIdent(schema)}.${quoteIdent(t.relname)} add constraint ${quoteIdent(c.conname)} ${c.def};`;
        if (c.contype === 'f') fkDeferred.push(row);
        else if (c.contype === 'u' || c.contype === 'x') uniqueDeferred.push(row);
        else checkDeferred.push(row);
      }
    }
    out.push('');

    // 2) DATA — ::text round-trip, 200 rows per INSERT
    for (const t of tables.rows) {
      const fqn = `${quoteIdent(schema)}.${quoteIdent(t.relname)}`;
      const cols = (await client.query(colSql, [t.oid])).rows;
      const colList = cols.map((c) => quoteIdent(c.attname)).join(', ');
      const overriding = cols.some((c) => c.attidentity === 'a') ? ' overriding system value' : '';
      const data = await client.query(`select * from ${fqn}`);
      let buf = [];
      const flush = () => {
        if (!buf.length) return;
        out.push(`insert into ${fqn} (${colList})${overriding} values\n${buf.join(',\n')};`);
        buf = [];
      };
      for (const row of data.rows) {
        const vals = cols.map((c) => renderValue(row[c.attname], c.type));
        buf.push('  (' + vals.join(', ') + ')');
        if (buf.length >= 200) flush();
      }
      flush();
      counts.rows += data.rows.length;
      log(`table ${t.relname}: ${data.rows.length} rows`);
    }
    out.push('');

    // 3) sequence setvals
    const seqs = await client.query(
      `select s.relname as seq, format_type(a.atttypid, a.atttypmod) as type,
              (select pg_get_serial_sequence(quote_ident($1)||'.'||quote_ident(t.relname), a.attname)) as owned_by
         from pg_class s
         join pg_namespace n on n.oid = s.relnamespace
         join pg_depend d on d.objid = s.oid and d.deptype in ('a','i')
         join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
         join pg_class t on t.oid = d.refobjid
        where n.nspname = $1 and s.relkind = 'S'`, [schema]);
    for (const s of seqs.rows) {
      const val = await client.query(`select last_value, is_called from ${quoteIdent(schema)}.${quoteIdent(s.seq)}`);
      out.push(`select setval(${quoteLit(`${schema}.${s.seq}`)}, ${val.rows[0].last_value}, ${val.rows[0].is_called});`);
    }
    if (seqs.rows.length) out.push('');

    // 4) CHECK constraints (validated against restored data)
    for (const r of checkDeferred) { out.push(r); counts.constraints += 1; }
    // 5) UNIQUE / EXCLUDE
    for (const r of uniqueDeferred) { out.push(r); counts.constraints += 1; }
    // 6) Foreign keys last
    for (const r of fkDeferred) { out.push(r); counts.constraints += 1; }
    if (fkDeferred.length || uniqueDeferred.length || checkDeferred.length) out.push('');

    // 7) non-constraint indexes
    const idx = await client.query(
      `select indexdef from pg_indexes where schemaname = $1 and indexname not in (
         select conname from pg_constraint where contype in ('p','u','x')
       ) order by indexname`, [schema]);
    for (const i of idx.rows) { out.push(i.indexdef + ';'); counts.indexes += 1; }
    if (idx.rows.length) out.push('');

    // 8) views (simple: one replace per view, ordered by dependency via reltuples heuristic — views here are independent)
    const views = await client.query('select viewname, definition from pg_views where schemaname = $1 order by viewname', [schema]);
    for (const v of views.rows) { out.push(`create or replace view ${quoteIdent(schema)}.${quoteIdent(v.viewname)} as\n${v.definition};`); counts.views += 1; }
    if (views.rows.length) out.push('');

    // 9) functions (full DDL incl. security definer + search_path), then triggers, then policies, then RLS flags.
    //    Function bodies may reference other functions regardless of definition
    //    order only when PostgreSQL validates eagerly — plpgsql/SQL functions
    //    are parsed at CREATE time, so they must come out dependency-ordered.
    //    Topologically sort on same-schema function references so a dump of a
    //    schema whose migrations were replayed out of order still restores.
    const fns = await client.query(
      `select p.oid, p.proname, pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and p.prokind in ('f','p')`, [schema]);
    const bodyOf = (def) => {
      const m = def.match(/\$[A-Za-z_]*\$[\s\S]*\$[A-Za-z_]*\$/);
      return m ? m[0] : '';
    };
    const names = fns.rows.map((f) => f.proname);
    const nameSet = new Set(names);
    const bodyCache = new Map(fns.rows.map((f) => [f.oid, bodyOf(f.def)]));
    const dependsOn = (f) => {
      const body = bodyCache.get(f.oid);
      const deps = new Set();
      for (const other of fns.rows) {
        if (other.oid === f.oid) continue;
        if (nameSet.has(other.proname) && new RegExp(`\\b${other.proname}\\b`).test(body)) deps.add(other.oid);
      }
      return deps;
    };
    const remaining = new Map(fns.rows.map((f) => [f.oid, f]));
    const ordered = [];
    const emitted = new Set();
    let guard = fns.rows.length + 1;
    while (remaining.size && guard-- > 0) {
      const ready = [...remaining.values()].filter((f) => [...dependsOn(f)].every((d) => emitted.has(d) || !remaining.has(d)));
      const batch = (ready.length ? ready : [...remaining.values()]).sort((a, b) => a.proname.localeCompare(b.proname) || a.oid - b.oid);
      if (!ready.length) out.push('-- WARNING: dependency cycle among functions; emitting in name order — restore may fail');
      for (const f of batch) { ordered.push(f); emitted.add(f.oid); remaining.delete(f.oid); }
    }
    for (const f of ordered) { out.push(f.def.trim() + ';'); counts.functions += 1; }
    // Function EXECUTE ACLs. CREATE FUNCTION defaults to EXECUTE for PUBLIC,
    // which would silently undo every `revoke execute` this schema applies
    // (see 20261114000400_restrict_trigger_functions_execute). Recreate the
    // exact privilege set for functions whose proacl is not the default.
    const acls = await client.query(
      `select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args,
              pg_get_userbyid(p.proowner) as owner, p.proacl::text as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and p.prokind in ('f','p') and p.proacl is not null
        order by p.proname, p.oid`, [schema]);
    const parseAcl = (aclText) => String(aclText).replace(/^\{|\}$/g, '').split(',').map((entry) => {
      const m = entry.trim().replace(/^"|"$/g, '').match(/^([^=]*)=([^/]*)(?:\/(.*))?$/);
      return m ? { grantee: m[1], privs: m[2] } : null;
    }).filter(Boolean);
    for (const row of acls.rows) {
      const signature = `${quoteIdent(schema)}.${quoteIdent(row.proname)}(${row.identity_args})`;
      const entries = parseAcl(row.acl);
      const publicEntry = entries.find((e) => e.grantee === '');
      if (!publicEntry || !publicEntry.privs.includes('X')) out.push(`revoke all on function ${signature} from public;`);
      for (const e of entries) {
        if (e.grantee === '' || e.grantee === row.owner) continue;
        if (!e.privs.includes('X')) continue;
        const withGrant = e.privs.includes('X*');
        out.push(`grant execute on function ${signature} to ${quoteIdent(e.grantee)}${withGrant ? ' with grant option' : ''};`);
      }
    }
    if (acls.rows.length) out.push('');

    const triggers = await client.query(
      `select pg_get_triggerdef(t.oid) as def
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and not t.tgisinternal order by t.tgname`, [schema]);
    for (const t of triggers.rows) { out.push(t.def.trim() + ';'); counts.triggers += 1; }
    if (triggers.rows.length) out.push('');

    const policies = await client.query(
      `select tablename, policyname, permissive, roles, cmd, qual, with_check
         from pg_policies where schemaname = $1 order by tablename, policyname`, [schema]);
    for (const p of policies.rows) {
      // pg returns name[] either as a JS array (text[]) or as a raw
      // "{a,b}" string (name[]) depending on the OID — normalise both.
      const rawRoles = Array.isArray(p.roles)
        ? p.roles
        : String(p.roles ?? '').replace(/^\{|\}$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      const roles = rawRoles.length ? rawRoles.map((r) => (r === 'public' ? 'public' : quoteIdent(r))).join(', ') : 'public';
      const cmd = (p.cmd || 'all').toLowerCase();
      let def = `create policy ${quoteIdent(p.policyname)} on ${quoteIdent(schema)}.${quoteIdent(p.tablename)} as ${p.permissive === 'PERMISSIVE' ? 'permissive' : 'restrictive'} for ${cmd} to ${roles}`;
      if (p.qual) def += ` using (${p.qual})`;
      if (p.with_check) def += ` with check (${p.with_check})`;
      out.push(def + ';'); counts.policies += 1;
    }
    for (const t of tables.rows) {
      if (t.relrowsecurity) out.push(`alter table ${quoteIdent(schema)}.${quoteIdent(t.relname)} enable row level security;`);
      if (t.relforcerowsecurity) out.push(`alter table ${quoteIdent(schema)}.${quoteIdent(t.relname)} force row level security;`);
    }
    out.push('');
    out.push('-- end of AutoDine logical backup');

    await client.query('commit');
    return { sql: out.join('\n') + '\n', counts };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

function renderValue(value, type) {
  if (value === null || value === undefined) return 'null';
  if (type === 'boolean') return value ? 'true' : 'false';
  if (/^(smallint|integer|bigint|numeric|real|double precision|oid)/.test(type)) return String(value);
  if (type.endsWith('[]')) return `${quoteLit(arrayText(value))}::${type}`;
  if (type === 'json' || type === 'jsonb') return `${quoteLit(JSON.stringify(value))}::${type}`;
  if (type === 'bytea') return `${quoteLit(Buffer.isBuffer(value) ? '\\x' + value.toString('hex') : String(value))}::bytea`;
  // everything else round-trips via its text output
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `${quoteLit(text)}::${type}`;
}

function arrayText(value) {
  // pg driver parses arrays into JS arrays; re-render as Postgres array literal
  const enc = (v) => {
    if (v === null) return 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return '"' + v.toISOString() + '"';
    const s = String(v);
    return '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
  };
  const inner = (arr) => '{' + arr.map((item) => (Array.isArray(item) ? inner(item) : enc(item))).join(',') + '}';
  return Array.isArray(value) ? inner(value) : String(value);
}
