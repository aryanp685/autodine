import Link from 'next/link';
import { DashboardBar } from '@/components/DashboardBar';
import type { OutletBar } from '@/lib/outlets';
import { Money, PaymentPill, PrepPill } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
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
function Bar({ label, value, peak, bills }: { label: string; value: number; peak: number; bills: number }) {
  const height = peak > 0 ? Math.max(2, Math.round((value / peak) * 100)) : 2;
  return (
    <div className="rep__bar" title={`${label} · ${bills} bill${bills === 1 ? '' : 's'}`}>
      <div className="rep__barTrack">
        <div className="rep__barFill" style={{ height: `${height}%` }} />
      </div>
      <span className="rep__barLabel">{label}</span>
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
  const peak = Math.max(0, ...report.buckets.map((b) => b.revenuePaise));
  const itemPeak = Math.max(0, ...report.topItems.map((i) => i.revenuePaise));
  const categoryPeak = Math.max(0, ...report.categories.map((c) => c.revenuePaise));

  return (
    <div className="pg pg--dash">
      <DashboardBar active="reports" outlet={outlet} />

      <div className="pg__body">
        {blocked && <SignInPrompt reason={blocked} screen="sales report" />}

        <header className="pg__head pg__head--row">
          <div>
            <div className="pg__kicker">Reports</div>
            <h1 className="pg__title">Sales</h1>
            <p className="pg__lede">
              {blocked
                ? 'Sign in to see your takings'
                : live
                  ? range.label
                  : 'Sample report · fictional takings'}
              {' · '}
              {timezone}
            </p>
          </div>
          {live && !blocked && (
            <div className="pg__headActions">
              <Link className="pg__btn" href={exportHref('summary', range, timezone)}>
                Summary CSV
              </Link>
              <Link className="pg__btn" href={exportHref('items', range, timezone)}>
                Item CSV
              </Link>
              <Link className="pg__btn pg__btn--solid" href={exportHref('orders', range, timezone)}>
                Order CSV
              </Link>
            </div>
          )}
        </header>

        {!blocked && (
          <div className="rep__ranges">
            {RANGE_TABS.map((tab) => (
              <Link
                key={tab.key}
                href={rangeHref(tab.key)}
                className={`rep__range ${range.key === tab.key ? 'is-active' : ''}`}
              >
                {tab.label}
              </Link>
            ))}

            <form className="rep__custom" method="get" action="/dashboard/reports">
              <input type="hidden" name="range" value="custom" />
              <label className="rep__customField">
                <span>From</span>
                <input type="date" name="from" required />
              </label>
              <label className="rep__customField">
                <span>To</span>
                <input type="date" name="to" required />
              </label>
              <button type="submit" className="rep__range">Apply</button>
            </form>
          </div>
        )}

        {!blocked && (
          <section className="rep__stats">
            <div className="rep__stat">
              <div className="dash__statLabel">Sales</div>
              <div className="dash__statValue">
                <Money value={totals.billedPaise} />
              </div>
              <div className="dash__statDelta">
                {totals.bills} bill{totals.bills === 1 ? '' : 's'} · what was sold
              </div>
            </div>
            <div className="rep__stat">
              <div className="dash__statLabel">Collected</div>
              <div className="dash__statValue">
                <Money value={totals.collectedPaise} />
              </div>
              <div className="dash__statDelta">Money actually recorded</div>
            </div>
            <div className="rep__stat">
              <div className="dash__statLabel">Outstanding</div>
              <div className="dash__statValue">
                <Money value={totals.unpaidPaise} />
              </div>
              <div className="dash__statDelta">Billed, not yet settled</div>
            </div>
            <div className="rep__stat">
              <div className="dash__statLabel">Average bill</div>
              <div className="dash__statValue">
                <Money value={totals.averageBillPaise} />
              </div>
              <div className="dash__statDelta">
                {hasBills ? 'Sales ÷ bills' : 'No bills in this range'}
              </div>
            </div>
          </section>
        )}

        {!blocked && (
          <section className="rep__grid">
            <div className="rep__block">
              <div className="rep__blockHead">
                <h2>Sales by {range.bucket}</h2>
                <span className="rep__blockMeta">Billed · {range.label}</span>
              </div>
              {peak > 0 ? (
                <div className="rep__bars">
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
                <div className="kb__empty">
                  Nothing billed in this range yet. The chart fills in as orders are placed.
                </div>
              )}
            </div>

            <div className="rep__block">
              <div className="rep__blockHead">
                <h2>How it was paid</h2>
                <span className="rep__blockMeta">Recorded payments</span>
              </div>
              {report.methods.length > 0 || totals.unpaidPaise > 0 ? (
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th className="tnum">Payments</th>
                      <th className="tnum">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.methods.map((m) => (
                      <tr key={m.method}>
                        <td>{methodLabel(m.method)}</td>
                        <td className="tnum">{m.count}</td>
                        <td className="tnum">
                          <Money value={m.recordedPaise} />
                        </td>
                      </tr>
                    ))}
                    {totals.unpaidPaise > 0 && (
                      <tr>
                        <td>Not settled yet</td>
                        <td className="tnum">—</td>
                        <td className="tnum">
                          <Money value={totals.unpaidPaise} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <div className="kb__empty">No payments recorded in this range.</div>
              )}
              {totals.refundedPaise > 0 && (
                <p className="rep__fine">
                  Refunded in this range: <Money value={totals.refundedPaise} />
                </p>
              )}
            </div>
          </section>
        )}

        {!blocked && (
          <section className="rep__grid">
            <div className="rep__block">
              <div className="rep__blockHead">
                <h2>Top items</h2>
                <span className="rep__blockMeta">By sales · portions counted apart</span>
              </div>
              {report.topItems.length > 0 ? (
                <ul className="rep__rank">
                  {report.topItems.map((item, i) => (
                    <li key={item.name}>
                      <span className="rep__rankNum">{String(i + 1).padStart(2, '0')}</span>
                      <span className="rep__rankBody">
                        <span className="rep__rankName">{item.name}</span>
                        <span className="rep__rankBar">
                          <span
                            className="rep__rankBarFill"
                            style={{ width: `${share(item.revenuePaise, itemPeak)}%` }}
                          />
                        </span>
                      </span>
                      <span className="rep__rankQty">{item.qty} sold</span>
                      <Money value={item.revenuePaise} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="kb__empty">
                  Nothing sold in this range. Items rank here once a bill exists.
                </div>
              )}
            </div>

            <div className="rep__block">
              <div className="rep__blockHead">
                <h2>By category</h2>
                <span className="rep__blockMeta">From the menu, as it is today</span>
              </div>
              {report.categories.length > 0 ? (
                <ul className="rep__rank">
                  {report.categories.map((c) => (
                    <li key={c.name}>
                      <span className="rep__rankBody">
                        <span className="rep__rankName">{c.name}</span>
                        <span className="rep__rankBar">
                          <span
                            className="rep__rankBarFill"
                            style={{ width: `${share(c.revenuePaise, categoryPeak)}%` }}
                          />
                        </span>
                      </span>
                      <span className="rep__rankQty">{c.qty} sold</span>
                      <Money value={c.revenuePaise} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="kb__empty">No dishes sold in this range.</div>
              )}
            </div>
          </section>
        )}

        {!blocked && (
          <section className="rep__block rep__block--wide">
            <div className="rep__blockHead">
              <h2>Order ledger</h2>
              <span className="rep__blockMeta">
                {data && data.ordersTruncated
                  ? `Showing the latest ${report.orders.length} of ${totals.bills} bills — the totals above cover all of them`
                  : 'Newest first'}
              </span>
            </div>
            {report.orders.length > 0 ? (
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Table</th>
                    <th>Kitchen</th>
                    <th>Payment</th>
                    <th className="tnum">Total</th>
                    <th className="tnum">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orders.map((order) => {
                    const outstanding = Math.max(0, order.totalPaise - order.paidPaise);
                    const cancelled = order.prepStatus === 'cancelled';
                    return (
                      <tr key={order.id} className={cancelled ? 'rep__row--void' : undefined}>
                        <td className="tnum">
                          {dateTimeInZone(timezone, order.placedAt)}
                        </td>
                        <td>{order.tableLabel ?? 'Takeaway'}</td>
                        <td>
                          {cancelled ? (
                            <span className="rep__void">Cancelled</span>
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
                        </td>
                        <td>
                          <PaymentPill
                            state={
                              order.paymentStatus === 'pending'
                                ? 'pending'
                                : order.paymentStatus === 'failed'
                                  ? 'failed'
                                  : 'paid'
                            }
                          />
                        </td>
                        <td className="tnum">
                          <Money value={order.totalPaise} />
                        </td>
                        <td className="tnum">
                          {outstanding > 0 ? <Money value={outstanding} /> : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="kb__empty">No bills in this range.</div>
            )}
          </section>
        )}

        {!blocked && (
          <div className="rep__notes">
            <p className="pg__note pg__note--info">
              <strong>Sales</strong> is what was billed: the sum of order totals, excluding
              cancelled bills. <strong>Collected</strong> is money actually recorded against
              those bills. <strong>Outstanding</strong> is the difference and is the figure to
              chase. They are separate on purpose — most tables settle at the counter on the
              way out.
            </p>
            <p className="pg__note">
              <strong>GST on bills:</strong>{' '}
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
            {!live && (
              <p className="pg__note pg__note--warn">
                Database not configured — every figure on this page is fictional sample data.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
