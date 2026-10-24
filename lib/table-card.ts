/**
 * The card a guest just scanned, remembered so they can browse.
 *
 * WHY THIS COOKIE EXISTS
 *
 * Scanning a table's QR used to open a page demanding six digits before the
 * menu would render at all. That is the wrong place to ask. A person who has
 * just sat down wants to read the menu; the question "which table are you at"
 * only has to be answered when an order is about to be sent to a kitchen.
 *
 * So the scan now leaves behind this: the public token of the card that was
 * scanned. It buys ONE thing -- the right to read that restaurant's published
 * menu -- and nothing else. It cannot place an order, cannot name a price, and
 * cannot stand in for a table session.
 *
 * WHY THAT IS NOT A WEAKENING
 *
 * Published menus and their prices are already public data: the RLS policies
 * on menus/items allow any anonymous reader to select them for an active
 * restaurant (migration 20261019000002). The old page-level gate therefore
 * never protected the menu's contents -- it only put a form in front of them.
 * The thing that actually matters, writing an order into a kitchen, is guarded
 * by a table session minted from the rotating on-site code, and that guard is
 * untouched: see place_public_order in migration 20261023000900.
 *
 * WHAT IS IN THE COOKIE -- AND WHAT IS NOT
 *
 * Only the card token, which is printed on the table in the first place. The
 * restaurant, the table label and the code window are NOT stored here, because
 * a cookie is customer-editable: every one of them is re-read from
 * public_qr_intro() on each request, which returns nothing at all unless the
 * card is live, the table is in service and the restaurant is taking orders.
 *
 * A card that has been revoked, a table that has been switched off, and a
 * restaurant that has paused ordering all fail that lookup, so the browse pass
 * dies with them -- without anyone having to visit this cookie to revoke it.
 */

import { cookies } from 'next/headers';
import { isQrToken } from '@/lib/table-session';

export const TABLE_CARD_COOKIE = 'autodine_table_card';

/**
 * Cookie options for the browse pass.
 *
 * One hour, matching the session ceiling: a guest who scanned an hour ago and
 * is still at the table is still browsing, and one who is not will be asked
 * for a code again -- which is the event that re-reads the card anyway.
 */
export const TABLE_CARD_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60,
};

/**
 * Pull a card token out of a raw cookie value.
 *
 * The value is a bare token rather than JSON: there is exactly one field, and
 * every extra field would be a field somebody could forge into a different
 * restaurant. Shape-checked here so a garbage cookie never reaches the
 * database, and re-checked by the database, which is the check that counts.
 */
export function parseCardPass(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const token = raw.trim();
  return isQrToken(token) ? token : null;
}

export async function readCardPass(): Promise<string | null> {
  const raw = (await cookies()).get(TABLE_CARD_COOKIE)?.value;
  return parseCardPass(raw);
}

/** Written by the scan handler only -- see app/t/[token]/route.ts. */
export async function saveCardPass(qrToken: string): Promise<void> {
  if (!isQrToken(qrToken)) return;
  (await cookies()).set(TABLE_CARD_COOKIE, qrToken, TABLE_CARD_COOKIE_OPTIONS);
}

export async function clearCardPass(): Promise<void> {
  (await cookies()).delete(TABLE_CARD_COOKIE);
}
