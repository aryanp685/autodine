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
  /** One-line summary of the ticket, e.g. '2 × Biryani · 3 × Roti'. */
  items: string;
};

export type CashierScreenData = {
  restaurantName: string;
  queue: CounterOrder[];
  /** Set when the caller has no restaurant to show. See lib/db/staff.ts. */
  blocked?: 'signed-out' | 'no-membership';
};

/** Payment methods the counter can record. Matches the payments.method check. */
export const COUNTER_METHODS = ['cash', 'card', 'upi'] as const;
export type CounterMethod = (typeof COUNTER_METHODS)[number];

/** How far back the queue looks for unpaid tickets. */
export const QUEUE_WINDOW_HOURS = 24;

const NO_TABLE = 'Takeaway';

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

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

  const { supabase, restaurantId, restaurantName } = staff.context;
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

  const [itemsResult, tablesResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('order_id, qty, name_snapshot, sort_order')
      .in('order_id', orderIds)
      .order('sort_order', { ascending: true }),
    tableIds.length
      ? supabase.from('dining_tables').select('id, label').in('id', tableIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (itemsResult.error) {
    throw new Error(`Could not load order items: ${itemsResult.error.message}`);
  }
  if (tablesResult.error) {
    throw new Error(`Could not load tables: ${tablesResult.error.message}`);
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
      at: clockTime(row.placed_at),
      state: PREP_LABEL[row.prep_status] ?? row.prep_status,
      total: paiseToRupees(row.total_paise),
      items: lines.join(' · ') || 'No items recorded',
    };
  });

  return { restaurantName, queue };
}
