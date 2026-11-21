/**
 * Where an emailed link lands.
 *
 * Supabase sends every auth mail back through its own /auth/v1/verify
 * endpoint, which then redirects here with either `?code=` (the PKCE flow this
 * app uses) or `token_hash` + `type` (what a template built on `{{ .TokenHash }}`
 * produces). Both are handled, because the difference between them is a
 * setting on the dashboard that nothing in this repository can see.
 *
 * Exchanging the code is what creates the session: the reset form and the
 * "confirm your email" redirect both depend on it, so a failure here has to
 * end somewhere a person can act on, never on a blank page.
 *
 * ONE HONEST LIMITATION
 *
 * When an email template returns a PKCE `code`, the one-time verifier is a
 * cookie on the browser that asked for the link. Opening that mail on another
 * device cannot complete the exchange. A template using `token_hash` can avoid
 * that browser binding, but the resulting flow still has to preserve the action
 * type and redirect to the correct screen (especially password recovery).
 *
 * The signup and reset actions currently use Supabase's confirmation URL / PKCE
 * path. Their cross-device behavior has not been verified against hosted Auth.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import {
  RECOVERY_COOKIE,
  RECOVERY_STATE_COOKIE,
  isValidRecoveryState,
} from '@/lib/password';
import { PENDING_SIGNUP_EMAIL_COOKIE } from '@/lib/signup-confirmation';
import { safeLocalPath } from '@/lib/safe-next-path';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Only same-origin paths, so a crafted link cannot bounce someone off-site.
 *  Shared floor: lib/safe-next-path.ts (rejects encoded and backslash forms). */
function safeNext(value: string | null, fallback: string): string {
  return safeLocalPath(value, fallback);
}

/**
 * Let the reset form know a recovery link was just used.
 *
 * A session alone is not enough to prove that: an owner who is simply signed
 * in could otherwise open /reset-password and set a new password without
 * knowing the old one, from a laptop they left unlocked. The cookie is
 * httpOnly, lasts fifteen minutes, and is deleted the moment the password is
 * saved -- see updatePasswordAction.
 */
function withRecovery(request: NextRequest, response: NextResponse, isRecovery: boolean) {
  if (!isRecovery) return response;

  response.cookies.set({
    name: RECOVERY_COOKIE,
    value: '1',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
    secure: request.nextUrl.protocol === 'https:',
  });

  return response;
}

function back(request: NextRequest, path: string, key: 'error' | 'notice', message: string) {
  const url = new URL(path, request.nextUrl.origin);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url);
}

function signupLinkProblem(request: NextRequest) {
  const url = new URL('/signup/confirmation-pending', request.nextUrl.origin);
  url.searchParams.set('link', 'problem');
  return NextResponse.redirect(url);
}

function clearPendingSignupEmail(request: NextRequest, response: NextResponse) {
  response.cookies.set({
    name: PENDING_SIGNUP_EMAIL_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/signup',
    maxAge: 0,
    secure: request.nextUrl.protocol === 'https:',
  });
  return response;
}

const TYPES: readonly string[] = ['signup', 'recovery', 'email', 'email_change', 'invite', 'magiclink'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get('type');
  const flow = params.get('flow');
  const requestedNext = params.get('next');
  const isOwnerSignupConfirmation = flow === 'signup';
  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const isRecoveryIntent = params.get('flow') === 'recovery' || type === 'recovery';
  const linkState = params.get('state');
  const cookieState = request.cookies.get(RECOVERY_STATE_COOKIE)?.value;
  // `flow`, `type`, and `next` are URL parameters. For the PKCE path only a
  // state value created during the reset request and returned in the same
  // browser can distinguish recovery from a normal confirmation code.
  const isPkceRecovery = Boolean(
    code &&
      params.get('flow') === 'recovery' &&
      isValidRecoveryState(linkState) &&
      linkState === cookieState,
  );

  if (code && isRecoveryIntent && !isPkceRecovery) {
    return back(
      request,
      '/forgot-password',
      'error',
      'This reset link was not opened in the browser that requested it. Request a new one below.',
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    if (isOwnerSignupConfirmation) return signupLinkProblem(request);
    return back(request, '/login', 'error', 'Sign-in is not available yet: the database is not connected.');
  }

  if (code) {
    const flowId = params.get('sb_flow_id');
    const exchange = flowId
      ? await supabase.auth.exchangeCodeForSession(code, { flowId })
      : await supabase.auth.exchangeCodeForSession(code);
    const { error } = exchange;
    if (error) {
      console.error('[autodine] auth link exchange failed', {
        status: error.status ?? null,
        code: error.code ?? 'unknown',
      });
      if (isOwnerSignupConfirmation) return signupLinkProblem(request);
      return back(
        request,
        '/forgot-password',
        'error',
        'This link did not work in this browser. Links are single-use and open only in the browser that asked for them — request a new one below.',
      );
    }
    const isRecovery = isPkceRecovery;
    const next = isRecovery
      ? '/reset-password'
      : isOwnerSignupConfirmation
        ? '/dashboard'
        : safeNext(requestedNext, '/dashboard');
    const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
    if (isRecovery) response.cookies.delete(RECOVERY_STATE_COOKIE);
    if (isOwnerSignupConfirmation) clearPendingSignupEmail(request, response);
    return withRecovery(request, response, isRecovery);
  }

  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error) {
      console.error('[autodine] auth token verification failed', {
        status: error.status ?? null,
        code: error.code ?? 'unknown',
      });
      if (isOwnerSignupConfirmation) return signupLinkProblem(request);
      return back(
        request,
        '/forgot-password',
        'error',
        'This link has expired or was already used. Request a new one below.',
      );
    }
    const isRecovery = type === 'recovery';
    const next = isRecovery
      ? '/reset-password'
      : isOwnerSignupConfirmation
        ? '/dashboard'
        : safeNext(requestedNext, '/dashboard');
    const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
    if (isRecovery) response.cookies.delete(RECOVERY_STATE_COOKIE);
    if (isOwnerSignupConfirmation) clearPendingSignupEmail(request, response);
    return withRecovery(request, response, isRecovery);
  }

  // Someone opened /auth/confirm on its own, or a link lost its query string.
  if (isOwnerSignupConfirmation) return signupLinkProblem(request);
  return back(request, '/forgot-password', 'error', 'That link is incomplete. Request a new reset email below.');
}
