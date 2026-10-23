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
  Tag,
  Empty,
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
}: {
  label: string;
  value: number;
  peak: number;
  bills: number;
}) {
  const height = peak > 0 ? Math.max(2, Math.round((value / peak) * 100)) : 2;
  const empty = value <= 0;
  return (
    <div
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
      <span className="w-full truncate text-center text-[10px] text-gink-46">{label}</span>
    </div>
  );
}

export function ReportsScreen({
  data,
  outlet,
}: {
  data?: ReportsScreenData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
}) {
  const live = Boolean(data);
  const blocked = data?.blocked;

  // No database configured: a clearly-labelled sample report so the layout can
  // be judged. Never mixed with live numbers.
  const range: ReportRange = data?.range ?? {
    key: '7d',
    fromIso: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    toIso: new Date().toISOString(),
    label: 'Sample · last 7 days',
    bucket: 'day',
    days: 7,
  };
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  const report: ReportView = data?.report ?? demoReport(range, timezone);

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
          {/* ------------------------------------------------------- the window */}
          <div className="mb-5 flex flex-col gap-2.5 border-b border-hair pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {RANGE_TABS.map((tab) => {
                const current = range.key === tab.key;
                return (
                  <Link
                    key={tab.key}
                    href={rangeHref(tab.key)}
                    aria-current={current ? 'true' : undefined}
                    data-range={current ? 'current' : 'other'}
                    className={[
                      'inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gink',
                      current
                        ? 'border-gink bg-gink text-onink'
                        : 'border-hair-strong text-gink-64 hover:border-gink-28 hover:text-gink',
                    ].join(' ')}
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
              <label className="flex items-center gap-1.5 text-[11.5px] text-gink-46">
                From
                <input
                  type="date"
                  name="from"
                  required
                  aria-label="From"
                  className={`${inputClass} h-8 w-[142px] text-[12px]`}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px] text-gink-46">
                To
                <input
                  type="date"
                  name="to"
                  required
                  aria-label="To"
                  className={`${inputClass} h-8 w-[142px] text-[12px]`}
                />
              </label>
              <button type="submit" className={btn('ghost', 'sm')}>
                Apply
              </button>
            </form>
          </div>

          {/* ------------------------------------------------------- four figures
              Billed and collected are never merged. Every card says, in small
              type, exactly what its number counts. */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Sales"
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
              tone={totals.unpaidPaise > 0 ? 'live' : 'plain'}
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
              meta={`Billed · ${range.label}`}
              bodyClassName="px-4 py-4 sm:px-5"
            >
              {peak > 0 ? (
                <div className="flex items-end gap-1.5" data-chart>
                  {report.buckets.map((bucket) => (
                    <Bar
                      key={bucket.key}
                      label={bucket.label}
                      value={bucket.revenuePaise}
                      peak={peak}
                      bills={bucket.bills}
                    />
                  ))}
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
                <ul className="m-0 flex list-none flex-col p-0">
                  {report.topItems.map((item, i) => (
                    <li
                      key={item.name}
                      className="border-b border-hair py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="text-[10.5px] text-gink-28 tabular-nums">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="truncate text-[12.5px] text-gink">{item.name}</span>
                        </span>
                        <span className="shrink-0 text-[12.5px] text-gink tabular-nums">
                          <Money value={item.revenuePaise} />
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-paper-deep">
                          <span
                            className="block h-full rounded-full bg-gink/70"
                            style={{ width: `${share(item.revenuePaise, itemPeak)}%` }}
                          />
                        </span>
                        <span className="w-[54px] shrink-0 text-right text-[10.5px] text-gink-46 tabular-nums">
                          {item.qty} sold
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nothing sold in this range. Items rank here once a bill exists.</Empty>
              )}
            </Panel>

            <Panel title="By category" meta="From the menu, as it is today">
              {report.categories.length > 0 ? (
                <ul className="m-0 flex list-none flex-col p-0">
                  {report.categories.map((c) => (
                    <li
                      key={c.name}
                      className="border-b border-hair py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[12.5px] text-gink">{c.name}</span>
                        <span className="shrink-0 text-[12.5px] text-gink tabular-nums">
                          <Money value={c.revenuePaise} />
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-paper-deep">
                          <span
                            className="block h-full rounded-full bg-gink/70"
                            style={{ width: `${share(c.revenuePaise, categoryPeak)}%` }}
                          />
                        </span>
                        <span className="w-[54px] shrink-0 text-right text-[10.5px] text-gink-46 tabular-nums">
                          {c.qty} sold
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
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
                              <span className="text-[12px] text-gink-64 tabular-nums">
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
            <p className="rounded-[12px] border border-hair bg-card px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
              <strong className="font-semibold text-gink">Sales</strong> is what was billed: the sum
              of order totals, excluding cancelled bills.{' '}
              <strong className="font-semibold text-gink">Collected</strong> is money actually
              recorded against those bills.{' '}
              <strong className="font-semibold text-gink">Outstanding</strong> is the difference and
              is the figure to chase. They are separate on purpose — most tables settle at the
              counter on the way out.
            </p>
            <p className="rounded-[12px] border border-hair bg-card px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
              <strong className="font-semibold text-gink">GST on bills:</strong>{' '}
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
            </p>
          </div>

          {!live && (
            <p className="mt-2.5 rounded-[12px] border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
              <strong className="font-semibold text-gink">Database not configured</strong> — every
              figure on this page is fictional sample data.
            </p>
          )}
        </>
      )}
    </OwnerPage>
  );
}
