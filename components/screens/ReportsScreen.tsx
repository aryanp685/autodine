import Link from 'next/link';
import type { OutletBar } from '@/lib/outlets';
import { Money, PaymentPill, PrepPill } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  OwnerPage,
  PageHead,
  SectionHead,
  Card,
  Panel,
  Stat,
  btn,
  chipClass,
  Tag,
  Empty,
  Notice,
  TableWrap,
  tableClass,
  Th,
  Td,
  Tr,
  inputClass,
} from '@/components/owner/chrome';
import {
  demoReport,
  type ReportView,
  type ReportRange,
  type ReportRangeKey,
  type ReportsScreenData,
} from '@/lib/db/reports';
import { dateTimeInZone, localDateKey } from '@/lib/db/time';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';

/**
 * Sales report.
 *
 * The one rule this screen is built around: BILLED and COLLECTED are two
 * different numbers and are never merged into a single "revenue" figure. In a
 * QR-ordering restaurant most tables settle at the counter on the way out, so
 * on any given evening the two differ by more than half the day. Showing the
 * billed figure under the word "revenue" would tell an owner they had a record
 * day on a day nobody had paid for yet.
 *
 * Every block that could be misread carries its definition in small type
 * underneath. That is deliberate: the numbers are only useful if the person
 * reading them knows exactly what was counted.
 */

const RANGE_TABS: Array<{ key: ReportRangeKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  online: 'Online',
};

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/**
 * Whether the bar at `index` prints its label.
 *
 * Up to a dozen buckets every one is legible; past that the label is dropped
 * to every Nth so the axis reads as dates rather than as a grey band. The last
 * bucket always prints -- on a 30-day range the right-hand edge is "today",
 * and an axis that stops at the 26th looks like the data does.
 */
export function everyNth(count: number, index: number): boolean {
  if (count <= 12) return true;
  if (index === count - 1) return true;
  return index % Math.ceil(count / 8) === 0;
}

function rangeHref(key: ReportRangeKey): string {
  return key === 'today' ? '/dashboard/reports' : `/dashboard/reports?range=${key}`;
}

/**
 * The export re-resolves the range from the same params the screen used, so
 * the file matches what was on screen. Those params are local DATES, not the
 * ISO instants the resolved range holds: a range that ends "now" would export
 * a slightly different window a second later, and a custom range must come
 * back as the days the owner picked.
 */
function exportHref(type: 'summary' | 'orders' | 'items', range: ReportRange, timeZone: string): string {
  const params = new URLSearchParams({ type, range: range.key });

  if (range.key === 'custom') {
    params.set('from', localDateKey(timeZone, new Date(range.fromIso)));
    // The end is exclusive, so the last included day is one millisecond back.
    params.set('to', localDateKey(timeZone, new Date(new Date(range.toIso).getTime() - 1)));
  }

  return `/dashboard/reports/export?${params.toString()}`;
}

/** One bar in the sales chart. Height is a percentage of the busiest bucket. */
function Bar({
  label,
  value,
  peak,
  bills,
  showLabel = true,
}: {
  label: string;
  value: number;
  peak: number;
  bills: number;
  /**
   * A 30-day range draws thirty bars. Thirty labels in the same width are not
   * small type, they are a smear -- so the axis prints every Nth tick and the
   * rest stay in the hover title. The bar itself never disappears: thinning
   * the labels must not thin the data.
   */
  showLabel?: boolean;
}) {
  const height = peak > 0 ? Math.max(2, Math.round((value / peak) * 100)) : 2;
  const empty = value <= 0;
  return (
    <div
      aria-hidden="true"
      className="group flex min-w-0 flex-1 flex-col items-center gap-1.5"
      title={`${label} · ${bills} bill${bills === 1 ? '' : 's'}`}
    >
      {/* A fixed floor so the columns have a common baseline, and the bar
          grows up from it. The track is invisible: a bar chart with a visible
          track at 4% reads as a value that failed. */}
      <div className="flex h-[136px] w-full items-end justify-center">
        <div
          className={[
            'w-full max-w-[40px] rounded-t-[3px] transition-[height,background-color] duration-300',
            empty ? 'bg-gink-07' : 'bg-gink/85 group-hover:bg-gink',
          ].join(' ')}
          style={{ height: `${height}%` }}
        />
      </div>
      <span className="w-full truncate text-center text-[10px] text-gink-46">
        {showLabel ? label : '\u00a0'}
      </span>
    </div>
  );
}

/**
 * A ranked list -- top items, or categories.
 *
 * The two blocks were the same markup written twice: same row, same bar, same
 * "sold" column, differing only in what the number means. Written twice they
 * had already drifted (one counted portions apart, the other not), and the
 * next change would have drifted them again.
 */
function RankList({
  rows,
  peak,
  quantityLabel,
}: {
  rows: ReadonlyArray<{ name: string; qty: number; revenuePaise: number }>;
  peak: number;
  /** "sold" on items, "sold" on categories too -- the figure is portions. */
  quantityLabel: string;
}) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((row) => (
        <li
          key={row.name}
          className="border-b border-hair py-2.5 first:pt-0 last:border-b-0 last:pb-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[12.5px] text-gink">{row.name}</span>
            <span className="shrink-0 text-[12.5px] text-gink tabular-nums">
              <Money value={row.revenuePaise} />
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-paper-deep">
              <span
                className="block h-full rounded-full bg-[var(--p-accent)]/70"
                style={{ width: `${share(row.revenuePaise, peak)}%` }}
              />
            </span>
            <span className="w-[58px] shrink-0 text-right text-[10.5px] text-gink-46 tabular-nums">
              {row.qty} {quantityLabel}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportsScreen({
  data,
  outlet,
  sampleRange,
}: {
  data?: ReportsScreenData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  /**
   * The range the URL asked for, when there is no database to resolve it.
   *
   * Without this the sample report was always the last seven days whatever the
   * URL said: the range chips changed the address bar and nothing else. That is
   * a dead control, and this screen is supposed to have none.
   */
  sampleRange?: ReportRange;
}) {
  const live = Boolean(data);
  const blocked = data?.blocked;

  // No database configured: a clearly-labelled sample report so the layout can
  // be judged. Never mixed with live numbers.
  const range: ReportRange = data?.range ??
    sampleRange ?? {
      key: '7d',
      fromIso: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      toIso: new Date().toISOString(),
      label: 'Sample · last 7 days',
      bucket: 'day',
      days: 7,
    };
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  /* The sample bills are placed relative to `now`, and `now` is the END OF THE
     RANGE it is previewing. Passed the wall clock instead, a custom window in
     the past drew an empty chart under the words "nothing billed" -- the sample
     saying there was no trade on a day it had itself just invented. */
  const report: ReportView = data?.report ?? demoReport(range, timezone, new Date(range.toIso));

  const totals = report.totals;
  const hasBills = totals.bills > 0;

  // Says what the list below actually is. The rows are capped, so a count that
  // does not match the totals has to be admitted rather than implied.
  const billWord = totals.bills === 1 ? 'bill' : 'bills';
  const ledgerNote =
    report.orders.length === 0
      ? hasBills
        ? `The ${totals.bills} ${billWord} behind these totals are not listed here — the totals above cover all of them`
        : 'Newest first'
      : report.orders.length < totals.bills
        ? `Showing the latest ${report.orders.length} of ${totals.bills} bills — the totals above cover all of them`
        : 'Newest first';
  const peak = Math.max(0, ...report.buckets.map((b) => b.revenuePaise));
  // The busiest bucket, named under the chart title. A bar chart with no scale
  // tells you the shape of the day but not one number on it, and the number
  // people ask for is "what was my best hour".
  const peakBucket = report.buckets.find((b) => b.revenuePaise === peak);

  // The two dates the range actually covers, in the restaurant's own timezone.
  // Filled back into the picker: a custom range used to load with two blank
  // date fields, so the owner could see the span in the heading but not in the
  // control that set it -- and pressing Apply with them empty submitted
  // nothing at all.
  const fromDate = localDateKey(timezone, new Date(range.fromIso));
  const toDate = localDateKey(timezone, new Date(new Date(range.toIso).getTime() - 1));
  const customActive = range.key === 'custom';
  const itemPeak = Math.max(0, ...report.topItems.map((i) => i.revenuePaise));
  const categoryPeak = Math.max(0, ...report.categories.map((c) => c.revenuePaise));

  return (
    <OwnerPage active="reports" outlet={outlet} wide>
      <PageHead
        kicker="Reports"
        title="Sales"
        meta={
          <>
            {blocked
              ? 'Sign in to see your takings'
              : live
                ? range.label
                : 'Sample report · fictional takings'}
            <span className="mx-2 text-gink-28">·</span>
            {timezone}
          </>
        }
        actions={
          live && !blocked ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Plain anchors, not <Link>: these URLs are route handlers that
                  answer with an attachment, so a client-side navigation would
                  fetch an RSC payload the route cannot produce. `download`
                  names the file and keeps the report on screen. */}
              <a className={btn('ghost', 'sm')} href={exportHref('summary', range, timezone)} download>
                Summary CSV
              </a>
              <a className={btn('ghost', 'sm')} href={exportHref('items', range, timezone)} download>
                Item CSV
              </a>
              <a className={btn('solid', 'sm')} href={exportHref('orders', range, timezone)} download>
                Order CSV
              </a>
            </div>
          ) : null
        }
      />

      {blocked && <SignInPrompt reason={blocked} screen="sales report" />}

      {!blocked && (
        <>
          {/* Two facts stated once, at the top, before any figure is read: the
              numbers below are fictional, or the range is empty. Both used to
              be said at the bottom of a page of scrolling, or not at all. */}
          {!live ? (
            <Notice tone="due" label="Database not configured.">
              Every figure on this page is fictional sample data — the layout can be judged, and
              nothing here is a takings record.
            </Notice>
          ) : null}

          {live && !hasBills ? (
            <Notice
              tone="plain"
              label="Nothing billed in this range."
              action={
                <Link href={rangeHref('7d')} className={btn('ghost', 'sm')}>
                  Last 7 days
                </Link>
              }
            >
              Nothing was billed {customActive ? 'between the dates you picked' : 'in this window'},
              so every block below is empty rather than wrong.
            </Notice>
          ) : null}

          {/* ------------------------------------------------------- the window
              One bar, two jobs: pick a preset, or edit the exact days. The
              custom fields are pre-filled with the range that is on screen --
              they used to be blank, which meant the owner could read the span
              in the heading but not in the control that set it, and Apply on an
              empty form submitted nothing. */}
          <Card className="mb-4 px-3.5 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-[11.5px] text-gink-46">Range</span>
                {RANGE_TABS.map((tab) => {
                  const current = range.key === tab.key;
                  return (
                    <Link
                      key={tab.key}
                      href={rangeHref(tab.key)}
                      aria-current={current ? 'true' : undefined}
                      data-range={current ? 'current' : 'other'}
                      className={chipClass(current)}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </div>

              <form
                className="flex flex-wrap items-center gap-1.5"
                method="get"
                action="/dashboard/reports"
              >
                <input type="hidden" name="range" value="custom" />
                {/* A label, not a control: "Custom" is not a destination, it is
                    the state the two date fields below are in. */}
                {customActive ? (
                  <Tag tone="work">Custom</Tag>
                ) : (
                  <span className="text-[11.5px] text-gink-46">Custom</span>
                )}
                <label className="flex items-center gap-1.5 text-[11.5px] text-gink-46">
                  From
                  <input
                    type="date"
                    name="from"
                    required
                    aria-label="From"
                    defaultValue={fromDate}
                    className={`${inputClass} h-9! w-[142px]! text-[12.5px]!`}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11.5px] text-gink-46">
                  To
                  <input
                    type="date"
                    name="to"
                    required
                    aria-label="To"
                    defaultValue={toDate}
                    className={`${inputClass} h-9! w-[142px]! text-[12.5px]!`}
                  />
                </label>
                <button type="submit" className={btn('ghost', 'sm')}>
                  Apply
                </button>
              </form>
            </div>
          </Card>

          {/* ------------------------------------------------------- four figures
              Billed and collected are never merged. Every card says, in small
              type, exactly what its number counts. */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {/* Sales leads: it is the figure an owner opens this screen for, so
                it gets the size and the only warm wash on the row. Collected
                and Outstanding stay the same object at the same weight -- they
                are answers to a question asked because of this number, not
                four equal boxes. */}
            <Stat
              label="Sales"
              lead
              value={<Money value={totals.billedPaise} />}
              meta={`${totals.bills} bill${totals.bills === 1 ? '' : 's'} · what was sold`}
            />
            <Stat
              label="Collected"
              value={<Money value={totals.collectedPaise} />}
              meta="Money actually recorded"
            />
            <Stat
              label="Outstanding"
              value={<Money value={totals.unpaidPaise} />}
              meta="Billed, not yet settled"
              /* Alert, not green: this is the figure to chase. Green said
                 "this is running", which is the opposite of the meaning. */
              tone={totals.unpaidPaise > 0 ? 'due' : 'plain'}
            />
            <Stat
              label="Average bill"
              value={<Money value={totals.averageBillPaise} />}
              meta={hasBills ? 'Sales ÷ bills' : 'No bills in this range'}
            />
          </section>

          {/* ------------------------------------------------- chart + methods */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel
              title={`Sales by ${range.bucket}`}
              meta={
                /* The chart's own scale, in words. A bar chart with no axis
                   tells you the shape of the day and not one number on it, and
                   the number people ask is "what was my best hour". */
                peak > 0 && peakBucket
                  ? `Peak ${inr(paiseToRupees(peak))} · ${peakBucket.label}`
                  : `Billed · ${range.label}`
              }
              bodyClassName="px-4 py-4 sm:px-5"
            >
              {peak > 0 ? (
                <div className="overflow-x-auto" data-chart>
                  {/* One image for a screen reader, because thirty <div> bars
                      announce as nothing at all. The detail stays in each
                      bar's title for a mouse. */}
                  <div
                    role="img"
                    aria-label={`Sales by ${range.bucket}, ${range.label}. Busiest: ${peakBucket?.label ?? ''}, ${inr(
                      paiseToRupees(peak),
                    )}. ${totals.bills} bill${totals.bills === 1 ? '' : 's'} in the range.`}
                    className="flex min-w-full items-end gap-1.5"
                  >
                    {report.buckets.map((bucket, i) => (
                      <Bar
                        key={bucket.key}
                        label={bucket.label}
                        value={bucket.revenuePaise}
                        peak={peak}
                        bills={bucket.bills}
                        showLabel={everyNth(report.buckets.length, i)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <Empty>
                  Nothing billed in this range yet. The chart fills in as orders are placed.
                </Empty>
              )}
            </Panel>

            <Panel title="How it was paid" meta="Recorded payments">
              {report.methods.length > 0 || totals.unpaidPaise > 0 ? (
                <>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <Th>Method</Th>
                        <Th align="right">Payments</Th>
                        <Th align="right">Amount</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.methods.map((m) => (
                        <Tr key={m.method}>
                          <Td>{methodLabel(m.method)}</Td>
                          <Td align="right">{m.count}</Td>
                          <Td align="right">
                            <Money value={m.recordedPaise} />
                          </Td>
                        </Tr>
                      ))}
                      {totals.unpaidPaise > 0 && (
                        <Tr>
                          <Td>
                            <span className="text-gink-64">Not settled yet</span>
                          </Td>
                          <Td align="right">
                            <span className="text-gink-28">—</span>
                          </Td>
                          <Td align="right">
                            <Money value={totals.unpaidPaise} />
                          </Td>
                        </Tr>
                      )}
                    </tbody>
                  </table>
                  {totals.refundedPaise > 0 && (
                    <p className="mt-2.5 text-[11.5px] text-gink-46">
                      Refunded in this range: <Money value={totals.refundedPaise} />
                    </p>
                  )}
                </>
              ) : (
                <Empty>No payments recorded in this range.</Empty>
              )}
            </Panel>
          </div>

          {/* ------------------------------------------------ what sold, ranked */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Top items" meta="By sales · portions counted apart">
              {report.topItems.length > 0 ? (
                <RankList rows={report.topItems} peak={itemPeak} quantityLabel="sold" />
              ) : (
                <Empty>Nothing sold in this range. Items rank here once a bill exists.</Empty>
              )}
            </Panel>

            <Panel title="By category" meta="From the menu, as it is today">
              {report.categories.length > 0 ? (
                <RankList rows={report.categories} peak={categoryPeak} quantityLabel="sold" />
              ) : (
                <Empty>No dishes sold in this range.</Empty>
              )}
            </Panel>
          </div>

          {/* --------------------------------------------------------- the ledger */}
          <section className="mt-4" aria-labelledby="report-ledger">
            <SectionHead
              title={<span id="report-ledger">Order ledger</span>}
              meta={
                /* The list is capped, so it is only "the bills" when it is all
                   of them. Derived from the rows themselves. */
                ledgerNote
              }
            />
            <Card className="overflow-hidden">
              {report.orders.length > 0 ? (
                <TableWrap>
                  <table className={tableClass} data-report-ledger>
                    <thead>
                      <tr>
                        <Th>Time</Th>
                        <Th>Table</Th>
                        <Th>Kitchen</Th>
                        <Th>Payment</Th>
                        <Th align="right">Total</Th>
                        <Th align="right">Outstanding</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.orders.map((order) => {
                        const outstanding = Math.max(0, order.totalPaise - order.paidPaise);
                        const cancelled = order.prepStatus === 'cancelled';
                        return (
                          <Tr key={order.id} data-void={cancelled ? 'true' : undefined}>
                            <Td>
                              <span className="text-[12.5px] text-gink-64 tabular-nums">
                                {dateTimeInZone(timezone, order.placedAt)}
                              </span>
                            </Td>
                            <Td>{order.tableLabel ?? 'Takeaway'}</Td>
                            <Td>
                              {cancelled ? (
                                <Tag tone="failed">Cancelled</Tag>
                              ) : (
                                <PrepPill
                                  state={
                                    order.prepStatus === 'preparing' ||
                                    order.prepStatus === 'ready' ||
                                    order.prepStatus === 'served'
                                      ? order.prepStatus
                                      : 'new'
                                  }
                                />
                              )}
                            </Td>
                            <Td>
                              <PaymentPill
                                state={
                                  order.paymentStatus === 'pending'
                                    ? 'pending'
                                    : order.paymentStatus === 'failed'
                                      ? 'failed'
                                      : 'paid'
                                }
                              />
                            </Td>
                            <Td align="right">
                              <Money value={order.totalPaise} />
                            </Td>
                            <Td align="right">
                              {outstanding > 0 ? (
                                <span className="text-[var(--alert)]">
                                  <Money value={outstanding} />
                                </span>
                              ) : (
                                <span className="text-gink-28">—</span>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <div className="px-4 py-4">
                  <Empty>No bills in this range.</Empty>
                </div>
              )}
            </Card>
          </section>

          {/* --------------------------------------------------------- the notes
              Kept, because the difference between the two figures is the thing
              this screen exists to make obvious. */}
          <div className="mt-5 grid gap-2.5 lg:grid-cols-2">
            <Notice tone="plain" label="How to read these figures" className="mb-0">
              <strong className="font-semibold text-gink">Sales</strong> is what was billed: the
              sum of order totals, excluding cancelled bills.{' '}
              <strong className="font-semibold text-gink">Collected</strong> is money actually
              recorded against those bills.{' '}
              <strong className="font-semibold text-gink">Outstanding</strong> is the difference and
              is the figure to chase. They are separate on purpose — most tables settle at the
              counter on the way out.
            </Notice>
            <Notice tone="plain" label="GST on bills" className="mb-0">
              <Money value={totals.taxPaise} /> charged across {totals.bills} bill
              {totals.bills === 1 ? '' : 's'}
              {totals.discountPaise > 0 && (
                <>
                  {' '}· discounts <Money value={totals.discountPaise} />
                </>
              )}
              {totals.cancelled > 0 && (
                <>
                  {' '}· {totals.cancelled} cancelled bill
                  {totals.cancelled === 1 ? '' : 's'} excluded from every figure above
                </>
              )}
              . This is what the menu charged, not a filing-ready return.
            </Notice>
          </div>
        </>
      )}
    </OwnerPage>
  );
}
