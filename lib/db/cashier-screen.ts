/**
 * Load the counter queue: orders still awaiting payment.
 *
 * Returns null when Supabase is not configured, and the screen then falls
 * back to its own demo rows -- the same contract as the rest of lib/db.
 *
 * A real query error is thrown. Swapping a live till's queue for fictional
 * orders would have someone take real cash against a bill that does not
 * exist.
 *
 * WHAT COUNTS AS "AWAITING PAYMENT"
 *
 * payment_status = 'pending'. Not 'failed': a failed online attempt is a
 * problem for the guest to retry on their own phone, and putting it in the
 * counter queue invites double-charging someone whose bank already declined
 * them once. Getting that wrong is a refund, a complaint, and a lost
 * customer, so it stays out.
 *
 * MONEY
 *
 * `total_paise` is authoritative. The amount a cashier types in is rupees
 * (that is what the guest hands over), so the comparison happens in paise on
 * both sides -- see recordPayment in app/cashier/actions.ts. Never compare a
 * rupee float against an integer paise total.
 */

import { getStaffContextDetailed } from '@/lib/db/staff';
import { clockTimeInZone } from './time';

// Re-exported rather than redefined: the constant lives in a module with no
// database imports so the client can use it. See lib/payment-methods.ts.
export { COUNTER_METHODS, isCounterMethod } from '@/lib/payment-methods';
export type { CounterMethod } from '@/lib/payment-methods';

import { paiseToRupees } from '@/lib/money';

/** Mirrors the demo counterQueue row so the locked markup is unchanged. */
export type CounterOrder = {
  /** Order UUID. Absent on demo rows; payment is only offered when present. */
  id?: string;
  /** Human-facing order code, e.g. 'A-1041'. */
  code: string;
  table: string;
  at: string;
  state: string;
  /** Rupees, for display. Derived from total_paise. */
  total: number;
  /**
   * What is still owed: total minus anything already recorded. Rupees.
   *
   * This is the amount a payment must be made for, NOT `total`.
   * record_cash_payment rejects any amount that is not exactly the
   * outstanding balance, so settling a partly-paid order for its full total
   * would fail with a Postgres error the cashier cannot act on.
   */
  outstanding: number;
  /** Already recorded against this order. Rupees. */
  paid: number;
  /** One-line summary of the ticket, e.g. '2 × Biryani · 3 × Roti'. */
  items: string;
};

export type CashierScreenData = {
  restaurantName: string;
  queue: CounterOrder[];
  /** Set when the caller has no restaurant to show. See lib/db/staff.ts. */
  blocked?: 'signed-out' | 'no-membership';
};

/** How far back the queue looks for unpaid tickets. */
export const QUEUE_WINDOW_HOURS = 24;

const NO_TABLE = 'Takeaway';

/** Human label for a prep state, matching the wording used on the board. */
const PREP_LABEL: Record<string, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

export async function getCashierScreenData(): Promise<CashierScreenData | null> {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return { restaurantName: '', queue: [], blocked: staff.reason };
  }

  const { supabase, restaurantId, restaurantName, timezone } = staff.context;
  const cutoff = new Date(Date.now() - QUEUE_WINDOW_HOURS * 3_600_000).toISOString();

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, code, table_id, prep_status, total_paise, placed_at')
    .eq('restaurant_id', restaurantId)
    .eq('payment_status', 'pending')
    .neq('prep_status', 'cancelled')
    .gte('placed_at', cutoff)
    .order('placed_at', { ascending: true });

  if (ordersError) {
    throw new Error(`Could not load orders: ${ordersError.message}`);
  }

  const rows = orders ?? [];
  if (rows.length === 0) return { restaurantName, queue: [] };

  const orderIds = rows.map((row) => row.id);
  const tableIds = [...new Set(rows.map((r) => r.table_id).filter(Boolean))] as string[];

  // payments is read so the queue can show what is genuinely still owed.
  // An order can be payment_status='pending' with a partial payment already
  // recorded against it, and record_cash_payment will only accept the exact
  // outstanding balance -- so showing the full total would be a lie that
  // fails at the till.
  const [itemsResult, tablesResult, paymentsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('order_id, qty, name_snapshot, sort_order')
      .in('order_id', orderIds)
      .order('sort_order', { ascending: true }),
    tableIds.length
      ? supabase.from('dining_tables').select('id, label').in('id', tableIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('payments').select('order_id, amount_paise, status').in('order_id', orderIds),
  ]);

  if (itemsResult.error) {
    throw new Error(`Could not load order items: ${itemsResult.error.message}`);
  }
  if (tablesResult.error) {
    throw new Error(`Could not load tables: ${tablesResult.error.message}`);
  }
  if (paymentsResult.error) {
    throw new Error(`Could not load payments: ${paymentsResult.error.message}`);
  }

  // Only 'recorded' money counts. A failed or refunded attempt did not move
  // any cash, so counting it would understate what the guest still owes.
  const paidByOrder = new Map<string, number>();
  for (const p of paymentsResult.data ?? []) {
    if (p.status !== 'recorded') continue;
    paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) ?? 0) + p.amount_paise);
  }

  const itemsByOrder = new Map<string, typeof itemsResult.data>();
  for (const item of itemsResult.data ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  const labelByTable = new Map<string, string>();
  for (const table of tablesResult.data ?? []) {
    labelByTable.set(table.id, table.label);
  }

  const queue: CounterOrder[] = rows.map((row) => {
    const lines = (itemsByOrder.get(row.id) ?? []).map(
      (item) => `${item.qty} × ${item.name_snapshot}`
    );

    return {
      id: row.id,
      code: row.code,
      table: (row.table_id && labelByTable.get(row.table_id)) || NO_TABLE,
      at: clockTimeInZone(timezone, row.placed_at),
      state: PREP_LABEL[row.prep_status] ?? row.prep_status,
      total: paiseToRupees(row.total_paise),
      // Clamped at zero: an overpaid order owes nothing, and a negative
      // "amount due" would render as a payment the cashier cannot collect.
      paid: paiseToRupees(Math.min(paidByOrder.get(row.id) ?? 0, row.total_paise)),
      outstanding: paiseToRupees(Math.max(row.total_paise - (paidByOrder.get(row.id) ?? 0), 0)),
      items: lines.join(' · ') || 'No items recorded',
    };
  });

  return { restaurantName, queue };
}
