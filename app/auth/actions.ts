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

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  RECOVERY_COOKIE,
  RECOVERY_STATE_COOKIE,
  RECOVERY_STATE_TTL_SECONDS,
  isValidRecoveryState,
  passwordProblem,
  passwordsMatch,
} from '@/lib/password';
import { requestOrigin } from '@/lib/site-origin';
import { safeLocalPath } from '@/lib/safe-next-path';
import { slugify, uniqueSlug } from '@/lib/slug';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { homeForRole } from '@/lib/db/team';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatIncidentLogLine } from '@/lib/monitoring-incidents';
import { operationalIncidents } from '@/lib/incident-registry';
import {
  normalizeAuthEmail,
  PENDING_SIGNUP_EMAIL_COOKIE,
  PENDING_SIGNUP_EMAIL_TTL_SECONDS,
  SIGNUP_CONFIRMATION_PENDING_PATH,
  signupConfirmationRedirectTo,
  type SignupResendState,
} from '@/lib/signup-confirmation';

/**
 * Every Auth mail failure (confirmation, send-again, password reset,
 * password update) used to be a lone `console.*` call while the visitor saw
 * normal anti-enumeration output — so the Brevo 525 IP rejection sat
 * invisible in production logs for days while signups silently failed.
 * Route every failure through the shared operational-incident tracker
 * instead: it dedups into a count, rejects raw provider text, and shows up
 * wherever operators already watch — the `[autodine:alert]` log line and
 * the owner/manager ops incident surface (`/api/ops/incidents`, which can
 * also forward to the configured alert webhook). Reporting must never leak
 * addresses, tenant ids, or provider messages into the line — callers pass
 * only the fixed kind plus numeric status/Auth code.
 */
type AuthFailureKind =
  | 'signup_confirmation_email_failed'
  | 'signup_confirmation_resend_failed'
  | 'password_reset_email_failed'
  | 'password_update_failed'
  | 'signup_workspace_creation_failed'
  | 'signup_rollback_failed'
  | 'sign_in_unavailable';

function reportAuthFailure(kind: AuthFailureKind, status: number | null): void {
  try {
    const { record, outcome } = operationalIncidents.report({
      key: kind,
      kind,
      severity: 'warning',
      summary:
        kind === 'signup_workspace_creation_failed'
          ? 'Signup workspace creation failed after Auth user creation'
          : kind === 'signup_rollback_failed'
            ? 'Signup rollback failed; a partial Auth user may remain'
            : kind === 'password_update_failed'
            ? `Password update failed (status ${status ?? 'transport'})`
            : kind === 'sign_in_unavailable'
            ? `Sign-in could not reach Auth (status ${status ?? 'transport'})`
            : `Auth email failed (${kind}, status ${status ?? 'transport'})`,
    });
    console.warn(formatIncidentLogLine(outcome, record));
  } catch {
    // Reporting must never change what the visitor sees or break the flow.
  }
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * The shape of an unknown error that is safe to write to the server log.
 * Auth and database error objects can carry provider wording; this keeps only
 * the identifiers support uses (name/status/code, length-capped and free of
 * control characters) and never the message.
 */
function safeErrorShape(error: unknown): { name: string; status: number | null; code: string } {
  const clean = (value: unknown, max: number): string =>
    String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const source = (error ?? {}) as Record<string, unknown>;
  const status = typeof source.status === 'number' && Number.isFinite(source.status) ? source.status : null;
  return {
    name: clean(error instanceof Error ? error.name : (source.name ?? 'unknown'), 80) || 'unknown',
    status,
    code: clean(source.code ?? 'unknown', 64) || 'unknown',
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rememberPendingSignupEmail(email: string, secure: boolean) {
  try {
    const cookieStore = await cookies();
    cookieStore.set(PENDING_SIGNUP_EMAIL_COOKIE, email, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/signup',
      maxAge: PENDING_SIGNUP_EMAIL_TTL_SECONDS,
      secure,
    });
  } catch {
    // The address is a convenience for the pending page, not signup state.
    // The page keeps an editable email field if this short-lived cookie cannot be written.
  }
}

async function clearPendingSignupEmail() {
  const cookieStore = await cookies();
  cookieStore.set(PENDING_SIGNUP_EMAIL_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/signup',
    maxAge: 0,
  });
}

async function rollbackSignup(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  restaurantId?: string,
) {
  // Signup spans Supabase Auth and several Postgres inserts, which cannot share
  // one transaction. Compensate on failure so a partial workspace is not left
  // behind and logged as a successful registration.
  if (restaurantId) await admin.from('restaurants').delete().eq('id', restaurantId);
  // Migration 20261110001000: signup also creates the ACCOUNT that owns the
  // first outlet, so a half-built workspace leaves an ownerless account behind
  // unless this removes it too.
  await admin.from('accounts').delete().eq('owner_id', userId);
  await admin.from('profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}

export async function signUpAction(formData: FormData): Promise<void> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const restaurantName = String(formData.get('restaurantName') ?? '').trim();
  const email = normalizeAuthEmail(formData.get('email'));
  const phone = String(formData.get('phone') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const agreed = formData.get('agree') === 'on';

  if (!fullName || !restaurantName) fail('/signup', 'Please enter your name and your restaurant name.');
  if (!email) fail('/signup', 'Please enter a valid email address.');
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) fail('/signup', passwordIssue);
  // Preview-account data use must be explicitly acknowledged.
  if (!agreed) fail('/signup', 'Please confirm that you understand how this preview uses your account details.');

  const supabase = await createSupabaseServerClient({
    preservePkceVerifierCookiesOnAuthError: true,
  });
  if (!supabase) fail('/signup', 'Sign-up is not available yet: the database is not connected.');

  const admin = getSupabaseAdmin();
  if (!admin) fail('/signup', 'Sign-up is temporarily unavailable. Please try again shortly.');

  const slug = await uniqueSlug(slugify(restaurantName), async (candidate) => {
    const { data } = await admin.from('restaurants').select('id').eq('slug', candidate).maybeSingle();
    return Boolean(data);
  });

  // Confirmations must return to this deployment so the matching PKCE verifier
  // cookie is available. The callback path and dashboard destination are fixed;
  // the configured Supabase redirect allowlist remains the external boundary.
  const origin = await requestOrigin();
  const emailRedirectTo = signupConfirmationRedirectTo(origin);
  if (!emailRedirectTo) {
    fail('/signup', 'Sign-up is not available from this address. Open AutoDine on its usual domain and try again.');
  }

  const signupResult = await supabase.auth
    .signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
        emailRedirectTo,
      },
    })
    .catch(() => null);
  const userId = signupResult?.data.user?.id;

  // Keep every valid address on the same confirmation-pending surface. Auth
  // may return different errors for mail/send eligibility, so neither the
  // redirect nor the PKCE cookie shape should reveal account state.
  if (!signupResult || signupResult.error || !userId) {
    // The visitor must see the identical pending page (anti-enumeration),
    // but operators must not: a broken mail provider (e.g. the Brevo 525 IP
    // rejection) otherwise fails every signup invisibly. Report only the
    // fixed kind plus numeric status — never the address or provider text.
    // A missing user id with no error is not a mail failure, so only an
    // explicit error or a transport failure (null result) is reported.
    if (!signupResult || signupResult.error) {
      const status = signupResult?.error ? safeErrorShape(signupResult.error).status : null;
      // A 429 is expected throttling, not a provider failure.
      if (status !== 429) reportAuthFailure('signup_confirmation_email_failed', status);
    }
    await rememberPendingSignupEmail(email, emailRedirectTo.startsWith('https://'));
    redirect(SIGNUP_CONFIRMATION_PENDING_PATH);
  }

  const { data: authData } = signupResult;
  // Supabase can return a user with no identities for an existing email when
  // email-enumeration protection is enabled. Do not create a second workspace.
  if (authData.user?.identities?.length === 0) {
    await rememberPendingSignupEmail(email, emailRedirectTo.startsWith('https://'));
    redirect(SIGNUP_CONFIRMATION_PENDING_PATH);
  }

  let restaurantId: string | undefined;
  try {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: userId, full_name: fullName, phone }, { onConflict: 'id' });
    if (profileError) throw profileError;

    // Migration 20261110001000 (Model C). The account, its first outlet, the
    // outlet's starter menu and the owner membership are created in ONE
    // transaction: the account is what trials and what is billed, and a
    // restaurant inserted directly would belong to no account at all — no
    // trial, no plan, and no way to add a second outlet.
    const { data: created, error: createError } = await admin.rpc('create_account_with_restaurant', {
      p_name: restaurantName,
      p_slug: slug,
      p_timezone: 'Asia/Kolkata',
      p_owner: userId,
    });
    if (createError) throw createError;
    restaurantId = created ?? undefined;
  } catch (error) {
    try {
      await rollbackSignup(admin, userId, restaurantId);
    } catch (rollbackError) {
      console.error('[autodine] signup rollback failed', safeErrorShape(rollbackError));
      reportAuthFailure('signup_rollback_failed', safeErrorShape(rollbackError).status);
    }
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.error('[autodine] signup session cleanup failed', safeErrorShape(signOutError));
    }
    console.error('[autodine] workspace creation failed', safeErrorShape(error));
    // Same invisibility trap as mail: without an incident, a broken signup
    // workspace path would fail every new restaurant with only a log line.
    reportAuthFailure('signup_workspace_creation_failed', safeErrorShape(error).status);
    fail('/signup', 'We could not finish setting up your workspace. Please try again.');
  }

  // With email confirmation ON there is no session yet. Sending them to the
  // dashboard would bounce them straight back out, so send them to a page that
  // can request another confirmation without claiming that delivery occurred.
  if (!authData.session) {
    await rememberPendingSignupEmail(email, emailRedirectTo.startsWith('https://'));
    redirect(SIGNUP_CONFIRMATION_PENDING_PATH);
  }

  await clearPendingSignupEmail();
  redirect('/dashboard');
}

/**
 * Request another owner signup confirmation. Supabase Auth is the only sender.
 * Every syntactically valid address gets the same UI result: Auth may return
 * different throttling or mail-provider errors only after it has found an
 * unconfirmed user, so reflecting those outcomes would create an account
 * oracle. The client never receives a raw Auth/provider message or email-state
 * distinction; acceptance and delivery remain unconfirmed.
 */
export async function resendSignupConfirmationAction(
  _previousState: SignupResendState,
  formData: FormData,
): Promise<SignupResendState> {
  const email = normalizeAuthEmail(formData.get('email'));
  if (!email) return { status: 'invalid' };

  try {
    const supabase = await createSupabaseServerClient({
      preservePkceVerifierCookiesOnAuthError: true,
    });
    if (!supabase) return { status: 'requested' };

    const origin = await requestOrigin();
    const emailRedirectTo = signupConfirmationRedirectTo(origin);
    if (!emailRedirectTo) return { status: 'requested' };

    // The Auth client creates a per-flow PKCE verifier and writes it through
    // the Server Action's cookie adapter. The opt-in adapter retains these
    // short-lived flow cookies even when Auth/provider errors are returned, so
    // cookie presence cannot distinguish a mail-eligible address either.
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });

    if (error) {
      console.warn('[autodine] signup confirmation resend did not complete', {
        status: error.status ?? null,
        code: error.code ?? 'unknown',
      });
      // The visitor still gets the identical anti-enumeration result, but a
      // provider-wide failure (the Brevo 525 lesson) must become a countable
      // operator incident instead of a lone warning nobody watches. A 429 is
      // expected throttling, not a provider failure, so it is not reported.
      if (error.status !== 429) {
        reportAuthFailure('signup_confirmation_resend_failed', error.status ?? null);
      }
    }
  } catch (error) {
    // Do not log email addresses or raw Auth/provider messages from this path.
    console.warn('[autodine] signup confirmation resend could not be completed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    reportAuthFailure('signup_confirmation_resend_failed', null);
  }

  return { status: 'requested' };
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const requestedNext = String(formData.get('next') ?? '');
  // Only accept same-origin pathnames. Never turn the login form into an open
  // redirect: one shared, hardened check (lib/safe-next-path.ts) that also
  // rejects encoded and double-encoded forms. Anything else falls through to
  // the role's own home below.
  const next = safeLocalPath(requestedNext, '') || null;

  if (!email || !password) fail('/login', 'Please enter your email and password.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('/login', 'Sign-in is not available yet: the database is not connected.');

  // A throw here means the request never got an answer from Auth — a
  // dropped connection or an unreachable endpoint, not a wrong password.
  // Letting it escape would show the visitor a raw error page and leave
  // operators with nothing: the same silent failure the incident tracker
  // exists to prevent. The message names the SITE's health, never the
  // address, so it cannot become an account oracle.
  let error: { status?: number; code?: string; message: string } | null = null;
  try {
    const result = await supabase.auth.signInWithPassword({ email, password });
    error = result.error;
  } catch (thrown) {
    console.error('[autodine] sign-in could not reach Auth', safeErrorShape(thrown));
    reportAuthFailure('sign_in_unavailable', safeErrorShape(thrown).status);
    fail('/login', 'Sign-in is temporarily unavailable. Please try again shortly.');
  }
  if (error) {
    // Deliberately vague. "Invalid login credentials" is fine to show; telling
    // an attacker which of the two was wrong is not.
    fail('/login', 'Email or password is incorrect.');
  }

  if (next) redirect(next);

  /* No destination was asked for, so land where this person actually works.
     It used to be /dashboard for everybody, which was harmless while every
     account was an owner. Now that a restaurant can hand a kitchen or counter
     login to a second person, sending them to the owner's dashboard means
     their first second in the product is a wall that says "not your role" --
     and the screen they need is one they never saw. */
  const staff = await getStaffContextDetailed();
  redirect(staff.ok ? homeForRole(staff.context.role) : '/dashboard');
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
  // `flow=recovery` alone is caller-controlled and cannot prove what kind of
  // PKCE code is being exchanged. Carry a random state in the email redirect
  // and store the matching value in an HTTP-only cookie on the requesting
  // browser. The callback requires both values before granting reset access.
  const cookieStore = await cookies();
  const existingState = cookieStore.get(RECOVERY_STATE_COOKIE)?.value;
  const recoveryState = isValidRecoveryState(existingState)
    ? existingState
    : randomBytes(32).toString('base64url');
  const redirectTo = new URL('/auth/confirm', origin);
  redirectTo.searchParams.set('flow', 'recovery');
  redirectTo.searchParams.set('state', recoveryState);

  let error: { status?: number; code?: string; message: string } | null = null;
  try {
    const result = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo.toString(),
    });
    error = result.error;
  } catch (thrown) {
    // Auth never answered, so no mail was sent and no state changed. Say
    // the same thing the refusal branch says (the site, not the address)
    // and open an incident, so an unreachable Auth endpoint cannot leave
    // password recovery broken with only a stack trace.
    console.error('[autodine] password reset could not reach Auth', safeErrorShape(thrown));
    reportAuthFailure('password_reset_email_failed', safeErrorShape(thrown).status);
    fail('/forgot-password', 'We could not send the email just now. Please try again in a few minutes.');
  }

  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 429 || /rate limit/i.test(error.message)) {
      fail(
        '/forgot-password',
        'Too many reset emails have been sent from this site in the last hour. Wait a few minutes, then try again.',
      );
    }
    // The provider's message can carry infrastructure detail (and support has
    // no use for it). The status and Auth code are enough to diagnose a
    // refusal without writing the address or provider words into the log.
    console.error('[autodine] could not send password reset email', {
      status: status ?? null,
      code: (error as { code?: string }).code ?? 'unknown',
    });
    // A dead mail provider would otherwise lock every user out of password
    // recovery with only this log line as evidence. (The 429 branch above
    // returns earlier and is not reported: throttling is expected, tells
    // the visitor the truth, and is a property of the site, not a failure.)
    reportAuthFailure('password_reset_email_failed', status ?? null);
    fail('/forgot-password', 'We could not send the email just now. Please try again in a few minutes.');
  }

  // Persist correlation state only after Auth accepted the request, so a
  // throttled or failed reset does not create a misleading pending flow.
  cookieStore.set(RECOVERY_STATE_COOKIE, recoveryState, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: RECOVERY_STATE_TTL_SECONDS,
    secure: origin.startsWith('https://'),
  });

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

  let user: { id?: string } | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data?.user ?? null;
  } catch (thrown) {
    // The session could not be confirmed. That is not the same as an
    // expired link, and saying "expired" would send the person away from a
    // reset that is still perfectly good.
    console.error('[autodine] password reset session check could not reach Auth', safeErrorShape(thrown));
    reportAuthFailure('password_update_failed', safeErrorShape(thrown).status);
    fail('/reset-password', 'We could not check your reset link just now. Please try again in a few minutes.');
  }

  if (!user) {
    fail('/reset-password', 'This reset link has expired. Request a new one.');
  }

  let error: { status?: number; code?: string; message: string } | null = null;
  try {
    const result = await supabase.auth.updateUser({ password });
    error = result.error;
  } catch (thrown) {
    // The password was never changed. The permission is NOT spent, so the
    // person can simply try again with the same link.
    console.error('[autodine] password update could not reach Auth', safeErrorShape(thrown));
    reportAuthFailure('password_update_failed', safeErrorShape(thrown).status);
    fail('/reset-password', 'We could not save the new password. Please try again in a few minutes.');
  }

  if (error) {
    if (/different from the old password/i.test(error.message)) {
      fail('/reset-password', 'That is already your password. Choose a different one.');
    }
    if (/weak|pwned|leaked/i.test(error.message)) {
      fail('/reset-password', 'That password is too easy to guess. Choose a longer one.');
    }
    // Do not log the provider's words here either: they can carry
    // infrastructure detail and this path is reachable by anyone who opens the
    // emailed link. Status and code are enough for support to tell a refusal
    // from an outage.
    console.error('[autodine] could not set the new password', {
      status: (error as { status?: number }).status ?? null,
      code: (error as { code?: string }).code ?? 'unknown',
    });
    reportAuthFailure(
      'password_update_failed',
      (error as { status?: number }).status ?? null,
    );
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
    console.error('[autodine] sign-out after password reset failed', safeErrorShape(signOutError));
  }

  redirect(`/login?notice=${encodeURIComponent(PASSWORD_CHANGED_NOTICE)}`);
}
