import Link from 'next/link';
import type { OutletBar } from '@/lib/outlets';
import { Money, PaymentPill, PrepPill } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { AutoRefresh } from '@/components/owner/AutoRefresh';
import { demoReport, resolveRange } from '@/lib/db/reports';
import type { OrderLedgerRow, OrdersLedgerScreenData } from '@/lib/db/orders-ledger';
import { dateTimeInZone } from '@/lib/db/time';
import {
  BtnLink,
  Empty,
  Notice,
  OwnerPage,
  PageHead,
  Panel,
  Td,
  Tag,
  TableWrap,
  Th,
  Tr,
  btn,
  chipClass,
  inputClass,
  tableClass,
} from '@/components/owner/chrome';

/**
 * The order ledger.
 *
 * This is the "what actually happened" screen: every order in the range, with
 * its kitchen state and a safe route to the bill. Finance details are rendered
 * only for Owner/Manager data; Cashier rows deliberately contain no payment
 * status or amount fields. It is not the kitchen board -- that is a live ticket
 * rail ordered by what needs cooking next. This one is a history, newest first.
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

function isOpen(order: OrderLedgerRow): boolean {
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
function matches(order: OrderLedgerRow, filter: OrderFilter, query: string): boolean {
  // The tab narrows first...
  if (filter === 'cancelled' && order.prepStatus !== 'cancelled') return false;
  if (filter !== 'all' && filter !== 'cancelled' && order.prepStatus === 'cancelled') return false;
  if (filter === 'open' && !isOpen(order)) return false;
  if (filter === 'settled' && order.paymentStatus !== 'paid') return false;

  // ...and then the search narrows what is left. The Cancelled tab used to
  // return before this point, so typing a table into the search box while that
  // tab was open did nothing at all -- the one case where the box looked
  // broken rather than empty.
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
  data?: OrdersLedgerScreenData | null;
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
  const canViewFinance = data?.canViewFinance ?? true;
  const canExport = data?.canExport === true;
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  // A custom range stays itself. It used to be flattened to 'today', which lit
  // the wrong chip and made the custom form's Apply look like it had failed.
  const rangeKey = data?.range.key ?? 'today';
  const dates = { from: customFrom, to: customTo };
  // A stale or hand-written `status=settled` link cannot make a restricted
  // order list infer payment state it was never allowed to query.
  const activeFilter = !canViewFinance && filter === 'settled' ? 'all' : filter;

  // Sample rows when nothing is configured, labelled as such below. The range
  // comes from resolveRange rather than from two identical instants: `from`
  // equal to `to` is an empty window, which is how the sample ledger ended up
  // promising rows and rendering none.
  const orders: OrderLedgerRow[] =
    data?.orders ?? demoReport(resolveRange('7d', timezone), timezone).orders;

  const visible = orders.filter((order) => matches(order, activeFilter, query.trim()));
  const openCount = orders.filter(isOpen).length;
  const unsettledCount = canViewFinance
    ? orders.filter((o) => o.prepStatus !== 'cancelled' && o.paymentStatus !== 'paid').length
    : 0;
  const cancelledCount = orders.filter((o) => o.prepStatus === 'cancelled').length;
  const settledCount = canViewFinance
    ? orders.filter((o) => o.prepStatus !== 'cancelled' && o.paymentStatus === 'paid').length
    : 0;
  // Each chip says how many rows it would show, from the same array the table
  // is drawn from. A filter that turns out to be empty is then a fact about the
  // day rather than something you find out by clicking it.
  const filterCounts: Record<OrderFilter, number> = {
    all: orders.length,
    open: openCount,
    settled: settledCount,
    cancelled: cancelledCount,
  };
  const visibleFilters = canViewFinance ? FILTERS : FILTERS.filter((item) => item.key !== 'settled');
  const narrowed = activeFilter !== 'all' || Boolean(query.trim());

  /**
   * A compact field at a chosen width.
   *
   * `inputClass` carries `w-full`, and stacking `w-[150px]` after it is a coin
   * toss: whichever utility the stylesheet emits last wins. Replacing the one
   * that is there is the only version that cannot flip.
   */
  const fieldSm = (width: string) =>
    inputClass.replace('h-11', 'h-9').replace('w-full', width);

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
    <OwnerPage active="orders" outlet={outlet} wide>
        {/* New orders land while the ledger is open. Slow, silent, and paused
            while somebody is typing in the search box. */}
        <AutoRefresh enabled={live && !blocked} />
      <PageHead
        kicker="Orders"
        title="Order ledger"
        meta={
          <>
            {live && !blocked ? data?.range.label : 'Sample ledger · fictional orders'}
            {' · '}
            {openCount} open
            {canViewFinance ? ` · ${unsettledCount} not settled` : ''}
            {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}
          </>
        }
        actions={
          live && !blocked ? (
            <>
              <BtnLink href="/kitchen" tone="ghost">
                Kitchen board
              </BtnLink>
              {canExport ? (
                <>
                  {/* A route handler that answers with a file, so an anchor
                      with `download` rather than <Link>: client-side navigation
                      has no RSC payload to fetch here. */}
                  <a className={btn('ghost')} href={exportHref} download>
                    Order CSV
                  </a>
                </>
              ) : null}
            </>
          ) : null
        }
      />

      {blocked && <SignInPrompt reason={blocked} screen="order ledger" />}

      {!blocked && (
        <div className="mb-3 flex flex-col gap-2">
          {/* Two questions, two rows: which days, and which rows. They used to
              share one wrapping row of identical chips, so "Last 7 days" and
              "Open" looked like the same kind of choice. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGE_LINKS.map((r) => (
              <Link
                key={r.key}
                href={href(r.key, activeFilter, query, dates)}
                aria-current={rangeKey === r.key ? 'true' : undefined}
                className={chipClass(rangeKey === r.key)}
              >
                {r.label}
              </Link>
            ))}

            {/* The sales report has always had a custom range; the ledger
                shares the same range controls so a dispute about one evening
                can be reviewed here too.

                `details` rather than a hidden panel: it opens without
                JavaScript, it is keyboard-reachable, and it stays open when a
                custom range is the one in force -- a range you cannot see is a
                range you will forget you set. */}
            <details open={rangeKey === 'custom'} className="w-full sm:w-auto">
              <summary
                className={`${chipClass(rangeKey === 'custom')} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              >
                {rangeKey === 'custom' && customFrom && customTo
                  ? `${customFrom} → ${customTo}`
                  : 'Custom dates'}
              </summary>
              <form
                method="get"
                action="/dashboard/orders"
                className="mt-2 flex flex-wrap items-end gap-2 rounded-[var(--p-r-block)] border border-hair bg-card p-2.5"
              >
                <input type="hidden" name="range" value="custom" />
                {activeFilter !== 'all' && <input type="hidden" name="status" value={activeFilter} />}
                {query ? <input type="hidden" name="q" value={query} /> : null}
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">From</span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={customFrom}
                    required
                    className={fieldSm('w-[150px] max-w-full')}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">To</span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={customTo}
                    required
                    className={fieldSm('w-[150px] max-w-full')}
                  />
                </label>
                <button type="submit" className={btn('ghost', 'sm')}>
                  Apply dates
                </button>
              </form>
            </details>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {visibleFilters.map((f) => (
              <Link
                key={f.key}
                href={href(rangeKey, f.key, query, dates)}
                aria-current={activeFilter === f.key ? 'true' : undefined}
                className={`${chipClass(activeFilter === f.key)} gap-1.5`}
              >
                {f.label}
                <span
                  className={[
                    'tnum text-[11.5px]',
                    activeFilter === f.key ? 'text-[var(--p-accent)]' : 'text-gink-46',
                  ].join(' ')}
                >
                  {filterCounts[f.key]}
                </span>
              </Link>
            ))}

            <form
              method="get"
              action="/dashboard/orders"
              className="ml-auto flex flex-wrap items-end gap-2"
            >
              {rangeKey !== 'today' && <input type="hidden" name="range" value={rangeKey} />}
              {rangeKey === 'custom' && customFrom ? (
                <input type="hidden" name="from" value={customFrom} />
              ) : null}
              {rangeKey === 'custom' && customTo ? (
                <input type="hidden" name="to" value={customTo} />
              ) : null}
              {activeFilter !== 'all' && <input type="hidden" name="status" value={activeFilter} />}
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Table or reference"
                aria-label="Find an order by table or reference"
                className={fieldSm('w-[180px] max-w-full')}
              />
              <button type="submit" className={btn('ghost', 'sm')}>
                Search
              </button>
            </form>
          </div>
        </div>
      )}

      {!blocked && (
        <Panel
          /* The same headed card as every other panel on the surface. This one
             was a bare card with a hand-made title row, so the ledger's own
             heading sat at a different height and on a different background
             from the panels two screens away. */
          title={`${visible.length} order${visible.length === 1 ? '' : 's'}`}
          meta={
            <>
              {query ? `Matching “${query}”` : 'Newest first'}
              {data?.ordersTruncated ? ' · showing the most recent hundred' : ''}
            </>
          }
          bodyClassName=""
        >

          {visible.length > 0 ? (
            <>
              {/* The finance columns fit a wide screen; on a phone the same
                  orders are cards below. Exactly one layout is shown, so
                  neither is read twice by a screen reader. */}
              <div className="hidden lg:block">
                <TableWrap>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <Th>Time</Th>
                        <Th>Reference</Th>
                        <Th>Table</Th>
                        <Th>Kitchen</Th>
                        {canViewFinance ? (
                          <>
                            <Th>Payment</Th>
                            <Th align="right">Total</Th>
                            <Th align="right">Outstanding</Th>
                          </>
                        ) : (
                          <Th align="right">Open</Th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((order) => {
                        const outstanding = Math.max(0, (order.totalPaise ?? 0) - (order.paidPaise ?? 0));
                        const cancelled = order.prepStatus === 'cancelled';
                        return (
                          <Tr key={order.id} className={cancelled ? 'opacity-55' : undefined}>
                            <Td className="tnum whitespace-nowrap text-gink-64">
                              {dateTimeInZone(timezone, order.placedAt)}
                            </Td>
                            <Td>
                              {live && !blocked ? (
                                // The code is the safe door into this specific
                                // bill; order identity is never taken from the URL.
                                <Link
                                  href={`/bill/${order.id}`}
                                  title="Open this bill"
                                  className="font-medium underline decoration-hair-strong underline-offset-2 hover:text-gink"
                                >
                                  {order.code}
                                </Link>
                              ) : (
                                <span className="text-gink-64">{order.code}</span>
                              )}
                            </Td>
                            <Td>{order.tableLabel ?? 'Takeaway'}</Td>
                            <Td>
                              {cancelled ? (
                                <Tag tone="neutral">Cancelled</Tag>
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
                            {canViewFinance ? (
                              <>
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
                                  <Money value={order.totalPaise ?? 0} />
                                </Td>
                                <Td align="right">
                                  {outstanding > 0 && !cancelled ? (
                                    <Link
                                      href={`/cashier?order=${encodeURIComponent(live && !blocked ? order.id : order.code)}`}
                                      title={`Take payment for ${order.code} at the counter`}
                                      className={btn('ghost', 'sm')}
                                    >
                                      Collect <Money value={outstanding} />
                                    </Link>
                                  ) : (
                                    <span className="text-[11.5px] text-gink-46">
                                      {cancelled ? 'Not collectable' : 'Settled'}
                                    </span>
                                  )}
                                </Td>
                              </>
                            ) : (
                              <Td align="right">
                                {!cancelled && live && !blocked ? (
                                  <Link
                                    href={`/cashier?order=${encodeURIComponent(order.id)}`}
                                    title={`Open ${order.code} at the counter`}
                                    className={btn('ghost', 'sm')}
                                  >
                                    Open at counter
                                  </Link>
                                ) : null}
                              </Td>
                            )}
                          </Tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              </div>

              <ul className="flex flex-col divide-y divide-hair lg:hidden">
                {visible.map((order) => {
                  const outstanding = Math.max(0, (order.totalPaise ?? 0) - (order.paidPaise ?? 0));
                  const cancelled = order.prepStatus === 'cancelled';
                  return (
                    <li key={order.id} className={['px-4 py-3', cancelled ? 'opacity-55' : ''].join(' ')}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-semibold text-gink">
                          {live && !blocked ? (
                            <Link href={`/bill/${order.id}`} title="Open this bill">
                              {order.code}
                            </Link>
                          ) : (
                            order.code
                          )}
                        </span>
                        <span className="tnum text-[11.5px] text-gink-46">
                          {dateTimeInZone(timezone, order.placedAt)}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] text-gink-64">{order.tableLabel ?? 'Takeaway'}</span>
                        {cancelled ? (
                          <Tag tone="neutral">Cancelled</Tag>
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
                        {canViewFinance ? (
                          <PaymentPill
                            state={
                              order.paymentStatus === 'pending'
                                ? 'pending'
                                : order.paymentStatus === 'failed'
                                  ? 'failed'
                                  : 'paid'
                            }
                          />
                        ) : null}
                      </div>

                      {canViewFinance ? (
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-[13.5px] font-semibold text-gink">
                            <Money value={order.totalPaise ?? 0} />
                          </span>
                          {outstanding > 0 && !cancelled ? (
                            <Link
                              href={`/cashier?order=${encodeURIComponent(live && !blocked ? order.id : order.code)}`}
                              title={`Take payment for ${order.code} at the counter`}
                              className={btn('ghost', 'sm')}
                            >
                              Collect <Money value={outstanding} />
                            </Link>
                          ) : (
                            <span className="text-[11.5px] text-gink-46">
                              {cancelled ? 'Not collectable' : 'Settled'}
                            </span>
                          )}
                        </div>
                      ) : !cancelled && live && !blocked ? (
                        <div className="mt-2 flex justify-end">
                          <Link
                            href={`/cashier?order=${encodeURIComponent(order.id)}`}
                            title={`Open ${order.code} at the counter`}
                            className={btn('ghost', 'sm')}
                          >
                            Open at counter
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="px-4 py-5 sm:px-5">
              <Empty>
                <span className="block">
                  {orders.length === 0
                    ? 'No orders in this range.'
                    : 'No orders match this filter.'}
                </span>
                {/* An empty view of a full ledger is not the same thing as an
                    empty day, and the way out has to be on the screen. */}
                {orders.length > 0 && narrowed ? (
                  <Link
                    href={href(rangeKey, 'all', '', dates)}
                    className="mt-2 inline-block text-[12.5px] font-medium text-[var(--p-accent)] underline decoration-[color-mix(in_oklab,var(--p-accent)_35%,transparent)] underline-offset-2 hover:decoration-[var(--p-accent)]"
                  >
                    Show all {orders.length} in this range
                  </Link>
                ) : null}
              </Empty>
            </div>
          )}
        </Panel>
      )}

      {!blocked && (
        <p className="mt-4 max-w-[92ch] text-[11.5px] leading-[1.6] text-gink-46">
          {canViewFinance ? (
            <>
              Outstanding is what the table still owes on that bill;{' '}
              <strong className="font-semibold text-gink-64">Collect</strong> opens the counter on
              that exact ticket, and the queue as a whole is at{' '}
              <Link href="/cashier" className="underline underline-offset-2">
                the counter
              </Link>
              . Cancelled bills stay here so the day&apos;s history is complete, and are excluded
              from every figure on the sales report.
            </>
          ) : (
            <>
              Payment details are not included in this ledger. Open an order to view its bill, or go
              to{' '}
              <Link href="/cashier" className="underline underline-offset-2">
                the counter
              </Link>{' '}
              to manage it. Cancelled orders remain here so the day&apos;s history is complete.
            </>
          )}
        </p>
      )}
      {!live && !blocked && (
        <Notice
          tone="accent"
          label={<Tag tone="work">Sample data</Tag>}
          className="mt-4 mb-0"
        >
          Database not configured — the rows above are fictional sample data.
        </Notice>
      )}
    </OwnerPage>
  );
}

/**
 * A chip, for a filter or a range.
 *
 * Selected chips are black, not green: on this screen green means "paid", and a
 * green filter chip beside a green payment pill reads as a statement about the
 * rows rather than about the filter.
 */

