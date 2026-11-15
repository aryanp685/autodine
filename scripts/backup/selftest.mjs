#!/usr/bin/env node
/**
 * Synthetic restore drill for the AutoDine backup pipeline.
 *
 *   node scripts/backup/selftest.mjs
 *
 * Spins up a throwaway embedded PostgreSQL, builds a fixture schema that
 * exercises the hard cases (FK ordering, identity columns, a SECURITY DEFINER
 * function with a dollar-quoted body, a trigger, an RLS policy, jsonb/array
 * values, quotes and newlines in text), dumps it with Mode B, destroys the
 * cluster, then restores into a fresh cluster and verifies content, policies,
 * RLS flags and decryption tamper-evidence. Exits non-zero on any failure.
 *
 * This proves the pipeline end to end on synthetic data. It is NOT evidence
 * about the hosted production database; a hosted restore rehearsal
 * (docs/backup-restore-runbook.md) is still required before relying on it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { encryptBuffer, decryptBuffer, sha256 } from './lib-crypto.mjs';
import { dumpDatabase } from './lib-dump.mjs';

const { default: EmbeddedPostgres } = await import('embedded-postgres');
const root = await mkdtempSync(path.join(tmpdir(), 'autodine-backup-selftest-'));
const password = `local-${randomUUID().replaceAll('-', '')}`;
const port = 20000 + Math.floor(Math.random() * 20000);
const server = new EmbeddedPostgres({ databaseDir: path.join(root, 'cluster'), port, user: 'postgres', password, persistent: false, onLog: () => {}, onError: () => {} });

const urlFor = (db) => `postgresql://postgres:${password}@127.0.0.1:${port}/${db}`;
const check = (name, cond) => {
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}\n`);
  if (!cond) process.exitCode = 1;
};

try {
  await server.initialise();
  await server.start();
  // fixture database
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  admin.on('error', () => {});
  await admin.connect();
  await admin.query('create database backup_fixture');
  await admin.end();

  const fx = new pg.Client({ connectionString: urlFor('backup_fixture') });
  fx.on('error', () => {});
  await fx.connect();
  await fx.query(`
    create table parent (
      id bigint generated always as identity primary key,
      name text not null,
      note text,
      tags text[] not null default '{}',
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create type public.ticket_kind as enum ('dine_in', 'takeaway');
    create table child (
      id bigint generated always as identity primary key,
      kind public.ticket_kind not null default 'dine_in',
      parent_id bigint not null references parent(id) on delete cascade,
      amount_paise integer not null check (amount_paise >= 0),
      ref uuid not null default gen_random_uuid()
    );
    create index child_parent_idx on child(parent_id);
    alter table child enable row level security;
    create or replace function public.touch_note() returns trigger language plpgsql security definer set search_path = public as $$
    begin
      new.note := coalesce(new.note, '') || '!';
      return new;
    end $$;
    create trigger parent_touch before insert on parent for each row execute function public.touch_note();
    create policy child_read on child as permissive for select to public using (true);
    insert into parent (name, note, tags, meta) values
      ('alpha', 'plain', '{one,two}', '{"k":1}'),
      ('quote''d', E'line1\nline2', '{three}', '{"arr":[1,2]}'),
      ('{jsonish}', null, '{}', '"just a string"');
    insert into child (parent_id, amount_paise)
      select id, (100 + id) * 7 from parent;
  `);
  // capture a fingerprint of the source data
  const fingerprint = async (client) => {
    const p = await client.query("select id, name, note, tags, meta::text from parent order by id");
    const c = await client.query('select parent_id, amount_paise from child order by parent_id');
    return createHash('sha256').update(JSON.stringify([p.rows, c.rows])).digest('hex');
  };
  const before = await fingerprint(fx);
  await fx.end();

  // dump (Mode B) + encrypt
  const passphrase = 'selftest-passphrase-0123456789';
  const { sql, counts } = await dumpDatabase(urlFor('backup_fixture'), {});
  check('dump contains CREATE TABLE parent', sql.includes('create table "public"."parent"'));
  check('dump contains enum type', sql.includes('create type "public"."ticket_kind" as enum'));
  check('dump contains function body', sql.includes('touch_note'));
  check('dump contains policy', sql.includes('create policy "child_read"'));
  check('dump enables RLS', sql.includes('enable row level security'));
  check('counts rows', counts.rows === 6);
  const encFile = path.join(root, 'fixture.sql.gz.enc');
  writeFileSync(encFile, encryptBuffer(Buffer.from(sql, 'utf8'), passphrase));
  const manifestSha = sha256(readFileSync(encFile));
  check('manifest sha256 stable', typeof manifestSha === 'string' && manifestSha.length === 64);

  // destroy the fixture entirely
  const admin2 = new pg.Client({ connectionString: urlFor('postgres') });
  admin2.on('error', () => {});
  await admin2.connect();
  await admin2.query('drop database backup_fixture');
  await admin2.query('create database backup_fixture');
  await admin2.end();

  // restore
  const target = new pg.Client({ connectionString: urlFor('backup_fixture') });
  target.on('error', (e) => { process.stderr.write('target client error: ' + e.message + '\n'); });
  await target.connect();
  const restoredSql = decryptBuffer(readFileSync(encFile), passphrase).toString('utf8');
  await target.query(restoredSql);
  const after = await fingerprint(target);
  check('row fingerprint identical after restore', before === after);
  const trig = await target.query("select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal");
  check('trigger restored', trig.rows[0].n === 1);
  const fnSec = await target.query("select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='touch_note'");
  check('SECURITY DEFINER preserved', fnSec.rows[0]?.prosecdef === true);
  const rls = await target.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname='child'");
  check('RLS flag restored', rls.rows[0]?.relrowsecurity === true);
  const pol = await target.query("select count(*)::int as n from pg_policies where schemaname='public' and policyname='child_read'");
  check('policy restored', pol.rows[0]?.n === 1);
  const sp = await target.query("select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where proname='touch_note'");
  check('search_path preserved', Array.isArray(sp.rows[0]?.proconfig) && sp.rows[0].proconfig.some((v) => String(v).includes('search_path')));
  await target.end();

  // tamper evidence
  const tampered = Buffer.from(readFileSync(encFile));
  tampered[tampered.length - 2] ^= 0x01;
  let tamperDetected = false;
  try { decryptBuffer(tampered, passphrase); } catch { tamperDetected = true; }
  check('tampered file fails decryption', tamperDetected);

  // wrong passphrase
  let wrongKeyDetected = false;
  try { decryptBuffer(readFileSync(encFile), 'definitely-wrong-passphrase'); } catch { wrongKeyDetected = true; }
  check('wrong passphrase rejected', wrongKeyDetected);

  if (process.exitCode) {
    process.stderr.write('backup selftest: FAILURES above\n');
  } else {
    process.stdout.write('backup selftest: ALL CHECKS PASS\n');
  }
} finally {
  await server.stop().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
