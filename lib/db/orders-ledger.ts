/**
 * The staff order ledger.
 *
 * Owners and managers use the canonical report RPC so the ledger stays aligned
 * with the full sales report. Cashiers (and roles that cannot open this route)
 * get an explicit, orders-only projection: no payment rows, payment status, or
 * monetary columns are selected. This keeps the read-only ledger useful without
 * turning it into a second finance surface.
 */

import { getStaffContextDetailed } from './staff';
import {
  getReportsScreenDataForStaff,
  isReportRangeKey,
  REPORT_ORDER_LIMIT,
  resolveRange,
  type ReportOrderRow,
  type ReportRange,
  type ReportsQueryParams,
} from './reports';
import { RESTAURANT_TIME_ZONE } from './time';

export type OrderLedgerSafeRow = Pick<
  ReportOrderRow,
  'id' | 'code' | 'placedAt' | 'prepStatus' | 'tableLabel'
>;

/** Full finance fields are present only for Owner/Manager report-backed rows. */
export type OrderLedgerRow = OrderLedgerSafeRow &
  Partial<
    Pick<
      ReportOrderRow,
      | 'paymentStatus'
      | 'subtotalPaise'
      | 'discountPaise'
      | 'taxPaise'
      | 'totalPaise'
      | 'paidPaise'
      | 'refundedPaise'
    >
  >;

export type OrdersLedgerScreenData = {
  timezone: string;
  range: ReportRange;
  orders: OrderLedgerRow[];
  /** True when more orders exist in the range than the ledger lists. */
  ordersTruncated: boolean;
  /** Cashier rows contain no finance columns; Owner/Manager rows do. */
  canViewFinance: boolean;
  canExport: boolean;
  blocked?: 'signed-out' | 'no-membership';
};

function resolvedRange(params: ReportsQueryParams, timezone: string, now: Date): ReportRange {
  const key = isReportRangeKey(params.range) ? params.range : 'today';
  return resolveRange(key, timezone, now, { from: params.from, to: params.to });
}

/**
 * Get the data for `/dashboard/orders` from the trusted selected-outlet context.
 *
 * Cashier queries select only order identity, kitchen state, timestamp and
 * table id from `orders`; table labels are a separate safe lookup. The list is
 * bounded to one extra row so truncation can be reported without loading the
 * full range or running finance aggregates.
 */
export async function getOrdersScreenData(
  params: ReportsQueryParams = {},
  now: Date = new Date(),
): Promise<OrdersLedgerScreenData | null> {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    // Unconfigured: the page renders its labelled sample ledger.
    if (staff.reason === 'unconfigured') return null;

    const timezone = RESTAURANT_TIME_ZONE;
    return {
      timezone,
      range: resolvedRange(params, timezone, now),
      orders: [],
      ordersTruncated: false,
      canViewFinance: false,
      canExport: false,
      blocked: staff.reason,
    };
  }

  const { context } = staff;
  if (context.role === 'owner' || context.role === 'manager') {
    const report = await getReportsScreenDataForStaff(context, params, now);
    return {
      timezone: report.timezone,
      range: report.range,
      orders: report.report.orders,
      ordersTruncated: report.ordersTruncated,
      canViewFinance: true,
      canExport: true,
    };
  }

  const { timezone } = context;
  const range = resolvedRange(params, timezone, now);
  if (context.role !== 'cashier') {
    // The route layout denies other roles. Keep its data loader default-deny too
    // in case the page tree evaluates before that UI gate is rendered.
    return {
      timezone,
      range,
      orders: [],
      ordersTruncated: false,
      canViewFinance: false,
      canExport: false,
    };
  }

  const { supabase, restaurantId } = context;
  const { data, error } = await supabase
    .from('orders')
    .select('id, code, table_id, prep_status, placed_at')
    .eq('restaurant_id', restaurantId)
    .gte('placed_at', range.fromIso)
    .lt('placed_at', range.toIso)
    .order('placed_at', { ascending: false })
    .limit(REPORT_ORDER_LIMIT + 1);

  if (error) throw new Error(`Could not load the order ledger: ${error.message}`);

  const candidates = data ?? [];
  const selected = candidates.slice(0, REPORT_ORDER_LIMIT);
  const tableIds = [...new Set(selected.map((order) => order.table_id).filter((id): id is string => Boolean(id)))];
  const tableLabels = new Map<string, string>();

  if (tableIds.length > 0) {
    const { data: tables, error: tablesError } = await supabase
      .from('dining_tables')
      .select('id, label')
      .eq('restaurant_id', restaurantId)
      .in('id', tableIds);

    if (tablesError) throw new Error(`Could not load order table labels: ${tablesError.message}`);
    for (const table of tables ?? []) tableLabels.set(table.id, table.label);
  }

  return {
    timezone,
    range,
    orders: selected.map((order) => ({
      id: order.id,
      code: order.code,
      placedAt: order.placed_at,
      prepStatus: order.prep_status,
      tableLabel: order.table_id ? (tableLabels.get(order.table_id) ?? null) : null,
    })),
    ordersTruncated: candidates.length > REPORT_ORDER_LIMIT,
    canViewFinance: false,
    canExport: false,
  };
}
