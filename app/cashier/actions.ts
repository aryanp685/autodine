/**
 * Counter payment actions.
 *
 * Recording a payment is two writes -- a row in payments, and settling the
 * order -- and they must both happen or neither. That atomicity lives in the
 * database, in public.record_counter_payment() (migration 0003), NOT here.
 * Doing them as two supabase calls from this file would leave a window where
 * a crash between them takes the guest's money twice, or marks a bill paid
 * with no record of the cash.
 *
 * Money: the cashier types RUPEES, because that is what a guest hands over.
 * It is converted to integer paise once, here, with rupeesToPaise() from
 * lib/money.ts, and only paise crosses into the database. Comparing a rupee
 * float against a paise total would be the bug this exists to prevent.
 *
 * Authorisation is inside the RPC: it checks the order's restaurant against
 * public.current_restaurant_ids() before touching anything, so a forged order
 * id is rejected with 'Order not found.' rather than settled.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext } from '@/lib/db/staff';
import { rupeesToPaise } from '@/lib/money';
import { COUNTER_METHODS, type CounterMethod } from '@/lib/db/cashier-screen';

const CASHIER_PATH = '/cashier';

export type RecordPaymentResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Settle one order at the counter.
 *
 * Returns a result rather than redirecting: the queue is a client component
 * with an optimistic copy and it needs to know whether to commit or roll
 * back, and a redirect would wipe the amount field mid-shift.
 */
export async function recordPaymentAction(input: {
  orderId: string;
  method: string;
  /** What the guest handed over, in RUPEES. Converted to paise here. */
  amountReceived: string | number;
}): Promise<RecordPaymentResult> {
  const orderId = input?.orderId;
  if (!orderId) return { ok: false, error: 'Missing order.' };

  // Method is validated against the same array the UI renders, so the two can
  // never drift. It is re-checked by the RPC as well.
  const method = COUNTER_METHODS.find((m) => m === input.method) as
    | CounterMethod
    | undefined;
  if (!method) {
    return { ok: false, error: 'Choose a payment method: cash, card or UPI.' };
  }

  const rupees = Number(input.amountReceived);
  if (!Number.isFinite(rupees) || rupees < 0) {
    return { ok: false, error: 'Enter a valid amount received.' };
  }

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  // The one place rupees become paise. roundPaise inside rupeesToPaise uses
  // half-up, which is what Indian invoicing software does.
  const amountPaise = rupeesToPaise(rupees);

  const { error } = await staff.supabase.rpc('record_counter_payment', {
    p_order_id: orderId,
    p_method: method,
    p_amount_paise: amountPaise,
  });

  if (error) {
    // The RPC raises readable messages for the cases a cashier can actually
    // hit (already paid, amount short). Surface them verbatim -- rewriting
    // them here would only lose the detail.
    return { ok: false, error: error.message };
  }

  revalidatePath(CASHIER_PATH);

  // Change is computed on what was handed over minus the order total. The
  // RPC guarantees amount >= total, so this cannot go negative.
  return { ok: true, message: `Payment recorded via ${method.toUpperCase()}.` };
}
