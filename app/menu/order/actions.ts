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
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type GuestActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const ORDER_PATH = '/menu/order';

function friendly(message: string): string {
  // The functions raise P0001 with messages written for a guest -- "The
  // kitchen has already started this order. Please ask the staff." -- so those
  // pass through. Everything else is a database detail and is replaced.
  return message.trim() || 'That did not work. Please ask the staff.';
}

export async function cancelGuestOrderAction(input: {
  orderId: string;
  token: string;
}): Promise<GuestActionResult> {
  if (!input.orderId || !input.token) {
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
    if (error.code === 'P0001') return { ok: false, error: friendly(error.message) };
    console.error('[cancelGuestOrderAction] unexpected failure', error);
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
}): Promise<GuestActionResult> {
  if (!input.orderId || !input.token) {
    return { ok: false, error: 'That order could not be found.' };
  }

  const lines = input.lines
    .filter((l) => typeof l.lineId === 'string' && l.lineId !== '')
    .map((l) => ({ line_id: l.lineId, qty: Math.max(0, Math.min(99, Math.trunc(l.qty))) }));

  if (lines.length === 0) return { ok: false, error: 'There was nothing to change.' };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: 'Ordering is not available right now.' };

  const { error } = await supabase.rpc('set_order_line_quantities', {
    p_order_id: input.orderId,
    p_lines: lines,
    p_guest_token: input.token,
  });

  if (error) {
    if (error.code === 'P0001') return { ok: false, error: friendly(error.message) };
    console.error('[setGuestOrderLinesAction] unexpected failure', error);
    return { ok: false, error: 'We could not change that order. Please ask the staff.' };
  }

  revalidatePath(ORDER_PATH);

  return { ok: true, message: 'Updated. The kitchen has the new quantities.' };
}
