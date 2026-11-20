'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isExactCheckoutBasket } from '@/lib/checkout-attempt';
import { parseCart } from '@/lib/cart-storage';
import { codePageHref, loadTableAccess } from '@/lib/table-access';
import { THROTTLE_COOKIE, notPlacedNotice, readThrottleFlag } from '@/lib/scan-outcome';
import { decodeOrderAttempt } from '@/lib/order-attempt-result';
import { dbErrorReference } from '@/lib/db/error-reference';
import { isOrderToken } from '@/lib/db/order-status';
import { orderHref } from '@/lib/guest-orders';
import { describePlaceFailure, describeRateLimited, isTransientPlaceCode, rateLimitWaitSeconds } from '@/lib/place-order-failure';

export type PlaceResult =
  | { kind: 'placed'; code: string; href: string }
  | { kind: 'refused'; href: string; keepAttempt?: true }
  | { kind: 'unconfirmed' };

function refuse(message: string, slug?: string, code?: string, keepAttempt?: true): PlaceResult {
  const query = new URLSearchParams({ error: message });
  if (slug) query.set('s', slug);
  if (code) query.set('code', code);
  return { kind: 'refused', href: `/menu/cart?${query}`, keepAttempt };
}

/** Only the RPC decides the amount, table and whether anything was placed.
 * Keep the client's attempt key on an uncertain response. No payment happens
 * here; the guest may retry that same basket, never start a fresh attempt to
 * recover a potentially committed one. */
export async function placeOrderAction(formData: FormData): Promise<PlaceResult> {
  const slug = String(formData.get('slug') ?? '').trim();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return refuse('Ordering is not available right now.', slug, undefined, true);
  if (!slug) return refuse('We lost track of which restaurant this is for. Open the menu again.');

  const raw = String(formData.get('lines') ?? '');
  const lines = parseCart(raw);
  if (lines.length === 0) return refuse('Your cart is empty.', slug, undefined, true);
  // Unlike reading a stored cart, silently dropping a line at submission is
  // not okay. The database separately verifies the exact persisted basket.
  const submitted: unknown = JSON.parse(raw);
  if (!isExactCheckoutBasket(submitted, lines)) {
    return refuse('An item or quantity is invalid. Review your cart before ordering.', slug, undefined, true);
  }
  const access = await loadTableAccess(slug);
  const back = `/menu/checkout?s=${encodeURIComponent(slug)}`;
  if (access.status === 'browse' || (access.status === 'stale' && access.qrToken && access.slug === slug)) {
    const throttle = readThrottleFlag((await cookies()).get(THROTTLE_COOKIE)?.value);
    if (throttle.throttled) return refuse(notPlacedNotice(throttle.retryAfterSeconds), slug, undefined, true);
    if (access.qrToken) return { kind: 'refused', href: `${codePageHref(access.qrToken)}?next=${encodeURIComponent(back)}`, keepAttempt: true };
  }
  if (access.status === 'unavailable') return refuse('We could not check your table just now. Please try again, or order with staff.', slug, undefined, true);
  if (access.status !== 'verified') return refuse('Scan the QR code on your table again before ordering.', slug, undefined, true);

  // This form field is only a compare-and-stop check against stale tabs. It
  // grants nothing and never contributes a table ID to the write.
  if (!access.tableId || formData.get('table') !== access.tableId) {
    return refuse('The table changed since you opened checkout. Review your table and cart before ordering.', slug, undefined, true);
  }
  const guestToken = String(formData.get('attempt') ?? '').trim();
  if (!isOrderToken(guestToken)) return refuse('Reopen checkout to start a new order attempt.', slug, undefined, true);
  const note = String(formData.get('note') ?? '').trim().slice(0, 300) || null;
  const args = { p_slug: slug, p_lines: lines, p_note: note, p_session_token: access.session.token, p_guest_token: guestToken };
  const submit = async () => {
    try {
      const result = await supabase.rpc('place_public_order_attempt', args);
      return result.error ? { data: null, error: result.error } : decodeOrderAttempt(result.data);
    } catch {
      return { data: null, error: null };
    }
  };
  let result = await submit();
  for (const waitMs of [400, 1200]) {
    if (!isTransientPlaceCode(result.error?.code)) break;
    console.warn('[placeOrderAction] retrying', dbErrorReference(result.error));
    await new Promise(resolve => setTimeout(resolve, waitMs));
    // The very same UUID is safe even if a previous reply was interrupted.
    result = await submit();
  }

  if (result.data) return { kind: 'placed', code: result.data, href: orderHref({ code: result.data, token: guestToken }, slug) };
  const error = result.error;
  const ref = dbErrorReference(error);
  if (error?.hint === 'rate-limited') return refuse(describeRateLimited(rateLimitWaitSeconds(error.message)), slug, 'rate', true);
  console.error('[placeOrderAction] result unavailable or refused', ref);
  if (!error || ref === 'unclassified' || isTransientPlaceCode(ref) || ref === '23505' || error.hint === 'attempt-mismatch') {
    return { kind: 'unconfirmed' };
  }
  if (ref === 'PGRST202' || ref === 'PGRST203' || ref === '42501') {
    return refuse('Ordering is not switched on for this restaurant yet. Please order with staff.', slug, undefined, true);
  }
  if (ref === '42883' || ref === '42P01' || ref === '42703') {
    return refuse('This restaurant is still being set up, so the order could not be placed. Please order with staff.', slug, undefined, true);
  }
  if (ref === 'P0001') {
    // Stable reasons, not arbitrary text embedded in db or transport errors.
    if (error.hint === 'basket-refused') return refuse('A dish, portion or add-on changed or is unavailable. Review your cart before placing it again.', slug);
    if (error.hint === 'menu-refused') return refuse('Ordering for this menu or sitting is unavailable. Please check with staff.', slug);
    if (error.hint === 'table-session') return refuse('Scan your table QR code again before ordering.', slug, undefined, true);
    return refuse('We could not confirm this order. Ask staff to check before you place another.', slug, undefined, true);
  }
  return refuse(describePlaceFailure(ref), slug, ref, true);
}
