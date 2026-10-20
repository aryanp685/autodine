import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the row -> dashboard mapping and the business-day boundary maths,
 * which is where this screen can quietly go wrong. SQL semantics are not
 * covered: the day filter and the cancelled filter are enforced by Postgres.
 *
 * Time-sensitive tests anchor to the real start of the business day rather
 * than to fixed clock times, so they do not go flaky when the suite happens
 * to run near midnight in the restaurant's zone.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import {
  RESTAURANT_TIME_ZONE,
  RECENT_ORDER_LIMIT,
  TOP_ITEM_LIMIT,
  getDashboardScreenData,
  hourInZone,
  startOfDayUtc,
} from './dashboard-screen';

type Row = Record<string, unknown>;

function fakeSupabase(rows: Record<string, Row[]>) {
  const from = (table: string) => {
    const data = rows[table] ?? [];
    // Not annotated on purpose: see lib/db/kitchen-screen.test.ts.
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      gte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve({ data, error: null }).then(
          onFulfilled as () => unknown,
          onRejected as () => unknown
        ),
    };
    return chain;
  };
  return { from } as never;
}

function signedIn(supabase: unknown, timezone: string = RESTAURANT_TIME_ZONE) {
  return {
    ok: true as const,
    context: {
      supabase,
      restaurantId: 'r-1',
      restaurantName: 'Kings of Kings',
      timezone,
      tagline: null,
    },
  };
}

/** An instant guaranteed to be inside today and not in the future. */
function earlierToday(fractionOfDay = 0.5): string {
  const now = new Date();
  const dayStart = startOfDayUtc(RESTAURANT_TIME_ZONE, now);
  const elapsed = now.getTime() - dayStart.getTime();
  return new Date(dayStart.getTime() + elapsed * fractionOfDay).toISOString();
}

const order = (id: string, extra: Row = {}) => ({
  id,
  code: `A-${id}`,
  table_id: null,
  prep_status: 'new',
  payment_status: 'pending',
  total_paise: 10000,
  placed_at: earlierToday(),
  ...extra,
});

const payment = (orderId: string, amountPaise: number, status = 'recorded') => ({
  order_id: orderId,
  amount_paise: amountPaise,
  status,
});

beforeEach(() => {
  mocks.staff.result = null;
});

describe('getDashboardScreenData', () => {
  it('returns null when Supabase is unconfigured, so the screen uses demo data', async () => {
    mocks.staff.result = { ok: false, reason: 'unconfigured' };
    expect(await getDashboardScreenData()).toBeNull();
  });

  it('reports signed-out rather than an empty dashboard that reads as "no orders"', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    const data = await getDashboardScreenData();
    expect(data?.blocked).toBe('signed-out');
    expect(data?.stats.ordersToday).toBe(0);
  });

  it('reports a signed-in account with no restaurant', async () => {
    mocks.staff.result = { ok: false, reason: 'no-membership' };
    expect((await getDashboardScreenData())?.blocked).toBe('no-membership');
  });

  it('returns zeroed stats on an empty day instead of dividing by zero', async () => {
    mocks.staff.result = signedIn(fakeSupabase({ orders: [], payments: [] }));
    const data = await getDashboardScreenData();

    expect(data?.stats).toEqual({
      ordersToday: 0,
      revenueTodayPaise: 0,
      averageTicketPaise: 0,
      openOrders: 0,
    });
    expect(data?.orders).toEqual([]);
    expect(data?.topItems).toEqual([]);
  });

  it('counts only settled payments as revenue, so pending orders do not flatter the day', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order('1')],
        payments: [
          payment('1', 10000),
          payment('1', 5000, 'pending'),
          payment('1', 300, 'failed'),
        ],
      })
    );
    expect((await getDashboardScreenData())?.stats.revenueTodayPaise).toBe(10000);
  });

  it('averages the ticket over orders, rounding to whole paise', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order('1'), order('2'), order('3')],
        payments: [payment('1', 1000), payment('2', 1000), payment('3', 1001)],
      })
    );
    // 3001 / 3 = 1000.33 -> 1000
    expect((await getDashboardScreenData())?.stats.averageTicketPaise).toBe(1000);
  });

  it('counts open orders as new/preparing/ready and excludes served and cancelled', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          order('1', { prep_status: 'new' }),
          order('2', { prep_status: 'preparing' }),
          order('3', { prep_status: 'ready' }),
          order('4', { prep_status: 'served' }),
        ],
        payments: [],
      })
    );
    expect((await getDashboardScreenData())?.stats.openOrders).toBe(3);
  });

  it('ranks top items by quantity sold and caps the list', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order('1')],
        payments: [],
        order_items: [
          { order_id: '1', name_snapshot: 'Naan', qty: 2, unit_price_paise: 5000 },
          { order_id: '1', name_snapshot: 'Naan', qty: 3, unit_price_paise: 5000 },
          { order_id: '1', name_snapshot: 'Biryani', qty: 1, unit_price_paise: 30000 },
          { order_id: '1', name_snapshot: 'Lassi', qty: 4, unit_price_paise: 8000 },
          { order_id: '1', name_snapshot: 'Tikka', qty: 5, unit_price_paise: 20000 },
          { order_id: '1', name_snapshot: 'Korma', qty: 6, unit_price_paise: 25000 },
          { order_id: '1', name_snapshot: 'Raita', qty: 7, unit_price_paise: 4000 },
        ],
      })
    );

    const top = (await getDashboardScreenData())?.topItems ?? [];

    expect(top.length).toBe(TOP_ITEM_LIMIT);
    // Quantities merged across rows, then sorted descending.
    expect(top[0]).toEqual({ name: 'Raita', qty: 7, revenuePaise: 28000 });
    expect(top.map((t) => t.name)).not.toContain('Biryani');
    // 'Naan' appears twice and is summed, not duplicated.
    expect(top.find((t) => t.name === 'Naan')).toEqual({
      name: 'Naan',
      qty: 5,
      revenuePaise: 25000,
    });
  });

  it('resolves the table label, and says Takeaway when there is no table', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order('1', { table_id: 't-1' }), order('2')],
        payments: [],
        dining_tables: [{ id: 't-1', label: 'T7' }],
      })
    );

    const orders = (await getDashboardScreenData())?.orders ?? [];
    expect(orders.find((o) => o.id === '1')?.table).toBe('T7');
    expect(orders.find((o) => o.id === '2')?.table).toBe('Takeaway');
  });

  it('trims the live orders table to the rows it renders', async () => {
    const many = Array.from({ length: 30 }, (_, i) => order(String(i)));
    mocks.staff.result = signedIn(fakeSupabase({ orders: many, payments: [] }));

    const data = await getDashboardScreenData();
    expect(data?.orders.length).toBe(RECENT_ORDER_LIMIT);
    // Stats still count the whole day, not just the rendered page.
    expect(data?.stats.ordersToday).toBe(30);
  });

  it('closes the day on the restaurant\'s own midnight, not a hardcoded zone', async () => {
    // 2026-07-01 02:00 in New York is still 2026-06-30 in local business terms
    // but already 2026-07-01 in Kolkata. The series length differs by one
    // bucket depending on which zone the restaurant row asked for, which is
    // only observable if the zone really is read from the row.
    const at = new Date('2026-07-01T02:00:00-04:00'); // 06:00 UTC

    const newYork = hourInZone('America/New_York', at);
    const kolkata = hourInZone('Asia/Kolkata', at);
    expect(newYork).not.toBe(kolkata);
    expect(newYork).toBe(2);
    expect(kolkata).toBe(11);
  });

  it('sizes the hourly series to the elapsed day, not to a full 24 hours', async () => {
    mocks.staff.result = signedIn(fakeSupabase({ orders: [], payments: [] }));
    const data = await getDashboardScreenData();
    expect(data?.hourlyPaise.length).toBe(hourInZone(RESTAURANT_TIME_ZONE, new Date()) + 1);
  });

  it('books each order into the hour it was placed, in the restaurant zone', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order('1')],
        payments: [payment('1', 7000)],
      })
    );

    const data = await getDashboardScreenData();
    const placed = hourInZone(RESTAURANT_TIME_ZONE, new Date(earlierToday()));

    expect(data?.hourlyPaise[placed]).toBe(7000);
    // Nothing leaks into the other buckets.
    expect(data?.hourlyPaise.reduce((a, b) => a + b, 0)).toBe(7000);
  });
});

describe('business-day boundary', () => {
  it('starts the Indian day at 18:30 UTC the previous day, not at UTC midnight', () => {
    // 2026-07-01 02:00 IST is still 2026-06-30 20:30 UTC.
    const at = new Date('2026-07-01T02:00:00+05:30');
    const start = startOfDayUtc('Asia/Kolkata', at);
    expect(start.toISOString()).toBe('2026-06-30T18:30:00.000Z');
  });

  it('follows daylight saving in a zone that observes it', () => {
    // New York is UTC-4 in July and UTC-5 in January; the local midnight is
    // 04:00 UTC in summer and 05:00 UTC in winter.
    const summer = startOfDayUtc('America/New_York', new Date('2026-07-01T12:00:00Z'));
    const winter = startOfDayUtc('America/New_York', new Date('2026-01-01T12:00:00Z'));

    expect(summer.toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(winter.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('reads the hour in the named zone rather than in UTC', () => {
    // 20:30 UTC is 02:00 the next morning in Kolkata.
    const at = new Date('2026-06-30T20:30:00Z');
    expect(hourInZone('Asia/Kolkata', at)).toBe(2);
    expect(hourInZone('UTC', at)).toBe(20);
  });
});
