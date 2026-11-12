#!/usr/bin/env node
/** Offline physical recovery drill, exclusively on two freshly-created local
 * clusters. Never accepts a connection URL or an existing data directory.
 * Requires initdb/pg_ctl/postgres from one matching PostgreSQL installation.
 * This is NOT pg_dump/PITR or Supabase platform recovery evidence. */
import { mkdtemp, mkdir, readFile, readdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import assert from 'node:assert/strict';
const bin=process.env.READINESS_PG_BIN;
if(!bin) throw new Error('Set READINESS_PG_BIN to a matching local PostgreSQL bin directory');
const root=await mkdtemp(join(tmpdir(),'autodine-cold-recovery-'));
const source=join(root,'source'), backup=join(root,'backup'), restored=join(root,'restored');
const database=`autodine_check_${randomUUID().replaceAll('-','')}`;
let running=null, db=null;
function command(tool,args,env=process.env){
  const r=spawnSync(tool,args,{env,encoding:'utf8',timeout:60_000,maxBuffer:8*1024*1024});
  if(r.error||r.status!==0) throw new Error(`${tool} failed: ${r.error?.message||r.stderr||r.stdout}`);
  return r.stdout;
}
async function freePort(){const s=createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p;}
function start(dir,port){command(join(bin,'pg_ctl'),['-D',dir,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${root}`,'-w','start']);running=dir;}
function stop(){if(running){command(join(bin,'pg_ctl'),['-D',running,'-m','fast','-w','stop']);running=null;}}
async function connect(port,name='postgres'){const c=new Client({connectionString:`postgres://postgres@127.0.0.1:${port}/${name}`});await c.connect();return c;}
async function fingerprint(c){
  const tables=(await c.query("select n.nspname,c.relname,c.relrowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind='r' order by 1,2")).rows;
  const content=[];const quote=s=>'"'+s.replaceAll('"','""')+'"';
  for(const t of tables){const r=await c.query(`select count(*)::text count,md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' order by md5(to_jsonb(x)::text)),'')) hash from ${quote(t.nspname)}.${quote(t.relname)} x`);content.push({...t,...r.rows[0]});}
  const policies=(await c.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows;
  const functions=(await c.query("select p.oid::regprocedure::text signature,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1")).rows;
  return {content,policies,functions};
}
async function seedAclOwnerFixtures(c){
  await c.query('create table public.acl_existing_postgres(id uuid primary key)');
  await c.query('create sequence public.acl_existing_postgres_seq');
  await c.query('set role supabase_admin');
  try{
    await c.query('create table public.acl_existing_supabase_admin(id uuid primary key)');
    await c.query('create sequence public.acl_existing_supabase_admin_seq');
  }finally{await c.query('reset role');}
}
try{
  await mkdir(source);
  command(join(bin,'initdb'),['-D',source,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const port=await freePort();start(source,port);db=await connect(port);
  await db.query(`create database "${database}"`);await db.end();db=await connect(port,database);
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql','utf8'));
  await db.query(`grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  await db.query('set role supabase_admin');
  try{
    await db.query(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  }finally{await db.query('reset role');}
  await seedAclOwnerFixtures(db);
  const migrations=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrations) await db.query(await readFile(join('supabase/migrations',file),'utf8'));
  await db.query('set role supabase_admin');
  try{
    await db.query(await readFile('supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql','utf8'));
  }finally{await db.query('reset role');}
  const url=`postgres://postgres@127.0.0.1:${port}/${database}`;
  await db.end();db=null;
  const tests=command('npx',['vitest','run','lib/db/readiness.integration.test.ts','app/menu/throttle-db.integration.test.tsx'],{...process.env,READINESS_DB_URL:url,THROTTLE_DB_URL:url});
  console.log(tests);
  db=await connect(port,database);const before=await fingerprint(db);
  const counts=(await db.query('select (select count(*) from orders)::int orders,(select count(*) from payments)::int payments,(select count(*) from restaurant_invoices)::int invoices')).rows[0];
  assert.ok(counts.orders>0&&counts.payments>0&&counts.invoices>0,'Require populated money/receipt fixtures');
  await db.end();db=null;
  // A clean shutdown is essential: copying a live data directory is NOT a backup.
  stop();const t=performance.now();await cp(source,backup,{recursive:true});
  // Simulate losing the original disposable cluster. Recovery must read backup.
  await rm(source,{recursive:true,force:true});
  await cp(backup,restored,{recursive:true});
  const recoveryPort=await freePort();start(restored,recoveryPort);db=await connect(recoveryPort,database);
  assert.deepEqual(await fingerprint(db),before);
  const privileges=(await db.query("select has_function_privilege('anon','public.reserve_staff_tts_attempt(uuid)','EXECUTE') tts,has_column_privilege('authenticated','public.orders','total_paise','UPDATE') money")).rows[0];
  assert.deepEqual(privileges,{tts:false,money:false});
  console.log('LOCAL_COLD_RECOVERY_VERIFIED',JSON.stringify({migrations:migrations.length,tables:before.content.length,...counts,recoveryElapsedMs:Math.round(performance.now()-t),originalClusterRemoved:true,method:'clean-shutdown physical snapshot',productionRecoveryClaim:false}));
}finally{
  if(db)await db.end();
  stop();await rm(root,{recursive:true,force:true});
}
