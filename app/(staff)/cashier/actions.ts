/**
 * Counter payment actions — cash, card and UPI.
 *
 * The database function is public.record_counter_payment() (migration 0004).
 * It records a verified tender atomically: payment, settlement and audit event
 * in one transaction. It does not take money.
 *
 * Card and UPI here are bookkeeping, not processing. Only record tender
 * already verified at the counter; this action never contacts a provider.
 * The RPC rechecks the exact outstanding balance, role, and idempotency key.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext, CASHIER_ROLES } from '@/lib/db/staff';
import { formatBillMoney } from '@/lib/bill';
import { dbErrorReference } from '@/lib/db/error-reference';
import { isCounterMethod } from '@/lib/payment-methods';
import { COUNTER_ID } from '@/lib/counter-attempt';

const CASHIER_PATH = '/cashier';

export type RecordPaymentResult =
  | { ok: true; message: string; paymentReceiptUrl?: string }
  | { ok: false; error: string; unconfirmed?: true };

const unconfirmed: RecordPaymentResult = {
  ok: false, unconfirmed: true,
  error: 'Recording could not be verified. Check the ticket and the terminal or cash before retrying. Do not collect again until reconciled.',
};

/**
 * Record a confirmed cash, card or UPI payment for one ticket.
 *
 * Returns a result rather than redirecting: the queue is a client component
 * holding an optimistic copy, and it needs to know whether to commit the
 * move or roll it back.
 */
export async function recordPaymentAction(input: {
  orderId: string;
  method: string;
  amountPaise: number;
  /**
   * Generated once per attempt by the caller and reused on retry. A well
   * formed UUID; anything else is rejected before it reaches the database so
   * the error the cashier sees is ours, not Postgres's.
   */
  idempotencyKey: string;
  /** Reconcile an attempt for a ticket no longer in the queue; never record. */
  checkOnly?: boolean;
}): Promise<RecordPaymentResult> {
  const orderId = input?.orderId;
  if (!orderId) return { ok: false, error: 'Missing order.' };

  // Validated against the same list the UI renders, so the two cannot drift.
  // Re-checked inside the RPC as well.
  if (!isCounterMethod(input.method)) {
    return { ok: false, error: 'Choose a payment method: cash, card or UPI.' };
  }
  const { method, amountPaise } = input;
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    return { ok: false, error: 'The verified tender amount is invalid. Check the saved ticket.' };
  }

  const key = String(input?.idempotencyKey ?? '').trim();
  if (!COUNTER_ID.test(key) || !COUNTER_ID.test(orderId)) {
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
    .from('orders_finance')
    .select('id, code, total_paise, payment_status, prep_status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (orderError) {
    return unconfirmed;
  }
  if (!order) {
    // Absent, or belongs to another restaurant. Same answer either way --
    // never confirm which.
    return { ok: false, error: 'That order is no longer in the queue.' };
  }

  const compositeKey = `${method}:${restaurantId}:${orderId}:${key.toLowerCase()}`;
  async function savedPayment() {
    const { data, error } = await supabase.from('payments')
      .select('id, method, amount_paise, status')
      .eq('order_id', orderId).eq('restaurant_id', restaurantId).eq('idempotency_key', compositeKey).maybeSingle();
    if (error) throw new Error('Payment ledger unavailable');
    return data;
  }
  const exactPayment = (row: Awaited<ReturnType<typeof savedPayment>>) =>
    row?.method === method && row.status === 'recorded' && Number(row.amount_paise) === amountPaise ? row.id : null;

  let paymentId: string;
  try {
    // Check the exact original record before deciding the paid ticket is no
    // longer eligible. Another tender/key is not proof this one succeeded.
    const prior = await savedPayment();
    const replay = exactPayment(prior);
    if (replay) {
      paymentId = replay;
    } else if (input.checkOnly === true) {
      return unconfirmed;
    } else if (prior || order.payment_status !== 'pending' || order.prep_status === 'cancelled') {
      return { ok: false, error: 'This payment does not match a recorded tender, or the ticket no longer accepts payment. Check the saved ticket.' };
    } else {
      // Never substitute a freshly read amount for what the cashier verified.
      // The RPC locks the sitting and rechecks this amount against the ledger.
      const result = await supabase.rpc('record_counter_payment', {
        p_restaurant_slug: slug,
        p_order_id: orderId,
        p_method: method,
        p_amount_paise: amountPaise,
        p_idempotency_key: key,
      }).then(v => v, () => null);
      if (typeof result?.data === 'string' && COUNTER_ID.test(result.data) && !result.error) {
        paymentId = result.data;
      } else {
        paymentId = exactPayment(await savedPayment()) ?? '';
        if (!paymentId) {
          const ref = dbErrorReference(result?.error);
          console.error('[counter-payment] confirmation unavailable', ref);
          if (['P0001', 'P0002', '42501', '22023'].includes(ref)) {
            return { ok: false, error: 'Payment was not recorded by this request. Check the saved ticket, balance and terminal or cash. Do not collect again until reconciled.' };
          }
          return unconfirmed;
        }
      }
    }
  } catch {
    return unconfirmed;
  }

  revalidatePath(CASHIER_PATH);

  // This lookup is supplemental. Failure cannot turn a verified payment
  // into a failed one, or substitute a payment acknowledgement for an invoice.
  let paymentReceiptUrl: string | undefined;
  try {
    const { data: receipt } = await supabase.from('restaurant_payment_receipts')
      .select('id').eq('payment_id', paymentId).eq('restaurant_id', restaurantId).maybeSingle();
    if (receipt) paymentReceiptUrl = `/invoice/payment/${receipt.id}`;
  } catch { /* the saved payment remains the source of truth */ }

  return {
    ok: true,
    message: `${method.toUpperCase()} ${formatBillMoney(amountPaise).replace(/\.00$/, '')} recorded for ${order.code}. Ref ${paymentId.slice(0, 8)}.`,
    ...(paymentReceiptUrl ? { paymentReceiptUrl } : {}),
  };
}
