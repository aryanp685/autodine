#!/usr/bin/env node
/**
 * Local rehearsal of the report_sales remediation upgrade path.
 *
 * Replays every repository migration up to (not including)
 * 20261112000300_report_sales_export_authorization.sql — the state staging
 * exhibits — verifies the pre-fix catalog markers, applies exactly the
 * remediation file in one transaction, re-checks markers, exercises an
 * Owner/Cashier smoke call as `authenticated`, then applies the file a
 * second time to prove the migration is safely re-runnable.
 *
 * Never connects anywhere but a loopback disposable database, and drops it
 * at the end. This is a local verification, not a hosted rehearsal.
 */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const FIX = '20261112000300_report_sales_export_authorization.sql';
const PRE_FIX_MD5 = '8f3c9ddd35b47c1ce6b966c675e1e843';
const PRE_FIX_WS = 'ea318d92857fb8af40b43aeb42ab75d1';
const POST_FIX_MD5 = 'eab7538009ade8eeb2ff3bb53004fd73';
const POST_FIX_WS = 'e87b0ea6e50c60532c2093ccd3a17672';

const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Refusing non-loopback PostgreSQL target');
}
const name = `autodine_upgrade_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url.href });
await admin.connect();
let db;
const checks = [];
const ok = (label, pass, detail = '') => {
  checks.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) process.exitCode = 1;
};
try {
  await admin.query(`create database "${name}"`);
  url.pathname = `/${name}`;
  db = new Client({ connectionString: url.href });
  await db.connect();
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
  await db.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  const migrations = (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql') && f < FIX)
    .sort();
  for (const file of migrations) await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
  console.log(`Replayed ${migrations.length} migrations (stopping before ${FIX}).`);

  const markers = async () => (await db.query(`
    select p.prosecdef as definer, p.provolatile as volatile, p.proconfig as config,
           md5(p.prosrc) as md5_prosrc,
           md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) as md5_ws,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid = 'public.report_sales(uuid,timestamptz,timestamptz,text,text,integer,boolean)'::regprocedure`)).rows[0];

  const pre = await markers();
  ok('pre-fix state reproduces the staging markers', pre.md5_prosrc === PRE_FIX_MD5 && pre.md5_ws === PRE_FIX_WS, `md5=${pre.md5_prosrc}`);
  ok('pre-fix function is SECURITY DEFINER + stable', pre.definer === true && pre.volatile === 's');
  ok('pre-fix grants: authenticated only', pre.authed_exec === true && !pre.anon_exec && !pre.public_exec && !pre.service_exec);

  // Apply exactly the remediation, in one transaction.
  const fixSql = await readFile(`supabase/migrations/${FIX}`, 'utf8');
  await db.query('begin');
  try {
    await db.query(fixSql);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }

  const post = await markers();
  ok('post-fix markers match the committed tree', post.md5_prosrc === POST_FIX_MD5 && post.md5_ws === POST_FIX_WS, `md5=${post.md5_prosrc}`);
  ok('post-fix function keeps SECURITY DEFINER + stable + search_path', post.definer === true && post.volatile === 's' && (post.config ?? []).includes('search_path=public'));
  ok('post-fix grants unchanged: authenticated only', post.authed_exec === true && !post.anon_exec && !post.public_exec && !post.service_exec);

  // Smoke: synthetic owner allowed, synthetic cashier refused — as authenticated.
  const owner = randomUUID(); const cashier = randomUUID();
  await db.query('insert into public.profiles(id) values ($1), ($2)', [owner, cashier]);
  const restaurant = (await db.query(
    `insert into public.restaurants(slug,name,address,tax_rate_bps,timezone,guest_verification_mode)
     values ($1,'Upgrade probe','Test-only address',0,'UTC','scan') returning id`,
    [`upgrade-probe-${randomUUID().slice(0, 8)}`],
  )).rows[0].id;
  await db.query(
    `insert into public.memberships(restaurant_id,user_id,role) values ($1,$2,'owner'), ($1,$3,'cashier')`,
    [restaurant, owner, cashier],
  );
  const call = (user) => {
    return db.query('begin')
      .then(() => db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]))
      .then(() => db.query('set local role authenticated'))
      .then(() => db.query(
        `select public.report_sales($1, statement_timestamp() - interval '1 day', statement_timestamp() + interval '1 day', 'UTC', 'day', 1, false) as report`,
        [restaurant],
      ))
      .finally(() => db.query('rollback'));
  };
  const ownerResult = await call(owner);
  ok('post-fix: owner can call report_sales own outlet', Boolean(ownerResult.rows[0]?.report));
  let cashierRefused = false;
  try { await call(cashier); } catch (error) { cashierRefused = error?.code === '42501'; }
  ok('post-fix: cashier refused with 42501', cashierRefused);

  // Repeatability: re-applying the migration must be a harmless no-op.
  await db.query('begin');
  try { await db.query(fixSql); await db.query('commit'); } catch (error) { await db.query('rollback'); throw error; }
  const again = await markers();
  ok('re-applying the migration keeps markers and grants stable', again.md5_prosrc === POST_FIX_MD5 && again.authed_exec === true);

  if (process.exitCode) {
    console.error('\nUpgrade verification FAILED. Do not proceed to any hosted rehearsal.');
  } else {
    console.log('\nUpgrade verification PASSED. Local evidence only — the staging rehearsal remains authorization-gated.');
  }
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
