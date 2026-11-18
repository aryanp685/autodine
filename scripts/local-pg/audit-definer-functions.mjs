#!/usr/bin/env node
/**
 * Privileged-function audit: replays the committed migration history into a
 * disposable database and reports every SECURITY DEFINER function in the
 * public schema together with the attributes that decide who can cross a
 * tenant boundary and how.
 *
 * Flags (heuristic, for human triage — a flag is a question, not a verdict):
 *   NO_FIXED_SEARCH_PATH  proconfig does not pin search_path
 *   ANON_OR_PUBLIC_EXECUTE anon/public holds EXECUTE
 *   NO_TENANT_PREDICATE     body references neither auth.uid(), nor a known
 *                           tenant helper, nor a role predicate
 *   SERVICE_ROLE_EXECUTE    service_role holds EXECUTE (bypasses RLS in Supabase)
 *
 * Creates and drops only its own autodine_audit_* database. Read-only after replay.
 */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Refusing non-loopback PostgreSQL target');
}
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
  // Mirror the harness's synthetic default ACLs from verify-database.mjs.
  await db.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const migrations = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  console.log(`Replayed ${migrations.length} migrations for the security-definer audit.\n`);

  const { rows } = await db.query(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           p.provolatile as volatility,
           l.lanname as language,
           coalesce(p.proconfig, '{}') as configuration,
           md5(p.prosrc) as md5_prosrc,
           length(p.prosrc) as body_length,
           p.prosrc as body,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec,
           pg_get_userbyid(p.proowner) as owner
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where n.nspname = 'public'
       and p.prosecdef
     order by p.proname, args`);

  const flagged = [];
  for (const r of rows) {
    const config = Array.isArray(r.configuration) ? r.configuration : [String(r.configuration)];
    const flags = [];
    if (!config.some((c) => /^search_path\s*=/.test(c))) flags.push('NO_FIXED_SEARCH_PATH');
    if (r.anon_exec || r.public_exec) flags.push('ANON_OR_PUBLIC_EXECUTE');
    if (r.service_role_exec) flags.push('SERVICE_ROLE_EXECUTE');
    const body = String(r.body);
    const tenantSignals = [
      'auth.uid()', 'is_member', 'has_restaurant_role', 'current_restaurant_ids',
      'request.jwt.claim', 'restaurant_access', 'current_setting',
    ];
    if (!tenantSignals.some((signal) => body.includes(signal))) flags.push('NO_TENANT_PREDICATE');
    const line = `${r.name}(${r.args}) | volatile=${r.volatility} lang=${r.language} owner=${r.owner} | `
      + `anon=${r.anon_exec} public=${r.public_exec} authenticated=${r.authenticated_exec} service_role=${r.service_role_exec} | `
      + `config={${config.join(',')}}` + (flags.length ? ` | FLAGS: ${flags.join(',')}` : '');
    console.log(line);
    if (flags.length) flagged.push({ name: r.name, args: r.args, flags });
  }
  console.log(`\n${rows.length} SECURITY DEFINER functions audited; ${flagged.length} flagged for triage.`);
  if (flagged.length) {
    console.log('Flagged (name → flags):');
    for (const f of flagged) console.log(`  ${f.name}(${f.args}) → ${f.flags.join(',')}`);
  }
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
