import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  TABLE_SESSION_COOKIE,
  TABLE_SESSION_COOKIE_OPTIONS,
  type TableSession,
} from '@/lib/table-session';

/**
 * What a printed QR code points at: /t/<public token>.
 *
 * Scanning exchanges that token for a short-lived table session, which is
 * stored in a cookie. Everything after this -- the menu, the cart, the order
 * -- reads the session from that cookie, so an order can be stamped with the
 * table it was placed at.
 *
 * WHY THIS IS A ROUTE HANDLER AND NOT A PAGE
 *
 * A Server Component cannot set a cookie. Next.js throws at render time if
 * one tries, which is deliberate: a component may be rendered more than once,
 * in a cache, or after the response has started streaming, and a write in
 * that position is not reliable. Only Route Handlers and Server Actions may
 * write cookies. This route's entire job is that write, so it is a handler.
 *
 * That costs the ability to render a component on failure. Instead the
 * handler redirects to /t/problem with a reason code, and that page does the
 * rendering. The code is from a fixed list rather than the database's message
 * passed through, because a reflected error string in a URL is a thing that
 * gets turned into something worse.
 *
 * The token in the URL is the QR's public token, printed on the table, and is
 * not a secret. What it is exchanged for is: 64 hex characters, generated
 * inside the database, handed over once, stored there only as a SHA-256 hash.
 * That goes straight into an httpOnly cookie and never into a URL -- a URL
 * gets copied into messages and lands in browser history, a cookie does not.
 */

export const dynamic = 'force-dynamic';

/**
 * A stable, non-reversible fingerprint of the caller's address.
 *
 * The database rate-limits verification attempts per code and per IP hash and
 * requires 64 hex characters. Salting with the QR token means a hash from one
 * table's code cannot be correlated with another's -- without it, the attempt
 * log would be a record of which addresses scanned which tables, which is
 * more than rate limiting needs to know.
 *
 * The address comes from the forwarded header because that is what carries it
 * behind Vercel. It is a header, so it can be forged. Rate limiting by IP is
 * a brake on casual probing, not a control an attacker cannot walk around,
 * and pretending otherwise would be worse than saying so.
 */
function ipHash(address: string, salt: string): string {
  return createHash('sha256').update(`${address}|${salt}`).digest('hex');
}

function clientAddress(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Reason codes shown at /t/problem.
 *
 * Deliberately a closed set. Each maps to one fixed sentence, so nothing a
 * caller can influence is ever reflected back into a page.
 */
type ProblemReason =
  | 'unreadable'
  | 'revoked'
  | 'limited'
  | 'notserving'
  | 'nomenu'
  | 'offline'
  | 'failed';

/** The database's own message, matched to a reason without passing it on. */
function reasonFor(message: string): ProblemReason {
  const m = message.toLowerCase();
  if (m.includes('too many attempts')) return 'limited';
  if (m.includes('no longer in use') || m.includes('no longer valid')) return 'revoked';
  if (m.includes('not taking orders') || m.includes('not accepting')) return 'notserving';
  if (m.includes('published a menu')) return 'nomenu';
  if (m.includes('expired')) return 'revoked';
  return 'unreadable';
}

function problem(request: NextRequest, reason: ProblemReason) {
  return NextResponse.redirect(new URL(`/t/problem?r=${reason}`, request.url));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!isSupabaseConfigured) return problem(request, 'offline');

  const supabase = await createSupabaseServerClient();
  if (!supabase) return problem(request, 'offline');

  const { data, error } = await supabase.rpc('verify_table_qr', {
    p_public_token: token,
    p_ip_hash: ipHash(clientAddress(request), token),
  });

  const row = Array.isArray(data) ? data[0] : undefined;

  if (error) {
    // P0001 is everything a guest can cause, and its messages are written for
    // a guest. Anything else is ours, not theirs, and must not be shown.
    if (error.code !== 'P0001') {
      console.error('[verify_table_qr] unexpected failure', error);
      return problem(request, 'failed');
    }
    return problem(request, reasonFor(error.message));
  }

  if (!row) return problem(request, 'unreadable');

  const session: TableSession = {
    token: row.session_token,
    slug: row.restaurant_slug,
    tableLabel: row.table_label,
    expiresAt: row.expires_at,
  };

  // The cookie is set on the response rather than through cookies() from
  // next/headers. Both are allowed in a Route Handler, but mixing them is
  // not: cookies() writes into the request context's mutable cookie store
  // while an explicit NextResponse carries its own headers, and the two do
  // not reliably compose. One response, one place the cookie is written.
  const response = NextResponse.redirect(
    new URL(`/menu?s=${encodeURIComponent(session.slug)}`, request.url)
  );

  response.cookies.set(TABLE_SESSION_COOKIE, JSON.stringify(session), {
    ...TABLE_SESSION_COOKIE_OPTIONS,
    // The cookie must not outlive the session it carries. The database caps a
    // session at an hour; taking a minute off the cookie means the browser
    // forgets first, so a guest never holds a cookie for a session that is
    // already gone.
    maxAge: 60 * 59,
  });

  return response;
}
