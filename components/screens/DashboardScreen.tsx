import { rupeesToPaise } from '@/lib/money';
import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems } from '@/lib/demo-data';
import { Money, PaymentPill, PrepPill, Sparkline } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { ChartMotion } from '@/components/owner/ChartMotion';
import { OpsSurface } from '@/components/owner/OpsSurface';
import { AutoRefresh } from '@/components/owner/AutoRefresh';
import {
  BtnLink,
  Empty,
  Notice,
  OwnerPage,
  SectionHead,
  Tag,
} from '@/components/owner/chrome';
import type { DashboardScreenData } from '@/lib/db/dashboard-screen';
import { MarkSessionPaidButton } from '@/components/owner/MarkSessionPaidButton';
import { CloseSessionButton } from '@/components/owner/CloseSessionButton';
import { accessSummary, planSentence } from '@/lib/access';
import { clockTimeInZone, hourLabel, hourRangeLabel } from '@/lib/db/time';

type PaymentState = 'paid' | 'pending' | 'failed';
type PrepState = 'new' | 'preparing' | 'ready' | 'served';

/**
 * A refund is still a recorded payment event: labelling it "failed" would
 * imply that no money moved. This overview does not claim to calculate net
 * sales after refunds; that belongs in the financial reports.
 */
function paymentState(status: string): PaymentState {
  const value = status.toLowerCase();
  if (value === 'pending' || value.includes('counter due')) return 'pending';
  if (value === 'failed' || value.includes('declined') || value.includes('refused')) return 'failed';
  if (value === 'paid' || value === 'recorded' || value === 'refunded' || value.includes('paid at')) {
    return 'paid';
  }
  // Unknown states must not be presented as settled.
  return 'pending';
}

function prepState(status: string): PrepState {
  const value = status.toLowerCase();
  if (value === 'preparing' || value === 'ready' || value === 'served') return value;
  return 'new';
}

function DashboardGlyph({ name }: { name: 'orders' | 'revenue' | 'ticket' | 'open' | 'table' | 'clock' }) {
  const paths = {
    orders: <><rect x="5" y="4.5" width="14" height="16" rx="2.5" /><path d="M9 4.5v-1h6v1M8.5 9h7M8.5 12.5h7M8.5 16h4" /></>,
    revenue: <><path d="M12 3.5v17M16.5 7.2c0-1.8-1.8-3-4.5-3S7.5 5.3 7.5 7s1.2 2.6 4.5 3.2 4.5 1.5 4.5 3.5-1.8 3.1-4.5 3.1-4.5-1.2-4.5-3" /></>,
    ticket: <><rect x="4" y="5" width="16" height="14" rx="2.5" /><path d="M4 9h16M8 14h3M15.5 14h.5" /></>,
    open: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
    table: <><path d="M4 7h16v4H4zM6 11v7M18 11v7M9 7V5h6v2" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
  } as const;

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function MetricCard({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  testId: string;
}) {
  return (
    <article
      data-metric={testId}
      className="min-w-0 rounded-[var(--p-r-card)] border border-hair bg-card p-4 shadow-[var(--p-shadow-1)] sm:p-5"
    >
      <p className="m-0 text-[12.5px] font-medium text-gink-64">{label}</p>
      <p className="mt-3 mb-0 truncate text-[24px] leading-none font-semibold tracking-[-0.04em] text-gink tabular-nums">
        {value}
      </p>
      <p className="mt-2.5 mb-0 text-[11.5px] leading-[1.4] text-gink-46">{note}</p>
    </article>
  );
}

function OrderRow({
  order,
}: {
  order: {
    id: string;
    code: string;
    table: string;
    placed: string;
    payment: PaymentState;
    prep: PrepState;
    totalPaise: number;
    href?: string;
  };
}) {
  const content = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--p-accent-soft)] text-[var(--p-accent-strong)]">
        <DashboardGlyph name="orders" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-gink">{order.code}</span>
          <span className="text-[12.5px] text-gink-64">{order.table}</span>
        </span>
        <span className="mt-1 block text-[11.5px] text-gink-46">{order.placed}</span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <PaymentPill state={order.payment} />
          <PrepPill state={order.prep} />
        </span>
      </span>
      <span className="shrink-0 self-start text-right text-[13px] font-semibold tabular-nums text-gink">
        <Money value={order.totalPaise} strong />
        {order.href ? <span aria-hidden="true" className="mt-1 block text-[12.5px] text-[var(--p-accent)]">↗</span> : null}
      </span>
    </>
  );

  return (
    <li className="min-w-0">
      {order.href ? (
        <Link
          href={order.href}
          aria-label={`Open order ${order.code}, ${order.table}, ${order.placed}`}
          className="group flex min-w-0 items-start gap-3 rounded-[14px] p-2.5 transition-colors duration-200 hover:bg-paper-deep focus-visible:bg-paper-deep motion-reduce:transition-none"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 items-start gap-3 rounded-[14px] p-2.5">{content}</div>
      )}
    </li>
  );
}

/**
 * The staff overview keeps the information owners act on close to the top:
 * today's numbers, the revenue curve, and the most recent tickets. The shell
 * supplies the persistent navigation; this page focuses on a quick read of
 * service and links to the full, role-gated workflows.
 *
 * Live figures come only from `getDashboardScreenData`. When the database is
 * not configured, the same layout may show sample data, always marked as
 * fictional. No sample values are used in a signed-in live workspace.
 */
export function Dashboard({
  data,
  outlet,
}: {
  data?: DashboardScreenData | null;
  outlet?: OutletBar | null;
}) {
  const live = Boolean(data);
  const blocked = data?.blocked;
  const stats = data?.stats;
  const timezone = data?.timezone ?? restaurant.timezone;
  const venueName = live ? data?.restaurantName ?? '' : restaurant.name;
  const venueMeta = live ? data?.tagline : restaurant.tagline;
  const demoOpenOrders = recentOrders.filter((order) => ['new', 'preparing', 'ready'].includes(order.state.toLowerCase())).length;
  const activeTableCount = live && data ? data.activeSessions.length : 0;
  const localHour = Number(new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date()));
  const greeting = localHour < 12 ? 'Good morning' : localHour < 17 ? 'Good afternoon' : 'Good evening';

  const metrics = live && stats && data
    ? [
        {
          id: 'revenue', label: 'Revenue today', value: <Money value={stats.revenueTodayPaise} />,
          note: 'Settled payments only',
        },
        {
          id: 'orders', label: 'Orders today', value: String(stats.ordersToday),
          note: stats.openOrders > 0 ? `${stats.openOrders} open · Since midnight` : 'Since midnight · restaurant time',
        },
        {
          id: 'active-tables', label: 'Active tables', value: String(activeTableCount),
          note: activeTableCount === 1 ? '1 open table session' : 'Open table sessions',
        },
        {
          id: 'ticket', label: 'Average ticket', value: <Money value={stats.averageTicketPaise} />,
          note: stats.ordersToday > 0 ? 'Revenue ÷ orders today' : 'No orders yet today',
        },
      ]
    : [
        {
          id: 'revenue', label: 'Revenue today', value: dashboardStats[1].value,
          note: 'Settled · sample figures',
        },
        {
          id: 'orders', label: 'Orders today', value: dashboardStats[0].value,
          note: `${demoOpenOrders} open · sample tickets`,
        },
        {
          id: 'active-tables', label: 'Active tables', value: String(activeTableCount),
          note: 'Open table sessions',
        },
        {
          id: 'ticket', label: 'Average ticket', value: dashboardStats[2].value,
          note: dashboardStats[2].delta,
        },
      ];

  const itemRows = live && data
    ? data.topItems
    : topItems.map((item) => ({ name: item.name, qty: item.sold, revenuePaise: rupeesToPaise(item.revenue) }));
  const topQty = itemRows.reduce((max, item) => Math.max(max, item.qty), 1);
  const orders = live && data
    ? data.orders.map((order) => ({
        id: order.id,
        code: order.code,
        table: order.table,
        placed: clockTimeInZone(timezone, order.placedAt),
        payment: paymentState(order.paymentStatus),
        prep: prepState(order.prepStatus),
        totalPaise: order.totalPaise,
        href: `/bill/${order.id}`,
      }))
    : !live
      ? recentOrders.map((order) => ({
          id: order.id,
          code: order.id,
          table: order.table,
          placed: order.at,
          payment: paymentState(order.payment),
          prep: prepState(order.state),
          totalPaise: rupeesToPaise(order.total),
        }))
      : [];

  const hourly = live && data ? data.hourlyPaise : sparkline;
  const chartable = hourly.length >= 2;
  const chartHasValue = hourly.some((value) => value > 0);
  const peakIndex = hourly.reduce((best, value, index) => value > hourly[best] ? index : best, 0);
  const hasPeak = (hourly[peakIndex] ?? 0) > 0;
  const displayDate = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone,
  }).format(new Date());

  return (
    <OwnerPage active="overview" outlet={outlet} signOut={!blocked}>
      <OpsSurface>
        <AutoRefresh enabled={live && !blocked} />

        {blocked ? <SignInPrompt reason={blocked} screen="dashboard" /> : null}

        {!blocked ? (
          <div className="mb-5 grid gap-2.5" data-overview-status>
            {!live ? (
              <Notice
                role="note"
                tone="accent"
                className="mb-0"
                label={<Tag tone="work">Sample dashboard</Tag>}
                action={<Link href="/menu" className="text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-4">Open menu</Link>}
              >
                Sample figures and orders are fictional. Live ordering and payment processing are disabled.
              </Notice>
            ) : null}

            {live && outlet?.operatingMode === 'mode_a' ? (
              <Notice
                tone="plain"
                className="mb-0"
                label={<Tag tone="neutral">Mode A · alongside POS</Tag>}
                action={<Link href="/dashboard/settings#settings-operating-mode" className="text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-4">Operating path</Link>}
              >
                QR ordering and the kitchen board run alongside your existing POS. AutoDine billing and financial reports are hidden in this mode.
              </Notice>
            ) : null}

            {live && data?.access ? (
              <Notice
                data-plan-line
                tone={data.access.readOnly ? 'due' : 'live'}
                className="mb-0"
                label={<Tag tone={data.access.readOnly ? 'due' : 'live'}>{accessSummary(data.access)}</Tag>}
                action={
                  <span className="flex items-center gap-3">
                    <Link href="/pricing" className="text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-4">Plans</Link>
                    <Link data-subscription-link href="/dashboard/subscription" className="text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-4">Subscription</Link>
                  </span>
                }
              >
                {planSentence(data.access)}
              </Notice>
            ) : null}

            {live && stats?.ordersToday === 0 ? (
              <Notice
                tone="plain"
                className="mb-0"
                label={<Tag tone="neutral">A fresh start</Tag>}
                action={<Link href="/dashboard/tables" className="text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-4">Tables &amp; QR</Link>}
              >
                No orders yet today. Your first table order will appear here and reach the kitchen board.
              </Notice>
            ) : null}
          </div>
        ) : null}

        {!blocked ? (
          <>
            <section
              aria-label="Welcome"
              data-overview-welcome
              className="mb-5 flex flex-col justify-between gap-5 rounded-[var(--p-r-card)] border border-hair bg-card px-5 py-6 shadow-[var(--p-shadow-1)] sm:px-7 sm:py-7 lg:flex-row lg:items-center"
            >
              <div className="min-w-0">
                <p className="m-0 text-[11.5px] font-semibold tracking-[0.14em] text-gink-46 uppercase">
                  Your restaurant, at a glance
                </p>
                <h1 className="mt-3 mb-0 text-[30px] leading-[1.12] font-semibold tracking-[-0.035em] text-gink text-balance">
                  {greeting}, {venueName || 'there'}.
                </h1>
                <p className="mt-2.5 mb-0 text-[15px] leading-[1.5] text-gink-64 sm:text-[17px]">
                  Here&apos;s what&apos;s happening in your restaurant today.
                </p>
                {venueMeta ? <p className="mt-1.5 mb-0 text-[11.5px] text-gink-46">{venueMeta}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="mr-1 inline-flex h-9 items-center gap-2 rounded-full border border-hair bg-paper px-3 text-[11.5px] font-medium text-gink-64" data-overview-date>
                  <span aria-hidden="true" className="text-[var(--p-accent)]">◷</span>
                  Today · {displayDate}
                </span>
                {outlet?.operatingMode === 'mode_a' ? (
                  <BtnLink href="/dashboard/orders" tone="ghost">Orders &amp; KOT handoff</BtnLink>
                ) : (
                  <BtnLink href="/cashier" tone="ghost">Open counter</BtnLink>
                )}
                <BtnLink href="/kitchen" tone="primary">Kitchen board <span aria-hidden="true">→</span></BtnLink>
              </div>
            </section>

            <section aria-label="Today's key figures" data-overview-metrics className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={metric.id} {...metric} testId={metric.id} />
              ))}
            </section>

            <section aria-label="Today at a glance" className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.9fr)] xl:items-stretch">
              <article data-revenue-chart className="min-w-0 rounded-[var(--p-r-card)] border border-hair bg-card p-4 shadow-[var(--p-shadow-1)] sm:p-5">
                <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-[15px] font-semibold tracking-[-0.02em] text-gink">Revenue overview</h2>
                    <p className="mt-1 mb-0 text-[11.5px] text-gink-46">
                      {live ? 'Settled payments · restaurant time' : 'Sample trend · fictional'}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-deep px-2.5 py-1 text-[10.5px] font-medium text-gink-64">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--p-accent)]" />
                    {live ? 'Today' : 'Sample'}
                  </span>
                </header>

                {chartable && chartHasValue ? (
                  <div className="text-gink" data-chart>
                    <ChartMotion>
                      <Sparkline
                        data={hourly}
                        width={520}
                        height={145}
                        baseline="zero"
                        area
                        label="Revenue by hour of the day"
                        className="h-[150px] w-full"
                        markIndex={hasPeak ? peakIndex : undefined}
                      />
                    </ChartMotion>
                    {live ? (
                      <div className="mt-2 flex items-center justify-between border-t border-hair pt-3 text-[10.5px] text-gink-46 tabular-nums">
                        <span>{hourLabel(0)}</span>
                        <span>{hourLabel(hourly.length - 1)}</span>
                      </div>
                    ) : null}
                    {live && hasPeak ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] bg-paper-deep px-3 py-2.5" data-busiest-hour>
                        <span className="grid size-7 place-items-center rounded-[9px] bg-card text-[var(--p-accent)]"><DashboardGlyph name="clock" /></span>
                        <span className="text-[11.5px] font-medium text-gink">Busiest hour</span>
                        <span className="text-[11.5px] text-gink-46">{hourRangeLabel(peakIndex)}</span>
                        <span className="ml-auto text-[13px] font-semibold tabular-nums text-gink"><Money value={hourly[peakIndex]} /></span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <Empty className="min-h-[190px]">
                    {chartable
                      ? 'No settled payments yet today. The chart will build as payments are recorded.'
                      : 'Today has just started. The chart will take shape as the day progresses.'}
                  </Empty>
                )}
              </article>

              <article className="min-w-0 rounded-[var(--p-r-card)] border border-hair bg-card p-4 shadow-[var(--p-shadow-1)] sm:p-5">
                <SectionHead
                  title={live ? 'Latest orders' : 'Recent sample orders'}
                  meta={live && stats ? `${stats.ordersToday} today` : 'Fictional'}
                  action={<BtnLink href="/dashboard/orders" tone="ghost" size="sm">View all <span aria-hidden="true">→</span></BtnLink>}
                  className="mb-2 items-center"
                />
                {orders.length > 0 ? (
                  <ul aria-label="Recent orders" className="m-0 divide-y divide-hair p-0">
                    {orders.slice(0, 5).map((order) => <OrderRow key={order.id} order={order} />)}
                  </ul>
                ) : (
                  <Empty className="min-h-[190px]">No orders yet today. New tickets will show here after guests submit them.</Empty>
                )}
              </article>
            </section>

            {live && data && data.orderHealth?.flaggedCount ? (
              <section aria-label="Orders needing attention" className="mt-6 rounded-[var(--p-r-card)] border border-[color-mix(in_oklab,var(--p-due)_22%,transparent)] bg-card p-4 shadow-[var(--p-shadow-1)] sm:p-5">
                <SectionHead
                  title="Needs attention"
                  meta={`${data.orderHealth.flaggedCount} order${data.orderHealth.flaggedCount === 1 ? '' : 's'} · ${data.orderHealth.delayedCount} delayed`}
                  action={<BtnLink href="/dashboard/orders?status=delayed" tone="ghost" size="sm">Review orders <span aria-hidden="true">→</span></BtnLink>}
                  className="mb-2 items-center"
                />
                <ul className="m-0 divide-y divide-hair p-0">
                  {data.orderHealth.flaggedOrders.slice(0, 4).map((item) => (
                    <li key={item.orderId} className="flex flex-wrap items-center justify-between gap-2.5 py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--p-due-soft)] text-[var(--p-due)]"><DashboardGlyph name="clock" /></span>
                        <Link href={`/bill/${item.orderId}`} className="text-[12.5px] font-semibold text-gink underline decoration-hair-strong underline-offset-2">{item.code}</Link>
                        <span className="text-[12.5px] text-gink-64">{item.tableLabel}</span>
                        <Tag tone="due">{item.summary ?? 'Needs attention'}</Tag>
                      </div>
                      <Link href={`/bill/${item.orderId}`} className="text-[11.5px] font-semibold text-[var(--p-accent)]">Inspect →</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-label="Service snapshot" className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.9fr)]">
              {live && data ? (
                <div>
                  <SectionHead
                    title="Active tables"
                    meta={`${data.activeSessions.length} open session${data.activeSessions.length === 1 ? '' : 's'}`}
                    action={<BtnLink href="/dashboard/tables" tone="ghost" size="sm">Floor plan <span aria-hidden="true">→</span></BtnLink>}
                    className="items-center"
                  />
                  {data.activeSessions.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {data.activeSessions.map((session) => {
                        const unpaid = session.outstandingPaise > 0;
                        return (
                          <article key={session.id} data-active-session={session.id} className="min-w-0 rounded-[var(--p-r-card)] border border-hair bg-card p-4 shadow-[var(--p-shadow-1)]">
                            <header className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-paper-deep text-[var(--p-accent)]"><DashboardGlyph name="table" /></span>
                                <div className="min-w-0">
                                  <h3 className="truncate text-[13.5px] font-semibold text-gink">{session.table}</h3>
                                  <p className="mt-0.5 text-[11.5px] text-gink-46">{session.orderCount} ticket{session.orderCount === 1 ? '' : 's'} · opened {clockTimeInZone(timezone, session.openedAt)}</p>
                                </div>
                              </div>
                              <Tag tone={unpaid ? 'due' : 'live'}>{unpaid ? 'Balance due' : 'Settled'}</Tag>
                            </header>

                            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-hair pt-3">
                              <div>
                                <p className="text-[10.5px] text-gink-46">Session total</p>
                                <p data-session-total className="mt-1 text-[17px] font-semibold tabular-nums text-gink"><Money value={session.totalPaise} /></p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10.5px] text-gink-46">Outstanding</p>
                                <p className="mt-1 text-[17px] font-semibold tabular-nums text-gink"><Money value={session.outstandingPaise} /></p>
                              </div>
                            </div>

                            {session.items.length > 0 ? (
                              <details className="mt-3 border-t border-hair pt-2.5">
                                <summary className="cursor-pointer text-[11.5px] font-medium text-gink-64">View tickets &amp; items <span className="text-gink-46">· {session.orderCodes.join(', ')}</span></summary>
                                <ul aria-label={`Items in session ${session.id}`} className="mt-2 space-y-1.5">
                                  {session.items.map((item, index) => (
                                    <li key={`${item.ticketCode}-${index}`} className="flex items-start justify-between gap-3 text-[11.5px]">
                                      <span className="min-w-0 text-gink"><strong className="font-semibold">{item.quantity} × {item.name}</strong>{item.variant || item.addons.length ? <span className="block text-[10.5px] text-gink-46">{[item.variant, ...item.addons].filter(Boolean).join(' · ')}</span> : null}</span>
                                      <span className="shrink-0 text-[10.5px] text-gink-46">{item.ticketCode}</span>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}

                            {session.paidAt && !unpaid ? <p className="mt-2 text-[10.5px] text-gink-46">Settled {clockTimeInZone(timezone, session.paidAt)}</p> : null}
                            {data.canMarkPaid ? (
                              <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-hair pt-3">
                                {unpaid ? <MarkSessionPaidButton sessionId={session.id} table={session.table} /> : <span className="text-[11.5px] text-gink-46">Balance settled</span>}
                                <CloseSessionButton sessionId={session.id} table={session.table} outstandingPaise={session.outstandingPaise} gstMode={data.gstMode} printers={data.printers} />
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[var(--p-r-card)] border border-hair bg-card px-4 py-4 text-[12.5px] text-gink-64 shadow-[var(--p-shadow-1)]">No open table sessions. New table orders appear here.</div>
                  )}
                </div>
              ) : null}

              <div>
                <SectionHead
                  title="Popular today"
                  meta={live ? 'By quantity sold' : 'Sample · fictional'}
                  action={(() => {
                    const role = outlet?.outlets.find((item) => item.id === outlet.activeId)?.role?.toLowerCase();
                    const canViewReports = outlet?.operatingMode !== 'mode_a' && (!role || role === 'owner' || role === 'manager');
                    return canViewReports ? <BtnLink href="/dashboard/reports" tone="ghost" size="sm">Reports <span aria-hidden="true">→</span></BtnLink> : null;
                  })()}
                  className="items-center"
                />
                {itemRows.length > 0 ? (
                  <ol data-top-items className="divide-y divide-hair rounded-[var(--p-r-card)] border border-hair bg-card px-4 shadow-[var(--p-shadow-1)]">
                    {itemRows.slice(0, 4).map((item, index) => (
                      <li key={item.name} className="py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-paper-deep text-[10.5px] font-semibold tabular-nums text-[var(--p-accent)]">{String(index + 1).padStart(2, '0')}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium text-gink" title={item.name}>{item.name}</span>
                            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-paper-deep"><span className="block h-full rounded-full bg-[var(--p-accent)]" style={{ width: `${Math.max(5, Math.round((item.qty / topQty) * 100))}%` }} /></span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-[11.5px] font-semibold text-gink tabular-nums">{item.qty} sold</span>
                            <span className="block text-[10.5px] text-gink-46 tabular-nums"><Money value={item.revenuePaise} /></span>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="rounded-[var(--p-r-card)] border border-hair bg-card px-4 py-4 text-[12.5px] text-gink-64 shadow-[var(--p-shadow-1)]">Nothing sold yet today. Popular dishes appear after the first order.</div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </OpsSurface>
    </OwnerPage>
  );
}
