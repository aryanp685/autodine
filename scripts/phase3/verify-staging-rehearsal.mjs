/** Loopback-only disposable historical reconstruction. Never a hosted clone/runner. */
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from './build-staging-rehearsal.mjs';
import { prepareFinancialUpgrade, financialFingerprint } from '../verify-financial-upgrade.mjs';
const target=new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)) throw Error('Refusing non-loopback target');
const database=`autodine_check_${randomUUID().replaceAll('-','')}`;
const admin=new Client({connectionString:target.href});await admin.connect();
let db;
try {
  await admin.query(`create database "${database}"`);target.pathname=`/${database}`;
  db=new Client({connectionString:target.href});await db.connect();
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql','utf8'));
  await db.query(`grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  for(const file of ['supabase/migrations/20261019000001_init.sql','supabase/migrations/20261019000002_public_read.sql','scripts/local-pg/005_scaffold_missing_tables.sql','supabase/migrations/20261020000004_counter_payment.sql','supabase/migrations/20261021000005_public_place_order.sql','supabase/migrations/20261021000006_table_qr_verification.sql','supabase/migrations/20261021000007_table_qr_provisioning.sql','scripts/staging/approved-upgrade.sql','supabase/migrations/20261109001000_operational_readiness.sql']) {
    await db.query(await readFile(file,'utf8'));
  }
  const baseline=JSON.parse(await readFile('scripts/phase3/staging-baseline.json','utf8'));
  const observed=(await db.query(`select p.oid::regprocedure::text signature,md5(p.prosrc) body_hash,p.proacl::text acl,p.proconfig settings from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cancel_order','open_table_session','operational_schema_readiness','place_public_order','place_public_order_attempt','record_counter_payment','set_order_line_quantities','settle_online_payment') order by signature`)).rows;
  // Plain PG lacks Supabase's per-function platform grants. Reconstruct only
  // the captured ACLs inside this fresh disposable DB; never weaken the guard.
  assert.deepEqual(observed.map(({signature,body_hash,settings})=>({signature,body_hash,settings})),baseline.functions.map(({signature,body_hash,settings})=>({signature,body_hash,settings})));
  for(const row of baseline.functions){
    await db.query(`revoke all on function ${row.signature} from public,postgres,service_role,anon,authenticated`);
    for(const entry of row.acl.slice(1,-1).split(',')){
      const match=/^(postgres|service_role|anon|authenticated)?=X\/postgres$/.exec(entry);
      assert.ok(match,'Only captured execute ACLs may be reconstructed');
      await db.query(`grant execute on function ${row.signature} to ${match[1] || 'public'}`);
    }
  }
  const {sql}=await build({baseline});
  await assert.rejects(db.query(sql),/Explicit isolated staging rehearsal context required/);await db.query('rollback');
  console.log('PASS missing rehearsal context refused');
  await db.query("set autodine.rehearsal_project_ref='juwyhslzchjevqkdvwjm'");
  // Seed only this disposable database, never existing hosted records.
  await prepareFinancialUpgrade(db);
  const before=await financialFingerprint(db);
  await db.query(sql);
  const after=await financialFingerprint(db);
  assert.deepEqual(after.content,before.content);
  console.log('PASS populated candidate executed; all table content fingerprints preserved');
  const rights=(await db.query(`select
    has_function_privilege('anon','public.place_public_order_attempt(text,jsonb,text,text,uuid,text)','EXECUTE') new_api,
    has_function_privilege('anon','public.place_public_order(text,jsonb,text,text,uuid,text)','EXECUTE') old_api,
    has_table_privilege('anon','public.orders','INSERT') direct_insert`)).rows[0];
  assert.deepEqual(rights,{new_api:true,old_api:false,direct_insert:false});
  console.log('PASS new/legacy RPC and direct INSERT ACLs');
  // The original candidate must now reject a repeated/cut-over baseline.
  await assert.rejects(db.query(sql),/Staging function\/ACL\/settings drift/);await db.query('rollback');
  console.log('PASS changed baseline/replay refused');
  const readiness=(await db.query('select public.operational_schema_readiness() value')).rows[0].value;
  assert.equal(Object.values(readiness).every(value=>value===true),true);
  console.log('PASS all readiness probes true');
} finally {
  if(db) await db.end();
  await admin.query(`drop database if exists "${database}"`);await admin.end();
}
