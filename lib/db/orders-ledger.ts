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
  normalizeKotHandoffStatus,
  type KotHandoffStatus,
  type OperatingMode,
} from '@/lib/operating-mode';
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
> & {
  updatedAt?: string | null;
  holdRequired?: boolean;
  confirmedAt?: string | null;
  kitchenAnnouncementStatus?: string | null;
  kotHandoffStatus?: KotHandoffStatus;
  kotHandoffRef?: string | null;
};

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
  operatingMode?: OperatingMode;
  posIntegrationName?: string | null;
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
  const modeA = context.operatingMode === 'mode_a';
  if (context.role === 'owner' || context.role === 'manager') {
    const report = await getReportsScreenDataForStaff(context, params, now);
    const orderIds = report.report.orders.map((o) => o.id);
    const operationalState = new Map<string, Partial<OrderLedgerSafeRow>>();
    const columns = 'id, updated_at, hold_required, confirmed_at, kitchen_announcement_status';
    for (let offset = 0; offset < orderIds.length; offset += 100) {
      const { data, error } = await context.supabase
        .from('orders')
        .select(modeA ? `${columns}, kot_handoff_status, kot_handoff_ref` : columns)
        .eq('restaurant_id', context.restaurantId)
        .in('id', orderIds.slice(offset, offset + 100));
      if (error) throw new Error(`Could not load order operational state: ${error.message}`);
      const rows = (data ?? []) as unknown as Array<{
        id: string;
        updated_at: string | null;
        hold_required: boolean;
        confirmed_at: string | null;
        kitchen_announcement_status: string | null;
        kot_handoff_status?: string | null;
        kot_handoff_ref?: string | null;
      }>;
      for (const row of rows) {
        operationalState.set(row.id, {
          updatedAt: row.updated_at,
          holdRequired: row.hold_required,
          confirmedAt: row.confirmed_at,
          kitchenAnnouncementStatus: row.kitchen_announcement_status,
          ...(modeA ? {
            kotHandoffStatus: normalizeKotHandoffStatus(row.kot_handoff_status),
            kotHandoffRef: row.kot_handoff_ref ?? null,
          } : {}),
        });
      }
    }
    return {
      timezone: report.timezone,
      range: report.range,
      orders: report.report.orders.map((order) => ({ ...order, ...operationalState.get(order.id) })),
      ordersTruncated: report.ordersTruncated,
      canViewFinance: true,
      canExport: true,
      ...(modeA
        ? {
            operatingMode: context.operatingMode,
            posIntegrationName: context.posIntegrationName ?? null,
          }
        : {}),
    };
  }

  const { timezone } = context;
  const range = resolvedRange(params, timezone, now);
  if (context.role !== 'cashier' && context.role !== 'waiter') {
    // The route layout denies other roles. Keep its data loader default-deny too
    // in case the page tree evaluates before that UI gate is rendered.
    return {
      timezone,
      range,
      orders: [],
      ordersTruncated: false,
      canViewFinance: false,
      canExport: false,
      ...(modeA
        ? {
            operatingMode: context.operatingMode,
            posIntegrationName: context.posIntegrationName ?? null,
          }
        : {}),
    };
  }

  const { supabase, restaurantId } = context;
  const selectCols = modeA
    ? 'id, code, table_id, prep_status, placed_at, kot_handoff_status, kot_handoff_ref'
    : 'id, code, table_id, prep_status, placed_at';
  const primaryAttempt = await supabase
    .from('orders')
    .select(selectCols)
    .eq('restaurant_id', restaurantId)
    .gte('placed_at', range.fromIso)
    .lt('placed_at', range.toIso)
    .order('placed_at', { ascending: false })
    .limit(REPORT_ORDER_LIMIT + 1);

  const fallbackAttempt =
    modeA && primaryAttempt.error?.code === '42703'
      ? await supabase
          .from('orders')
          .select('id, code, table_id, prep_status, placed_at')
          .eq('restaurant_id', restaurantId)
          .gte('placed_at', range.fromIso)
          .lt('placed_at', range.toIso)
          .order('placed_at', { ascending: false })
          .limit(REPORT_ORDER_LIMIT + 1)
      : null;

  const { data, error } = fallbackAttempt ?? primaryAttempt;

  if (error) throw new Error(`Could not load the order ledger: ${error.message}`);

  const candidates = (data ?? []) as Array<{
    id: string;
    code: string;
    table_id: string | null;
    prep_status: string;
    placed_at: string;
    kot_handoff_status?: string | null;
    kot_handoff_ref?: string | null;
  }>;
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
      ...(modeA
        ? {
            kotHandoffStatus: normalizeKotHandoffStatus(order.kot_handoff_status),
            kotHandoffRef: order.kot_handoff_ref ?? null,
          }
        : {}),
    })),
    ordersTruncated: candidates.length > REPORT_ORDER_LIMIT,
    canViewFinance: false,
    canExport: false,
    ...(modeA
      ? {
          operatingMode: context.operatingMode,
          posIntegrationName: context.posIntegrationName ?? null,
        }
      : {}),
  };
}
