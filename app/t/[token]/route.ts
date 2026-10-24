import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isQrToken } from '@/lib/table-session';
import { loadTableAccess } from '@/lib/table-access';
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

  const response = to(menuHref, request);
  response.cookies.set(TABLE_CARD_COOKIE, token, TABLE_CARD_COOKIE_OPTIONS);
  return response;
}
