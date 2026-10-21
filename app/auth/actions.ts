/**
 * Sign up, sign in, sign out, and the two halves of a password reset.
 *
 * Runs only on the server. Signup deliberately uses the SERVICE ROLE client
 * to create the restaurant, menu and membership, because there is no RLS
 * INSERT policy for restaurants: letting any authenticated user create
 * unlimited restaurants would be an abuse vector. Creation is therefore
 * gated behind this one controlled, validated server path.
 *
 * Errors redirect with a message in the query string rather than throwing,
 * because these are called directly by a <form action> in a Server Component
 * and there is no client-side state to hold an error in.
 */

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { RECOVERY_COOKIE, passwordProblem, passwordsMatch } from '@/lib/password';
import { requestOrigin } from '@/lib/site-origin';
import { slugify, uniqueSlug } from '@/lib/slug';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rollbackSignup(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  restaurantId?: string,
) {
  // Signup spans Supabase Auth and several Postgres inserts, which cannot share
  // one transaction. Compensate on failure so a partial workspace is not left
  // behind and logged as a successful registration.
  if (restaurantId) await admin.from('restaurants').delete().eq('id', restaurantId);
  await admin.from('profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}

export async function signUpAction(formData: FormData): Promise<void> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const restaurantName = String(formData.get('restaurantName') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const phone = String(formData.get('phone') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const agreed = formData.get('agree') === 'on';

  if (!fullName || !restaurantName) fail('/signup', 'Please enter your name and your restaurant name.');
  if (!EMAIL.test(email)) fail('/signup', 'Please enter a valid email address.');
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) fail('/signup', passwordIssue);
  // Preview-account data use must be explicitly acknowledged.
  if (!agreed) fail('/signup', 'Please confirm that you understand how this preview uses your account details.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('/signup', 'Sign-up is not available yet: the database is not connected.');

  const admin = getSupabaseAdmin();
  if (!admin) fail('/signup', 'Sign-up is temporarily unavailable. Please try again shortly.');

  const slug = await uniqueSlug(slugify(restaurantName), async (candidate) => {
    const { data } = await admin.from('restaurants').select('id').eq('slug', candidate).maybeSingle();
    return Boolean(data);
  });

  // Where the "confirm your email" link comes back to. Without this Supabase
  // uses the project's Site URL, which is a single value: every confirmation
  // mail sent from a preview or a branch deployment pointed at whichever host
  // happened to be configured months earlier, and those deployments are gone.
  const origin = await requestOrigin();

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, phone },
      ...(origin ? { emailRedirectTo: `${origin}/auth/confirm?next=/dashboard` } : {}),
    },
  });

  if (authError) fail('/signup', 'We could not create your account. Please try again.');

  const userId = authData.user?.id;
  if (!userId) fail('/signup', 'We could not create your account. Please try again.');
  // Supabase can return a user with no identities for an existing email when
  // email-enumeration protection is enabled. Do not create a second workspace.
  if (authData.user?.identities?.length === 0) {
    redirect('/login?notice=If%20an%20account%20can%20be%20used%20with%20that%20email%2C%20sign%20in%20instead.');
  }

  let restaurantId: string | undefined;
  try {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: userId, full_name: fullName, phone }, { onConflict: 'id' });
    if (profileError) throw profileError;

    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .insert({ slug, name: restaurantName, timezone: 'Asia/Kolkata' })
      .select('id')
      .single();
    if (restaurantError) throw restaurantError;
    restaurantId = restaurant.id;

    const { error: menuError } = await admin
      .from('menus')
      .insert({ restaurant_id: restaurantId, name: 'Main menu', is_published: true });
    if (menuError) throw menuError;

    const { error: membershipError } = await admin
      .from('memberships')
      .insert({ restaurant_id: restaurantId, user_id: userId, role: 'owner' });
    if (membershipError) throw membershipError;
  } catch (error) {
    try {
      await rollbackSignup(admin, userId, restaurantId);
    } catch (rollbackError) {
      console.error('[autodine] signup rollback failed:', rollbackError);
    }
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.error('[autodine] signup session cleanup failed:', signOutError);
    }
    console.error('[autodine] workspace creation failed:', error);
    fail('/signup', 'We could not finish setting up your workspace. Please try again.');
  }

  // With email confirmation ON there is no session yet. Sending them to the
  // dashboard would bounce them straight back out, so say what happened.
  if (!authData.session) {
    redirect('/login?notice=Check%20your%20email%20to%20confirm%20your%20address%2C%20then%20sign%20in.');
  }

  redirect('/dashboard');
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const requestedNext = String(formData.get('next') ?? '');
  // Only accept same-origin pathnames. Never turn the login form into an open redirect.
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') && !requestedNext.includes('\\')
    ? requestedNext
    : '/dashboard';

  if (!email || !password) fail('/login', 'Please enter your email and password.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('/login', 'Sign-in is not available yet: the database is not connected.');

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Deliberately vague. "Invalid login credentials" is fine to show; telling
    // an attacker which of the two was wrong is not.
    fail('/login', 'Email or password is incorrect.');
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect('/login');
}

/* ========================================================================== */
/*  Password reset                                                            */
/* ========================================================================== */

/**
 * Ask Supabase to email a reset link.
 *
 * Deliberately says the same thing whether or not the address has an account.
 * Signup already refuses to confirm that an email exists (it lets Supabase's
 * own enumeration protection hide it), and a reset form that answers
 * "no such user" would hand that answer back on a plate.
 *
 * The one exception is a rate limit, and only because staying silent there
 * would be a lie of a different kind: the person would wait for a mail that
 * was never sent. A rate limit is a property of the site, not of the address,
 * so saying so reveals nothing about who has an account.
 */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!EMAIL.test(email)) fail('/forgot-password', 'Please enter a valid email address.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    fail('/forgot-password', 'Password reset is not available yet: the database is not connected.');
  }

  const origin = await requestOrigin();
  if (!origin) {
    fail('/forgot-password', 'Password reset is not available from this address. Open the site on its usual domain and try again.');
  }

  // The link is built from the request's own host, so a reset started on a
  // preview deployment comes back to that preview, not to production.
  //
  // `flow=recovery` is carried through the mail link so /auth/confirm can tell
  // a password reset apart from an email confirmation. Both land on the same
  // handler with the same `code`, and only a reset may leave behind the
  // short-lived permission to set a new password without knowing the old one.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?flow=recovery`,
  });

  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 429 || /rate limit/i.test(error.message)) {
      fail(
        '/forgot-password',
        'Too many reset emails have been sent from this site in the last hour. Wait a few minutes, then try again.',
      );
    }
    console.error('[autodine] could not send password reset email:', error.message);
    fail('/forgot-password', 'We could not send the email just now. Please try again in a few minutes.');
  }

  redirect(
    `/forgot-password?notice=${encodeURIComponent(
      'If that email has an AutoDine account, a reset link is on its way. It works once and expires in an hour. Check the spam folder if it does not arrive.',
    )}`,
  );
}

/** The notice a finished reset lands on. */
const PASSWORD_CHANGED_NOTICE = 'Your password was changed. Sign in with the new one.';

/**
 * Set the new password, on the session the emailed link created.
 *
 * There is no "which user" input: the account is whatever `/auth/confirm`
 * established, so this cannot be pointed at somebody else's account. That also
 * means it must be useless without that session, which is what the getUser()
 * check below enforces -- the page shows the same thing, but the check has to
 * be here too, because a form can be posted by hand.
 */
export async function updatePasswordAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('confirmation') ?? '');

  // A signed-in session is not permission to replace the password: it could be
  // a laptop somebody walked away from. The recovery cookie is, and only for
  // fifteen minutes after the emailed link was used.
  const cookieStore = await cookies();
  if (cookieStore.get(RECOVERY_COOKIE)?.value !== '1') {
    fail('/reset-password', 'Open the link from the reset email to choose a new password.');
  }

  const problem = passwordProblem(password);
  if (problem) fail('/reset-password', problem);
  if (!passwordsMatch(password, confirmation)) {
    fail('/reset-password', 'The two passwords do not match.');
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('/reset-password', 'Password reset is not available yet: the database is not connected.');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    fail('/reset-password', 'This reset link has expired. Request a new one.');
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    if (/different from the old password/i.test(error.message)) {
      fail('/reset-password', 'That is already your password. Choose a different one.');
    }
    if (/weak|pwned|leaked/i.test(error.message)) {
      fail('/reset-password', 'That password is too easy to guess. Choose a longer one.');
    }
    console.error('[autodine] could not set the new password:', error.message);
    fail('/reset-password', 'We could not save the new password. Request a new reset link and try again.');
  }

  // The permission is spent. Leaving it would let a second change go through
  // without another email.
  cookieStore.delete(RECOVERY_COOKIE);

  // A reset is also a "sign out everywhere": whoever may have been holding the
  // old password loses the sessions they were using. The person then signs in
  // again on this device with the password they just chose.
  try {
    await supabase.auth.signOut();
  } catch (signOutError) {
    console.error('[autodine] sign-out after password reset failed:', signOutError);
  }

  redirect(`/login?notice=${encodeURIComponent(PASSWORD_CHANGED_NOTICE)}`);
}
