/**
 * Non-blocking minter of ONE deliberately-aged synthetic invitation, used by
 * e2e/integration/invites.spec.ts to prove an expired link is refused.
 *
 * Creates the invite through the real create_staff_invite RPC as the synthetic
 * fixture owner (never raw SQL into restaurant_invites for the "new" path), then
 * age-shifts exactly that one row (created_at/expires_at together, preserving
 * the expires_at > created_at constraint) so redemption reports 'expired'.
 *
 * Failure NEVER fails the job: if this script cannot mint or age the invite, it
 * exports nothing and the spec reports the expired-link test as skipped —
 * honest, not green. Prints no codes, URLs or tokens; masks the code.
 *
 * Requires .staging-private/fixture-manifest.json from the provision step.
 */
import { createClient } from '@supabase/supabase-js';
import { appendFile, readFile } from 'node:fs/promises';

const mask = (v) => { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${v}`); };

try {
  const url = process.env.STAGING_SUPABASE_URL;
  const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  if (url !== 'https://juwyhslzchjevqkdvwjm.supabase.co' || !key) {
    console.log('invite-mint: SKIP (project/credentials not approved)');
    process.exit(0);
  }
  const env = JSON.parse(await readFile('.staging-private/fixture-env.json', 'utf8'));
  const manifest = JSON.parse(await readFile('.staging-private/fixture-manifest.json', 'utf8'));
  const publishable = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || key;
  const owner = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const session = await owner.auth.signInWithPassword({ email: env.E2E_OWNER_EMAIL, password: env.E2E_OWNER_PASSWORD });
  if (session.error) throw new Error('owner sign-in failed');

  const minted = await owner.rpc('create_staff_invite', { p_restaurant_id: manifest.restaurantId, p_role: 'cashier', p_days: 1 });
  const code = typeof minted.data === 'string' ? minted.data : null;
  if (minted.error || !code) throw new Error('create_staff_invite failed');
  mask(code);

  const newest = await admin
    .from('restaurant_invites')
    .select('id')
    .eq('restaurant_id', manifest.restaurantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (newest.error || !newest.data) throw new Error('invite lookup failed');

  const now = Date.now();
  const aged = await admin
    .from('restaurant_invites')
    .update({
      created_at: new Date(now - 10 * 86_400_000).toISOString(),
      expires_at: new Date(now - 8 * 86_400_000).toISOString(),
    })
    .eq('id', newest.data.id);
  if (aged.error) throw new Error('invite age-shift failed');

  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `E2E_EXPIRED_INVITE_CODE=${code}\n`);
  console.log('invite-mint: aged synthetic invitation exported for the invites suite.');
} catch (e) {
  console.log(`::warning::invite-mint skipped: ${e instanceof Error ? e.message : 'unknown'} — the expired-link test will report itself as skipped.`);
  process.exit(0);
}
