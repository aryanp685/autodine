#!/usr/bin/env node
/**
 * RLS coverage inventory for the disposable database created by
 * scripts/local-pg/with-embedded-postgres.mjs (or any loopback autodine_check_*
 * database via RECONCILE_PG_ADMIN_URL / READINESS_PG_ADMIN_URL).
 *
 * Creates its own scratch database (name autodine_rls_<uuid>), replays the
 * Supabase shim + every migration, prints each public table with its RLS
 * flag and policy count, and drops the scratch database afterwards. Never
 * touches a hosted instance: the admin URL must point at a local cluster.
 */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.READINESS_PG_ADMIN_URL);
const name = `autodine_rls_${randomUUID().replaceAll('-','')}`;
const admin = new Client({ connectionString: url.href });
await admin.connect();
let db;
try {
  await admin.query(`create database "${name}"`);
  url.pathname = `/${name}`;
  db = new Client({ connectionString: url.href });
  await db.connect();
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrations) await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const { rows } = await db.query(`
    select c.relname as table_name, c.relrowsecurity as rls,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    order by c.relrowsecurity asc, c.relname`);
  console.log('TABLE_ROWS');
  for (const r of rows) console.log(`${r.rls ? 'RLS ' : 'NORLS'} policies=${String(r.policies).padStart(2)} ${r.table_name}`);
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
