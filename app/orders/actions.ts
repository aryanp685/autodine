/**
 * Cancelling a ticket from the staff side.
 *
 * Guest and staff cancellation are the same database function --
 * public.cancel_order() -- because the rules about money and about served food
 * must not exist in two places. What differs is who the caller is and what
 * they are allowed to do:
 *
 *   guest   the guest token, ten minutes, only while the kitchen has not
 *           started
 *   staff   Owner, Manager or Cashier membership in this restaurant
 *
 * Kitchen is deliberately excluded from ordinary cancellation because the
 * refusal depends on payment state; that action would otherwise disclose
 * whether a ticket was paid. Kitchen can still reject an unconfirmed held
 * table through its separate, nonfinancial action. Both paths refuse a paid
 * order because this build has no refund path.
 *
 * Nothing here trusts the browser for identity. The restaurant comes from the
 * signed-in session, the order is checked against it before the call, and the
 * function re-checks the membership itself.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { CASHIER_ROLES, getStaffContext } from '@/lib/db/staff';

export type CancelTicketResult = { ok: true; message: string } | { ok: false; error: string };

/** Every screen that shows a ticket, so none of them keeps a dead one. */
const SCREENS = ['/kitchen', '/cashier', '/dashboard/orders', '/dashboard'];

export async function cancelStaffOrderAction(input: {
  orderId: string;
  reason?: string;
}): Promise<CancelTicketResult> {
  const orderId = input?.orderId;
  if (!orderId) return { ok: false, error: 'Missing order.' };

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  const { supabase, restaurantId, role } = staff;
  if (!CASHIER_ROLES.includes(role)) {
    return { ok: false, error: 'Only an owner, manager or cashier can cancel an order.' };
  }

  // The database-backed finance projection is independently role-scoped.
  // It lets this action return useful cashier feedback without opening
  // payment_status to the Kitchen role through the base table.
  const { data: order, error: readError } = await supabase
    .from('orders_finance')
    .select('id, prep_status, payment_status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (readError) return { ok: false, error: `Could not read the ticket: ${readError.message}` };
  if (!order) return { ok: false, error: 'That ticket is no longer on the board.' };

  if (order.prep_status === 'cancelled') {
    return { ok: true, message: 'This order was already cancelled.' };
  }
  if (order.payment_status !== 'pending') {
    return {
      ok: false,
      error: 'This order has already been paid. A refund has to be handled separately.',
    };
  }
  if (order.prep_status === 'served') {
    return { ok: false, error: 'This order has already been served.' };
  }

  const { error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: input.reason?.trim() ? input.reason.trim().slice(0, 120) : 'staff',
  });

  if (error) {
    if (error.code === 'P0001') return { ok: false, error: error.message };
    console.error('[cancelStaffOrderAction] unexpected failure', error);
    return { ok: false, error: 'We could not cancel that order. Please try again.' };
  }

  for (const path of SCREENS) revalidatePath(path);

  return { ok: true, message: 'Order cancelled. The kitchen has been told.' };
}
