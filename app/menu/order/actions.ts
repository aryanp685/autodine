/**
 * Changing or cancelling an order from the guest's own screen.
 *
 * These are the two things a diner can do to an order after placing it, and
 * both are decided by the database, not here:
 *
 *   - public.set_order_line_quantities() re-reads the order's own price
 *     snapshots, so a cart the browser edited cannot invent a cheaper bill.
 *   - public.cancel_order() checks the token, the ten minute window and
 *     whether the kitchen has started.
 *
 * What this file does is the part the database cannot: turn a failed call
 * into one sentence a guest can act on, without leaking the shape of the
 * schema.
 *
 * Neither action redirects. The screen keeps the guest where they are, shows
 * what happened, and refreshes -- a redirect after "cancel" would land on a
 * page that looks like a brand new order.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { revisionNumber } from '@/lib/realtime-revisions';
import { orderRefusal } from '@/lib/db/order-refusals';
import { isOrderToken } from '@/lib/db/order-status';
import { dbErrorReference } from '@/lib/db/error-reference';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type GuestActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const ORDER_PATH = '/menu/order';

export async function cancelGuestOrderAction(input: {
  orderId: string;
  token: string;
}): Promise<GuestActionResult> {
  if (!isOrderToken(input?.orderId) || !isOrderToken(input?.token)) {
    return { ok: false, error: 'That order could not be found.' };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: 'Ordering is not available right now.' };

  const { data, error } = await supabase.rpc('cancel_order', {
    p_order_id: input.orderId,
    p_guest_token: input.token,
    p_reason: 'guest',
  });

  if (error) {
    const refusal = orderRefusal(error);
    if (refusal) return { ok: false, error: refusal };
    console.error('[cancelGuestOrderAction] unexpected failure', dbErrorReference(error));
    return { ok: false, error: 'We could not cancel that order. Please ask the staff.' };
  }

  const already =
    data && typeof data === 'object' && (data as { already?: unknown }).already === true;

  revalidatePath(ORDER_PATH);

  return {
    ok: true,
    message: already
      ? 'This order is already cancelled.'
      : 'Order cancelled. The kitchen has been told.',
  };
}

export async function setGuestOrderLinesAction(input: {
  orderId: string;
  token: string;
  lines: { lineId: string; qty: number }[];
  revision?: string;
}): Promise<GuestActionResult> {
  if (!isOrderToken(input?.orderId) || !isOrderToken(input?.token)) {
    return { ok: false, error: 'That order could not be found.' };
  }

  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100 ||
      input.lines.some(line => !isOrderToken(line?.lineId) || !Number.isSafeInteger(line.qty) || line.qty < 0 || line.qty > 99)) {
    return { ok: false, error: 'Review the quantities before trying again.' };
  }
  const lines = input.lines.map(line => ({ line_id: line.lineId, qty: line.qty }));

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: 'Ordering is not available right now.' };

  if (typeof input.revision !== 'string' || revisionNumber(input.revision) === null) {
    return { ok: false, error: 'Reopen the order to review its latest quantities before editing.' };
  }

  const { data, error } = await supabase.rpc('set_guest_order_lines_at_version', {
    p_version: input.revision,
    p_order_id: input.orderId,
    p_lines: lines,
    p_guest_token: input.token,
  });

  if (error) {
    const refusal = orderRefusal(error);
    if (refusal) return { ok: false, error: refusal };
    console.error('[setGuestOrderLinesAction] unexpected failure', dbErrorReference(error));
    return { ok: false, error: 'We could not change that order. Please ask the staff.' };
  }

  if (data !== 'updated') return { ok: false, error: data === 'stale'
    ? 'This order changed on another screen. Review the saved quantities before editing again.'
    : 'That order could not be found.' };

  revalidatePath(ORDER_PATH);

  return { ok: true, message: 'Updated. The kitchen has the new quantities.' };
}
