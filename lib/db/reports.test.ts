import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the parts of the report that can be wrong on this side of the wire:
 * which range the owner asked for, filling the empty buckets, coercing jsonb
 * that arrived as `unknown`, and the CSV an accountant opens in Excel.
 *
 * The aggregation itself is SQL and is NOT covered here -- `sql:check` only
 * parses DDL, so the function was exercised against the real database with
 * hand-checked totals. Do not read a green suite here as "the totals are
 * right".
 *
 * Time-sensitive tests anchor to the restaurant's real day boundary rather
 * than to fixed clock times, so they do not go flaky near midnight.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  rpc: { data: null as unknown, error: null as unknown, calls: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import {
  MAX_RANGE_DAYS,
  REPORT_ORDER_LIMIT,
  csvCell,
  demoReport,
  getReportsScreenData,
  itemsCsv,
  ordersCsv,
  parseIsoDate,
  parseReportPayload,
  resolveRange,
  rupees,
  summaryCsv,
  toCsv,
  zeroFillBuckets,
} from './reports';
import { RESTAURANT_TIME_ZONE, startOfDayOffsetUtc, startOfDayUtc } from './time';

const TZ = RESTAURANT_TIME_ZONE;

/**
 * CSV takes the VIEW shape -- buckets already filled and labelled. Tests build
 * it from the raw payload through zeroFillBuckets, the same path the loader
 * takes, rather than hand-rolling a label.
 */
function asView(raw: unknown) {
  const parsed = parseReportPayload(raw);
  const range = resolveRange('today', TZ, NOON);
  return { ...parsed, buckets: zeroFillBuckets(range, parsed.buckets, TZ, NOON) };
}

function fakeSupabase(rpc: typeof mocks.rpc) {
  return {
    rpc: (_fn: string, args: Record<string, unknown>) => {
      rpc.calls.push(args);
      return Promise.resolve({ data: rpc.data, error: rpc.error });
    },
  } as never;
}

function signedIn(supabase: unknown) {
  return {
    ok: true as const,
    context: {
      supabase,
      restaurantId: 'r-1',
      restaurantName: 'maddi',
      timezone: TZ,
      tagline: null,
      slug: 'maddi',
      role: 'owner' as const,
    },
  };
}

/** A fixed instant in the middle of a trading day, in restaurant time. */
const NOON = (() => {
  const now = new Date();
  const dayStart = startOfDayUtc(TZ, now);
  return new Date(dayStart.getTime() + 12 * 3_600_000 + 30 * 60_000);
})();

beforeEach(() => {
  mocks.staff.result = null;
  mocks.rpc.data = null;
  mocks.rpc.error = null;
  mocks.rpc.calls = [];
});

describe('resolveRange', () => {
  it('runs today from local midnight to now, bucketed by hour', () => {
    const range = resolveRange('today', TZ, NOON);

    expect(range.key).toBe('today');
    expect(range.fromIso).toBe(startOfDayUtc(TZ, NOON).toISOString());
    expect(range.toIso).toBe(NOON.toISOString());
    expect(range.bucket).toBe('hour');
    expect(range.days).toBe(1);
  });

  it('covers seven calendar days for the week, bucketed by day', () => {
    const range = resolveRange('7d', TZ, NOON);

    expect(range.fromIso).toBe(startOfDayOffsetUtc(TZ, NOON, 6).toISOString());
    expect(range.bucket).toBe('day');
    expect(range.days).toBe(7);
  });

  it('covers thirty calendar days for the month', () => {
    const range = resolveRange('30d', TZ, NOON);
    expect(range.fromIso).toBe(startOfDayOffsetUtc(TZ, NOON, 29).toISOString());
    expect(range.days).toBe(30);
  });

  it('treats a single custom day as an hourly range', () => {
    const range = resolveRange('custom', TZ, NOON, { from: '2026-10-14', to: '2026-10-14' });

    expect(range.key).toBe('custom');
    expect(range.bucket).toBe('hour');
    expect(range.days).toBe(1);
  });

  it('makes a multi-day custom range inclusive of both dates', () => {
    const range = resolveRange('custom', TZ, NOON, { from: '2026-10-01', to: '2026-10-07' });

    expect(range.days).toBe(7);
    expect(range.bucket).toBe('day');
    // The end is exclusive: the 7th is fully inside it, the 8th is not.
    expect(new Date(range.toIso).toISOString()).toBe(
      startOfDayUtc(TZ, new Date(Date.UTC(2026, 9, 8, 12))).toISOString(),
    );
  });

  it('swaps a backwards custom range instead of returning an empty day', () => {
    const range = resolveRange('custom', TZ, NOON, { from: '2026-10-07', to: '2026-10-01' });
    expect(range.days).toBe(7);
  });

  it('clamps a range longer than the maximum instead of asking the database', () => {
    const range = resolveRange('custom', TZ, NOON, { from: '2020-01-01', to: '2026-10-07' });
    expect(range.days).toBeLessThanOrEqual(MAX_RANGE_DAYS);
    expect(range.days).toBeGreaterThan(MAX_RANGE_DAYS - 2);
  });

  it('falls back to today when the custom dates are unreadable', () => {
    const range = resolveRange('custom', TZ, NOON, { from: 'yesterday', to: '???' });
    expect(range.key).toBe('today');
    expect(range.bucket).toBe('hour');
  });

  it('treats a lone "from" date as that one day, not a guess at an end date', () => {
    const range = resolveRange('custom', TZ, NOON, { from: '2026-10-01' });
    expect(range.days).toBe(1);
    expect(range.bucket).toBe('hour');
  });
});

describe('parseIsoDate', () => {
  it('rejects a date the calendar does not have', () => {
    expect(parseIsoDate('2026-02-31')).toBeNull();
  });

  it('rejects a partial or slash-separated date', () => {
    expect(parseIsoDate('2026-2-1')).toBeNull();
    expect(parseIsoDate('01/02/2026')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(parseIsoDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe('parseReportPayload', () => {
  it('returns an empty, renderable report for null', () => {
    const report = parseReportPayload(null);
    expect(report.totals.bills).toBe(0);
    expect(report.orders).toEqual([]);
  });

  it('rounds fractional paise instead of trusting them', () => {
    const report = parseReportPayload({
      totals: { bills: 6, billed_paise: 1200886, average_bill_paise: 200147.666666666667 },
    });
    expect(report.totals.averageBillPaise).toBe(200148);
    expect(Number.isInteger(report.totals.averageBillPaise)).toBe(true);
  });

  it('coerces a stringified bigint, which is what jsonb does to large numbers', () => {
    const report = parseReportPayload({ totals: { billed_paise: '1200886' } });
    expect(report.totals.billedPaise).toBe(1200886);
  });

  it('turns a non-array payload into empty lists rather than throwing', () => {
    const report = parseReportPayload({ orders: 'nope', top_items: null, buckets: {} });
    expect(report.orders).toEqual([]);
    expect(report.topItems).toEqual([]);
    expect(report.buckets).toEqual([]);
  });

  it('keeps a missing table label as null, not the string "null"', () => {
    const report = parseReportPayload({ orders: [{ id: 'o1', table_label: null }] });
    expect(report.orders[0].tableLabel).toBeNull();
  });
});

describe('zeroFillBuckets', () => {
  it('emits every hour of a closed past day, including the empty ones', () => {
    const past = new Date(NOON.getTime() - 3 * 86_400_000);
    const range = resolveRange('custom', TZ, NOON, {
      from: past.toISOString().slice(0, 10),
      to: past.toISOString().slice(0, 10),
    });

    const buckets = zeroFillBuckets(range, [], TZ, NOON);
    expect(buckets).toHaveLength(24);
    expect(buckets[0].label).toBe('12a');
    expect(buckets[13].label).toBe('1p');
    expect(buckets.every((b) => b.revenuePaise === 0)).toBe(true);
  });

  it('stops today at the current hour instead of drawing the future', () => {
    const range = resolveRange('today', TZ, NOON);
    const buckets = zeroFillBuckets(range, [], TZ, NOON);
    expect(buckets).toHaveLength(13); // midnight through 12:00
  });

  it('puts a real row into the bucket it belongs to', () => {
    const range = resolveRange('today', TZ, NOON);
    // The key is the restaurant's LOCAL day. fromIso is UTC, and IST midnight
    // is 18:30 the previous day in UTC, so slicing fromIso would build a key
    // that never matches. Take the key the filler itself produces.
    const [first] = zeroFillBuckets(range, [], TZ, NOON);
    const buckets = zeroFillBuckets(
      range,
      [{ key: first.key, bills: 2, revenuePaise: 50_000 }],
      TZ,
      NOON,
    );

    expect(buckets[0].bills).toBe(2);
    expect(buckets[0].revenuePaise).toBe(50_000);
  });

  it('emits one row per day for a week, empty days included', () => {
    const range = resolveRange('7d', TZ, NOON);
    const buckets = zeroFillBuckets(range, [], TZ, NOON);
    expect(buckets).toHaveLength(7);
  });

  it('ignores a row whose key is outside the range', () => {
    const range = resolveRange('today', TZ, NOON);
    const buckets = zeroFillBuckets(range, [{ key: '1999-01-01 00:00', bills: 9, revenuePaise: 900 }], TZ, NOON);
    expect(buckets.every((b) => b.revenuePaise === 0)).toBe(true);
  });
});

describe('csv', () => {
  it('quotes a comma and doubles an inner quote', () => {
    expect(csvCell('Butter Chicken, Full')).toBe('"Butter Chicken, Full"');
    expect(csvCell('the "special"')).toBe('"the ""special"""');
  });

  it('neutralises a spreadsheet formula', () => {
    // Prefixed with an apostrophe, then quoted for its own inner quotes. Both
    // are correct: the cell value is `'=HYPERLINK("http://x")`.
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('-Dal')).toBe("'-Dal");
  });

  it('leaves ordinary text alone', () => {
    expect(csvCell('Paneer Tikka')).toBe('Paneer Tikka');
    expect(csvCell(42)).toBe('42');
  });

  it('joins rows with CRLF and ends with a newline', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
  });

  it('writes money as rupees with two decimals', () => {
    expect(rupees(50740)).toBe('507.40');
    expect(rupees(0)).toBe('0.00');
    expect(rupees(5)).toBe('0.05');
    expect(rupees(-250)).toBe('-2.50');
  });

  it('exports the order ledger with an outstanding column', () => {
    const report = asView({
      orders: [
        {
          id: 'o1',
          code: 'MA-1',
          placed_at: '2026-10-21T10:00:00Z',
          prep_status: 'served',
          payment_status: 'paid',
          subtotal_paise: 43000,
          tax_paise: 7740,
          total_paise: 50740,
          paid_paise: 50000,
          refunded_paise: 0,
          table_label: 'T1',
        },
      ],
    });

    const csv = ordersCsv(report, TZ);
    const [head, row] = csv.split('\r\n');
    expect(head.split(',')).toContain('Outstanding');
    expect(row).toContain('MA-1');
    expect(row).toContain('T1');
    expect(row).toContain('7.40'); // 507.40 billed - 500.00 paid, in rupees
  });

  it('exports one line per dish with a line total', () => {
    const report = asView({
      lines: [
        { code: 'MA-1', placed_at: '2026-10-21T10:00:00Z', name: 'koko', variant: 'Half', qty: 2, unit_price_paise: 9000 },
      ],
    });
    const csv = itemsCsv(report, TZ);
    expect(csv).toContain('koko');
    expect(csv).toContain('Half');
    expect(csv).toContain('180.00');
  });

  it('states the billed/collected split in the summary header, not just the totals', () => {
    const range = resolveRange('today', TZ, NOON);
    const csv = summaryCsv(asView(null), range, TZ);
    expect(csv).toContain('Sales (billed)');
    expect(csv).toContain('Collected');
    expect(csv).toContain('Outstanding');
  });
});

describe('getReportsScreenData', () => {
  it('returns null when Supabase is unconfigured, so the screen shows its sample report', async () => {
    mocks.staff.result = { ok: false, reason: 'unconfigured' };
    expect(await getReportsScreenData({}, NOON)).toBeNull();
  });

  it('returns a blocked, empty report for a signed-out caller rather than sample data', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    const data = await getReportsScreenData({}, NOON);

    expect(data?.blocked).toBe('signed-out');
    expect(data?.report.totals.billedPaise).toBe(0);
    expect(data?.report.orders).toEqual([]);
  });

  it('passes the resolved range, the restaurant and the bucket to the RPC', async () => {
    mocks.staff.result = signedIn(fakeSupabase(mocks.rpc));
    await getReportsScreenData({ range: '7d' }, NOON);

    const args = mocks.rpc.calls[0];
    expect(args.p_restaurant_id).toBe('r-1');
    expect(args.p_bucket).toBe('day');
    expect(args.p_timezone).toBe(TZ);
    expect(args.p_order_limit).toBe(REPORT_ORDER_LIMIT);
    expect(args.p_to).toBe(NOON.toISOString());
  });

  it('defaults to today when the range in the URL is nonsense', async () => {
    mocks.staff.result = signedIn(fakeSupabase(mocks.rpc));
    await getReportsScreenData({ range: 'all-time' }, NOON);
    expect(mocks.rpc.calls[0].p_bucket).toBe('hour');
  });

  it('fills the empty buckets before handing the payload to the screen', async () => {
    mocks.rpc.data = { totals: { bills: 1, billed_paise: 1000 }, buckets: [] };
    mocks.staff.result = signedIn(fakeSupabase(mocks.rpc));

    const data = await getReportsScreenData({ range: '7d' }, NOON);
    expect(data?.report.buckets).toHaveLength(7);
    expect(data?.report.totals.billedPaise).toBe(1000);
  });

  it('flags a truncated order list from the bill count, not from the array length alone', async () => {
    mocks.rpc.data = { totals: { bills: 250 }, orders: [{ id: 'o1', code: 'MA-1' }] };
    mocks.staff.result = signedIn(fakeSupabase(mocks.rpc));

    expect((await getReportsScreenData({}, NOON))?.ordersTruncated).toBe(true);
  });

  it('throws with the database message when the RPC fails', async () => {
    mocks.rpc.error = { message: 'permission denied' };
    mocks.staff.result = signedIn(fakeSupabase(mocks.rpc));

    await expect(getReportsScreenData({}, NOON)).rejects.toThrow('permission denied');
  });
});

describe('demoReport', () => {
  it('is labelled sample data and still adds up', () => {
    const range = resolveRange('7d', TZ, NOON);
    const report = demoReport(range, TZ, NOON);

    expect(report.buckets).toHaveLength(7);
    expect(report.totals.collectedPaise).toBeLessThan(report.totals.billedPaise);
    expect(report.totals.unpaidPaise).toBe(
      report.totals.billedPaise - report.totals.collectedPaise,
    );
  });

  /**
   * A sample report is still a report. It used to be four hand-written sets of
   * numbers that contradicted each other -- the payment rows added up to a
   * fifth of "collected", the categories to a different total again, and the
   * top items were priced at a tenth of the menu -- so an owner reading it
   * could not tell which figure was the real one.
   */
  it('adds up across buckets, categories and payment methods', () => {
    for (const key of ['today', '7d', '30d'] as const) {
      const report = demoReport(resolveRange(key, TZ, NOON), TZ, NOON);

      const bucketRevenue = report.buckets.reduce((sum, b) => sum + b.revenuePaise, 0);
      const bucketBills = report.buckets.reduce((sum, b) => sum + b.bills, 0);
      expect(bucketRevenue).toBe(report.totals.billedPaise);
      expect(bucketBills).toBe(report.totals.bills);

      const categoryRevenue = report.categories.reduce((sum, c) => sum + c.revenuePaise, 0);
      expect(categoryRevenue).toBe(report.totals.billedPaise);

      const recorded = report.methods.reduce(
        (sum, m) => sum + m.recordedPaise - m.refundedPaise,
        0,
      );
      expect(recorded).toBe(report.totals.collectedPaise);

      // Nothing in the "top items" table can outsell the whole day.
      for (const item of report.topItems) {
        expect(item.revenuePaise).toBeLessThanOrEqual(report.totals.billedPaise);
      }
    }
  });

  it('prices the sample top items off the sample menu', () => {
    const report = demoReport(resolveRange('7d', TZ, NOON), TZ, NOON);
    const prices: Record<string, number> = {
      'Butter Chicken · Full': 46_900,
      'Paneer Tikka': 34_900,
      'Dal Bukhara': 38_900,
      'Garlic Naan': 9_900,
    };

    for (const item of report.topItems) {
      expect(item.revenuePaise).toBe(item.qty * prices[item.name]);
    }

    const revenues = report.topItems.map((item) => item.revenuePaise);
    expect([...revenues].sort((a, b) => b - a)).toEqual(revenues);
  });

  it('shows the same bills the kitchen and the counter show', () => {
    const report = demoReport(resolveRange('7d', TZ, NOON), TZ, NOON);
    const codes = report.orders.map((order) => order.code);

    expect(codes).toEqual(['A-1042', 'A-1041', 'A-1040', 'A-1039', 'A-1038', 'A-1037']);
    // A paid bill owes nothing; an unpaid one owes all of it. A row where the
    // two disagree is a row nobody can act on.
    for (const order of report.orders) {
      if (order.paymentStatus === 'paid') expect(order.paidPaise).toBe(order.totalPaise);
      else expect(order.paidPaise).toBe(0);
    }
  });
});
