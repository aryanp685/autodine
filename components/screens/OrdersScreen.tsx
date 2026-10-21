import Link from 'next/link';
import { DashboardBar } from '@/components/DashboardBar';
import { Money, PaymentPill, PrepPill } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { demoReport, type ReportOrderRow, type ReportsScreenData } from '@/lib/db/reports';

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

function matches(order: ReportOrderRow, filter: OrderFilter, query: string): boolean {
  if (filter === 'cancelled' && order.prepStatus !== 'cancelled') return false;
  if (filter === 'cancelled') return true;
  if (order.prepStatus === 'cancelled') return false;
  if (filter === 'open' && !isOpen(order)) return false;
  if (filter === 'settled' && order.paymentStatus !== 'paid') return false;

  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    order.code.toLowerCase().includes(needle) ||
    (order.tableLabel ?? 'takeaway').toLowerCase().includes(needle)
  );
}

function href(range: string, filter: OrderFilter, query: string): string {
  const params = new URLSearchParams();
  if (range !== 'today') params.set('range', range);
  if (filter !== 'all') params.set('status', filter);
  if (query) params.set('q', query);
  const qs = params.toString();
  return qs ? `/dashboard/orders?${qs}` : '/dashboard/orders';
}

export function OrdersScreen({
  data,
  filter = 'all',
  query = '',
}: {
  data?: ReportsScreenData | null;
  filter?: OrderFilter;
  query?: string;
}) {
  const live = Boolean(data);
  const blocked = data?.blocked;
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  const rangeKey = data?.range.key === 'custom' ? 'today' : (data?.range.key ?? 'today');

  // Sample rows when nothing is configured, labelled as such below.
  const orders: ReportOrderRow[] = data?.report.orders ?? demoReport(
    { key: '7d', fromIso: new Date().toISOString(), toIso: new Date().toISOString(), label: '', bucket: 'day', days: 7 },
    timezone,
  ).orders;

  const visible = orders.filter((order) => matches(order, filter, query.trim()));
  const openCount = orders.filter(isOpen).length;
  const unsettledCount = orders.filter((o) => o.prepStatus !== 'cancelled' && o.paymentStatus !== 'paid').length;

  return (
    <div className="pg pg--dash">
      <DashboardBar active="orders" />

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
            </p>
          </div>
          {live && !blocked && (
            <div className="pg__headActions">
              <Link className="pg__btn" href="/kitchen">
                Kitchen board
              </Link>
              <Link
                className="pg__btn pg__btn--solid"
                href={`/dashboard/reports/export?type=orders&range=${rangeKey}`}
              >
                Order CSV
              </Link>
            </div>
          )}
        </header>

        {!blocked && (
          <div className="rep__ranges">
            {RANGE_LINKS.map((r) => (
              <Link
                key={r.key}
                href={href(r.key, filter, query)}
                className={`rep__range ${rangeKey === r.key ? 'is-active' : ''}`}
              >
                {r.label}
              </Link>
            ))}

            <form className="rep__custom" method="get" action="/dashboard/orders">
              {rangeKey !== 'today' && <input type="hidden" name="range" value={rangeKey} />}
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
                href={href(rangeKey, f.key, query)}
                className={`rep__range ${filter === f.key ? 'is-active' : ''}`}
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
                          {new Date(order.placedAt).toLocaleString('en-IN', {
                            timeZone: timezone,
                            day: '2-digit',
                            month: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="pg__barMuted">{order.code}</td>
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
                        <td className="tnum">{outstanding > 0 ? <Money value={outstanding} /> : '—'}</td>
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
          </section>
        )}

        {!blocked && (
          <p className="pg__note">
            Outstanding is what the table still owes on that bill. Settle it at the counter —{' '}
            <Link href="/cashier">open the counter</Link>. A cancelled order stays in this list
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
