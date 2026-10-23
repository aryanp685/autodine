/**
 * Load the owner-facing dashboard overview from the real database.
 *
 * WHY THE TIME ZONE MATH IS NOT `new Date().setHours(0,0,0,0)`
 *
 * "Revenue today" has to mean the restaurant's today, not the server's. Every
 * Vercel lambda runs in UTC, so a naive start-of-day would put an Indian
 * restaurant's business day boundary at 5:30 in the afternoon. For five and a
 * half hours every evening the dashboard would report a day that had not
 * finished, and then silently reset in the middle of dinner service.
 *
 * India has no daylight saving, so a fixed +05:30 would work here -- but this
 * product is meant to expand internationally, and half the countries it would
 * expand into do observe DST. So the boundary is derived from the IANA zone
 * through Intl rather than from a hardcoded offset, which stays correct in a
 * zone that shifts twice a year.
 *
 * WHAT IS DELIBERATELY MISSING
 *
 * The demo dashboard this replaces had an "Avg prep time" card. The orders
 * table has no served_at column, only placed_at and an updated_at that any
 * edit touches -- so there is nothing to compute an honest prep time from, and
 * a fake one would be worse than none. The fourth card is "Open orders"
 * instead, which is derivable and is what the owner actually acts on.
 */

import type { RestaurantAccess } from '@/lib/access';
import { getStaffContextDetailed } from './staff';
import { hourInZone, RESTAURANT_TIME_ZONE, startOfDayUtc } from './time';


/** Payment rows in this state have actually moved money. */
const RECORDED = 'recorded';

/** Prep states that still need someone to do something. */
const OPEN_STATES = ['new', 'preparing', 'ready'];

export type DashboardOrder = {
  id: string;
  code: string;
  /** Table label, or 'Takeaway' when the order has no table. */
  table: string;
  /** ISO timestamp. The screen formats it; this layer does not guess a locale. */
  placedAt: string;
  paymentStatus: string;
  prepStatus: string;
  totalPaise: number;
};

export type DashboardTopItem = {
  name: string;
  qty: number;
  revenuePaise: number;
};

export type DashboardStats = {
  ordersToday: number;
  revenueTodayPaise: number;
  /**
   * Zero when there are no orders rather than NaN. The screen renders it, so
   * it has to be a number the money formatter can take.
   */
  averageTicketPaise: number;
  openOrders: number;
};

export type DashboardScreenData = {
  restaurantName: string;
  /** IANA zone of the restaurant, so a placed-at time is its time, not UTC's. */
  timezone: string;
  /** Null when the owner never filled it in. Never substitute sample copy. */
  tagline: string | null;
  stats: DashboardStats;
  /** Most recent first, already trimmed to what the table renders. */
  orders: DashboardOrder[];
  /** Empty when there is nothing to rank -- never padded with sample rows. */
  topItems: DashboardTopItem[];
  /**
   * Revenue per elapsed hour of the business day. Length is
   * hours elapsed + 1, not 24: a chart that ran to midnight every morning
   * would be mostly a flat line of a future that has not happened.
   */
  hourlyPaise: number[];
  /** Set when the database answered but this caller has no restaurant. */
  blocked?: 'signed-out' | 'no-membership';
  /**
   * Plan and trial state. Read from the database on every load, never from a
   * cookie: the line above the figures has to agree with the gate that refuses
   * writes. Null in demo mode and when the read failed.
   */
  access?: RestaurantAccess | null;
};

/** How many rows the Live orders table shows. */
export const RECENT_ORDER_LIMIT = 8;

/** How many rows the Top items list shows. */
export const TOP_ITEM_LIMIT = 5;

/**
 * Time helpers live in ./time so that the dashboard and the reports screen
 * cannot disagree about where a day starts. Re-exported here because this
 * module was their only home until reports arrived, and every caller and test
 * already imports them from this path.
 */
export {
  RESTAURANT_TIME_ZONE,
  hourInZone,
  startOfDayUtc,
  timeZoneOffsetMs,
} from './time';

export async function getDashboardScreenData(): Promise<DashboardScreenData | null> {
  const staff = await getStaffContextDetailed();

  // Nested rather than a compound condition: a narrowed && does not carry into
  // the next if, so the union would stay wide and `blocked` would not typecheck.
  if (!staff.ok) {
    // Unconfigured: the screen falls back to its demo rows, as it always has.
    if (staff.reason === 'unconfigured') return null;
    return {
      restaurantName: '',
      timezone: RESTAURANT_TIME_ZONE,
      tagline: null,
      stats: { ordersToday: 0, revenueTodayPaise: 0, averageTicketPaise: 0, openOrders: 0 },
      orders: [],
      topItems: [],
      hourlyPaise: [],
      blocked: staff.reason,
      access: null,
    };
  }

  const { supabase, restaurantId, restaurantName, timezone } = staff.context;

  const now = new Date();
  const dayStart = startOfDayUtc(timezone, now);
  const dayStartIso = dayStart.toISOString();

  const [ordersResult, paymentsResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, code, table_id, prep_status, payment_status, total_paise, placed_at')
      .eq('restaurant_id', restaurantId)
      .neq('prep_status', 'cancelled')
      .gte('placed_at', dayStartIso)
      .order('placed_at', { ascending: false }),
    supabase
      .from('payments')
      .select('order_id, amount_paise, status')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', dayStartIso),
  ]);

  if (ordersResult.error) {
    throw new Error(`Could not load orders: ${ordersResult.error.message}`);
  }
  if (paymentsResult.error) {
    throw new Error(`Could not load payments: ${paymentsResult.error.message}`);
  }

  const rows = ordersResult.data ?? [];

  // Revenue is the sum of settled payments, not of order totals: an order with
  // payment_status 'pending' is money the restaurant does not have yet, and
  // counting it would flatter the day's takings.
  const recordedByOrder = new Map<string, number>();
  let revenueTodayPaise = 0;
  for (const payment of paymentsResult.data ?? []) {
    if (payment.status !== RECORDED) continue;
    const amount = Number(payment.amount_paise ?? 0);
    revenueTodayPaise += amount;
    const previous = recordedByOrder.get(payment.order_id) ?? 0;
    recordedByOrder.set(payment.order_id, previous + amount);
  }

  const ordersToday = rows.length;
  const openOrders = rows.filter((row) => OPEN_STATES.includes(row.prep_status)).length;
  const averageTicketPaise = ordersToday > 0 ? Math.round(revenueTodayPaise / ordersToday) : 0;

  const hourlyPaise = Array.from({ length: hourInZone(timezone, now) + 1 }, () => 0);
  for (const row of rows) {
    const placed = new Date(row.placed_at);
    if (Number.isNaN(placed.getTime())) continue;
    if (placed < dayStart) continue;

    const bucket = hourInZone(timezone, placed);
    if (bucket >= hourlyPaise.length) continue;
    hourlyPaise[bucket] += Number(recordedByOrder.get(row.id) ?? 0);
  }

  // Empty day: skip the follow-up queries entirely rather than firing an
  // .in() with an empty id list and a join that can only return nothing.
  if (rows.length === 0) {
    return {
      restaurantName,
      timezone,
      tagline: staff.context.tagline,
      stats: { ordersToday: 0, revenueTodayPaise, averageTicketPaise: 0, openOrders: 0 },
      orders: [],
      topItems: [],
      hourlyPaise,
      access: staff.context.access,
    };
  }

  const orderIds = rows.map((row) => row.id);
  const tableIds = [...new Set(rows.map((row) => row.table_id).filter(Boolean))] as string[];

  // Separate queries rather than embedded selects: lib/db/database.ts is
  // hand-written and does not declare every relationship, so an embed such as
  // dining_tables(label) resolves to a SelectQueryError and will not compile.
  const [itemsResult, tablesResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('order_id, name_snapshot, qty, unit_price_paise')
      .in('order_id', orderIds),
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

  const labelById = new Map<string, string>();
  for (const table of tablesResult.data ?? []) {
    labelById.set(table.id, table.label);
  }

  const topItems = new Map<string, DashboardTopItem>();
  for (const item of itemsResult.data ?? []) {
    const name = item.name_snapshot;
    const qty = Number(item.qty ?? 0);
    const revenue = qty * Number(item.unit_price_paise ?? 0);

    const existing = topItems.get(name);
    if (existing) {
      existing.qty += qty;
      existing.revenuePaise += revenue;
    } else {
      topItems.set(name, { name, qty, revenuePaise: revenue });
    }
  }

  return {
    restaurantName,
    timezone,
    tagline: staff.context.tagline,
    stats: { ordersToday, revenueTodayPaise, averageTicketPaise, openOrders },
    orders: rows.slice(0, RECENT_ORDER_LIMIT).map((row) => ({
      id: row.id,
      code: row.code,
      table: row.table_id ? (labelById.get(row.table_id) ?? '—') : 'Takeaway',
      placedAt: row.placed_at,
      paymentStatus: row.payment_status,
      prepStatus: row.prep_status,
      totalPaise: Number(row.total_paise ?? 0),
    })),
    topItems: [...topItems.values()]
      .sort((a, b) => b.qty - a.qty || b.revenuePaise - a.revenuePaise)
      .slice(0, TOP_ITEM_LIMIT),
    hourlyPaise,
    access: staff.context.access,
  };
}
