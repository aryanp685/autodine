/**
 * Sales reports.
 *
 * WHY THE AGGREGATION IS NOT IN THIS FILE
 *
 * A 30-day report at a busy venue is thousands of bills and tens of thousands
 * of lines. PostgREST has no join, so building that in TypeScript would mean
 * fetching the orders, then chunking every order id into `.in()` lists for
 * order_items and payments -- dozens of round trips per page load, each one
 * capped by URL length. `public.report_sales()` does it in one query. This
 * module owns everything the database should not: the range the owner asked
 * for, filling the empty buckets, shaping the payload into types, and writing
 * the CSV.
 *
 * BILLED AND COLLECTED ARE TWO DIFFERENT NUMBERS
 *
 *   billed     what the restaurant sold. Sum of order totals.
 *   collected  what it was actually paid. Sum of recorded payments.
 *   unpaid     the gap. In a QR-ordering restaurant this is most of the
 *              evening, and it is the number an owner chases.
 *
 * Reporting one as the other is the easiest way to tell someone they had their
 * best day ever on a day nobody has paid for yet. Every surface that shows
 * these carries the definition next to it.
 */

import { getStaffContextDetailed } from './staff';
import {
  RESTAURANT_TIME_ZONE,
  hourInZone,
  localDateKey,
  localDateParts,
  startOfDayOffsetUtc,
  startOfLocalDayUtc,
  startOfDayUtc,
} from './time';

/* ======================================================================= range */

export type ReportRangeKey = 'today' | '7d' | '30d' | 'custom';

export const REPORT_RANGE_KEYS: readonly ReportRangeKey[] = ['today', '7d', '30d', 'custom'] as const;

/** Nobody needs a report longer than this, and a typo in a date picker is cheaper to refuse. */
export const MAX_RANGE_DAYS = 366;

/** How many orders the screen lists. The totals above it never truncate. */
export const REPORT_ORDER_LIMIT = 100;

export function isReportRangeKey(value: string | undefined | null): value is ReportRangeKey {
  return value === 'today' || value === '7d' || value === '30d' || value === 'custom';
}

export type ReportRange = {
  key: ReportRangeKey;
  /** Inclusive. */
  fromIso: string;
  /** Exclusive: the instant the range ends. */
  toIso: string;
  /** Written for a human: 'Today · 21 Oct 2026'. */
  label: string;
  bucket: 'hour' | 'day';
  /** Whole local days the range covers. 1 for today and for a single custom day. */
  days: number;
};

type LocalDate = { year: number; month: number; day: number };

/** 'YYYY-MM-DD' -> parts, or null. Rejects 2026-02-31 as well as nonsense. */
export function parseIsoDate(value: string | undefined | null): LocalDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function formatDay(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(at);
}

function formatDayShort(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
  }).format(at);
}

/** Whole local days between two UTC instants that are already local midnights. */
function dayCount(from: Date, toExclusive: Date): number {
  const ms = toExclusive.getTime() - from.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function build(
  key: ReportRangeKey,
  timeZone: string,
  from: Date,
  toExclusive: Date,
  label: string,
): ReportRange {
  const days = dayCount(from, toExclusive);
  return {
    key,
    fromIso: from.toISOString(),
    toIso: toExclusive.toISOString(),
    label,
    // A single day is worth an hour-by-hour chart. Anything longer becomes a
    // wall of sixty labels and is easier to read day by day.
    bucket: days === 1 ? 'hour' : 'day',
    days,
  };
}

/**
 * Turn the requested key into a concrete range on the restaurant's clock.
 *
 * A custom range with an unparseable date falls back to today rather than
 * throwing: the owner is looking at a screen, not an API, and a crash on a
 * half-typed date is a worse answer than showing them today.
 */
export function resolveRange(
  key: ReportRangeKey,
  timeZone: string,
  now: Date = new Date(),
  custom: { from?: string; to?: string } = {},
): ReportRange {
  if (key === 'custom') {
    const fromParts = parseIsoDate(custom.from);
    const toParts = parseIsoDate(custom.to);

    if (fromParts || toParts) {
      const startParts = fromParts ?? { ...(toParts as LocalDate), day: (toParts as LocalDate).day - 6 };
      const endParts = toParts ?? fromParts ?? startParts;

      let from = startOfLocalDayUtc(timeZone, startParts);
      let toExclusive = startOfLocalDayUtc(timeZone, { ...endParts, day: endParts.day + 1 });

      // A backwards range is a slip of the date picker, not a request to fail.
      if (from >= toExclusive) {
        const swapFrom = startOfLocalDayUtc(timeZone, endParts);
        const swapTo = startOfLocalDayUtc(timeZone, { ...startParts, day: startParts.day + 1 });
        from = swapFrom;
        toExclusive = swapTo;
      }

      // Clamp instead of refusing: the SQL function rejects anything over 400
      // days, and a silent clamp with an honest label beats an error page.
      if (dayCount(from, toExclusive) > MAX_RANGE_DAYS) {
        const local = localDateParts(timeZone, toExclusive);
        const clamped = startOfLocalDayUtc(timeZone, { ...local, day: local.day - MAX_RANGE_DAYS });
        from = clamped;
      }

      const single = dayCount(from, toExclusive) === 1;
      const label = single
        ? formatDay(timeZone, from)
        : `${formatDayShort(timeZone, from)} – ${formatDay(timeZone, new Date(toExclusive.getTime() - 1))}`;

      return build('custom', timeZone, from, toExclusive, label);
    }

    // Nothing usable in the query string. Today is the least surprising answer.
    key = 'today';
  }

  if (key === 'today') {
    return build(
      'today',
      timeZone,
      startOfDayUtc(timeZone, now),
      now,
      `Today · ${formatDay(timeZone, now)}`,
    );
  }

  const days = key === '7d' ? 7 : 30;
  const from = startOfDayOffsetUtc(timeZone, now, days - 1);
  const lastCompleteDay = startOfDayUtc(timeZone, now);
  const label = `${formatDayShort(timeZone, from)} – ${formatDayShort(
    timeZone,
    new Date(lastCompleteDay.getTime()),
  )}`;

  // Runs to now, not to midnight: a report opened at noon should not promise
  // eight hours of trade that has not happened.
  return build(key, timeZone, from, now, label);
}

/* ===================================================================== payload */

export type ReportTotals = {
  bills: number;
  cancelled: number;
  billedPaise: number;
  taxPaise: number;
  discountPaise: number;
  collectedPaise: number;
  refundedPaise: number;
  unpaidPaise: number;
  averageBillPaise: number;
};

export type ReportBucketRow = { key: string; bills: number; revenuePaise: number };

export type ReportBucket = ReportBucketRow & { label: string };

export type ReportItemRow = { name: string; qty: number; revenuePaise: number };

export type ReportMethodRow = {
  method: string;
  count: number;
  recordedPaise: number;
  refundedPaise: number;
};

export type ReportOrderRow = {
  id: string;
  code: string;
  placedAt: string;
  prepStatus: string;
  paymentStatus: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  refundedPaise: number;
  tableLabel: string | null;
};

export type ReportLineRow = {
  code: string;
  placedAt: string;
  name: string;
  variant: string | null;
  qty: number;
  unitPricePaise: number;
};

/**
 * What the screen renders: the payload with every bucket present and
 * labelled. The raw buckets from jsonb have no label -- the label depends on
 * the restaurant's time zone and on how far through today we are, both of
 * which are decided here, not in SQL.
 */
export type ReportView = Omit<ReportPayload, 'buckets'> & { buckets: ReportBucket[] };

export type ReportPayload = {
  totals: ReportTotals;
  buckets: ReportBucketRow[];
  topItems: ReportItemRow[];
  categories: ReportItemRow[];
  methods: ReportMethodRow[];
  orders: ReportOrderRow[];
  lines: ReportLineRow[];
};

export const EMPTY_TOTALS: ReportTotals = {
  bills: 0,
  cancelled: 0,
  billedPaise: 0,
  taxPaise: 0,
  discountPaise: 0,
  collectedPaise: 0,
  refundedPaise: 0,
  unpaidPaise: 0,
  averageBillPaise: 0,
};

/**
 * jsonb arrives as `unknown`. Every field is coerced rather than trusted:
 * a column added or renamed upstream should leave this screen rendering one
 * zero, not throwing and taking the whole page down.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Money is a whole number of paise. Anything fractional is rounded, never trusted. */
function money(value: unknown): number {
  return Math.round(num(value));
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function parseReportPayload(raw: unknown): ReportPayload {
  const root = asRecord(raw);
  const totals = asRecord(root.totals);

  return {
    totals: {
      bills: num(totals.bills),
      cancelled: num(totals.cancelled),
      billedPaise: money(totals.billed_paise),
      taxPaise: money(totals.tax_paise),
      discountPaise: money(totals.discount_paise),
      collectedPaise: money(totals.collected_paise),
      refundedPaise: money(totals.refunded_paise),
      unpaidPaise: money(totals.unpaid_paise),
      averageBillPaise: money(totals.average_bill_paise),
    },
    buckets: asArray(root.buckets).map((row) => {
      const r = asRecord(row);
      return { key: text(r.key), bills: num(r.bills), revenuePaise: money(r.revenue_paise) };
    }),
    topItems: asArray(root.top_items).map((row) => {
      const r = asRecord(row);
      return { name: text(r.name), qty: num(r.qty), revenuePaise: money(r.revenue_paise) };
    }),
    categories: asArray(root.categories).map((row) => {
      const r = asRecord(row);
      return { name: text(r.name), qty: num(r.qty), revenuePaise: money(r.revenue_paise) };
    }),
    methods: asArray(root.methods).map((row) => {
      const r = asRecord(row);
      return {
        method: text(r.method, 'unknown'),
        count: num(r.count),
        recordedPaise: money(r.recorded_paise),
        refundedPaise: money(r.refunded_paise),
      };
    }),
    orders: asArray(root.orders).map((row) => {
      const r = asRecord(row);
      return {
        id: text(r.id),
        code: text(r.code),
        placedAt: text(r.placed_at),
        prepStatus: text(r.prep_status, 'new'),
        paymentStatus: text(r.payment_status, 'pending'),
        subtotalPaise: money(r.subtotal_paise),
        discountPaise: money(r.discount_paise),
        taxPaise: money(r.tax_paise),
        totalPaise: money(r.total_paise),
        paidPaise: money(r.paid_paise),
        refundedPaise: money(r.refunded_paise),
        tableLabel: typeof r.table_label === 'string' ? r.table_label : null,
      };
    }),
    lines: asArray(root.lines).map((row) => {
      const r = asRecord(row);
      return {
        code: text(r.code),
        placedAt: text(r.placed_at),
        name: text(r.name),
        variant: typeof r.variant === 'string' ? r.variant : null,
        qty: num(r.qty),
        unitPricePaise: money(r.unit_price_paise),
      };
    }),
  };
}

/* ==================================================================== buckets */

function hourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

/**
 * The database returns only the buckets that have bills in them. A chart that
 * silently skips the hours with no trade draws a smooth line through a quiet
 * afternoon and tells the owner their evening was flat when it was not. Every
 * bucket in the range is emitted, empty ones included.
 */
export function zeroFillBuckets(
  range: ReportRange,
  rows: ReportBucketRow[],
  timeZone: string,
  now: Date = new Date(),
): ReportBucket[] {
  const byKey = new Map<string, ReportBucketRow>();
  for (const row of rows) byKey.set(row.key, row);

  const out: ReportBucket[] = [];
  const start = new Date(range.fromIso);
  const end = new Date(range.toIso);

  if (range.bucket === 'hour') {
    const dayKey = localDateKey(timeZone, start);
    // A day that is still running stops at the current hour; a closed day in
    // the past runs to midnight. Comparing local dates rather than instants
    // matters: today's range ends at `now`, so `now < end` is never true and
    // would have drawn a full 24-hour chart into the future every morning.
    const coversNow = localDateKey(timeZone, now) === dayKey;
    const lastHour = coversNow ? hourInZone(timeZone, now) : 23;

    for (let hour = 0; hour <= lastHour; hour += 1) {
      const key = `${dayKey} ${String(hour).padStart(2, '0')}:00`;
      const row = byKey.get(key);
      out.push({
        key,
        label: hourLabel(hour),
        bills: row?.bills ?? 0,
        revenuePaise: row?.revenuePaise ?? 0,
      });
    }
    return out;
  }

  for (let cursor = start; cursor < end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const key = `${localDateKey(timeZone, cursor)} 00:00`;
    const row = byKey.get(key);
    out.push({
      key,
      label: formatDayShort(timeZone, cursor),
      bills: row?.bills ?? 0,
      revenuePaise: row?.revenuePaise ?? 0,
    });
  }

  return out;
}

/* ========================================================================= csv */

/**
 * One CSV cell.
 *
 * Two jobs, both of which have bitten spreadsheets before:
 *   - quote anything with a comma, quote or newline, doubling inner quotes
 *   - neutralise a leading = + - @ so an item an owner typed as "-Dal" (or a
 *     planted "=HYPERLINK(...)") is data, not a formula Excel will run.
 */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/["\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Array<Array<string | number>>): string {
  // CRLF and a trailing newline: Excel on Windows is the main consumer.
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Rupees with two decimals. Reports are read by accountants, not by a screen. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function stamp(timeZone: string, iso: string): { date: string; time: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}`,
  };
}

export function ordersCsv(report: ReportView, timeZone: string): string {
  const head = [
    'Date',
    'Time',
    'Reference',
    'Table',
    'Kitchen',
    'Payment',
    'Subtotal',
    'Discount',
    'Tax',
    'Total',
    'Paid',
    'Refunded',
    'Outstanding',
  ];

  const rows = report.orders.map((o) => {
    const at = stamp(timeZone, o.placedAt);
    return [
      at.date,
      at.time,
      o.code,
      o.tableLabel ?? 'Takeaway',
      o.prepStatus,
      o.paymentStatus,
      rupees(o.subtotalPaise),
      rupees(o.discountPaise),
      rupees(o.taxPaise),
      rupees(o.totalPaise),
      rupees(o.paidPaise),
      rupees(o.refundedPaise),
      rupees(Math.max(0, o.totalPaise - o.paidPaise)),
    ];
  });

  return toCsv([head, ...rows]);
}

export function itemsCsv(report: ReportView, timeZone: string): string {
  const head = ['Date', 'Time', 'Reference', 'Item', 'Portion', 'Qty', 'Unit price', 'Line total'];
  const rows = report.lines.map((line) => {
    const at = stamp(timeZone, line.placedAt);
    return [
      at.date,
      at.time,
      line.code,
      line.name,
      line.variant ?? '',
      line.qty,
      rupees(line.unitPricePaise),
      rupees(line.unitPricePaise * line.qty),
    ];
  });
  return toCsv([head, ...rows]);
}

/**
 * The one-page summary. Sections are stacked with a blank line between them:
 * CSV has no concept of two tables, and an accountant reading this in Excel
 * understands a blank row far better than three files.
 */
export function summaryCsv(report: ReportView, range: ReportRange, timeZone: string): string {
  const t = report.totals;
  const rows: Array<Array<string | number>> = [
    ['AutoDine sales report'],
    ['Range', range.label],
    ['From', range.fromIso],
    ['To (exclusive)', range.toIso],
    ['Time zone', timeZone],
    [],
    ['Summary', ''],
    ['Bills', t.bills],
    ['Cancelled (excluded)', t.cancelled],
    ['Sales (billed)', rupees(t.billedPaise)],
    ['Collected', rupees(t.collectedPaise)],
    ['Outstanding', rupees(t.unpaidPaise)],
    ['Refunded', rupees(t.refundedPaise)],
    ['GST on bills', rupees(t.taxPaise)],
    ['Discounts', rupees(t.discountPaise)],
    ['Average bill', rupees(t.averageBillPaise)],
    [],
    ['Period', 'Bills', 'Sales'],
    ...report.buckets.map((b) => [b.label, b.bills, rupees(b.revenuePaise)]),
    [],
    ['Item', 'Qty', 'Sales'],
    ...report.topItems.map((i) => [i.name, i.qty, rupees(i.revenuePaise)]),
    [],
    ['Category', 'Qty', 'Sales'],
    ...report.categories.map((c) => [c.name, c.qty, rupees(c.revenuePaise)]),
    [],
    ['Payment method', 'Payments', 'Recorded', 'Refunded'],
    ...report.methods.map((m) => [m.method, m.count, rupees(m.recordedPaise), rupees(m.refundedPaise)]),
  ];

  return toCsv(rows);
}

/* ====================================================================== loader */

export type ReportsScreenData = {
  restaurantName: string;
  tagline: string | null;
  timezone: string;
  range: ReportRange;
  report: ReportView;
  /** True when the range holds more bills than the table lists. */
  ordersTruncated: boolean;
  blocked?: 'signed-out' | 'no-membership';
};

/**
 * `includeLines` and `orderLimit` exist for the CSV export, which wants the
 * whole ledger rather than the hundred rows the screen lists. The screen never
 * sets them: a page that pulled every line of a 30-day range would be slower
 * for no reason.
 */
export async function getReportsScreenData(
  params: {
    range?: string;
    from?: string;
    to?: string;
    includeLines?: boolean;
    orderLimit?: number;
  } = {},
  now: Date = new Date(),
): Promise<ReportsScreenData | null> {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    // Unconfigured: the screen renders its labelled sample report instead.
    if (staff.reason === 'unconfigured') return null;
    const timezone = RESTAURANT_TIME_ZONE;
    const range = resolveRange(isReportRangeKey(params.range) ? params.range : 'today', timezone, now);
    return {
      restaurantName: '',
      tagline: null,
      timezone,
      range,
      report: { ...emptyPayload(), buckets: zeroFillBuckets(range, [], timezone, now) },
      ordersTruncated: false,
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, restaurantName, timezone, tagline } = staff.context;
  const key = isReportRangeKey(params.range) ? params.range : 'today';
  const range = resolveRange(key, timezone, now, { from: params.from, to: params.to });

  const { data, error } = await supabase.rpc('report_sales', {
    p_restaurant_id: restaurantId,
    p_from: range.fromIso,
    p_to: range.toIso,
    p_timezone: timezone,
    p_bucket: range.bucket,
    p_order_limit: params.orderLimit ?? REPORT_ORDER_LIMIT,
    p_include_lines: params.includeLines ?? false,
  });

  if (error) throw new Error(`Could not load the report: ${error.message}`);

  const report = parseReportPayload(data);

  return {
    restaurantName,
    tagline,
    timezone,
    range,
    report: { ...report, buckets: zeroFillBuckets(range, report.buckets, timezone, now) },
    ordersTruncated: report.totals.bills > report.orders.length,
  };
}

export function emptyPayload(): ReportPayload {
  return {
    totals: { ...EMPTY_TOTALS },
    buckets: [],
    topItems: [],
    categories: [],
    methods: [],
    orders: [],
    lines: [],
  };
}

/**
 * Sample report for the unconfigured case, so the layout can be judged without
 * a database. Every surface that renders it says it is sample data -- an owner
 * who has not signed in must never see fabricated takings that look real.
 */
export function demoReport(range: ReportRange, timeZone: string, now: Date = new Date()): ReportView {
  const raw: ReportBucketRow[] = range.bucket === 'hour'
    ? [
        { key: `${localDateKey(timeZone, new Date(range.fromIso))} 12:00`, bills: 3, revenuePaise: 184_300 },
        { key: `${localDateKey(timeZone, new Date(range.fromIso))} 13:00`, bills: 5, revenuePaise: 296_100 },
        { key: `${localDateKey(timeZone, new Date(range.fromIso))} 19:00`, bills: 4, revenuePaise: 421_800 },
        { key: `${localDateKey(timeZone, new Date(range.fromIso))} 20:00`, bills: 6, revenuePaise: 588_400 },
      ]
    : [
        { key: `${localDateKey(timeZone, startOfDayOffsetUtc(timeZone, now, 2))} 00:00`, bills: 18, revenuePaise: 1_284_000 },
        { key: `${localDateKey(timeZone, startOfDayOffsetUtc(timeZone, now, 1))} 00:00`, bills: 24, revenuePaise: 1_742_500 },
        { key: `${localDateKey(timeZone, startOfDayUtc(timeZone, now))} 00:00`, bills: 18, revenuePaise: 1_490_600 },
      ];

  const billed = raw.reduce((sum, b) => sum + b.revenuePaise, 0);

  return {
    ...emptyPayload(),
    totals: {
      bills: 60,
      cancelled: 1,
      billedPaise: billed,
      taxPaise: Math.round(billed * 0.18),
      discountPaise: 24_000,
      collectedPaise: Math.round(billed * 0.62),
      refundedPaise: 0,
      unpaidPaise: billed - Math.round(billed * 0.62),
      averageBillPaise: Math.round(billed / 60),
    },
    buckets: zeroFillBuckets(range, raw, timeZone, now),
    topItems: [
      { name: 'Butter Chicken · Full', qty: 34, revenuePaise: 159_460 },
      { name: 'Paneer Tikka', qty: 41, revenuePaise: 143_090 },
      { name: 'Dal Makhani', qty: 29, revenuePaise: 101_210 },
      { name: 'Garlic Naan', qty: 88, revenuePaise: 52_800 },
    ],
    categories: [
      { name: 'Main Course', qty: 96, revenuePaise: 402_600 },
      { name: 'Starters', qty: 74, revenuePaise: 258_300 },
      { name: 'Breads', qty: 128, revenuePaise: 76_800 },
    ],
    methods: [
      { method: 'upi', count: 22, recordedPaise: 640_000, refundedPaise: 0 },
      { method: 'card', count: 9, recordedPaise: 288_000, refundedPaise: 0 },
      { method: 'cash', count: 4, recordedPaise: 96_000, refundedPaise: 0 },
    ],
  };
}
