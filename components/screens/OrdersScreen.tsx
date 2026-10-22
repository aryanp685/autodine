import Link from 'next/link';
import { DashboardBar } from '@/components/DashboardBar';
import type { OutletBar } from '@/lib/outlets';
import { Money, PaymentPill, PrepPill } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { demoReport, resolveRange, type ReportOrderRow, type ReportsScreenData } from '@/lib/db/reports';
import { dateTimeInZone } from '@/lib/db/time';

/**
 * The order ledger.
 *
 * This is the "what actually happened" screen: every bill in the range, with
 * its kitchen state and whether it has been paid for. It is deliberately not
 * the kitchen board -- the board is a live ticket rail that staff work from,
 * ordered by what needs cooking next. This one is a history, newest first, and
 * nobody cooks from it.
 *
 * Filtering happens here rather than in SQL because the window is one day (or
 * a chosen range) capped at a hundred bills. Pushing a substring search down
 * to the database would mean a query per keystroke for a table the page
 * already holds in memory.
 */

export type OrderFilter = 'all' | 'open' | 'settled' | 'cancelled';

const FILTERS: Array<{ key: OrderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'settled', label: 'Settled' },
  { key: 'cancelled', label: 'Cancelled' },
];

const RANGE_LINKS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

function isOpen(order: ReportOrderRow): boolean {
  return order.prepStatus === 'new' || order.prepStatus === 'preparing' || order.prepStatus === 'ready';
}

/**
 * `all` means all.
 *
 * It used to hide cancelled bills, so the screen's own footnote ("a cancelled
 * order stays in this list so the day's history is complete") described
 * something the default view did not do: a cancellation vanished from the day
 * it happened and could only be found by guessing at the Cancelled tab. The
 * other three filters stay mutually exclusive and skip cancelled bills, which
 * is why they are worth having.
 */
function matches(order: ReportOrderRow, filter: OrderFilter, query: string): boolean {
  if (filter === 'cancelled') return order.prepStatus === 'cancelled';
  if (filter !== 'all' && order.prepStatus === 'cancelled') return false;
  if (filter === 'open' && !isOpen(order)) return false;
  if (filter === 'settled' && order.paymentStatus !== 'paid') return false;

  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    order.code.toLowerCase().includes(needle) ||
    (order.tableLabel ?? 'takeaway').toLowerCase().includes(needle)
  );
}

/**
 * Every link on this screen, with the state it must not lose.
 *
 * `custom` carries its dates: switching from "last 7 days" to a filter chip
 * must not silently throw away the week the person picked.
 */
function href(
  range: string,
  filter: OrderFilter,
  query: string,
  dates?: { from?: string; to?: string },
): string {
  const params = new URLSearchParams();
  if (range !== 'today') params.set('range', range);
  if (range === 'custom') {
    if (dates?.from) params.set('from', dates.from);
    if (dates?.to) params.set('to', dates.to);
  }
  if (filter !== 'all') params.set('status', filter);
  if (query) params.set('q', query);
  const qs = params.toString();
  return qs ? `/dashboard/orders?${qs}` : '/dashboard/orders';
}

export function OrdersScreen({
  data,
  outlet,
  filter = 'all',
  query = '',
  customFrom,
  customTo,
}: {
  data?: ReportsScreenData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  filter?: OrderFilter;
  query?: string;
  /** The dates a custom range was asked for, so the form can show them back. */
  customFrom?: string;
  customTo?: string;
}) {
  const live = Boolean(data);
  const blocked = data?.blocked;
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  // A custom range stays itself. It used to be flattened to 'today', which lit
  // the wrong chip and made the custom form's Apply look like it had failed.
  const rangeKey = data?.range.key ?? 'today';
  const dates = { from: customFrom, to: customTo };

  // Sample rows when nothing is configured, labelled as such below. The range
  // comes from resolveRange rather than from two identical instants: `from`
  // equal to `to` is an empty window, which is how the sample ledger ended up
  // promising rows and rendering none.
  const orders: ReportOrderRow[] =
    data?.report.orders ?? demoReport(resolveRange('7d', timezone), timezone).orders;

  const visible = orders.filter((order) => matches(order, filter, query.trim()));
  const openCount = orders.filter(isOpen).length;
  const unsettledCount = orders.filter((o) => o.prepStatus !== 'cancelled' && o.paymentStatus !== 'paid').length;
  const cancelledCount = orders.filter((o) => o.prepStatus === 'cancelled').length;

  // The CSV has to cover the window on screen. A custom range is sent as the
  // two local dates it was asked for, because the resolved range holds ISO
  // instants and re-resolving those would move the window by a few seconds.
  const exportParams = new URLSearchParams({ type: 'orders', range: rangeKey });
  if (rangeKey === 'custom') {
    if (customFrom) exportParams.set('from', customFrom);
    if (customTo) exportParams.set('to', customTo);
  }
  const exportHref = `/dashboard/reports/export?${exportParams.toString()}`;

  return (
    <div className="pg pg--dash">
      <DashboardBar active="orders" outlet={outlet} />

      <div className="pg__body">
        {blocked && <SignInPrompt reason={blocked} screen="order ledger" />}

        <header className="pg__head pg__head--row">
          <div>
            <div className="pg__kicker">Orders</div>
            <h1 className="pg__title">Order ledger</h1>
            <p className="pg__lede">
              {live && !blocked ? data?.range.label : 'Sample ledger · fictional orders'}
              {' · '}
              {openCount} open · {unsettledCount} not settled
              {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}
            </p>
          </div>
          {live && !blocked && (
            <div className="pg__headActions">
              <Link className="pg__btn" href="/kitchen">
                Kitchen board
              </Link>
              {/* A route handler that answers with a file, so an anchor with
                  `download` rather than <Link>: client-side navigation has no
                  RSC payload to fetch here. */}
              <a
                className="pg__btn pg__btn--solid"
                href={exportHref}
                download
              >
                Order CSV
              </a>
            </div>
          )}
        </header>

        {!blocked && (
          <div className="rep__ranges">
            {RANGE_LINKS.map((r) => (
              <Link
                key={r.key}
                href={href(r.key, filter, query, dates)}
                className={`rep__range ${rangeKey === r.key ? 'is-active' : ''}`}
                aria-current={rangeKey === r.key ? 'true' : undefined}
              >
                {r.label}
              </Link>
            ))}

            {/* The sales report has always had a custom range; the ledger,
                which reads the same aggregate, only had three presets. A
                dispute about one evening is exactly the question this screen
                gets asked. */}
            <form className="rep__custom rep__custom--dates" method="get" action="/dashboard/orders">
              <input type="hidden" name="range" value="custom" />
              {filter !== 'all' && <input type="hidden" name="status" value={filter} />}
              {query ? <input type="hidden" name="q" value={query} /> : null}
              <label className="rep__customField">
                <span>From</span>
                <input type="date" name="from" defaultValue={customFrom} required />
              </label>
              <label className="rep__customField">
                <span>To</span>
                <input type="date" name="to" defaultValue={customTo} required />
              </label>
              <button type="submit" className="rep__range">
                Apply dates
              </button>
            </form>

            <form className="rep__custom" method="get" action="/dashboard/orders">
              {rangeKey !== 'today' && <input type="hidden" name="range" value={rangeKey} />}
              {rangeKey === 'custom' && customFrom ? (
                <input type="hidden" name="from" value={customFrom} />
              ) : null}
              {rangeKey === 'custom' && customTo ? (
                <input type="hidden" name="to" value={customTo} />
              ) : null}
              {filter !== 'all' && <input type="hidden" name="status" value={filter} />}
              <label className="rep__customField">
                <span>Find</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Table or reference"
                  aria-label="Find an order by table or reference"
                />
              </label>
              <button type="submit" className="rep__range">
                Search
              </button>
            </form>
          </div>
        )}

        {!blocked && (
          <div className="rep__ranges rep__ranges--tight">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href(rangeKey, f.key, query, dates)}
                className={`rep__range ${filter === f.key ? 'is-active' : ''}`}
                aria-current={filter === f.key ? 'true' : undefined}
              >
                {f.label}
              </Link>
            ))}
          </div>
        )}

        {!blocked && (
          <section className="rep__block rep__block--wide">
            <div className="rep__blockHead">
              <h2>
                {visible.length} order{visible.length === 1 ? '' : 's'}
              </h2>
              <span className="rep__blockMeta">
                {query ? `Matching “${query}”` : 'Newest first'}
                {data?.ordersTruncated ? ' · the range holds more than this list' : ''}
              </span>
            </div>

            {visible.length > 0 ? (
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Reference</th>
                    <th>Table</th>
                    <th>Kitchen</th>
                    <th>Payment</th>
                    <th className="tnum">Total</th>
                    <th className="tnum">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((order) => {
                    const outstanding = Math.max(0, order.totalPaise - order.paidPaise);
                    const cancelled = order.prepStatus === 'cancelled';
                    return (
                      <tr key={order.id} className={cancelled ? 'rep__row--void' : undefined}>
                        <td className="tnum">
                          {dateTimeInZone(timezone, order.placedAt)}
                        </td>
                        <td className="pg__barMuted">
                          {live && !blocked ? (
                            // The code is the natural door into one bill: it is
                            // what the counter and the guest both quote.
                            <Link href={`/bill/${order.id}`} title="Open this bill">
                              {order.code}
                            </Link>
                          ) : (
                            order.code
                          )}
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
                          {/* A cancelled bill is never collectable: money must
                              not be taken for food that will not arrive. */}
                          {outstanding > 0 && !cancelled ? (
                            // The money on this row is collected on that bill,
                            // not on an arbitrary one: the counter opens on
                            // this ticket. Without a database the sample rows
                            // are the counter's own sample queue, so the code
                            // is the handle that works there.
                            <Link
                              className="rep__collect"
                              href={`/cashier?order=${encodeURIComponent(live && !blocked ? order.id : order.code)}`}
                              title={`Take payment for ${order.code} at the counter`}
                            >
                              Collect <Money value={outstanding} />
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="kb__empty">
                {orders.length === 0
                  ? 'No orders in this range.'
                  : 'No orders match this filter.'}
              </div>
            )}

            {/* The same bills as cards, for the width where seven columns of
                numbers become a sideways scroll. One of the two is always
                display:none, so neither is read twice. */}
            {visible.length > 0 && (
              <ul className="rep__cards">
                {visible.map((order) => {
                  const outstanding = Math.max(0, order.totalPaise - order.paidPaise);
                  const cancelled = order.prepStatus === 'cancelled';
                  return (
                    <li key={order.id} className={`rep__card ${cancelled ? 'is-void' : ''}`}>
                      <div className="rep__cardTop">
                        <span className="rep__cardRef">
                          {live && !blocked ? (
                            <Link href={`/bill/${order.id}`} title="Open this bill">
                              {order.code}
                            </Link>
                          ) : (
                            order.code
                          )}
                        </span>
                        <span className="rep__cardTime">{dateTimeInZone(timezone, order.placedAt)}</span>
                      </div>
                      <div className="rep__cardMid">
                        <span className="rep__cardTable">{order.tableLabel ?? 'Takeaway'}</span>
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
                        <PaymentPill
                          state={
                            order.paymentStatus === 'pending'
                              ? 'pending'
                              : order.paymentStatus === 'failed'
                                ? 'failed'
                                : 'paid'
                          }
                        />
                      </div>
                      <div className="rep__cardFoot">
                        <span className="rep__cardTotal">
                          <Money value={order.totalPaise} />
                        </span>
                        <span className="rep__cardDue">
                          {outstanding > 0 && !cancelled ? (
                            <Link
                              className="rep__collect"
                              href={`/cashier?order=${encodeURIComponent(live && !blocked ? order.id : order.code)}`}
                              title={`Take payment for ${order.code} at the counter`}
                            >
                              Collect <Money value={outstanding} />
                            </Link>
                          ) : (
                            'Settled'
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {!blocked && (
          <p className="pg__note">
            Outstanding is what the table still owes on that bill. <strong>Collect</strong> opens
            the counter on that exact ticket; the queue as a whole is at{' '}
            <Link href="/cashier">the counter</Link>. A cancelled order stays in this list
            so the day&apos;s history is complete, but it is excluded from every figure on the
            sales report.
          </p>
        )}
        {!live && !blocked && (
          <p className="pg__note pg__note--warn">
            Database not configured — the rows above are fictional sample data.
          </p>
        )}
      </div>
    </div>
  );
}
