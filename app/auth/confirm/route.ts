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
 * PKCE keeps a one-time verifier in a cookie on the browser that asked for the
 * link. Opening the mail on a different device -- requested on the office
 * laptop, clicked on the phone -- therefore cannot complete the exchange, and
 * Supabase reports it as an invalid or expired link. The failure message says
 * so and offers a new link instead of pretending the link was stale.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { RECOVERY_COOKIE } from '@/lib/password';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Only same-origin paths, so a crafted link cannot bounce someone off-site. */
function safeNext(value: string | null, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
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

const TYPES: readonly string[] = ['recovery', 'email', 'email_change', 'invite', 'magiclink'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const isRecovery = params.get('flow') === 'recovery';
  const next = safeNext(params.get('next'), isRecovery ? '/reset-password' : '/dashboard');

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return back(request, '/login', 'error', 'Sign-in is not available yet: the database is not connected.');
  }

  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[autodine] auth link exchange failed:', error.message);
      return back(
        request,
        '/forgot-password',
        'error',
        'This link did not work in this browser. Links are single-use and open only in the browser that asked for them — request a new one below.',
      );
    }
    return withRecovery(request, NextResponse.redirect(new URL(next, request.nextUrl.origin)), isRecovery);
  }

  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error) {
      console.error('[autodine] auth token verification failed:', error.message);
      return back(
        request,
        '/forgot-password',
        'error',
        'This link has expired or was already used. Request a new one below.',
      );
    }
    return withRecovery(
      request,
      NextResponse.redirect(new URL(next, request.nextUrl.origin)),
      isRecovery || type === 'recovery',
    );
  }

  // Someone opened /auth/confirm on its own, or a link lost its query string.
  return back(request, '/forgot-password', 'error', 'That link is incomplete. Request a new reset email below.');
}
