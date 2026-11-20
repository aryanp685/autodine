#!/usr/bin/env node
/** Dumps the privileged-function inventory as JSON for line-by-line review.
 *
 *   node scripts/local-pg/with-embedded-postgres.mjs \
 *     node scripts/local-pg/dump-definer-audit.mjs /tmp/definer-audit.json
 *
 * Same replay and same flags as audit-definer-functions.mjs; the only
 * difference is the output shape (JSON instead of console lines) so a reviewer
 * can attach the exact body, grants and trigger usage to each flag without a
 * hosted connection.
 */
import { Client } from 'pg';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const out = process.argv[2];
if (!out) { console.error('Usage: dump-definer-audit.mjs <out.json>'); process.exit(2); }
const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Refusing non-loopback PostgreSQL target');
const name = `autodine_audit_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url.href });
await admin.connect();
let db;
try {
  await admin.query(`create database "${name}"`);
  url.pathname = `/${name}`;
  db = new Client({ connectionString: url.href });
  await db.connect();
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
  await db.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const migrations = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));

  const { rows } = await db.query(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           p.provolatile as volatility,
           p.prorettype::regtype::text as returns,
           l.lanname as language,
           coalesce(p.proconfig, '{}') as configuration,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec,
           pg_get_userbyid(p.proowner) as owner,
           p.prosrc as body,
           coalesce((select json_agg(t.tgname) from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal), '[]'::json) as triggers,
           coalesce((select json_agg(r.rolname) from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee where a.privilege_type = 'EXECUTE'), '[]'::json) as explicit_grantees
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and p.prosecdef
     order by p.proname, args`);
  await writeFile(out, JSON.stringify({ migrations: migrations.length, rows }, null, 1));
  console.log(`${rows.length} SECURITY DEFINER functions written to ${out}`);
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
