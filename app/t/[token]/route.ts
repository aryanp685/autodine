import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isQrToken, TABLE_SESSION_COOKIE, TABLE_SESSION_COOKIE_OPTIONS } from '@/lib/table-session';
import { loadTableAccess } from '@/lib/table-access';
import { addressFromHeaders, hashAddress } from '@/lib/ip-hash';
import { TABLE_CARD_COOKIE, TABLE_CARD_COOKIE_OPTIONS } from '@/lib/table-card';

/**
 * What a printed QR code points at: /t/<public token>.
 *
 * WHAT THIS USED TO BE
 *
 * Originally a route handler that exchanged the token for a table session on
 * sight, so a photograph of a card was the whole check. That was closed by
 * making the session depend on the restaurant's rotating on-site code.
 *
 * WHAT IT IS NOW
 *
 * The card's address opens the menu. Scanning is not a proof of anything and
 * does not pretend to be: it records which card was scanned -- in an httpOnly
 * cookie, server-side only -- and sends the guest to the restaurant's menu,
 * where they belong. The six-digit code is asked for at checkout, at the
 * moment an order would otherwise be written, which is the only moment the
 * answer actually changes anything.
 *
 * WHY A GET IS ALLOWED TO SET THAT COOKIE
 *
 * The cookie grants nothing but reading a published menu, which any anonymous
 * reader can already select under RLS (see lib/table-card.ts). It cannot mint
 * a session, name a price, or place an order: place_public_order still refuses
 * without a table session, and the only function that mints one is
 * verify_table_qr_with_code, which demands the rotating code.
 *
 * The card is still checked here -- live card, table in service, restaurant
 * taking orders -- so a revoked card lands on the explanation page instead of
 * a menu it cannot order from.
 *
 * RESTAURANTS THAT HAVE OPTED OUT OF THE CODE
 *
 * A restaurant can set guest_verification_mode to 'scan_confirm' or 'scan'
 * (migration 20261028000900). For those, this handler also asks the database
 * for a table session, because a scan is the only credential their guests are
 * given. The decision is the DATABASE's, not this file's: open_table_session
 * refuses outright when the restaurant is on 'code', rate-limits per card and
 * per address, and mints a session only for a live card on a table in service
 * at a restaurant that is taking orders.
 *
 * A refusal is not an error and not a dead end. The guest still gets the menu,
 * because reading a published menu harms nothing; the code gate (or the
 * kitchen's confirmation, depending on the mode) is what stands between them
 * and an order.
 */
export const dynamic = 'force-dynamic';

function to(path: string, request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Shape first: this value is copied into a cookie and into redirects, so it
  // must never be arbitrary text.
  if (!isQrToken(token)) return to('/t/problem?r=unreadable', request);
  if (!isSupabaseConfigured) return to('/t/problem?r=offline', request);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return to('/t/problem?r=offline', request);

  const { data, error } = await supabase.rpc('public_qr_intro', {
    p_public_token: token,
  });

  if (error) {
    // Ours, not the guest's: a constraint, a permission problem, a database
    // that is not answering. Its words are not for a guest.
    console.error('[table-scan] public_qr_intro failed', error);
    return to('/t/problem?r=failed', request);
  }

  const row = Array.isArray(data) ? data[0] : undefined;
  if (!row) return to('/t/problem?r=unreadable', request);

  const menuHref = `/menu?s=${encodeURIComponent(row.restaurant_slug)}`;

  // Already verified at this restaurant -- the database says so, not the
  // cookie -- so a re-scan goes straight back to the menu with no form at all.
  const access = await loadTableAccess(row.restaurant_slug);
  if (access.status === 'verified') {
    const response = to(menuHref, request);
    response.cookies.set(TABLE_CARD_COOKIE, token, TABLE_CARD_COOKIE_OPTIONS);
    return response;
  }

  // No session yet. In a scan-mode restaurant the scan itself is the proof the
  // restaurant chose to accept, so a session is minted here -- the database
  // decides whether this card, this table and this restaurant qualify.
  const opened = await openSessionOnScan(token, request);
  const response = to(menuHref, request);
  response.cookies.set(TABLE_CARD_COOKIE, token, TABLE_CARD_COOKIE_OPTIONS);
  if (opened) {
    // Written on the RESPONSE, like the card cookie above, rather than through
    // cookies().set(): this handler already owns a response, and one cookie
    // mechanism per handler is one place to look when a guest arrives without
    // a table.
    response.cookies.set(TABLE_SESSION_COOKIE, JSON.stringify(opened), {
      ...TABLE_SESSION_COOKIE_OPTIONS,
      maxAge: 60 * 59,
    });
  }
  return response;
}

/**
 * Ask for a table session on a scan, and keep it only if the database agrees.
 *
 * Deliberately silent on failure: a guest who cannot get a session here is in
 * exactly the position every guest was in before this existed -- they read the
 * menu, and the order path asks for whatever the restaurant requires. Logging
 * is reserved for genuine failures, not for the expected 'code' answer.
 */
async function openSessionOnScan(cardToken: string, request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('open_table_session', {
    p_public_token: cardToken,
    // The request is already here; next/headers would be a second, slower
    // lookup that only works inside a request scope.
    p_ip_hash: hashAddress(addressFromHeaders((name) => request.headers.get(name)), cardToken),
  });

  if (error) {
    console.error('[table-scan] open_table_session failed', error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.status !== 'opened' || !row.session_token) return null;

  return {
    token: row.session_token as string,
    slug: row.restaurant_slug as string,
    tableLabel: row.table_label as string,
    expiresAt: row.expires_at as string,
    qrToken: cardToken,
  };
}
