import { rupeesToPaise } from '@/lib/money';
import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems } from '@/lib/demo-data';
import { Money, PaymentPill, PrepPill, Sparkline } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { ChartMotion } from '@/components/owner/ChartMotion';
import { OpsSurface } from '@/components/owner/OpsSurface';
import { AutoRefresh } from '@/components/owner/AutoRefresh';
import {
  BtnLink,
  Empty,
  OwnerPage,
  Notice,
  Panel,
  Td,
  Tag,
  Th,
  TableWrap,
  Tr,
  SectionHead,
  tableClass,
} from '@/components/owner/chrome';
import type { DashboardScreenData } from '@/lib/db/dashboard-screen';
import { MarkSessionPaidButton } from '@/components/owner/MarkSessionPaidButton';
import { CloseSessionButton } from '@/components/owner/CloseSessionButton';
import { accessSummary, planSentence } from '@/lib/access';
import {
  clockTimeInZone,
  hourInZone,
  hourLabel,
  hourRangeLabel,
  RESTAURANT_TIME_ZONE,
} from '@/lib/db/time';

/**
 * 'refunded' reads as paid here for the same reason it does on the kitchen
 * board: money did move, and badging it "payment failed" would tell the owner
 * a guest never paid when in fact they were paid back afterwards. Whether the
 * refund should reduce the day's takings is a reporting question, and this
 * overview does not claim to be a report.
 */
function paymentState(status: string): 'paid' | 'pending' | 'failed' {
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  return 'paid';
}

/** Anything unrecognised falls back to 'new' rather than rendering nothing. */
function prepState(status: string): 'new' | 'preparing' | 'ready' | 'served' {
  if (status === 'preparing' || status === 'ready' || status === 'served') return status;
  return 'new';
}

/* ============================================================================
   Editorial Minimal — locked design system dashboard
   Slim left rail, big numerals, hairlines, lots of air.

   Two data sources, one markup: with no database configured this renders the
   sample rows exactly as it always has. With one, it renders the restaurant
   the signed-in account belongs to, and says so when there is nothing to show
   rather than dressing an empty day up as a quiet one.
   ========================================================================== */
export function Dashboard({
  data,
  outlet,
}: {
  data?: DashboardScreenData | null;
  /** Which outlet is open, for the switcher in the rail. */
  outlet?: OutletBar | null;
}) {
  const live = Boolean(data);
  const blocked = data?.blocked;
  const stats = data?.stats;

  const venueName = live ? (data?.restaurantName ?? '') : restaurant.name;
  const venueMeta = live ? (data?.tagline ?? '') : restaurant.tagline;
  // Times in the table are shown on the restaurant's clock, never the server's.
  const timezone = data?.timezone;

  // The greeting follows the restaurant's clock, not the reader's: a kitchen
  // that opens at 6pm should not be told "good morning" by a phone in London.
  const localHour = hourInZone(timezone ?? RESTAURANT_TIME_ZONE, new Date());
  const greeting = localHour < 12 ? 'Good morning' : localHour < 17 ? 'Good afternoon' : 'Good evening';

  const cards: Array<{ label: string; value: ReactNode; meta: string }> = live && stats
    ? [
        {
          label: 'Orders today',
          value: String(stats.ordersToday),
          meta: 'Since midnight, restaurant time',
        },
        {
          label: 'Revenue today',
          value: <Money value={stats.revenueTodayPaise} />,
          meta: 'Settled payments only',
        },
        {
          label: 'Average ticket',
          value: <Money value={stats.averageTicketPaise} />,
          meta: stats.ordersToday > 0 ? 'Billed ÷ orders today' : 'No orders yet today',
        },
        {
          label: 'Open orders',
          value: String(stats.openOrders),
          meta: 'New, preparing or ready',
        },
      ]
    : dashboardStats.map((s) => ({ label: s.label, value: s.value, meta: s.delta }));

  /*
   * The day's takings lead, wherever the source put them.
   *
   * These four cards were equal in every respect, so the eye had nowhere to
   * land: "Orders today" happened to be first because it was written first.
   * Revenue is what an owner opens this screen for, so it is lifted out of the
   * grid entirely and becomes the hero; the other three keep their weight and
   * their order beside it.
   *
   * The fallback matters. `find` returns undefined if the source ever stops
   * sending "Revenue today" -- and rendering `undefined.label` would take the
   * whole screen down. The first card is a bad hero but a working one.
   */
  const LEAD = 'Revenue today';
  const leadStat = cards.find((card) => card.label === LEAD) ?? cards[0];
  const otherStats = cards.filter((card) => card !== leadStat);

  // One shape for both sources: the demo rows call the quantity 'sold' and the
  // live ones 'qty'. Normalising here keeps the union out of the markup.
  const itemRows: Array<{ name: string; qty: number; revenuePaise: number }> =
    live && data
      ? data.topItems
      // Demo rows hold rupees; the live ones hold paise. Money takes paise,
      // so the demo branch converts at the boundary rather than teaching the
      // component two units.
      : topItems.map((t) => ({ name: t.name, qty: t.sold, revenuePaise: rupeesToPaise(t.revenue) }));

  // The bar under each ranked dish is relative to the best seller, so both the
  // width and the "N sold" beside it describe the same set of orders.
  const topQty = itemRows.reduce((max, t) => Math.max(max, t.qty), 1);

  // The Sparkline divides by (length - 1); a single bucket at ten past
  // midnight would hand it a zero step and draw nothing. Two points minimum.
  const chartable = live && data ? data.hourlyPaise.length >= 2 : true;
  const hourly = live && data ? data.hourlyPaise : sparkline;
  const chartHasValue = hourly.some((v) => v > 0);

  // Ties go to the earliest hour: two hours that took the same money are both
  // "the busiest", and naming the later one would imply a run that is not in
  // the data. `hasPeak` keeps a flat zero day from dotting midnight.
  const peakIndex = hourly.reduce((best, value, i) => (value > hourly[best] ? i : best), 0);
  const hasPeak = (hourly[peakIndex] ?? 0) > 0;

  const orders = live ? (data?.orders ?? []) : [];
  const openCount = live && stats ? stats.openOrders : 5;

  return (
    <OwnerPage active="overview" outlet={outlet} signOut={!blocked}>
      <OpsSurface tone="welcome">
        {/* The overview is a read of the database, so it is only as true as the
            last render. This re-renders it on a slow timer while the tab is
            visible and nobody is typing -- see components/owner/AutoRefresh. */}
        <AutoRefresh enabled={live && !blocked} />
      {/*
        The masthead is drawn here rather than through `PageHead` because the
        greeting is the one place the product speaks in the display face:
        Fraunces on a white card, like the reference dashboard's welcome panel.
        Everything under it keeps the kit's own type.
      */}
      <header className="mb-6 sm:mb-7">
        <div className="rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] bg-[var(--p-card)] px-5 py-6 shadow-[var(--p-shadow-1)] sm:px-7 sm:py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold tracking-[0.2em] text-[var(--p-ink-46)] uppercase">
                {live ? 'Your restaurant, at a glance' : 'Sample dashboard · fictional data'}
              </p>
              <h1 className="ov-display mt-3 text-[clamp(2.1rem,3.4vw,3rem)] leading-[1.04] font-semibold tracking-[-0.02em] text-balance text-gink">
                {greeting}
                {venueName ? `, ${venueName}.` : '.'}
              </h1>
              <p className="mt-2.5 max-w-[60ch] text-[13.5px] leading-[1.6] text-gink-64">
                {live ? 'Here’s what’s happening in your restaurant today.' : venueMeta}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pb-1">
              {outlet?.operatingMode === 'mode_a' ? (
                <BtnLink href="/dashboard/orders" tone="ghost">
                  Orders &amp; KOT handoff
                </BtnLink>
              ) : (
                <BtnLink href="/cashier" tone="ghost">
                  Open the counter
                </BtnLink>
              )}
              <BtnLink href="/kitchen" tone="accent">
                Open the kitchen board
              </BtnLink>
            </div>
          </div>
        </div>
      </header>

      {blocked && <SignInPrompt reason={blocked} screen="dashboard" />}

      {!blocked && outlet?.operatingMode === 'mode_a' ? (
        <Notice
          tone="plain"
          label={
            <Tag tone="live">
              Mode A · Alongside {outlet.posIntegrationName || 'existing POS'}
            </Tag>
          }
          action={
            <Link
              href="/dashboard/settings#settings-operating-mode"
              className="text-[12.5px] font-medium text-gink-64 underline decoration-hair-strong underline-offset-[3px] hover:text-gink hover:decoration-gink"
            >
              Operating path
            </Link>
          }
        >
          AutoDine is running QR ordering and the kitchen board alongside your existing billing
          software. Billing, GST receipts, and financial reports are hidden from the rail until you
          switch to Mode B.
        </Notice>
      ) : null}

      {/*
        The plan, on the first screen, because it is the one fact that changes
        what the rest of the dashboard can do. It is read from the database on
        every load -- not from a cookie, and not from the pricing page's copy --
        so it agrees with the gate that refuses a write.

        A read-only workspace gets the full sentence rather than a red chip: an
        owner who cannot save a menu needs to know their records are still
        there, or the first call they make is about a missing backup.
      */}
      {!blocked && live && data?.access ? (
        <Notice
          data-plan-line
          tone={data.access.readOnly ? 'due' : 'live'}
          label={<Tag tone={data.access.readOnly ? 'due' : 'live'}>{accessSummary(data.access)}</Tag>}
          action={
            <>
              <Link
                href="/pricing"
                className="text-[12.5px] font-medium text-gink-64 underline decoration-hair-strong underline-offset-[3px] hover:text-gink hover:decoration-gink"
              >
                Plans
              </Link>
              {/* The plan line is where an owner notices their trial is ending.
                  It also points at the subscription page rather than only at
                  the marketing pricing page, because what they need next is
                  their own account: the date it ends, what it costs, and what
                  stays when it does. */}
              <Link
                data-subscription-link
                href="/dashboard/subscription"
                className="text-[12.5px] font-medium text-gink-64 underline decoration-hair-strong underline-offset-[3px] hover:text-gink hover:decoration-gink"
              >
                Subscription
              </Link>
            </>
          }
        >
          {planSentence(data.access)}
        </Notice>
      ) : null}

      {!blocked && !live && (
        <Notice
          role="note"
          tone="accent"
          label={<Tag tone="work">Preview mode</Tag>}
          action={
            <Link
              href="/menu"
              className="text-[12.5px] font-medium text-[var(--p-accent)] underline decoration-[color-mix(in_oklab,var(--p-accent)_35%,transparent)] underline-offset-2 hover:decoration-[var(--p-accent)]"
            >
              Open the menu
            </Link>
          }
        >
          Metrics and orders are fictional. Live ordering and payment processing are disabled.
        </Notice>
      )}

      {/*
        A live workspace with nothing in it yet. The four cards below all read
        zero, and two empty panels explain themselves -- but an owner opening
        this for the first time needs the next step, not four zeros. This strip
        is only the truthful next action: it does not invent an order, and it
        disappears the moment the first one lands.
      */}
      {!blocked && live && stats && stats.ordersToday === 0 ? (
        <Notice
          tone="plain"
          label={<Tag tone="neutral">No orders yet</Tag>}
          action={
            <Link
              href="/dashboard/tables"
              className="text-[12.5px] font-medium text-gink-64 underline decoration-hair-strong underline-offset-[3px] hover:text-gink hover:decoration-gink"
            >
              Tables &amp; QR
            </Link>
          }
        >
          Scan a table&rsquo;s QR and place one yourself &mdash; it reaches the kitchen board in
          seconds, and today&rsquo;s figures start filling in from there.
        </Notice>
      ) : null}

      {/*
        THE DAY, AS ONE OBJECT.

        This screen used to open with four identical cards, then a chart panel,
        then a ranked list, then a table: four boxes of equal weight stacked in
        a column, which is a wireframe rather than a dashboard. Nothing on it
        said "this is the number you came for" -- the takings happened to be in
        the first box because somebody wrote it first.

        So the composition is now: ONE hero (the takings, with the shape of the
        day inside it), THREE secondary figures beside it, a ranked STRIP, and
        the ledger. Fewer, larger objects, each doing one job. The hero is the
        only card on the page with a warm fill and a lit top edge, which is how
        the eye finds the number before it has read a word.

        Nothing here is decoration: the chart is the same `Sparkline` over the
        same buckets, the figures are the same `Stat`, and the plan line above
        still comes from the database on every load.
      */}
      <section aria-label="Today at a glance" className="grid gap-4 lg:grid-cols-[1.62fr_1fr] lg:items-stretch">
        {/* ------------------------------------------------------------ hero */}
        <div
          data-hero="revenue"
          className="relative flex flex-col justify-between overflow-hidden rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] bg-[var(--p-card)] text-gink shadow-[var(--p-shadow-1)]"
        >
          {/* Reference-style white hero card: the figure in ink on white, the
              day's curve in the one accent. A faint orange sheen keeps the
              fill from reading as untouched paper. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(194,65,12,0.08),transparent)]"
          />

          <div className="relative flex flex-col gap-5 p-5 sm:p-6">
            {/* the figure */}
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold tracking-[0.16em] text-[var(--p-ink-46)] uppercase">
                {leadStat.label}
              </p>
              {/* The one display numeral on the surface. `tabular-nums` keeps
                  the rupee digits from shivering as the day grows, and the
                  clamp lets it be enormous on a laptop without wrapping on a
                  phone. */}
              <div className="mt-2.5 text-[clamp(2.2rem,5.4vw,4rem)] leading-[0.9] font-semibold tracking-[-0.055em] text-gink tabular-nums">
                {leadStat.value}
              </div>
              <p className="mt-3 max-w-[32ch] text-[12.5px] leading-[1.5] text-gink-64">
                {leadStat.meta}
              </p>
            </div>

            {/* the shape of the day, under the figure across the card */}
            <div className="min-w-0 border-t border-[var(--p-line-soft)] pt-4">
              {chartable && chartHasValue ? (
                <div className="text-[var(--p-accent)]" data-chart>
                  {/* The line draws itself once, on arrival: GSAP, lazily
                      loaded, and it can only ever ADD motion -- the server
                      sends the chart fully drawn, so a blocked bundle leaves a
                      complete chart. */}
                  <ChartMotion>
                    <Sparkline
                      data={hourly}
                      width={520}
                      height={120}
                      baseline="zero"
                      area
                      label="Revenue by hour of the day"
                      className="h-auto w-full"
                      markIndex={hasPeak ? peakIndex : undefined}
                    />
                  </ChartMotion>
                  {live ? (
                    <>
                      {/* Two ticks and nothing between them: an hour is an
                          hour, not a measurement, and a grid would be a claim
                          about precision the buckets do not have. */}
                      <div className="mt-1.5 flex items-baseline justify-between gap-3">
                        <span className="text-[10.5px] text-gink-46 tabular-nums">{hourLabel(0)}</span>
                        <span className="text-[10.5px] text-gink-46 tabular-nums">
                          {hourLabel(hourly.length - 1)}
                        </span>
                      </div>
                      {/* The line says the shape; this says the answer. */}
                      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[var(--p-line-soft)] pt-2.5">
                        <span className="text-[11.5px] font-medium text-gink">Busiest hour</span>
                        <span className="text-[11.5px] text-gink-46">{hourRangeLabel(peakIndex)}</span>
                        <span className="ml-auto text-[13px] font-semibold text-gink tabular-nums">
                          <Money value={hourly[peakIndex]} />
                        </span>
                      </div>
                    </>
                  ) : (
                    /* The sample series is a shape with no clock behind it, so
                       it is labelled as a sample and given no axis: printing
                       midnight-to-11am under twelve invented buckets invented
                       a trading day the demo never had. */
                    <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
                      Sample shape &middot; fictional
                    </p>
                  )}
                </div>
              ) : (
                <Empty>
                  {chartable
                    ? 'No settled payments yet today. The chart fills in as orders are paid for.'
                    : 'Today has only just started. The chart needs an hour of trading before it can show a shape.'}
                </Empty>
              )}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------- the ledgers
            Three figures, not four: the fourth is the hero. The reference
            dashboard gives each its own lightly tinted card -- warm peach, then
            a whisper of paper -- so the row reads as one band of colour beside
            the white hero rather than a sheet of ruled rows. Tint order is
            fixed so the band always alternates the same way. */}
        <aside
          aria-label="Other figures for today"
          className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1"
        >
          {otherStats.map((card) => {
            /* Open orders is the one card allowed a fill: it means "somebody
               is working right now". Every other figure is a white card with a
               hairline, like the reference dashboard's tiles -- colour is
               reserved for the thing that needs a glance. */
            const tinted = card.label === 'Open orders' && openCount > 0;
            const tint = tinted
              ? 'bg-[color-mix(in_oklab,var(--p-accent-soft)_62%,var(--p-card))]'
              : 'bg-[var(--p-card)]';
            return (
              <div
                key={card.label}
                className={`flex flex-1 flex-col justify-center rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] px-5 py-4 shadow-[var(--p-shadow-1)] sm:px-6 ${tint}`}
              >
                <p className="text-[11.5px] font-medium text-gink-64">{card.label}</p>
                <span className="mt-1 text-[clamp(1.55rem,2.3vw,1.9rem)] leading-none font-semibold tracking-[-0.03em] text-gink tabular-nums">
                  {card.value}
                </span>
                <span className="mt-1.5 text-[11.5px] leading-[1.4] text-gink-64">
                  {card.meta}
                </span>
              </div>
            );
          })}
        </aside>
      </section>

      {/* ------------------------------------------------------------- ranked
          A leaderboard strip, not a list inside a panel. One card per dish, in
          order, each with the same bar scaled against the best seller -- the
          comparison the heading promises, and it is drawn from the figure
          printed beside it, so the bar and the number cannot disagree. */}
      {live && data && !blocked ? (
        <section aria-label="Active table sessions" className="mt-6">
          <SectionHead
            title="Active tables"
            meta={`${data.activeSessions.length} open session${data.activeSessions.length === 1 ? '' : 's'}`}
          />
          {data.activeSessions.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.activeSessions.map((session) => {
                const unpaid = session.outstandingPaise > 0;
                return (
                  <li
                    key={session.id}
                    className="rounded-[var(--p-r-card)] border border-hair bg-card p-4 shadow-[var(--p-shadow-1)]"
                    data-active-session={session.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-gink">
                          {session.table}
                        </h3>
                        <p className="mt-1 text-[11.5px] text-gink-46">
                          {session.orderCount} ticket{session.orderCount === 1 ? '' : 's'}
                          {session.orderCodes.length ? ` · ${session.orderCodes.join(', ')}` : ''}
                        </p>
                        <p className="mt-1 break-all text-[10px] text-gink-46">
                          Session {session.id} · opened {clockTimeInZone(timezone, session.openedAt)}
                        </p>
                      </div>
                      <Tag tone={unpaid ? 'due' : 'live'}>{unpaid ? 'Unpaid' : 'Paid'}</Tag>
                    </div>

                    {session.items.length ? (
                      <ul aria-label={`Items in session ${session.id}`} className="mt-3 space-y-1 border-t border-hair pt-3">
                        {session.items.map((item, index) => (
                          <li key={`${item.ticketCode}-${index}`} className="flex items-start justify-between gap-3 text-[11.5px]">
                            <span className="min-w-0 break-words text-gink">
                              <strong className="font-semibold">{item.quantity} × {item.name}</strong>
                              {item.variant || item.addons.length ? (
                                <span className="block text-[10px] text-gink-46">
                                  {[item.variant, ...item.addons].filter(Boolean).join(' · ')}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-[10px] text-gink-46">{item.ticketCode}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-3 flex items-end justify-between gap-3 border-t border-hair pt-3">
                      <div>
                        <p className="text-[10.5px] text-gink-46">Session total</p>
                        <p data-session-total className="mt-0.5 text-[18px] font-semibold tracking-[-0.025em] text-gink tabular-nums">
                          <Money value={session.totalPaise} />
                        </p>
                        <p className="mt-1 text-[10.5px] text-gink-46">
                          Paid <Money value={session.paidPaise} /> · Outstanding <Money value={session.outstandingPaise} />
                        </p>
                        {!unpaid && session.paidAt ? (
                          <p className="mt-1 text-[10.5px] text-gink-46">
                            Paid {clockTimeInZone(timezone, session.paidAt)}
                          </p>
                        ) : null}
                      </div>
                      {data.canMarkPaid ? (
                        <div className="flex flex-col items-end gap-2">
                          {unpaid ? <MarkSessionPaidButton sessionId={session.id} table={session.table} /> : null}
                          <CloseSessionButton
                            sessionId={session.id}
                            table={session.table}
                            outstandingPaise={session.outstandingPaise}
                            gstMode={data.gstMode}
                            printers={data.printers}
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>No open table sessions. New table orders will appear here.</Empty>
          )}
        </section>
      ) : null}

      {/* ------------------------------------------------------- the two reads
          The ranked list and the order-health read sit side by side on a
          laptop: both are "what sold / what is stuck", both are lists, and
          neither needs the full width to be read. On a phone they stack in the
          same order. */}
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
        <Panel
          title="Top items"
          meta={live ? 'Today · by quantity' : 'Sample · fictional'}
          bodyClassName=""
        >
          {itemRows.length > 0 ? (
            <ol data-top-items className="m-0 list-none p-0">
              {itemRows.map((t, i) => (
                <li
                  key={t.name}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-[var(--p-line-soft)] px-5 py-3.5 last:border-b-0"
                >
                  <span className="tnum w-6 text-[11.5px] font-semibold tracking-[0.08em] text-[var(--p-accent-strong)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-gink" title={t.name}>
                      {t.name}
                    </p>
                    <div
                      aria-hidden="true"
                      className="mt-2 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--p-ink)_7%,transparent)]"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--p-accent)]"
                        style={{ width: `${Math.max(6, Math.round((t.qty / topQty) * 100))}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-semibold text-gink tabular-nums">
                      <Money value={t.revenuePaise} />
                    </p>
                    <p className="tnum mt-0.5 text-[11.5px] text-gink-46">{t.qty} sold</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="px-5 py-4">
              <Empty>
                Nothing sold yet today. Items rank here once the first order of the day is placed.
              </Empty>
            </div>
          )}
        </Panel>

        {live && !blocked && data?.orderHealth ? (
          <Panel
            data-order-health-panel
            title="Order reliability & delays"
            meta={
              data.orderHealth.flaggedCount > 0
                ? `${data.orderHealth.flaggedCount} need attention · ${data.orderHealth.delayedCount} delayed`
                : 'All open orders on track'
            }
            action={
              <BtnLink href="/dashboard/orders?status=delayed" tone="ghost" size="sm">
                View alerts
              </BtnLink>
            }
          >
            {data.orderHealth.flaggedOrders.length > 0 ? (
              <ul className="m-0 flex list-none flex-col divide-y divide-hair p-0">
                {data.orderHealth.flaggedOrders.slice(0, 6).map((item) => (
                  <li
                    key={item.orderId}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/bill/${item.orderId}`}
                        className="text-[13px] font-semibold text-gink underline decoration-hair-strong underline-offset-2"
                      >
                        {item.code}
                      </Link>
                      <span className="text-[12.5px] text-gink-64">{item.tableLabel}</span>
                      <Tag tone="due">{item.summary ?? 'Needs attention'}</Tag>
                    </div>
                    <Link
                      href={`/bill/${item.orderId}`}
                      className="text-[12.5px] font-medium text-gink-64 underline decoration-hair-strong underline-offset-2 hover:text-gink"
                    >
                      Inspect trace →
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[12.5px] text-gink-64">
                No stalled tickets, unconfirmed tables, or failed kitchen alerts today.
              </p>
            )}
          </Panel>
        ) : null}
      </div>

      <div className="mt-5">
        <Panel
          /* "Orders today" is the label on the first-row card; this is the
             five most recent, so it says that. */
          title={live ? 'Latest orders' : 'Recent orders'}
          meta={
            live && stats
              ? `${stats.openOrders} open · ${stats.ordersToday} today`
              : '5 open · 2 awaiting counter payment'
          }
          bodyClassName=""
          action={
            /* A ghost action, not an underlined word. On a panel header the
               underlined link read as a footnote to the table rather than as
               the way to the ledger. */
            <BtnLink href="/dashboard/orders" tone="ghost" size="sm">
              All orders
            </BtnLink>
          }
        >
          {live ? (
            orders.length > 0 ? (
              <OrderTable
                rows={orders.map((o) => ({
                  key: o.id,
                  code: o.code,
                  table: o.table,
                  placed: clockTimeInZone(timezone, o.placedAt),
                  payment: paymentState(o.paymentStatus),
                  prep: prepState(o.prepStatus),
                  totalPaise: o.totalPaise,
                }))}
              />
            ) : (
              <div className="px-4 py-4 sm:px-5">
                <Empty>
                  No orders yet today. Orders placed from the customer menu appear here as soon as
                  they are sent to the kitchen.
                </Empty>
              </div>
            )
          ) : (
            <OrderTable
              rows={recentOrders.map((o) => ({
                key: o.id,
                code: o.id,
                table: o.table,
                placed: o.at,
                payment: paymentState(o.payment),
                prep: prepState(o.state.toLowerCase()),
                totalPaise: rupeesToPaise(o.total),
              }))}
            />
          )}
        </Panel>
      </div>

      {/*
        A closing line used to repeat the open-order count for the third time on
        one screen -- once in the stat card, once in this panel's meta -- and
        then explain the restaurant clock to somebody who had already read
        "today, restaurant time" under the title. Both facts are still stated;
        neither is stated twice.
      */}
      </OpsSurface>
    </OwnerPage>
  );
}

/** One table shape for both sources, so the two branches cannot drift apart. */
function OrderTable({
  rows,
}: {
  rows: Array<{
    key: string;
    code: string;
    table: string;
    placed: string;
    payment: 'paid' | 'pending' | 'failed';
    prep: 'new' | 'preparing' | 'ready' | 'served';
    totalPaise: number;
  }>;
}) {
  return (
    <TableWrap>
      <table className={tableClass}>
        <thead>
          <tr>
            <Th>Order</Th>
            {/* On a phone the table number moves under the order code (see
                the body cell) and the placed time is dropped, so status and
                total fit without a sideways scroll. Both return from `sm`. */}
            <Th className="hidden sm:table-cell">Table</Th>
            <Th className="hidden sm:table-cell">Placed</Th>
            <Th className="max-sm:px-2.5">Payment</Th>
            <Th className="max-sm:px-2.5">Status</Th>
            <Th align="right" className="max-sm:px-2.5">
              Total
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <Tr key={o.key}>
              <Td className="tnum max-sm:px-2.5 font-medium whitespace-nowrap">
                {o.code}
                <span className="mt-0.5 block text-[11.5px] font-normal text-gink-46 sm:hidden">
                  {o.table}
                </span>
              </Td>
              <Td className="hidden sm:table-cell">{o.table}</Td>
              <Td className="tnum hidden text-gink-64 sm:table-cell">{o.placed}</Td>
              <Td className="max-sm:px-2.5">
                <PaymentPill state={o.payment} />
              </Td>
              <Td className="max-sm:px-2.5">
                <PrepPill state={o.prep} />
              </Td>
              <Td align="right" className="max-sm:px-2.5">
                <Money value={o.totalPaise} strong />
              </Td>
            </Tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
