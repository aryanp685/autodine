/**
 * Session refresh and owner/staff route protection.
 *
 * Runs in the Next.js request proxy for owner and staff application routes. Two jobs:
 *   1. Refresh the Supabase session cookie so it does not silently expire
 *      while someone is working.
 *   2. Send signed-out visitors to /login.
 *
 * When Supabase is not configured, session refresh is skipped only for the
 * explicitly enabled local demo and the hermetic CI build. The server-side
 * runtime guard rejects an unconfigured production build, so this branch can
 * never turn a production deployment into an unauthenticated demo.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase/env';
import { buildCsp } from '@/lib/csp';

export async function proxy(request: NextRequest) {
  // ---- Content Security Policy, on every document this app serves.
  //
  // The nonce rides on the request (x-nonce) so the root layout can tag the
  // motion script, and inside the CSP request header so Next.js nonces its
  // own inline runtime. The same policy is set on the response, which is
  // where the browser reads it. Staff-route session work below is untouched:
  // it still only runs where it ran before.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestId = crypto.randomUUID();
  request.headers.set('x-request-id', requestId);
  const csp = buildCsp({ nonce, supabaseUrl: SUPABASE_URL });
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', csp);

  const staffPath = /^\/(dashboard|kitchen|cashier|bill)(\/|$)/.test(request.nextUrl.pathname);

  const finish = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('X-Request-ID', requestId);
    return response;
  };

  // Explicit live mode never turns a missing database into a convincing demo.
  // Local/CI previews keep their existing no-secret demonstration contract.
  if (process.env.AUTODINE_MODE === 'live' && !isSupabaseConfigured &&
      (staffPath || /^\/(menu|t|bill|invoice|join)(\/|$)/.test(request.nextUrl.pathname))) {
    return finish(new NextResponse('Ordering is temporarily unavailable. Please contact restaurant staff.', {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    }));
  }

  if (!isSupabaseConfigured || !staffPath) {
    return finish(NextResponse.next({ request: { headers: request.headers } }));
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: request.headers } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Touching the user refreshes the session cookie when it is near expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // pathname AND search: dropping the query sent an owner who opened
    // /dashboard/orders?range=7d&status=open back to today's bills after
    // signing in, so the link they clicked appeared not to work.
    url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return finish(NextResponse.redirect(url));
  }

  return finish(response);
}

export const config = {
  // Everything that renders HTML carries the CSP. /api is left out on
  // purpose: payment webhooks and JSON answers have no document to protect
  // and the proxy's session work must never sit in their path. Static
  // chunks and optimized images are documents to nobody.
  matcher: ['/((?!api|_next/static|_next/image).*)'],
};
