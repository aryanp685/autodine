#!/usr/bin/env node
/** Set up a synthetic Supabase scaffold ONLY in an empty, disposable local DB.
 * This is not a substitute for Supabase Auth, Storage, or a hosted restore.
 */
import { readFileSync } from 'node:fs';
import { isLoopbackHost } from './lib-restore-target.mjs';

const fail = (message) => { console.error(`prepare-disposable-restore: ${message}`); process.exit(1); };
if (process.argv.slice(2).join(' ') !== '--confirm-disposable') fail('pass --confirm-disposable for a throwaway database');
const target = process.env.AUTODINE_RESTORE_TARGET_URL;
let url;
try { url = new URL(target); } catch { fail('invalid target URL'); }
// Reject query parameters: libpq/pg connection options can override the URL host.
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !isLoopbackHost(url.hostname) || url.search || url.hash || !url.pathname || url.pathname === '/' || url.pathname === '/postgres') {
  fail('requires an explicit, non-default loopback database URL without query options');
}
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: target, application_name: 'autodine-disposable-restore-setup' });
try {
  await client.connect();
  const result = await client.query(`select
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')) +
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') +
    (select count(*) from pg_namespace where nspname in ('auth','storage')) as objects`);
  if (Number(result.rows[0].objects) !== 0) throw new Error('target is not empty; refusing scaffold');
  await client.query(readFileSync(new URL('../local-pg/000_supabase_shim.sql', import.meta.url), 'utf8'));
  await client.query('create extension if not exists pgcrypto');
  console.log('Disposable loopback scaffold prepared (synthetic Auth/Storage; no application tables).');
} catch (error) {
  // Do not print connection errors: they may contain credentials or URL options.
  if (error.message === 'target is not empty; refusing scaffold') console.error(`prepare-disposable-restore: ${error.message}`);
  else console.error('prepare-disposable-restore: setup failed; inspect the disposable database');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
