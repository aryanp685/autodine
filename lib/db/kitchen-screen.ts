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

import { getStaffContextDetailed, KITCHEN_ROLES } from '@/lib/db/staff';
import { paiseToRupees } from '@/lib/money';
import { clockTimeInZone } from './time';
import type { MemberRole } from './database';

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
  items: {
    qty: number;
    name: string;
    /**
     * Portion and add-ons together, as the voice reads them: "Half · Extra
     * cheese". Kept as one string because lib/announce turns it into Hindi by
     * splitting it again, and because every ticket printed before add-ons
     * existed already carries this shape.
     */
    detail?: string;
    /** The portion alone, for the ticket card. */
    portion?: string;
    /**
     * The add-ons alone, for the ticket card. Shown as tags attached to the
     * dish rather than as part of its name: a cook reads the dish first and
     * its instructions second, and "Half · Extra cheese" run together reads
     * as one long dish name.
     */
    addons?: string[];
    veg: boolean;
    /** The owner's written pronunciation, when there is one. */
    spoken?: string | null;
  }[];
  /** Rupees, for display. Derived from total_paise. */
  total: number;
};

/**
 * A ticket cancelled recently, so the board can say so out loud.
 *
 * The board cannot work this out by comparing payloads: a ticket that leaves
 * the list may have been cancelled at the counter, cancelled by the guest, or
 * served from a phone. Announcing the wrong one of those is worse than saying
 * nothing, so the query names cancellations explicitly.
 */
export type CancelledTicket = {
  id: string;
  table: string;
  /** ISO instant of the cancellation. */
  at: string;
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
   * Cancelled in the last fifteen minutes. The board announces new entries
   * once each -- a cook who has a pan on needs to hear a stop, not notice that
   * a card quietly vanished.
   */
  cancelled: CancelledTicket[];
  /**
   * Set when the database answered but this caller has no restaurant to show.
   * Distinct from a genuinely empty board: an empty board is good news, a
   * blocked one needs the user to do something. See lib/db/staff.ts.
   */
  blocked?: 'signed-out' | 'no-membership';
  /** The caller's role, so the board can explain itself in their words. */
  role: MemberRole | null;
  /**
   * Whether this caller may move tickets. False for two unrelated reasons --
   * the role, or the restaurant being read-only -- and `cannotAdvance` says
   * which, because "ask an owner" and "the plan has ended" are different
   * instructions.
   *
   * The database is still the authority: this only decides whether to show a
   * button that would be refused.
   */
  canAdvance: boolean;
  cannotAdvance?: 'role' | 'plan';
};

/**
 * How far back the board looks. Six hours covers a full dinner service
 * including the tail of it, and bounds the query regardless of how long the
 * restaurant has been using AutoDine.
 */
export const BOARD_WINDOW_HOURS = 6;

/** How long a cancellation stays worth announcing. Minutes. */
export const CANCELLED_WINDOW_MIN = 15;

/** Table label shown when an order has no table (takeaway, delivery). */
const NO_TABLE = 'Takeaway';

function minutesSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / 60_000));
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
    return {
      restaurantName: '',
      restaurantId: null,
      tickets: [],
      cancelled: [],
      role: null,
      canAdvance: false,
      cannotAdvance: 'role',
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, restaurantName, role, timezone } = staff.context;

  /**
   * Two independent gates, checked in the order the operator can act on them.
   *
   * A cashier cannot move tickets because the update policy on orders names
   * owner, manager and kitchen only -- not because the board feels like
   * restricting them. A read-only restaurant (trial ended, no plan) fails the
   * second half of the same policy.
   *
   * restaurant_can_write is a read; a transient failure here must not hide the
   * buttons, so the call is treated as "allowed" and the write path reports
   * whatever the database says.
   */
  let canAdvance = KITCHEN_ROLES.includes(role);
  let cannotAdvance: 'role' | 'plan' | undefined = canAdvance ? undefined : 'role';

  if (canAdvance) {
    const { data: writable, error: writeCheckError } = await supabase.rpc('restaurant_can_write', {
      p_restaurant_id: restaurantId,
    });

    if (writeCheckError) {
      console.error(`[kitchen] could not read the write state: ${writeCheckError.message}`);
    } else if (writable === false) {
      canAdvance = false;
      cannotAdvance = 'plan';
    }
  }
  const now = Date.now();
  const cutoff = new Date(now - BOARD_WINDOW_HOURS * 3_600_000).toISOString();

  const cancelledCutoff = new Date(
    now - CANCELLED_WINDOW_MIN * 60_000
  ).toISOString();

  const [ordersResult, cancelledResult] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, code, table_id, customer_note, prep_status, payment_status, total_paise, placed_at'
      )
      .eq('restaurant_id', restaurantId)
      .neq('prep_status', 'cancelled')
      .gte('placed_at', cutoff)
      .order('placed_at', { ascending: true }),
    supabase
      .from('orders')
      .select('id, table_id, updated_at, placed_at')
      .eq('restaurant_id', restaurantId)
      .eq('prep_status', 'cancelled')
      .gte('updated_at', cancelledCutoff)
      .order('updated_at', { ascending: true }),
  ]);

  if (ordersResult.error) {
    throw new Error(`Could not load orders: ${ordersResult.error.message}`);
  }
  if (cancelledResult.error) {
    throw new Error(`Could not load cancellations: ${cancelledResult.error.message}`);
  }

  const rows = ordersResult.data ?? [];
  const cancelledRows = cancelledResult.data ?? [];

  const orderIds = rows.map((row) => row.id);
  const tableIds = [
    ...new Set(
      [...rows, ...cancelledRows].map((r) => r.table_id).filter(Boolean),
    ),
  ] as string[];

  // Separate queries rather than embedded selects: lib/db/database.ts is
  // hand-written and only declares the orders -> order_items relationship, so
  // an embed like dining_tables(label) resolves to SelectQueryError and will
  // not compile. Joining in JS also lets us order items by sort_order, which
  // is the sequence the kitchen wants them plated in.
  const [itemsResult, tablesResult] = await Promise.all([
    // An empty .in() list is a wasted round trip on a board that refreshes
    // every thirty seconds, so it is skipped rather than sent.
    orderIds.length
      ? supabase
          .from('order_items')
          .select(
            'order_id, item_id, qty, name_snapshot, variant_snapshot, addons_snapshot, is_veg, sort_order'
          )
          .in('order_id', orderIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
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

  /**
   * How each dish should be said.
   *
   * Read from the live item, not from the order snapshot: a pronunciation is
   * a property of the dish, and correcting it should fix every ticket from the
   * moment it is saved. A dish deleted since the order was placed simply has
   * no entry, and the board falls back to the automated transliteration.
   */
  const itemIds = [
    ...new Set((itemsResult.data ?? []).map((item) => item.item_id).filter(Boolean)),
  ] as string[];

  const { data: spokenRows, error: spokenError } = itemIds.length
    ? await supabase.from('items').select('id, spoken_name').in('id', itemIds)
    : { data: [] as { id: string; spoken_name: string | null }[], error: null };

  if (spokenError) {
    // Not fatal: the board still announces, using the generated pronunciation.
    console.error(`[kitchen] could not load spoken names: ${spokenError.message}`);
  }

  const spokenById = new Map<string, string>();
  for (const row of spokenRows ?? []) {
    if (row.spoken_name && row.spoken_name.trim()) spokenById.set(row.id, row.spoken_name.trim());
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

  const cancelled: CancelledTicket[] = cancelledRows.map((row) => ({
    id: row.id,
    table: (row.table_id && labelByTable.get(row.table_id)) || NO_TABLE,
    at: row.updated_at,
  }));

  const tickets: KitchenTicket[] = rows.map((row) => {
    const items = (itemsByOrder.get(row.id) ?? []).map((item) => {
      const portion = item.variant_snapshot?.trim() || undefined;
      const addons = (item.addons_snapshot ?? [])
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name));

      return {
        qty: item.qty,
        name: item.name_snapshot,
        detail: [portion, ...addons].filter(Boolean).join(' · ') || undefined,
        ...(portion ? { portion } : {}),
        ...(addons.length ? { addons } : {}),
        veg: item.is_veg,
        spoken: (item.item_id && spokenById.get(item.item_id)) || undefined,
      };
    });

    return {
      id: row.id,
      code: row.code,
      table: (row.table_id && labelByTable.get(row.table_id)) || NO_TABLE,
      placedAt: clockTimeInZone(timezone, row.placed_at),
      placedAtIso: row.placed_at,
      ageMin: minutesSince(row.placed_at, now),
      payment: paymentLabel(row.payment_status),
      state: row.prep_status as KitchenPrepState,
      note: row.customer_note?.trim() || undefined,
      items,
      total: paiseToRupees(row.total_paise),
    };
  });

  return {
    restaurantName,
    restaurantId,
    tickets,
    cancelled,
    role,
    canAdvance,
    ...(cannotAdvance ? { cannotAdvance } : {}),
  };
}
