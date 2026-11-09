/** Nonproduction recovery drill for the database created by verify-database.
 * Never accepts a production database name or remote host. */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
function native(tool, args, input) {
  const container = process.env.READINESS_PG_CONTAINER;
  const result = spawnSync(container ? 'docker' : tool, container ? ['exec', '-i', container, tool, ...args] : args,
    { input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${tool} unavailable: install matching PostgreSQL client tools or provide the disposable CI container.`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr.toString()}`);
  return result.stdout;
}
async function fingerprint(url) {
  const db = new Client({ connectionString: url }); await db.connect();
  try {
    const tables = (await db.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage') and c.relkind='r' order by 1,2`)).rows;
    const snapshots = [];
    for (const {nspname,relname} of tables) {
      const quote = s => '"' + s.replaceAll('"','""') + '"';
      const result = await db.query(`select count(*)::text n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) checksum from ${quote(nspname)}.${quote(relname)} t`);
      snapshots.push({table:`${nspname}.${relname}`,...result.rows[0]});
    }
    const policies = (await db.query(`select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname`)).rows;
    const functions = (await db.query(`select p.oid::regprocedure::text signature,p.proacl::text acl from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' order by 1`)).rows;
    return {snapshots,policies,functions};
  } finally {await db.end();}
}
export async function verifyRestore(source, admin) {
  const url = new URL(source);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) throw new Error('Restore drill requires a disposable local test database');
  const name=`autodine_check_${randomUUID().replaceAll('-','')}`;
  const restored=new URL(url);restored.pathname=`/${name}`;
  const started=performance.now();
  const before=await fingerprint(url.href);
  const dump=native('pg_dump',['--format=custom','--no-owner','--dbname',url.href]);
  try {
    await admin.query(`create database "${name}"`);
    native('pg_restore',['--exit-on-error','--no-owner','--dbname',restored.href],dump);
    assert.deepEqual(await fingerprint(restored.href),before);
    console.log('LOCAL_RESTORE_VERIFIED',JSON.stringify({tables:before.snapshots.length,policies:before.policies.length,functions:before.functions.length,archiveBytes:dump.length,elapsedMs:Math.round(performance.now()-started),productionBackupClaim:false}));
  } finally {await admin.query(`drop database if exists "${name}"`);}
}
