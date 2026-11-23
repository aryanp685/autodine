/**
 * Hosted staging acceptance probes — Auth, RBAC, tenant isolation, monitoring.
 *
 * Runs on the staging runner AFTER the browser suites. All data is synthetic
 * (arena-<uuid>@example.invalid). Everything goes through the real application
 * paths: GoTrue sign-up/sign-in, the invitation RPCs, the report_sales RPC with
 * the caller's own JWT, and the monitoring HTTP endpoints with a same-origin
 * header. No service-role privilege is used to answer a member-level question.
 *
 * Output is counts and check names only — never codes, URLs, emails or tokens.
 * Any failed check exits 1 (a genuine hosted defect must block the batch).
 * If the provision step did not produce fixtures, this prints SKIP and exits 0.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const REF = 'juwyhslzchjevqkdvwjm';
const EXPECTED_ORIGIN = 'https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app';

const mask = (v) => { if (process.env.GITHUB_ACTIONS && v) console.log(`::add-mask::${v}`); };
const results = [];
const tally = { pass: 0, fail: 0, skip: 0 };
function check(name, ok) {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) { tally.pass += 1; } else { tally.fail += 1; }
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error::hosted acceptance check failed: ${name}`);
}
function skip(name) {
  results.push(`SKIP ${name}`);
  tally.skip++;
}

let env, manifest;
try {
  env = JSON.parse(await readFile('.staging-private/fixture-env.json', 'utf8'));
  manifest = JSON.parse(await readFile('.staging-private/fixture-manifest.json', 'utf8'));
} catch {
  console.log('auth-acceptance: SKIP (no fixture manifest — provision did not run)');
  process.exit(0);
}

const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const base = new URL(env.E2E_BASE_URL || 'https://invalid.invalid');
if (url !== `https://${REF}.supabase.co` || !key || base.origin !== EXPECTED_ORIGIN || env.E2E_BASE_URL !== EXPECTED_ORIGIN) {
  console.error('::error::auth-acceptance refused: environment is not the approved staging target.');
  process.exit(1);
}

const publishable = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || key;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const mkClient = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = mkClient();
const run = randomUUID();
const pw = randomBytes(18).toString('hex');
mask(pw);

// --- 1. Login: wrong password must be refused; correct sign-in must work ---
const bad = await owner.auth.signInWithPassword({ email: env.E2E_OWNER_EMAIL, password: `${pw}-wrong` });
check('login-wrong-password-refused', Boolean(bad.error));
const good = await owner.auth.signInWithPassword({ email: env.E2E_OWNER_EMAIL, password: env.E2E_OWNER_PASSWORD });
check('login-owner-signin', !good.error && Boolean(good.data.session));

// --- 2. Signup → unconfirmed refused → admin confirmation → sign-in works ---
const probeEmail = `arena-authprobe-${run}@example.invalid`;
mask(probeEmail);
const probePw = randomBytes(18).toString('hex');
mask(probePw);
const probeUser = await admin.auth.admin.createUser({ email: probeEmail, password: probePw, email_confirm: false });
if (probeUser.error || !probeUser.data.user) {
  check('signup-probe-created', false);
} else {
  check('signup-probe-created', true);
  const probeId = probeUser.data.user.id;
  const early = await mkClient().auth.signInWithPassword({ email: probeEmail, password: probePw });
  check('unconfirmed-signin-refused', Boolean(early.error));
  const confirmed = await admin.auth.admin.updateUserById(probeId, { email_confirm: true });
  check('admin-confirm', !confirmed.error);
  const late = await mkClient().auth.signInWithPassword({ email: probeEmail, password: probePw });
  check('confirmed-signin', !late.error);
}
// Recovery request at the API level: a recovery link is issued for an existing
// user. Delivery to the synthetic inbox is NOT claimed — no mailbox is read.
const recovery = await admin.auth.admin.generateLink({ type: 'recovery', email: probeEmail });
check('recovery-link-issued', !recovery.error && Boolean(recovery.data?.properties?.action_link));
await admin.auth.admin.deleteUser(probeUser.data?.user?.id ?? '00000000-0000-0000-0000-000000000000').catch(() => {});

// --- 3. Invitation chain for cashier, kitchen, manager (owner mints; new
// ---    synthetic users redeem through redeem_staff_invite) ---
const members = {};
for (const role of ['cashier', 'kitchen', 'manager']) {
  const minted = await owner.rpc('create_staff_invite', { p_restaurant_id: manifest.restaurantId, p_role: role, p_days: 1 });
  const code = typeof minted.data === 'string' ? minted.data : null;
  mask(code);
  if (minted.error || !code) { check(`invite-mint-${role}`, false); continue; }
  const email = `arena-${role}-${run}@example.invalid`;
  mask(email);
  const memberPw = randomBytes(18).toString('hex');
  mask(memberPw);
  const memberUser = await admin.auth.admin.createUser({ email, password: memberPw, email_confirm: true });
  if (memberUser.error || !memberUser.data.user) { check(`invite-member-${role}`, false); continue; }
  const memberClient = mkClient();
  const signin = await memberClient.auth.signInWithPassword({ email, password: memberPw });
  if (signin.error) { check(`invite-member-signin-${role}`, false); continue; }
  const redeemed = await memberClient.rpc('redeem_staff_invite', { p_code: code });
  const row = Array.isArray(redeemed.data) ? redeemed.data[0] : null;
  check(`invite-redeem-${role}`, !redeemed.error && row?.status === 'ok' && row?.role === role);
  // Single-use is for everyone OTHER than the original redeemer. A retry by
  // the same actor is an intentional idempotent 'already_member' (lost
  // response replay, see 20261108005000); a different authenticated actor must
  // see 'used'. The owner is such an actor and this path writes nothing. The
  // received status word is an enum, safe to print; it never carries a code.
  const again = await owner.rpc('redeem_staff_invite', { p_code: code });
  const againRow = Array.isArray(again.data) ? again.data[0] : null;
  console.log(`invite-single-use-${role}: received status=${againRow?.status ?? 'none'} error=${again.error?.code ?? 'none'}`);
  check(`invite-single-use-${role}`, !again.error && againRow?.status === 'used');
  members[role] = { client: memberClient, email, password: memberPw, role };
}

// --- 4. report_sales authorization through the real authenticated paths ---
const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
const to = new Date().toISOString();
const salesArgs = (restaurantId) => ({ p_restaurant_id: restaurantId, p_from: from, p_to: to, p_timezone: 'Asia/Kolkata', p_bucket: 'day', p_order_limit: 50, p_include_lines: false });
const ownerSales = await owner.rpc('report_sales', salesArgs(manifest.restaurantId));
check('report-sales-owner-allowed', !ownerSales.error && Boolean(ownerSales.data));
if (members.manager) {
  const r = await members.manager.client.rpc('report_sales', salesArgs(manifest.restaurantId));
  check('report-sales-manager-allowed', !r.error && Boolean(r.data));
} else skip('report-sales-manager-allowed');
if (members.cashier) {
  const r = await members.cashier.client.rpc('report_sales', salesArgs(manifest.restaurantId));
  check('report-sales-cashier-denied', Boolean(r.error) && (r.error.code === '42501' || /manage this restaurant/i.test(r.error.message ?? '')));
} else skip('report-sales-cashier-denied');
if (members.kitchen) {
  const r = await members.kitchen.client.rpc('report_sales', salesArgs(manifest.restaurantId));
  check('report-sales-kitchen-denied', Boolean(r.error) && (r.error.code === '42501' || /manage this restaurant/i.test(r.error.message ?? '')));
} else skip('report-sales-kitchen-denied');
const crossTenant = await owner.rpc('report_sales', salesArgs(manifest.otherRestaurantId));
check('report-sales-cross-tenant-denied', Boolean(crossTenant.error) && (crossTenant.error.code === '42501' || /manage this restaurant/i.test(crossTenant.error.message ?? '')));

// --- 5. Staff roster RBAC (owner/manager list; cashier denied) ---
const rosterOwner = await owner.rpc('list_staff_members', { p_restaurant_id: manifest.restaurantId });
check('roster-owner-allowed', !rosterOwner.error && Array.isArray(rosterOwner.data));
if (members.cashier) {
  const r = await members.cashier.client.rpc('list_staff_members', { p_restaurant_id: manifest.restaurantId });
  check('roster-cashier-denied', Boolean(r.error) && (r.error.code === '42501' || /owner or manager/i.test(r.error.message ?? '')));
} else skip('roster-cashier-denied');
const rosterOther = await owner.rpc('list_staff_members', { p_restaurant_id: manifest.otherRestaurantId });
check('roster-cross-tenant-denied', Boolean(rosterOther.error) && (rosterOther.error.code === '42501' || /owner or manager/i.test(rosterOther.error.message ?? '')));
const verificationOther = await owner.rpc('current_verification_code', { p_restaurant_id: manifest.otherRestaurantId });
check('verification-code-cross-tenant-denied', Boolean(verificationOther.error) || verificationOther.data == null);

// --- 6. Monitoring: public health + kitchen realtime signal endpoint ---
// The staging preview sits behind Vercel Authentication. Reuse the SSO
// share-link cookie the browser flow already proved (stored by the Playwright
// global setup) so these probes reach the app; never print it. If no browser
// state exists on this runner, fall back to the _vercel_share query, which
// authorizes any path on the deployment. The app ignores unknown query params.
async function stagingHttp(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  let cookie = '';
  try {
    const state = JSON.parse(await readFile('.staging-private/browser-access.json', 'utf8'));
    const host = base.host;
    cookie = (Array.isArray(state?.cookies) ? state.cookies : [])
      .filter((c) => typeof c?.domain === 'string' && (host === c.domain.replace(/^\./, '') || host.endsWith(`.${c.domain.replace(/^\./, '')}`)))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  } catch { /* no browser state — fall back to the share query below */ }
  const share = process.env.STAGING_SHARE_URL ? new URL(process.env.STAGING_SHARE_URL) : null;
  const shareToken = share?.searchParams.get('_vercel_share');
  const target = new URL(path, base.origin);
  if (cookie) headers.set('cookie', cookie);
  else if (shareToken) target.searchParams.set('_vercel_share', shareToken);
  return fetch(target, { ...init, headers });
}

const health = await stagingHttp('/api/health', { headers: { accept: 'application/json' } });
let healthOk = false;
try { healthOk = (await health.json())?.ok === true; } catch { /* leave false */ }
check('health-endpoint-200-ok', health.status === 200 && healthOk);

// The realtime-alert route authenticates through the SERVER'S COOKIE SESSION
// (createSupabaseServerClient), never through a bearer token — so probe it the
// way a real signed-in member's browser does: sign in through the app and
// POST same-origin from the page. Bearer-only probes are refused as
// signed-out (401) by design. Status words and HTTP codes are not secrets;
// emails and passwords never leave this process.
async function realtimeAlertStatus(member) {
  let phase = 'launch';
  let hasStorage = false;
  const browser = await chromium.launch();
  try {
    const storagePath = '.staging-private/browser-access.json';
    hasStorage = await readFile(storagePath, 'utf8').then(() => true, () => false);
    phase = 'context';
    const context = await browser.newContext(hasStorage
      ? { storageState: storagePath, baseURL: base.origin }
      : { baseURL: base.origin });
    const page = await context.newPage();
    if (!hasStorage) {
      phase = 'share-goto';
      const share = process.env.STAGING_SHARE_URL ? new URL(process.env.STAGING_SHARE_URL) : null;
      if (!share) throw new Error('Staging share access is unavailable for the browser probe.');
      await page.goto(share.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    phase = 'login-goto';
    await page.goto(`${base.origin}/login`);
    phase = 'login-fill';
    await page.getByLabel('Work email').fill(member.email);
    await page.getByLabel('Password').fill(member.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The staff shell renders for every staff role; waiting for the redirect
    // away from /login proves the cookie session exists without assuming
    // which screen this role lands on.
    phase = 'login-redirect';
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
    phase = 'post-alert';
    return await page.evaluate(async () => {
      const response = await fetch('/api/ops/realtime-alert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'recovered', durationMs: 61_000 }),
      });
      return response.status;
    });
  } catch (error) {
    // The raw error text (Playwright dumps the page URL and sometimes page
    // content) can embed the share token or a password, which GitHub masks as
    // *** and hides the diagnosis. Emit phase-level facts only; statuses and
    // paths are not secrets.
    const url = (() => { try { return new URL(error?.message.match(/https?:\/\/\S+/)?.[0] ?? base.origin).pathname; } catch { return base.pathname; } })();
    console.log(`::error::realtime-alert probe failed at phase=${phase} hasStorage=${hasStorage} role=${member.role ?? 'unknown'} contextUrl=${url} errorName=${error?.name ?? 'Error'}`);
    throw new Error(`realtime-alert probe failed at phase=${phase} (details masked; see phase above)`);
  } finally {
    await browser.close();
  }
}

// Surface WHY a probe threw (masked): a silent catch hides whether the harness
// or the hosted app failed, which contradicts the fail-honest contract above.
async function probe(name, member) {
  try {
    check(name, (await realtimeAlertStatus(member)) === member.expectedStatus);
  } catch (error) {
    mask(String(error?.message ?? error));
    console.log(`::error::${name} probe threw: ${String(error?.message ?? error).slice(0, 300)}`);
    check(name, false);
  }
}
if (members.kitchen) await probe('realtime-alert-kitchen-204', { ...members.kitchen, expectedStatus: 204 });
else skip('realtime-alert-kitchen-204');
if (members.cashier) await probe('realtime-alert-cashier-403', { ...members.cashier, expectedStatus: 403 });
else skip('realtime-alert-cashier-403');

for (const line of results) console.log(line);
console.log(`auth-acceptance: pass=${tally.pass} fail=${tally.fail} skip=${tally.skip}`);
if (tally.fail > 0) process.exit(1);
