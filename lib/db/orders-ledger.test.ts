import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffContext } from './staff';
import type { ReportOrderRow } from './reports';

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  reportLoader: vi.fn(),
}));

vi.mock('./staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

vi.mock('./reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reports')>();
  return {
    ...actual,
    getReportsScreenDataForStaff: (...args: unknown[]) => mocks.reportLoader(...args),
  };
});

import { getOrdersScreenData } from './orders-ledger';
import { REPORT_ORDER_LIMIT, resolveRange } from './reports';

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-10-21T12:30:00Z');

type QueryCall = {
  table: string;
  selection?: string;
  filters: Array<{ method: string; column: string; value: unknown }>;
  order?: { column: string; ascending: boolean };
  limit?: number;
};

function fakeSupabase(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    const call: QueryCall = { table, filters: [] };
    calls.push(call);
    const data = rows[table] ?? [];
    const chain = {
      select: (selection: string) => {
        call.selection = selection;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push({ method: 'eq', column, value });
        return chain;
      },
      gte: (column: string, value: unknown) => {
        call.filters.push({ method: 'gte', column, value });
        return chain;
      },
      lt: (column: string, value: unknown) => {
        call.filters.push({ method: 'lt', column, value });
        return chain;
      },
      in: (column: string, value: unknown) => {
        call.filters.push({ method: 'in', column, value });
        return chain;
      },
      order: (column: string, options: { ascending: boolean }) => {
        call.order = { column, ascending: options.ascending };
        return chain;
      },
      limit: (value: number) => {
        call.limit = value;
        return chain;
      },
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve({ data, error: null }).then(
          onFulfilled as (value: unknown) => unknown,
          onRejected as (reason: unknown) => unknown,
        ),
    };
    return chain;
  });
  const rpc = vi.fn();
  return { client: { from, rpc } as never, calls, from, rpc };
}

function signedIn(
  role: StaffContext['role'],
  supabase: unknown,
) {
  return {
    ok: true as const,
    context: {
      supabase: supabase as StaffContext['supabase'],
      restaurantId: 'restaurant-1',
      restaurantName: 'Maddi',
      timezone: TZ,
      tagline: null,
      slug: 'maddi',
      role,
      outlets: [{ id: 'restaurant-1', name: 'Maddi', role }],
      access: null,
    },
  };
}

function orderRow(index: number, over: Record<string, unknown> = {}) {
  return {
    id: `order-${index}`,
    code: `MA-${1000 + index}`,
    table_id: 'table-1',
    prep_status: 'preparing',
    placed_at: new Date(NOW.getTime() - index * 60_000).toISOString(),
    // Deliberately present in the mock response to ensure the mapper only
    // returns its explicit safe allowlist.
    payment_status: 'paid',
    total_paise: 84_000,
    ...over,
  };
}

beforeEach(() => {
  mocks.staff.result = null;
  mocks.reportLoader.mockReset();
});

describe('getOrdersScreenData', () => {
  it('uses an orders-only safe projection for Cashier and never calls the finance report RPC', async () => {
    const fake = fakeSupabase({
      orders: [orderRow(1)],
      dining_tables: [{ id: 'table-1', label: 'T4' }],
    });
    mocks.staff.result = signedIn('cashier', fake.client);

    const data = await getOrdersScreenData({ range: 'today' }, NOW);

    expect(data).toMatchObject({
      canViewFinance: false,
      canExport: false,
      orders: [
        {
          id: 'order-1',
          code: 'MA-1001',
          placedAt: orderRow(1).placed_at,
          prepStatus: 'preparing',
          tableLabel: 'T4',
        },
      ],
    });
    expect(data?.orders[0]).not.toHaveProperty('paymentStatus');
    expect(data?.orders[0]).not.toHaveProperty('totalPaise');
    expect(data?.orders[0]).not.toHaveProperty('paidPaise');

    const ordersQuery = fake.calls.find((call) => call.table === 'orders');
    expect(ordersQuery?.selection).toBe('id, code, table_id, prep_status, placed_at');
    expect(ordersQuery?.filters).toContainEqual({
      method: 'eq',
      column: 'restaurant_id',
      value: 'restaurant-1',
    });
    expect(ordersQuery?.filters).toContainEqual({
      method: 'gte',
      column: 'placed_at',
      value: resolveRange('today', TZ, NOW).fromIso,
    });
    expect(ordersQuery?.filters).toContainEqual({
      method: 'lt',
      column: 'placed_at',
      value: NOW.toISOString(),
    });
    expect(ordersQuery?.order).toEqual({ column: 'placed_at', ascending: false });
    expect(ordersQuery?.limit).toBe(REPORT_ORDER_LIMIT + 1);
    expect(fake.calls.map((call) => call.table)).toEqual(['orders', 'dining_tables']);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(mocks.reportLoader).not.toHaveBeenCalled();
  });

  it('bounds Cashier results and marks the list truncated without a range-wide aggregate', async () => {
    const fake = fakeSupabase({
      orders: Array.from({ length: REPORT_ORDER_LIMIT + 1 }, (_, index) => orderRow(index)),
      dining_tables: [{ id: 'table-1', label: 'T4' }],
    });
    mocks.staff.result = signedIn('cashier', fake.client);

    const data = await getOrdersScreenData({ range: '30d' }, NOW);

    expect(data?.orders).toHaveLength(REPORT_ORDER_LIMIT);
    expect(data?.ordersTruncated).toBe(true);
    expect(mocks.reportLoader).not.toHaveBeenCalled();
  });

  it.each(['owner', 'manager'] as const)('%s keeps the full report-backed order data', async (role) => {
    const fake = fakeSupabase({});
    const fullOrder: ReportOrderRow = {
      id: 'order-1',
      code: 'MA-1001',
      placedAt: NOW.toISOString(),
      prepStatus: 'served',
      paymentStatus: 'paid',
      subtotalPaise: 80_000,
      discountPaise: 0,
      taxPaise: 4_000,
      totalPaise: 84_000,
      paidPaise: 84_000,
      refundedPaise: 0,
      tableLabel: 'T4',
    };
    const range = resolveRange('7d', TZ, NOW);
    mocks.staff.result = signedIn(role, fake.client);
    mocks.reportLoader.mockResolvedValue({
      timezone: TZ,
      range,
      report: { orders: [fullOrder] },
      ordersTruncated: false,
    });

    const data = await getOrdersScreenData({ range: '7d' }, NOW);

    expect(mocks.reportLoader).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: 'restaurant-1', role }),
      { range: '7d' },
      NOW,
    );
    expect(data).toMatchObject({
      canViewFinance: true,
      canExport: true,
      orders: [fullOrder],
    });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('does not run an order or report query for a role denied by the route layout', async () => {
    const fake = fakeSupabase({});
    mocks.staff.result = signedIn('kitchen', fake.client);

    const data = await getOrdersScreenData({}, NOW);

    expect(data?.orders).toEqual([]);
    expect(data?.canViewFinance).toBe(false);
    expect(fake.from).not.toHaveBeenCalled();
    expect(mocks.reportLoader).not.toHaveBeenCalled();
  });

  it('returns no live data for a signed-out caller instead of showing demo rows', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };

    const data = await getOrdersScreenData({}, NOW);

    expect(data).toMatchObject({
      blocked: 'signed-out',
      orders: [],
      canViewFinance: false,
      canExport: false,
    });
  });

  it('returns null only when the database is unconfigured', async () => {
    mocks.staff.result = { ok: false, reason: 'unconfigured' };
    expect(await getOrdersScreenData({}, NOW)).toBeNull();
  });
});
