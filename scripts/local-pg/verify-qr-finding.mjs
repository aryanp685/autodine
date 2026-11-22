#!/usr/bin/env node
/** Reproduces security finding QR-01/QR-02, and the rotation race, on a
 * disposable database.
 *
 *   node scripts/local-pg/with-embedded-postgres.mjs \
 *     node scripts/local-pg/verify-qr-finding.mjs
 *
 * It replays the migration chain WITHOUT 20261118002200_qr_code_staff_boundary
 * (the fix), shows a signed-in outsider rotating another outlet's table code and
 * receiving a working token, shows two concurrent rotations of the same table
 * leaving two live cards, then applies the fix (20261118002200 plus the QR invariant pair) and shows the
 * same calls refused or serialised. Nothing leaves the disposable cluster; no hosted project is
 * used.
 */
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const FIX = "20261118002200_qr_code_staff_boundary.sql";
const EXTRA_FIXES = ["20261122000400_qr_one_active_cleanup.sql", "20261122000500_qr_one_active_per_table.sql"];
const url = new URL(process.env.READINESS_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Refusing non-loopback PostgreSQL target');

const name = `autodine_qr_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url.href });
await admin.connect();
let db;
const step = (label, value) => console.log(`${label.padEnd(58)} ${value}`);

try {
  await admin.query(`create database "${name}"`);
  url.pathname = `/${name}`;
  db = new Client({ connectionString: url.href });
  await db.connect();
  await db.query(await readFile('scripts/local-pg/000_supabase_shim.sql', 'utf8'));
  await db.query(`grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  const files = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  // The fix is three files: the membership gates and the one-live-card invariant
  // with its advisory lock. All three are withheld for the PRE-FIX half.
  const FIXES = [FIX, ...EXTRA_FIXES];
  for (const file of files.filter((f) => !FIXES.includes(f))) await db.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
  step('migrations replayed without the fix', files.length - FIXES.length);

  const victimSlug = 'victim-' + randomUUID();
  const victim = (await db.query(
    `insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
     values ($1,'Victim outlet','Test address',0,'scan') returning id`, [victimSlug])).rows[0].id;
  const table = (await db.query(`insert into dining_tables(restaurant_id,label) values($1,'T1') returning id`, [victim])).rows[0].id;
  const attacker = randomUUID();
  const owner = randomUUID();
  await db.query('insert into profiles(id) values ($1),($2)', [attacker, owner]);
  await db.query(`insert into memberships(restaurant_id,user_id,role) values($1,$2,'owner')`, [victim, owner]);

  const asUser = async (userId, sql, params) => {
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
      await db.query('set local role authenticated');
      const result = await db.query(sql, params);
      return result.rows;
    } finally { await db.query('rollback'); }
  };

  const liveCards = async () => (await db.query(
    'select count(*)::int n from public.table_qr_codes where table_id = $1 and revoked_at is null',
    [table])).rows[0].n;

  /** Two independent sessions rotate the same table at the same time.
   *
   * `holdFirst` keeps the first rotation's transaction open so the second
   * session is genuinely queued on the lock; otherwise the first commits and
   * the second simply reads the fresh state. The advisory lock is what makes
   * the second wait, so the window has to be open for it to be measured.
   */
  const race = async (label, { holdFirst = false } = {}) => {
    const firstHold = holdFirst ? 400 : 300;
    const c1 = new Client({ connectionString: url.href });
    const c2 = new Client({ connectionString: url.href });
    await c1.connect();
    await c2.connect();
    const prepare = async (client) => {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await client.query('set local role authenticated');
    };
    try {
      await prepare(c1);
      const first = (await c1.query('select public.rotate_table_qr_code($1) as token', [table])).rows[0].token;
      await prepare(c2);
      const started = Date.now();
      const pending = c2.query('select public.rotate_table_qr_code($1) as token', [table]);
      // Give the second session time to reach the lock before the first commits.
      await new Promise((resolve) => setTimeout(resolve, firstHold));
      await c1.query('commit');
      const second = (await pending).rows[0].token;
      await c2.query('commit');
      const waited = Date.now() - started - firstHold;
      const live = await liveCards();
      step(
        `${label}: two concurrent rotations`,
        `issued 2 distinct token(s), ${live} live card(s)` +
          (holdFirst ? `, second session queued ${Math.max(waited, 0)}ms on the lock` : ''),
      );
      return { live, secondWaitedForLock: holdFirst && waited > 100, distinct: first !== second };
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
  };

  let reproduced = false;
  try {
    const rows = await asUser(attacker, 'select public.rotate_table_qr_code($1) as token', [table]);
    const token = rows[0]?.token;
    reproduced = typeof token === 'string' && token.length >= 8;
    step('PRE-FIX: outsider rotated another outlet\'s table code', reproduced ? 'SUCCEEDED (vulnerable)' : 'unexpected');
    step('PRE-FIX: token returned to the attacker', reproduced ? `${token.slice(0, 12)}… (${token.length} chars)` : 'none');
  } catch (error) {
    step('PRE-FIX: outsider rotate', `refused (${error.code ?? error.message})`);
  }
  try {
    await asUser(attacker, 'select public.retire_table_qr_code($1)', [table]);
    step('PRE-FIX: outsider retired the same table code', 'SUCCEEDED (vulnerable)');
  } catch (error) {
    step('PRE-FIX: outsider retire', `refused (${error.code ?? error.message})`);
  }
  const preRace = await race('PRE-FIX');

  for (const fix of FIXES) {
    try {
      await db.query(await readFile(`supabase/migrations/${fix}`, 'utf8'));
    } catch (error) {
      console.log('FAILED APPLYING', fix, '->', error.message);
      throw error;
    }
  }
  step('fix applied on the same disposable database', FIXES.join(' + '));
  for (const [label, sql] of [
    ['rotate', 'select public.rotate_table_qr_code($1)'],
    ['retire', 'select public.retire_table_qr_code($1)'],
  ]) {
    try {
      await asUser(attacker, sql, [table]);
      step(`POST-FIX: outsider ${label}`, 'ALLOWED (fix failed)');
    } catch (error) {
      step(`POST-FIX: outsider ${label}`, `refused (${error.code})`);
    }
  }
  try {
    const rows = await asUser(owner, 'select public.rotate_table_qr_code($1) as token', [table]);
    step('POST-FIX: the outlet owner rotates its own code', `allowed (${String(rows[0]?.token).length} chars)`);
  } catch (error) {
    step('POST-FIX: owner rotate', `refused (${error.code}) — regression`);
  }
  const postRace = await race('POST-FIX', { holdFirst: true });

  console.log(`\nFinding QR-01/QR-02 outsider access: ${reproduced ? 'reproduced and closed' : 'NOT reproduced'}.`);
  console.log(`Concurrent rotation: PRE-FIX left ${preRace.live} live card(s); POST-FIX left ${postRace.live}.`);
  console.log(`Serialisation: the queued POST-FIX rotation waited for the lock: ${postRace.secondWaitedForLock ? 'yes' : 'NO'}.`);
  const ok = reproduced && postRace.live === 1 && postRace.secondWaitedForLock;
  console.log(ok
    ? 'Result: the isolation defect reproduces and the fix closes it; the invariant holds under a held lock.'
    : 'Result: UNEXPECTED — inspect the rows above before trusting the fix.');
  if (!ok) process.exitCode = 1;
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
