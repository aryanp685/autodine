/**
 * Counter payment actions — CASH ONLY.
 *
 * The database function is public.record_cash_payment(). It is the only way
 * money is taken at the counter, and it is atomic: payment row, order
 * settlement and audit event in one transaction. Doing those as separate
 * calls from here would leave a window where a crash between them charges
 * the guest twice, or marks a bill paid with no record of the cash.
 *
 * WHY CASH ONLY
 *
 * The payments table allows 'cash', 'card', 'upi' and 'online', but the
 * function hardcodes method = 'cash'. There is no card or UPI counterpart.
 * That is not a schema limitation, it is just unbuilt — so the UI shows
 * those two as unavailable rather than offering a button that would fail.
 * Adding them means a new function, not a new button.
 *
 * THE AMOUNT IS NEVER TAKEN FROM THE CLIENT
 *
 * record_cash_payment rejects any amount that is not exactly the outstanding
 * balance, so sending the wrong number would fail. It is still computed here
 * from orders.total_paise minus recorded payments, and the browser sends
 * only an order id and an idempotency key. Letting the page decide how much
 * it is paying would be a way to settle a bill for the wrong value the
 * moment that check is ever relaxed.
 *
 * THE IDEMPOTENCY KEY
 *
 * Generated once per attempt, in the browser, and reused if the call is
 * retried. The function uses it to recognise a repeat: a retry returns the
 * original payment instead of inserting a second one. Generating it inside
 * this action would defeat that completely, because every attempt would get
 * a fresh key.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext, CASHIER_ROLES } from '@/lib/db/staff';
import { paiseToRupees } from '@/lib/money';
import { inr } from '@/lib/demo-data';

const CASHIER_PATH = '/cashier';

export type RecordPaymentResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Settle one order in cash.
 *
 * Returns a result rather than redirecting: the queue is a client component
 * holding an optimistic copy, and it needs to know whether to commit the
 * move or roll it back.
 */
export async function recordCashPaymentAction(input: {
  orderId: string;
  /**
   * Generated once per attempt by the caller and reused on retry. A well
   * formed UUID; anything else is rejected before it reaches the database so
   * the error the cashier sees is ours, not Postgres's.
   */
  idempotencyKey: string;
}): Promise<RecordPaymentResult> {
  const orderId = input?.orderId;
  if (!orderId) return { ok: false, error: 'Missing order.' };

  const key = String(input?.idempotencyKey ?? '').trim();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(key)) {
    return { ok: false, error: 'This payment attempt is malformed. Refresh the queue and try again.' };
  }

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  const { supabase, restaurantId, slug, role } = staff;

  // Checked here as well as inside the RPC, so the cashier is told why the
  // button will not work instead of seeing a Postgres permission error.
  if (!CASHIER_ROLES.includes(role)) {
    return {
      ok: false,
      error: `Your role (${role}) cannot collect payments. Ask an owner or manager.`,
    };
  }

  // restaurant_id is bound explicitly even though RLS already scopes this:
  // it turns the read into an existence check the caller is allowed to make.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, code, total_paise, payment_status, prep_status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (orderError) {
    return { ok: false, error: `Could not read the order: ${orderError.message}` };
  }
  if (!order) {
    // Absent, or belongs to another restaurant. Same answer either way --
    // never confirm which.
    return { ok: false, error: 'That order is no longer in the queue.' };
  }

  if (order.payment_status === 'paid') {
    return { ok: false, error: `Order ${order.code} is already paid.` };
  }
  if (order.prep_status === 'cancelled') {
    return { ok: false, error: `Order ${order.code} was cancelled and cannot be settled.` };
  }

  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('amount_paise, status')
    .eq('order_id', orderId);

  if (paymentsError) {
    return { ok: false, error: `Could not read prior payments: ${paymentsError.message}` };
  }

  // Only 'recorded' money counts towards the balance. A failed or refunded
  // attempt moved no cash, so counting it would understate what is owed.
  const paid = (payments ?? [])
    .filter((p) => p.status === 'recorded')
    .reduce((sum, p) => sum + p.amount_paise, 0);

  const outstanding = Math.max(order.total_paise - paid, 0);

  if (outstanding === 0) {
    return { ok: false, error: `Order ${order.code} has no outstanding balance.` };
  }

  const { data: paymentId, error } = await supabase.rpc('record_cash_payment', {
    p_restaurant_slug: slug,
    p_order_id: orderId,
    p_amount_paise: outstanding,
    p_idempotency_key: key,
  });

  if (error) {
    // The function raises readable messages for everything a cashier can
    // actually hit -- wrong role, already settled, read-only restaurant.
    // Passing them through verbatim rather than rewriting them here, which
    // would only lose the detail that explains the fix.
    return { ok: false, error: error.message };
  }

  revalidatePath(CASHIER_PATH);

  const paidAlready = paid > 0 ? ` (${inr(paiseToRupees(paid))} was already recorded)` : '';

  // The payment id is the receipt reference. Surfacing it means a disputed
  // "I paid that" can be settled by matching it to the row in payments,
  // instead of arguing from memory.
  const ref = paymentId ? ` Ref ${String(paymentId).slice(0, 8)}.` : '';

  return {
    ok: true,
    message: `Cash ${inr(paiseToRupees(outstanding))} recorded for ${order.code}${paidAlready}.${ref}`,
  };
}
