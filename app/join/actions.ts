/**
 * Accepting a staff invitation.
 *
 * ONE LINK, THREE PEOPLE
 *
 * The same URL has to work for somebody with an account, somebody without
 * one, and somebody who is signed out on the phone in their hand. So the page
 * asks the session what it is and renders accordingly -- rather than sending
 * everyone through a generic login screen and losing the invitation on the
 * way, which is the usual way these flows end with "the link didn't work".
 *
 * WHAT IT WILL NOT DO
 *
 *   - Reveal which restaurant a link belongs to before sign-in. The preview
 *     function requires a session; an anonymous visitor holding a guessed code
 *     learns nothing, not even that the code exists.
 *   - Say "joined" before the database says so. Every outcome here is a status
 *     the database returned: ok, already_member, used, expired, revoked,
 *     closed, not_found.
 */

'use server';

import { redirect } from 'next/navigation';
import { passwordProblem } from '@/lib/password';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requestOrigin } from '@/lib/site-origin';
import { homeForRole, roleLabel } from '@/lib/db/team';
import { isWellFormedInviteCode, joinPath, normaliseInviteCode } from '@/lib/team-invite';
import type { MemberRole } from '@/lib/db/database';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function back(code: string, key: 'error' | 'status', message: string): never {
  redirect(`${joinPath(code)}?${key}=${encodeURIComponent(message)}`);
}

/**
 * Redeem, and turn the database's status word into a destination.
 *
 * Shared by the "accept" button and by a brand-new account, because the second
 * half of signing up through an invitation is exactly the same step.
 */
async function redeemAndLand(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  code: string,
): Promise<never> {
  const { data, error } = await supabase.rpc('redeem_staff_invite', { p_code: code });

  if (error) {
    back(code, 'error', error.message);
  }

  const row = data?.[0];

  if (!row) {
    back(code, 'error', 'That invitation could not be read. Please try the link again.');
  }

  if (row.status === 'ok' || row.status === 'already_member') {
    const role = (row.role ?? 'cashier') as MemberRole;
    const where = homeForRole(role);
    const name = row.restaurant_name ?? 'the restaurant';
    const message =
      row.status === 'ok'
        ? `You have joined ${name} as ${roleLabel(role)}.`
        : `You are already on the team at ${name} as ${roleLabel(role)}.`;
    redirect(`${where}?notice=${encodeURIComponent(message)}`);
  }

  // Every other status is a real answer with its own sentence on the page.
  redirect(`${joinPath(code)}?status=${encodeURIComponent(row.status)}`);
}

/** The Accept button, for somebody who already has an account. */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const code = normaliseInviteCode(String(formData.get('code') ?? ''));
  if (!isWellFormedInviteCode(code)) {
    redirect('/join?error=That%20invitation%20link%20is%20incomplete.%20Ask%20the%20owner%20to%20send%20it%20again.');
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    back(code, 'error', 'The database is not connected, so this invitation cannot be accepted yet.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(joinPath(code))}`);
  }

  await redeemAndLand(supabase, code);
}

/**
 * Sign up and join in one step.
 *
 * Deliberately NOT the /signup action: that one creates a restaurant, a menu
 * and an owner membership, which is the opposite of what a cook following an
 * invitation wants. This creates an account, a profile row, and then redeems
 * the link -- nothing else.
 *
 * With email confirmation switched on there is no session yet. Saying "check
 * your email, then open the link again" is the honest version; silently
 * sending them to a dashboard they cannot enter would not be.
 */
export async function joinSignUpAction(formData: FormData): Promise<void> {
  const code = normaliseInviteCode(String(formData.get('code') ?? ''));
  const fullName = String(formData.get('fullName') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!isWellFormedInviteCode(code)) {
    redirect('/join?error=That%20invitation%20link%20is%20incomplete.%20Ask%20the%20owner%20to%20send%20it%20again.');
  }

  if (!fullName) back(code, 'error', 'Please enter your name so the owner knows who joined.');
  if (!EMAIL.test(email)) back(code, 'error', 'Please enter a valid email address.');
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) back(code, 'error', passwordIssue);

  const supabase = await createSupabaseServerClient();
  if (!supabase) back(code, 'error', 'Sign-up is not available yet: the database is not connected.');

  const admin = getSupabaseAdmin();
  if (!admin) back(code, 'error', 'Sign-up is temporarily unavailable. Please try again shortly.');

  const origin = await requestOrigin();

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      // The confirmation mail must come back to THIS invitation, so accepting
      // it is one more tap rather than a hunt through the inbox.
      ...(origin ? { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(joinPath(code))}` } : {}),
    },
  });

  if (authError) back(code, 'error', 'We could not create your account. Please try again.');

  const userId = authData.user?.id;
  if (!userId) back(code, 'error', 'We could not create your account. Please try again.');

  // An existing address, with enumeration protection on, returns a user with
  // no identities. Sending them to sign in is the only truthful answer.
  if (authData.user?.identities?.length === 0) {
    redirect(
      `/login?next=${encodeURIComponent(joinPath(code))}&notice=${encodeURIComponent(
        'An account already uses that email. Sign in to accept the invitation.',
      )}`,
    );
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, full_name: fullName }, { onConflict: 'id' });

  if (profileError) {
    // The account exists but has no profile. The redeem function creates one
    // if needed, so this is not fatal; log it and continue rather than
    // stranding somebody who has just set a password.
    console.error('[autodine] invitation profile write failed:', profileError);
  }

  if (!authData.session) {
    redirect(
      `/login?next=${encodeURIComponent(joinPath(code))}&notice=${encodeURIComponent(
        'Check your email to confirm your address, then sign in to finish joining.',
      )}`,
    );
  }

  await redeemAndLand(supabase, code);
}
