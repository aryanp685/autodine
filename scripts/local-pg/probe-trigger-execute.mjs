#!/usr/bin/env node
/**
 * Disposable-PG probe: does a SECURITY DEFINER trigger function fire when
 * EXECUTE is revoked from PUBLIC, anon, authenticated and service_role?
 * Read-only scratch database; proves trigger privileges are irrelevant to firing.
 */
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Refusing non-loopback PostgreSQL target');
}
const name = `autodine_probe_${randomUUID().replaceAll('-', '')}`;
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
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  await db.query(`create table public.probe_parent(id int primary key);
    create table public.probe_audit(id int primary key, note text);
    create or replace function public.probe_trg() returns trigger
    language plpgsql security definer set search_path = public as $$
    begin
      insert into public.probe_audit values (new.id, 'fired');
      return new;
    end; $$;
    revoke all on function public.probe_trg() from public, anon, authenticated, service_role;
    create trigger probe_parent_trg after insert on public.probe_parent
      for each row execute function public.probe_trg();`);
  await db.query('set local role authenticated').catch(() => {});
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query('insert into public.probe_parent values (1)');
  await db.query('commit');
  const { rows } = await db.query('select count(*)::int as fired from public.probe_audit');
  console.log(`Trigger fired with EXECUTE revoked from every runtime role: ${rows[0].fired} row(s) audited`);
  if (rows[0].fired !== 1) process.exitCode = 1;
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
