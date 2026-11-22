/**
 * Counter payment actions — cash, card and UPI.
 *
 * The database function is public.record_counter_payment() (migration 0004).
 * It is the only way money is taken at the counter, and it is atomic: payment
 * row, order settlement and audit event in one transaction. Doing those as
 * separate calls from here would leave a window where a crash between them
 * charges the guest twice, or marks a bill paid with no record of the cash.
 *
 * WHY NOT 'ONLINE'
 *
 * The payments table allows it, but the function rejects it. An online
 * payment is initiated by the guest through a provider and arrives by webhook
 * carrying a provider reference; letting a cashier record one would put a row
 * in payments with no provider, no settlement and no refund path behind it.
 * That needs its own function written against the provider's contract.
 *
 * WHAT "CARD" AND "UPI" MEAN HERE
 *
 * Bookkeeping, not processing. The guest pays on a separate terminal or by
 * scanning a code, and the cashier records that it happened. No card is read
 * and no provider is contacted at any point in this file.
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
 *
 * The method is folded into the key by the database, so changing method and
 * retrying is treated as a different payment rather than a replay of the
 * previous one.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext, CASHIER_ROLES } from '@/lib/db/staff';
import { paiseToRupees } from '@/lib/money';
import { inr } from '@/lib/demo-data';
import { isCounterMethod, isSplitMethod } from '@/lib/payment-methods';

const CASHIER_PATH = '/cashier';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRupeesToPaise(raw: unknown, label: string): { ok: true; paise: number } | { ok: false; error: string } {
  if (raw === '' || raw === null || raw === undefined) return { ok: true, paise: 0 };
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false, error: `${label} cannot be negative or invalid.` };
  }
  const paise = Math.round(num * 100);
  if (!Number.isSafeInteger(paise)) {
    return { ok: false, error: `${label} is out of range.` };
  }
  return { ok: true, paise };
}

export type RecordPaymentResult =
  | { ok: true; message: string; paymentReceiptUrl?: string }
  | { ok: false; error: string };

/**
 * Settle one order in cash.
 *
 * Returns a result rather than redirecting: the queue is a client component
 * holding an optimistic copy, and it needs to know whether to commit the
 * move or roll it back.
 */
export async function recordPaymentAction(input: {
  orderId: string;
  method: string;
  /**
   * Generated once per attempt by the caller and reused on retry. A well
   * formed UUID; anything else is rejected before it reaches the database so
   * the error the cashier sees is ours, not Postgres's.
   */
  idempotencyKey: string;
}): Promise<RecordPaymentResult> {
  const orderId = input?.orderId;
  if (!orderId) return { ok: false, error: 'Missing order.' };

  // Validated against the same list the UI renders, so the two cannot drift.
  // Re-checked inside the RPC as well.
  if (!isCounterMethod(input.method)) {
    return { ok: false, error: 'Choose a payment method: cash, card or UPI.' };
  }
  const method = input.method;

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
    .from('orders_finance')
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

  const { data: paymentId, error } = await supabase.rpc('record_counter_payment', {
    p_restaurant_slug: slug,
    p_order_id: orderId,
    p_method: method,
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

  // If this order belongs to a session that already has an issued invoice,
  // the database trigger created a separate immutable payment acknowledgement.
  // A missing link must not turn a successful payment into an apparent failure.
  let paymentReceiptUrl: string | undefined;
  if (typeof paymentId === 'string') {
    const { data: receipt, error: receiptError } = await supabase
      .from('restaurant_payment_receipts')
      .select('id')
      .eq('payment_id', paymentId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (!receiptError && receipt) paymentReceiptUrl = `/invoice/payment/${receipt.id}`;
  }

  const paidAlready = paid > 0 ? ` (${inr(paiseToRupees(paid))} was already recorded)` : '';

  // The payment id is the receipt reference. Surfacing it means a disputed
  // "I paid that" can be settled by matching it to the row in payments,
  // instead of arguing from memory.
  const ref = paymentId ? ` Ref ${String(paymentId).slice(0, 8)}.` : '';

  return {
    ok: true,
    message: `${method.toUpperCase()} ${inr(paiseToRupees(outstanding))} recorded for ${order.code}${paidAlready}.${ref}`,
    ...(paymentReceiptUrl ? { paymentReceiptUrl } : {}),
  };
}

export type CreateCounterOrderResult =
  | {
      ok: true;
      message: string;
      orderId?: string;
      code?: string;
      placedAt?: string;
      deduplicated?: boolean;
    }
  | { ok: false; error: string };

export async function createCounterOrderAction(input: {
  channel: 'dine_in' | 'takeaway' | 'delivery';
  tableId?: string | null;
  lines: Array<{ itemId: string; variantId?: string | null; qty: number }>;
  note?: string;
  customerName?: string;
  customerPhone?: string;
  idempotencyKey?: string | null;
}): Promise<CreateCounterOrderResult> {
  if (input.channel !== 'dine_in' && input.channel !== 'takeaway' && input.channel !== 'delivery') {
    return { ok: false, error: 'Choose Dine-in, Takeaway, or Delivery.' };
  }
  if (input.channel === 'dine_in' && (!input.tableId || !UUID_RE.test(input.tableId))) {
    return { ok: false, error: 'Select a valid table for a dine-in counter order.' };
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: 'Add at least one dish before creating the order.' };
  }

  const cleanIdempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : null;
  if (cleanIdempotencyKey && !UUID_RE.test(cleanIdempotencyKey)) {
    return { ok: false, error: 'Invalid counter order attempt key. Please retry from the queue.' };
  }

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }
  const { supabase, restaurantId, role } = staff;
  if (!CASHIER_ROLES.includes(role) && role !== 'kitchen' && role !== 'waiter') {
    return { ok: false, error: `Your role (${role}) cannot create counter orders.` };
  }

  const payload = input.lines
    .filter((l) => UUID_RE.test(l.itemId) && Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= 99)
    .map((l) => ({
      item_id: l.itemId,
      ...(l.variantId && UUID_RE.test(l.variantId) ? { variant_id: l.variantId } : {}),
      qty: l.qty,
    }));
  if (payload.length !== input.lines.length) {
    return { ok: false, error: 'One or more order lines are invalid.' };
  }

  const { data, error } = await supabase.rpc('create_counter_order', {
    p_restaurant_id: restaurantId,
    p_channel: input.channel,
    p_table_id: input.channel === 'dine_in' ? (input.tableId ?? null) : null,
    p_lines: payload,
    p_note: input.note?.trim() || null,
    p_customer_name: input.customerName?.trim() || null,
    p_customer_phone: input.customerPhone?.trim() || null,
    p_idempotency_key: cleanIdempotencyKey,
  });

  if (error) return { ok: false, error: error.message };

  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const code = typeof obj.code === 'string' ? obj.code : '';
  const orderId = typeof obj.order_id === 'string' ? obj.order_id : undefined;
  const placedAt = typeof obj.placed_at === 'string' ? obj.placed_at : undefined;
  const deduplicated = obj.deduplicated === true;
  const totalPaise = typeof obj.total_paise === 'number' ? obj.total_paise : 0;

  revalidatePath(CASHIER_PATH);
  revalidatePath('/kitchen');
  revalidatePath('/dashboard/orders');

  const shortId = orderId ? ` · ID ${orderId.slice(0, 8).toUpperCase()}` : '';
  const suffix = deduplicated ? ' (recovered existing order — no duplicate)' : '';

  return {
    ok: true,
    orderId,
    code,
    placedAt,
    deduplicated,
    message: `Confirmed ${input.channel.replace('_', '-')} order ${code} (${inr(paiseToRupees(totalPaise))})${shortId}${suffix}.`,
  };
}

export async function applyBillingAdjustmentAction(input: {
  orderId: string;
  discountRupees?: string | number;
  discountReason?: string;
  serviceChargeRupees?: string | number;
  packagingChargeRupees?: string | number;
  deliveryChargeRupees?: string | number;
  roundOff?: boolean;
  isComplimentary?: boolean;
  complimentaryReason?: string;
}): Promise<RecordPaymentResult> {
  if (!input?.orderId || !UUID_RE.test(input.orderId)) {
    return { ok: false, error: 'Missing or invalid order.' };
  }

  const disc = parseRupeesToPaise(input.discountRupees ?? 0, 'Discount');
  if (!disc.ok) return { ok: false, error: disc.error };
  const svc = parseRupeesToPaise(input.serviceChargeRupees ?? 0, 'Service charge');
  if (!svc.ok) return { ok: false, error: svc.error };
  const pkg = parseRupeesToPaise(input.packagingChargeRupees ?? 0, 'Packaging charge');
  if (!pkg.ok) return { ok: false, error: pkg.error };
  const del = parseRupeesToPaise(input.deliveryChargeRupees ?? 0, 'Delivery charge');
  if (!del.ok) return { ok: false, error: del.error };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot adjust bills.` };
  }

  const { data, error } = await staff.supabase.rpc('apply_order_billing_adjustment', {
    p_order_id: input.orderId,
    p_discount_paise: disc.paise,
    p_discount_reason: input.discountReason?.trim() || null,
    p_service_charge_paise: svc.paise,
    p_packaging_charge_paise: pkg.paise,
    p_delivery_charge_paise: del.paise,
    p_round_off: Boolean(input.roundOff),
    p_is_complimentary: Boolean(input.isComplimentary),
    p_complimentary_reason: input.complimentaryReason?.trim() || null,
  });

  if (error) return { ok: false, error: error.message };

  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const totalPaise = typeof obj.total_paise === 'number' ? obj.total_paise : 0;

  revalidatePath(CASHIER_PATH);
  revalidatePath(`/bill/${input.orderId}`);
  return {
    ok: true,
    message: obj.is_complimentary
      ? 'Order marked complimentary (₹0 payable).'
      : `Bill updated — net payable ${inr(paiseToRupees(totalPaise))}.`,
  };
}

export async function recordSplitPaymentAction(input: {
  orderId: string;
  splits: Array<{ method: string; amountRupees: string | number; splitLabel?: string }>;
  idempotencyKey: string;
}): Promise<RecordPaymentResult> {
  if (!input?.orderId || !UUID_RE.test(input.orderId)) {
    return { ok: false, error: 'Missing or invalid order.' };
  }
  const key = String(input?.idempotencyKey ?? '').trim();
  if (!UUID_RE.test(key)) {
    return { ok: false, error: 'This payment attempt is malformed. Refresh and try again.' };
  }
  if (!Array.isArray(input.splits) || input.splits.length === 0 || input.splits.length > 10) {
    return { ok: false, error: 'Enter between 1 and 10 split payment entries.' };
  }

  const parsedSplits: Array<{ method: string; amount_paise: number; split_label?: string }> = [];
  for (const s of input.splits) {
    if (!isSplitMethod(s.method)) {
      return { ok: false, error: 'Choose Cash, UPI, Card, or Other for every split line.' };
    }
    const amt = parseRupeesToPaise(s.amountRupees, 'Split amount');
    if (!amt.ok || amt.paise <= 0) {
      return { ok: false, error: amt.ok ? 'Every split amount must be greater than ₹0.' : amt.error };
    }
    parsedSplits.push({
      method: s.method,
      amount_paise: amt.paise,
      ...(s.splitLabel?.trim() ? { split_label: s.splitLabel.trim().slice(0, 60) } : {}),
    });
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot collect payments.` };
  }

  const { data, error } = await staff.supabase.rpc('record_split_counter_payments', {
    p_order_id: input.orderId,
    p_splits: parsedSplits,
    p_idempotency_key: key,
  });

  if (error) return { ok: false, error: error.message };

  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const outstandingPaise = typeof obj.outstanding_paise === 'number' ? obj.outstanding_paise : 0;
  const totalSplitPaise = parsedSplits.reduce((sum, s) => sum + s.amount_paise, 0);

  revalidatePath(CASHIER_PATH);
  revalidatePath('/dashboard/orders');
  return {
    ok: true,
    message:
      outstandingPaise === 0
        ? `Split payment ${inr(paiseToRupees(totalSplitPaise))} recorded — bill settled.`
        : `Partial payment ${inr(paiseToRupees(totalSplitPaise))} recorded — ${inr(paiseToRupees(outstandingPaise))} still due.`,
  };
}

export async function recordRefundAction(input: {
  paymentId: string;
  amountRupees: string | number;
  reason: string;
  idempotencyKey: string;
}): Promise<RecordPaymentResult> {
  if (!input?.paymentId || !UUID_RE.test(input.paymentId)) {
    return { ok: false, error: 'Missing or invalid payment reference.' };
  }
  const key = String(input?.idempotencyKey ?? '').trim();
  if (!UUID_RE.test(key)) {
    return { ok: false, error: 'Malformed refund request key. Try again.' };
  }
  const amt = parseRupeesToPaise(input.amountRupees, 'Refund amount');
  if (!amt.ok || amt.paise <= 0) {
    return { ok: false, error: amt.ok ? 'Refund amount must be greater than ₹0.' : amt.error };
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length < 3) {
    return { ok: false, error: 'Enter a refund reason (at least 3 characters).' };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (staff.role !== 'owner' && staff.role !== 'manager') {
    return { ok: false, error: 'Only an owner or manager can issue refunds.' };
  }

  const { error } = await staff.supabase.rpc('record_counter_refund', {
    p_payment_id: input.paymentId,
    p_amount_paise: amt.paise,
    p_reason: reason.slice(0, 160),
    p_idempotency_key: key,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(CASHIER_PATH);
  revalidatePath('/dashboard/reports');
  return {
    ok: true,
    message: `Refund of ${inr(paiseToRupees(amt.paise))} recorded (${reason}).`,
  };
}

export async function applyCouponAction(input: {
  orderId: string;
  code: string;
}): Promise<RecordPaymentResult> {
  if (!input?.orderId || !UUID_RE.test(input.orderId)) {
    return { ok: false, error: 'Missing or invalid order.' };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot apply promo codes.` };
  }

  const code = (input.code ?? '').trim().toUpperCase();
  const { data, error } = await staff.supabase.rpc('apply_coupon_to_order', {
    p_order_id: input.orderId,
    p_code: code || null,
  });

  if (error) return { ok: false, error: error.message };

  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const totalPaise = typeof obj.total_paise === 'number' ? obj.total_paise : 0;
  const discountPaise = typeof obj.discount_paise === 'number' ? obj.discount_paise : 0;

  revalidatePath(CASHIER_PATH);
  revalidatePath(`/bill/${input.orderId}`);
  return {
    ok: true,
    message: code
      ? `Applied promo ${code} (-${inr(paiseToRupees(discountPaise))}) — net payable ${inr(paiseToRupees(totalPaise))}.`
      : `Removed promo code — net payable ${inr(paiseToRupees(totalPaise))}.`,
  };
}

export async function splitBillAction(input: {
  sourceSessionId: string;
  orderIds?: string[];
  itemSplits?: Array<{ orderItemId: string; quantity: number }>;
}): Promise<RecordPaymentResult & { newSessionId?: string; newOrderCode?: string }> {
  if (!input?.sourceSessionId || !UUID_RE.test(input.sourceSessionId)) {
    return { ok: false, error: 'This sitting cannot be split — refresh the queue and try again.' };
  }

  const orderIds = Array.isArray(input.orderIds)
    ? input.orderIds.filter((id) => UUID_RE.test(id))
    : undefined;
  const itemSplits = Array.isArray(input.itemSplits)
    ? input.itemSplits
        .filter((s) => UUID_RE.test(s.orderItemId) && Number.isInteger(s.quantity) && s.quantity > 0)
        .map((s) => ({ order_item_id: s.orderItemId, quantity: s.quantity }))
    : undefined;

  if ((!orderIds || orderIds.length === 0) && (!itemSplits || itemSplits.length === 0)) {
    return { ok: false, error: 'Select at least one order or item quantity to move to a separate bill.' };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot split bills.` };
  }

  const { data, error } = await staff.supabase.rpc('split_order_session_for_billing', {
    p_source_session_id: input.sourceSessionId,
    p_order_ids: orderIds && orderIds.length > 0 ? orderIds : null,
    p_item_splits: itemSplits && itemSplits.length > 0 ? itemSplits : null,
  });

  if (error) return { ok: false, error: error.message };

  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const newSessionId = typeof obj.new_session_id === 'string' ? obj.new_session_id : undefined;
  const newOrderCode = typeof obj.new_order_code === 'string' ? obj.new_order_code : undefined;
  const splitLabel = typeof obj.split_label === 'string' ? obj.split_label : 'Split bill';

  revalidatePath(CASHIER_PATH);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return {
    ok: true,
    newSessionId,
    newOrderCode,
    message: newOrderCode
      ? `Created separate bill ${newOrderCode} (${splitLabel}).`
      : `Moved selected orders into ${splitLabel}.`,
  };
}
