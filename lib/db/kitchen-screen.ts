/**
 * Load the kitchen board.
 *
 * Returns null when Supabase is not configured, and the screen then falls
 * back to its own demo rows -- the same contract as lib/db/tables-screen.ts,
 * so the locked markup never has to change shape.
 *
 * A real query error is thrown rather than swallowed. Silently swapping a
 * live kitchen's tickets for six fictional ones is the worst possible
 * failure here: a cook would start plating food nobody ordered.
 *
 * WHAT THE BOARD SHOWS
 *
 * Only open tickets, plus anything served inside BOARD_WINDOW_HOURS. A board
 * that keeps every order since the restaurant opened fills up until the
 * newest ticket scrolls off a screen nobody scrolls. The window is a query
 * bound, not a display filter -- we never fetch what we will not show.
 *
 * SCHEMA NOTES
 *
 * `prep_status` and `payment_status` are two independent state machines and
 * are never merged. The kitchen drives prep_status only. Whether a ticket has
 * been paid is not the kitchen's concern and does not gate cooking; it is
 * surfaced as a badge so the pass can see "unpaid, collect at counter".
 *
 * `total_paise` is authoritative and is written by place_order(), never by a
 * client. We convert to rupees here for display only -- lib/money.ts is the
 * only place allowed to divide by 100.
 */

import { getStaffContextDetailed } from '@/lib/db/staff';
import { paiseToRupees } from '@/lib/money';

export type KitchenPrepState = 'new' | 'preparing' | 'ready' | 'served';

/** Mirrors the demo KitchenOrder shape so the locked markup is unchanged. */
export type KitchenTicket = {
  /**
   * Order UUID. Present only on live rows: the demo rows have no database
   * identity, and the screen renders advance buttons only when it is set, so
   * a fictional ticket can never be submitted as if it were real.
   */
  id?: string;
  /** Human-facing order code, e.g. 'A-1042'. This is what the pass calls out. */
  code: string;
  table: string;
  /** Formatted for the card. */
  placedAt: string;
  /**
   * The same instant, untouched. The board compares it against the moment the
   * screen was opened to tell "this ticket has been sitting here" from "this
   * arrived while nobody was watching", which a formatted clock time cannot
   * answer across midnight or a reload.
   */
  placedAtIso: string;
  ageMin: number;
  payment: 'paid' | 'pending' | 'failed';
  state: KitchenPrepState;
  note?: string;
  items: { qty: number; name: string; detail?: string; veg: boolean }[];
  /** Rupees, for display. Derived from total_paise. */
  total: number;
};

export type KitchenScreenData = {
  restaurantName: string;
  /**
   * Needed by the realtime subscription, which filters INSERTs to this
   * restaurant in the browser. Null on demo data.
   */
  restaurantId: string | null;
  tickets: KitchenTicket[];
  /**
   * Set when the database answered but this caller has no restaurant to show.
   * Distinct from a genuinely empty board: an empty board is good news, a
   * blocked one needs the user to do something. See lib/db/staff.ts.
   */
  blocked?: 'signed-out' | 'no-membership';
};

/**
 * How far back the board looks. Six hours covers a full dinner service
 * including the tail of it, and bounds the query regardless of how long the
 * restaurant has been using AutoDine.
 */
export const BOARD_WINDOW_HOURS = 6;

/** Tickets older than this are the kitchen running late. Minutes. */
export const LATE_AFTER_MIN = 20;
export const WARN_AFTER_MIN = 10;

/** Table label shown when an order has no table (takeaway, delivery). */
const NO_TABLE = 'Takeaway';

function minutesSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / 60_000));
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * 'refunded' reads as paid to the kitchen: money did move, and the ticket
 * should not be badged "unpaid, collect at counter" because the guest was
 * refunded after paying. The distinction belongs on the reports screen, not
 * on a board a cook reads while plating.
 */
function paymentLabel(
  status: string
): 'paid' | 'pending' | 'failed' {
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  return 'paid';
}

export async function getKitchenScreenData(): Promise<KitchenScreenData | null> {
  const staff = await getStaffContextDetailed();

  // Nested rather than `!staff.ok && reason === ...` above, because a
  // narrowed && does not carry into the next if and the union stays wide.
  if (!staff.ok) {
    // Unconfigured: the screen falls back to its demo board.
    if (staff.reason === 'unconfigured') return null;
    // Configured but this caller has no restaurant: say which, so the screen
    // can prompt instead of showing a blank board that reads as "no orders".
    return { restaurantName: '', restaurantId: null, tickets: [], blocked: staff.reason };
  }

  const { supabase, restaurantId, restaurantName } = staff.context;
  const now = Date.now();
  const cutoff = new Date(now - BOARD_WINDOW_HOURS * 3_600_000).toISOString();

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select(
      'id, code, table_id, customer_note, prep_status, payment_status, total_paise, placed_at'
    )
    .eq('restaurant_id', restaurantId)
    .neq('prep_status', 'cancelled')
    .gte('placed_at', cutoff)
    .order('placed_at', { ascending: true });

  if (ordersError) {
    throw new Error(`Could not load orders: ${ordersError.message}`);
  }

  const rows = orders ?? [];
  if (rows.length === 0) return { restaurantName, restaurantId, tickets: [] };

  const orderIds = rows.map((row) => row.id);
  const tableIds = [...new Set(rows.map((r) => r.table_id).filter(Boolean))] as string[];

  // Separate queries rather than embedded selects: lib/db/database.ts is
  // hand-written and only declares the orders -> order_items relationship, so
  // an embed like dining_tables(label) resolves to SelectQueryError and will
  // not compile. Joining in JS also lets us order items by sort_order, which
  // is the sequence the kitchen wants them plated in.
  const [itemsResult, tablesResult] = await Promise.all([
    supabase
      .from('order_items')
      .select(
        'order_id, qty, name_snapshot, variant_snapshot, addons_snapshot, is_veg, sort_order'
      )
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

  const tickets: KitchenTicket[] = rows.map((row) => {
    const items = (itemsByOrder.get(row.id) ?? []).map((item) => ({
      qty: item.qty,
      name: item.name_snapshot,
      detail:
        [item.variant_snapshot, ...(item.addons_snapshot ?? [])]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(' · ') || undefined,
      veg: item.is_veg,
    }));

    return {
      id: row.id,
      code: row.code,
      table: (row.table_id && labelByTable.get(row.table_id)) || NO_TABLE,
      placedAt: clockTime(row.placed_at),
      placedAtIso: row.placed_at,
      ageMin: minutesSince(row.placed_at, now),
      payment: paymentLabel(row.payment_status),
      state: row.prep_status as KitchenPrepState,
      note: row.customer_note?.trim() || undefined,
      items,
      total: paiseToRupees(row.total_paise),
    };
  });

  return { restaurantName, restaurantId, tickets };
}
