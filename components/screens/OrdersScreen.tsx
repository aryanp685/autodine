import Link from 'next/link';
import type { OutletBar } from '@/lib/outlets';
import { Money, PaymentPill, PrepPill } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { AutoRefresh } from '@/components/owner/AutoRefresh';
import { OpsSurface } from '@/components/owner/OpsSurface';
import { demoReport, resolveRange } from '@/lib/db/reports';
import type { OrderLedgerRow, OrdersLedgerScreenData } from '@/lib/db/orders-ledger';
import { dateTimeInZone } from '@/lib/db/time';
import { toggleOrderKotHandoffAction } from '@/app/orders/actions';
import { kotHandoffLabel, normalizeKotHandoffStatus } from '@/lib/operating-mode';
import { assessOrderReliability } from '@/lib/order-health';
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

export type OrderFilter = 'all' | 'open' | 'delayed' | 'settled' | 'cancelled';

const FILTERS: Array<{ key: OrderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'delayed', label: 'Delayed / alerts' },
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
function matches(
  order: OrderLedgerRow,
  filter: OrderFilter,
  query: string,
  needsAttention: boolean,
): boolean {
  // The tab narrows first...
  if (filter === 'cancelled' && order.prepStatus !== 'cancelled') return false;
  if (filter !== 'all' && filter !== 'cancelled' && order.prepStatus === 'cancelled') return false;
  if (filter === 'open' && !isOpen(order)) return false;
  if (filter === 'delayed' && !needsAttention) return false;
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

type OrderMetricTone = 'forest' | 'orange' | 'moss' | 'paper';

function OrdersIcon({ name }: { name: 'orders' | 'open' | 'alert' | 'settled' }) {
  const paths = {
    orders: <><rect x="5" y="4.5" width="14" height="16" rx="2.5" /><path d="M9 4.5v-1h6v1M8.5 9h7M8.5 12.5h7M8.5 16h4" /></>,
    open: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
    alert: <><path d="m12 3.5 9 16H3z" /><path d="M12 9v4M12 16.4v.1" /></>,
    settled: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12.2 2.6 2.6 5.5-5.6" /></>,
  } as const;

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function OrderMetric({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: number;
  note: string;
  tone: OrderMetricTone;
  icon: 'orders' | 'open' | 'alert' | 'settled';
}) {
  const toneClass = {
    forest: 'bg-[var(--p-rail)] text-onink',
    orange: 'bg-[var(--p-accent)] text-onink',
    moss: 'bg-[var(--p-rail-raised)] text-onink',
    paper: 'border border-hair bg-card text-gink',
  }[tone];
  const mutedClass = tone === 'paper' ? 'text-gink-64' : 'text-onink-64';

  return (
    <article
      data-order-metric={label.toLowerCase().replaceAll(' ', '-')}
      className={[
      'group relative isolate min-w-0 overflow-hidden rounded-[var(--p-r-card)] p-4 shadow-[var(--p-shadow-1)] sm:p-5',
      'motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:ease-[var(--o-ease)] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[var(--p-shadow-2)] motion-reduce:transition-none',
      toneClass,
    ].join(' ')}>
      <span aria-hidden="true" className="pointer-events-none absolute -right-7 -bottom-10 -z-10 size-28 rounded-full border border-current opacity-[0.08] transition-transform duration-500 group-hover:scale-110 motion-reduce:transition-none" />
      <div className="flex items-center justify-between gap-3">
        <p className={['m-0 text-[12.5px] font-medium', mutedClass].join(' ')}>{label}</p>
        <span className={[
          'grid size-9 shrink-0 place-items-center rounded-[11px]',
          tone === 'paper' ? 'bg-paper-deep text-[var(--p-accent)]' : 'bg-white/10 text-current',
        ].join(' ')}>
          <OrdersIcon name={icon} />
        </span>
      </div>
      <p className="mt-4 mb-0 text-[clamp(1.6rem,2.5vw,2.15rem)] leading-none font-semibold tracking-[-0.045em] tabular-nums">{value}</p>
      <p className={['mt-2.5 mb-0 text-[11.5px] leading-[1.4]', mutedClass].join(' ')}>{note}</p>
    </article>
  );
}

function OrderPrep({ order }: { order: OrderLedgerRow }) {
  if (order.prepStatus === 'cancelled') return <Tag tone="neutral">Cancelled</Tag>;
  return (
    <PrepPill
      state={
        order.prepStatus === 'preparing' || order.prepStatus === 'ready' || order.prepStatus === 'served'
          ? order.prepStatus
          : 'new'
      }
    />
  );
}

function OrderHandoff({
  order,
  live,
  blocked,
}: {
  order: OrderLedgerRow;
  live: boolean;
  blocked: boolean;
}) {
  const cancelled = order.prepStatus === 'cancelled';
  const entered = order.kotHandoffStatus === 'entered_in_pos' || order.kotHandoffStatus === 'webhook_sent';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {cancelled ? <span className="text-[11.5px] text-gink-46">—</span> : (
        <Tag tone={entered ? 'live' : 'due'}>
          {kotHandoffLabel(normalizeKotHandoffStatus(order.kotHandoffStatus))}
        </Tag>
      )}
      {live && !blocked && !cancelled ? (
        <form action={toggleOrderKotHandoffAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="nextStatus" value={order.kotHandoffStatus === 'entered_in_pos' ? 'pending' : 'entered_in_pos'} />
          <button type="submit" className={btn('quiet', 'sm')}>
            {order.kotHandoffStatus === 'entered_in_pos' ? 'Reset' : 'Mark entered'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function orderPaymentState(order: OrderLedgerRow): 'paid' | 'pending' | 'failed' {
  if (order.paymentStatus === 'pending') return 'pending';
  if (order.paymentStatus === 'failed') return 'failed';
  return 'paid';
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
  const isModeA = (data?.operatingMode ?? outlet?.operatingMode) === 'mode_a';
  const posIntegrationName = data?.posIntegrationName ?? outlet?.posIntegrationName ?? null;
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

  const operatingMode = data?.operatingMode ?? outlet?.operatingMode;
  const healthById = new Map(
    orders.map((order) => [
      order.id,
      live && !blocked
        ? assessOrderReliability(
            {
              id: order.id,
              code: order.code,
              tableLabel: order.tableLabel,
              placedAt: order.placedAt,
              updatedAt: order.updatedAt,
              prepStatus: order.prepStatus,
              holdRequired: order.holdRequired,
              confirmedAt: order.confirmedAt,
              kitchenAnnouncementStatus: order.kitchenAnnouncementStatus,
              kotHandoffStatus: order.kotHandoffStatus,
            },
            { operatingMode },
          )
        : null,
    ]),
  );

  const visible = orders.filter((order) =>
    matches(order, activeFilter, query.trim(), Boolean(healthById.get(order.id)?.needsAttention)),
  );
  const openCount = orders.filter(isOpen).length;
  const delayedCount = orders.filter((o) => Boolean(healthById.get(o.id)?.needsAttention)).length;
  const unsettledCount = canViewFinance
    ? orders.filter((o) => o.prepStatus !== 'cancelled' && o.paymentStatus !== 'paid').length
    : 0;
  const cancelledCount = orders.filter((o) => o.prepStatus === 'cancelled').length;
  const settledCount = canViewFinance
    ? orders.filter((o) => o.prepStatus !== 'cancelled' && o.paymentStatus === 'paid').length
    : 0;
  const pendingHandoffCount = isModeA
    ? orders.filter((o) => {
        if (o.prepStatus === 'cancelled') return false;
        const status = normalizeKotHandoffStatus(o.kotHandoffStatus);
        return status !== 'entered_in_pos' && status !== 'webhook_sent';
      }).length
    : 0;
  // Each chip says how many rows it would show, from the same array the table
  // is drawn from. A filter that turns out to be empty is then a fact about the
  // day rather than something you find out by clicking it.
  const filterCounts: Record<OrderFilter, number> = {
    all: orders.length,
    open: openCount,
    delayed: delayedCount,
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
      <OpsSurface>
        <AutoRefresh enabled={live && !blocked && !query.trim()} />
        <PageHead
          kicker="Service / orders"
          title="Orders"
          meta={live && !blocked ? data?.range.label : 'Sample ledger · fictional orders'}
          actions={
            live && !blocked ? (
              <>
                <BtnLink href="/kitchen" tone="ghost">Kitchen board</BtnLink>
                {canExport ? (
                  <a className={btn('ghost')} href={exportHref} download>Download CSV</a>
                ) : null}
              </>
            ) : null
          }
        />

        {blocked ? <SignInPrompt reason={blocked} screen="orders" /> : null}

        {!blocked ? (
          <div className="mb-5 grid gap-2.5">
            {!live ? (
              <Notice
                tone="accent"
                className="mb-0"
                label={<Tag tone="work">Sample data</Tag>}
              >
                Database not configured — the rows above are fictional sample data.
              </Notice>
            ) : null}

            {isModeA ? (
              <Notice
                tone="plain"
                className="mb-0"
                label={<Tag tone="neutral">Mode A · Alongside {posIntegrationName || 'your existing POS'}</Tag>}
                action={
                  <Link href="/dashboard/settings#settings-operating-mode" className={btn('ghost', 'sm')}>
                    Operating mode
                  </Link>
                }
              >
                Billing stays in your existing POS.{' '}
                {pendingHandoffCount > 0
                  ? `${pendingHandoffCount} active order${pendingHandoffCount === 1 ? ' is' : 's are'} awaiting POS entry — mark Entered in POS after punching the bill so nothing is duplicated.`
                  : 'All orders in this range are handed off to your billing POS.'}
              </Notice>
            ) : null}
          </div>
        ) : null}

        {!blocked ? (
          <>
            <section
              aria-label="Order summary"
              className={[
                'grid gap-3 sm:gap-4',
                canViewFinance ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3',
              ].join(' ')}
            >
              <OrderMetric
                label="Orders in range"
                value={orders.length}
                note={data?.ordersTruncated ? 'Most recent 100 shown' : data?.range.label ?? 'Sample range'}
                tone="forest"
                icon="orders"
              />
              <OrderMetric
                label="Open orders"
                value={openCount}
                note="New, preparing, or ready"
                tone="orange"
                icon="open"
              />
              <OrderMetric
                label="Needs attention"
                value={delayedCount}
                note={live ? 'Delayed or unacknowledged' : 'Live alerts appear with real orders'}
                tone="moss"
                icon="alert"
              />
              {canViewFinance ? (
                <OrderMetric
                  label="Not settled"
                  value={unsettledCount}
                  note="Cancelled orders excluded"
                  tone="paper"
                  icon="settled"
                />
              ) : null}
            </section>

            <section
              aria-label="Order filters"
              className="mt-5 rounded-[var(--p-r-card)] border border-hair bg-card p-4 shadow-[var(--p-shadow-1)] sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div>
                  <h2 className="m-0 text-[13.5px] font-semibold tracking-[-0.014em] text-gink">Find orders</h2>
                  <p className="mt-1 mb-0 text-[11.5px] text-gink-46">Choose a date range, filter by status, or search a table or reference.</p>
                </div>
                <form method="get" action="/dashboard/orders" className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  {rangeKey !== 'today' ? <input type="hidden" name="range" value={rangeKey} /> : null}
                  {rangeKey === 'custom' && customFrom ? <input type="hidden" name="from" value={customFrom} /> : null}
                  {rangeKey === 'custom' && customTo ? <input type="hidden" name="to" value={customTo} /> : null}
                  {activeFilter !== 'all' ? <input type="hidden" name="status" value={activeFilter} /> : null}
                  <input
                    type="search"
                    name="q"
                    defaultValue={query}
                    placeholder="Table or reference"
                    aria-label="Find an order by table or reference"
                    className={fieldSm('w-[220px] max-w-full')}
                  />
                  <button type="submit" className={btn('ghost', 'sm')}>Search</button>
                </form>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hair pt-3">
                <span className="mr-1 text-[11.5px] font-semibold text-gink-46">Date range</span>
                <nav aria-label="Order date range" className="flex flex-wrap items-center gap-1.5">
                  {RANGE_LINKS.map((range) => (
                    <Link
                      key={range.key}
                      href={href(range.key, activeFilter, query, dates)}
                      aria-current={rangeKey === range.key ? 'true' : undefined}
                      className={chipClass(rangeKey === range.key)}
                    >
                      {range.label}
                    </Link>
                  ))}
                </nav>

                <details open={rangeKey === 'custom'} className="relative">
                  <summary className={`${chipClass(rangeKey === 'custom')} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                    {rangeKey === 'custom' && customFrom && customTo
                      ? `${customFrom} → ${customTo}`
                      : 'Custom dates'}
                  </summary>
                  <form
                    method="get"
                    action="/dashboard/orders"
                    className="absolute top-full left-0 z-10 mt-2 flex min-w-[min(100vw-2rem,380px)] flex-wrap items-end gap-2 rounded-[var(--p-r-card)] border border-hair bg-card p-3 shadow-[var(--p-shadow-2)]"
                  >
                    <input type="hidden" name="range" value="custom" />
                    {activeFilter !== 'all' ? <input type="hidden" name="status" value={activeFilter} /> : null}
                    {query ? <input type="hidden" name="q" value={query} /> : null}
                    <label className="block">
                      <span className="mb-1 block text-[11.5px] font-medium text-gink-46">From</span>
                      <input type="date" name="from" defaultValue={customFrom} required className={fieldSm('w-[145px] max-w-full')} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11.5px] font-medium text-gink-46">To</span>
                      <input type="date" name="to" defaultValue={customTo} required className={fieldSm('w-[145px] max-w-full')} />
                    </label>
                    <button type="submit" className={btn('primary', 'sm')}>Apply dates</button>
                  </form>
                </details>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hair pt-3">
                <span className="mr-1 text-[11.5px] font-semibold text-gink-46">Status</span>
                <nav aria-label="Order status filter" className="flex flex-wrap items-center gap-1.5">
                  {visibleFilters.map((item) => (
                    <Link
                      key={item.key}
                      href={href(rangeKey, item.key, query, dates)}
                      aria-current={activeFilter === item.key ? 'true' : undefined}
                      className={`${chipClass(activeFilter === item.key)} gap-1.5`}
                    >
                      {item.label}
                      <span className={[
                        'tnum text-[11.5px]',
                        activeFilter === item.key ? 'text-[var(--p-accent)]' : 'text-gink-46',
                      ].join(' ')}>
                        {filterCounts[item.key]}
                      </span>
                    </Link>
                  ))}
                </nav>
              </div>
            </section>

            <Panel
              title={`${visible.length} order${visible.length === 1 ? '' : 's'}`}
              meta={
                <>
                  {query ? `Matching “${query}”` : 'Newest first'}
                  {data?.ordersTruncated ? ' · showing the most recent hundred' : ''}
                </>
              }
              className="mt-5"
              bodyClassName=""
            >
              {visible.length > 0 ? (
                <>
                  <div className="hidden xl:block">
                    <TableWrap>
                      <table className={tableClass}>
                        <thead>
                          <tr>
                            <Th>Order</Th>
                            <Th>Table</Th>
                            <Th>Placed</Th>
                            <Th>Kitchen</Th>
                            {isModeA ? <Th>POS handoff</Th> : null}
                            {canViewFinance ? <Th>Payment</Th> : null}
                            {canViewFinance ? <Th align="right">Total</Th> : <Th align="right">Counter</Th>}
                            {canViewFinance ? <Th align="right">Balance</Th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((order) => {
                            const outstanding = Math.max(0, (order.totalPaise ?? 0) - (order.paidPaise ?? 0));
                            const cancelled = order.prepStatus === 'cancelled';
                            const health = healthById.get(order.id);
                            return (
                              <Tr key={order.id} data-order-row={order.id} className={cancelled ? 'opacity-55' : undefined}>
                                <Td>
                                  <span className="flex items-center gap-2">
                                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-paper-deep text-[var(--p-accent)]">
                                      <OrdersIcon name="orders" />
                                    </span>
                                    {live && !blocked ? (
                                      <Link href={`/bill/${order.id}`} title="Open this bill" className="font-semibold text-gink underline decoration-hair-strong underline-offset-2 hover:text-[var(--p-accent)]">
                                        {order.code}
                                      </Link>
                                    ) : <span className="font-semibold text-gink">{order.code}</span>}
                                  </span>
                                </Td>
                                <Td>{order.tableLabel ?? 'Takeaway'}</Td>
                                <Td className="tnum whitespace-nowrap text-gink-64">{dateTimeInZone(timezone, order.placedAt)}</Td>
                                <Td>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <OrderPrep order={order} />
                                    {health?.summary ? <Tag tone="due">{health.summary}</Tag> : null}
                                  </div>
                                </Td>
                                {isModeA ? <Td><OrderHandoff order={order} live={live} blocked={Boolean(blocked)} /></Td> : null}
                                {canViewFinance ? <Td><PaymentPill state={orderPaymentState(order)} /></Td> : null}
                                {canViewFinance ? <Td align="right"><Money value={order.totalPaise ?? 0} /></Td> : null}
                                <Td align="right">
                                  {canViewFinance ? (
                                    outstanding > 0 && !cancelled ? (
                                      <Link
                                        href={`/cashier?order=${encodeURIComponent(live && !blocked ? order.id : order.code)}`}
                                        title={`Take payment for ${order.code} at the counter`}
                                        className={btn('ghost', 'sm')}
                                      >
                                        Collect <Money value={outstanding} />
                                      </Link>
                                    ) : <span className="text-[11.5px] text-gink-46">{cancelled ? 'Not collectable' : 'Settled'}</span>
                                  ) : !cancelled && live && !blocked ? (
                                    <Link href={`/cashier?order=${encodeURIComponent(order.id)}`} title={`Open ${order.code} at the counter`} className={btn('ghost', 'sm')}>
                                      Open at counter
                                    </Link>
                                  ) : <span className="text-[11.5px] text-gink-46">{cancelled ? 'Cancelled' : '—'}</span>}
                                </Td>
                              </Tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  </div>

                  <ul aria-label="Orders" className="grid gap-2.5 p-3 sm:grid-cols-2 sm:p-4 xl:hidden">
                    {visible.map((order) => {
                      const outstanding = Math.max(0, (order.totalPaise ?? 0) - (order.paidPaise ?? 0));
                      const cancelled = order.prepStatus === 'cancelled';
                      const health = healthById.get(order.id);
                      return (
                        <li key={order.id} data-order-row={order.id} className={[
                          'min-w-0 rounded-[var(--p-r-card)] border border-hair bg-card p-3.5 shadow-[var(--p-shadow-1)]',
                          cancelled ? 'opacity-55' : '',
                        ].join(' ')}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-paper-deep text-[var(--p-accent)]"><OrdersIcon name="orders" /></span>
                              <div className="min-w-0">
                                {live && !blocked ? (
                                  <Link href={`/bill/${order.id}`} title="Open this bill" className="text-[13.5px] font-semibold text-gink underline decoration-hair-strong underline-offset-2">
                                    {order.code}
                                  </Link>
                                ) : <span className="text-[13.5px] font-semibold text-gink">{order.code}</span>}
                                <span className="mt-0.5 block truncate text-[11.5px] text-gink-64">{order.tableLabel ?? 'Takeaway'}</span>
                              </div>
                            </div>
                            <span className="shrink-0 text-right text-[10.5px] leading-[1.4] text-gink-46 tabular-nums">{dateTimeInZone(timezone, order.placedAt)}</span>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <OrderPrep order={order} />
                            {health?.summary ? <Tag tone="due">{health.summary}</Tag> : null}
                            {canViewFinance ? <PaymentPill state={orderPaymentState(order)} /> : null}
                          </div>

                          {isModeA && !cancelled ? (
                            <div className="mt-2"><OrderHandoff order={order} live={live} blocked={Boolean(blocked)} /></div>
                          ) : null}

                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-hair pt-3">
                            {canViewFinance ? (
                              <div>
                                <span className="block text-[10.5px] text-gink-46">Order total</span>
                                <span className="mt-0.5 block text-[13.5px] font-semibold text-gink"><Money value={order.totalPaise ?? 0} /></span>
                              </div>
                            ) : <span className="text-[11.5px] text-gink-46">Payment details hidden</span>}
                            {canViewFinance ? (
                              outstanding > 0 && !cancelled ? (
                                <Link
                                  href={`/cashier?order=${encodeURIComponent(live && !blocked ? order.id : order.code)}`}
                                  title={`Take payment for ${order.code} at the counter`}
                                  className={btn('primary', 'sm')}
                                >
                                  Collect <Money value={outstanding} />
                                </Link>
                              ) : <span className="text-[11.5px] font-medium text-gink-46">{cancelled ? 'Not collectable' : 'Settled'}</span>
                            ) : !cancelled && live && !blocked ? (
                              <Link href={`/cashier?order=${encodeURIComponent(order.id)}`} title={`Open ${order.code} at the counter`} className={btn('ghost', 'sm')}>
                                Open at counter
                              </Link>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <div className="px-4 py-5 sm:px-5">
                  <Empty>
                    <span className="block">{orders.length === 0 ? 'No orders in this range.' : 'No orders match this filter.'}</span>
                    {orders.length > 0 && narrowed ? (
                      <Link href={href(rangeKey, 'all', '', dates)} className="mt-2 inline-block text-[12.5px] font-medium text-[var(--p-accent)] underline decoration-[color-mix(in_oklab,var(--p-accent)_35%,transparent)] underline-offset-2 hover:decoration-[var(--p-accent)]">
                        Show all {orders.length} in this range
                      </Link>
                    ) : null}
                  </Empty>
                </div>
              )}
            </Panel>

            <p className="mt-4 max-w-[92ch] text-[11.5px] leading-[1.6] text-gink-46">
              {canViewFinance ? (
                <>
                  Outstanding is what the table still owes on that bill;{' '}
                  <strong className="font-semibold text-gink-64">Collect</strong> opens the counter on that exact ticket.{' '}
                  <Link href="/cashier" className="underline underline-offset-2">Open the counter queue</Link>.
                  {' '}Cancelled bills stay in the history and are excluded from sales-report totals.
                </>
              ) : (
                <>
                  Payment details are not included in this list. Open an order to view its bill, or go to{' '}
                  <Link href="/cashier" className="underline underline-offset-2">the counter</Link>. Cancelled orders remain in the history.
                </>
              )}
            </p>
          </>
        ) : null}
      </OpsSurface>
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

