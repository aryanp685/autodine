import { rupeesToPaise } from '@/lib/money';
import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems } from '@/lib/demo-data';
import { Money, PaymentPill, PrepPill, Sparkline } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { ChartMotion } from '@/components/owner/ChartMotion';
import {
  BtnLink,
  Empty,
  OwnerPage,
  PageHead,
  Notice,
  Panel,
  Stat,
  Td,
  Tag,
  Th,
  TableWrap,
  Tr,
  tableClass,
} from '@/components/owner/chrome';
import type { DashboardScreenData } from '@/lib/db/dashboard-screen';
import { accessSummary, planSentence } from '@/lib/access';
import { clockTimeInZone, hourLabel, hourRangeLabel } from '@/lib/db/time';

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
          meta: stats.ordersToday > 0 ? 'Revenue ÷ orders today' : 'No orders yet today',
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
   * Revenue is what an owner opens this screen for, so it goes first and it is
   * drawn larger; the rest keep their weight and their order.
   */
  const LEAD = 'Revenue today';
  const orderedCards = [...cards].sort(
    (a, b) => Number(b.label === LEAD) - Number(a.label === LEAD)
  );

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
      <PageHead
        kicker={live ? 'Overview · today, restaurant time' : 'Sample dashboard · fictional data'}
        title={venueName || 'Restaurant overview'}
        meta={venueMeta || undefined}
        actions={
          <>
            <BtnLink href="/cashier" tone="ghost">
              Open the counter
            </BtnLink>
            <BtnLink href="/kitchen" tone="primary">
              Open the kitchen board
            </BtnLink>
          </>
        }
      />

      {blocked && <SignInPrompt reason={blocked} screen="dashboard" />}

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
            <Link
              href="/pricing"
              className="text-[12.5px] font-medium text-gink-64 underline decoration-hair-strong underline-offset-[3px] hover:text-gink hover:decoration-gink"
            >
              Plans
            </Link>
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

      {/* Four figures, each with the sentence that says what it counts. On a
          phone they are two by two, not one long column: a KPI you have to
          scroll past is not a KPI.

          These were hand-rolled copies of `Stat`, which is the kit's whole
          point -- one figure size, one label size, one note size, one border.
          The only difference the copy had was a slightly smaller numeral. */}
      <section
        aria-label="Today at a glance"
        className="grid grid-cols-2 gap-3.5 lg:grid-cols-[1.6fr_1fr_1fr_1fr]"
      >
        {orderedCards.map((card) => (
          <Stat
            key={card.label}
            label={card.label}
            value={card.value}
            meta={card.meta}
            lead={card.label === LEAD}
            /* Green means "somebody is working right now", so it belongs on
               open orders and only when there are some. A permanently tinted
               card is decoration. */
            tone={card.label === 'Open orders' && openCount > 0 ? 'live' : 'plain'}
          />
        ))}
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        {/* The chart is deliberately quiet: one line, no gridlines, no axis
            labels. The number above it is the reading; this is the shape. */}
        <Panel
          /* Not "Revenue today": the lead card above already says exactly
             that, and two headings with one name on one screen is how a page
             starts looking like it has a bug. This one is the hour-by-hour
             detail, and says so. */
          title="Revenue by hour"
          meta={live ? 'Restaurant time' : 'Sample shape · fictional'}
        >
          {chartable && chartHasValue ? (
            <div className="text-gink" data-chart>
              {/* The line draws itself once, on arrival: GSAP, lazily loaded,
                  and it can only ever ADD motion -- the server sends the chart
                  fully drawn, so a blocked bundle leaves a complete chart. */}
              <ChartMotion>
                {/* Fluid, not a fixed 520px: the old width overflowed a phone and
                    pushed the most recent hour off the edge of the card. */}
                <Sparkline
                  data={hourly}
                  width={520}
                  height={120}
                  baseline="zero"
                  area
                  label="Revenue by hour of the day"
                  className="h-[112px] w-full"
                  markIndex={hasPeak ? peakIndex : undefined}
                />
              </ChartMotion>
              {/* The axis and the reading are only for live data. The sample
                  series is a shape with no clock behind it, so labelling its
                  twelve buckets midnight-to-11am invented a trading day the
                  demo never had. */}
              {live ? (
                <>
                  {/* Two ticks and nothing between them. The chart is a shape,
                      and a grid would be a claim about precision the buckets
                      do not have -- an hour is an hour, not a measurement.
                      They are the first and last hour of trading so far, so
                      the line starts and ends on the axis it is drawn on. */}
                  <div className="mt-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-[10.5px] text-gink-46 tabular-nums">{hourLabel(0)}</span>
                    <span className="text-[10.5px] text-gink-46 tabular-nums">
                      {hourLabel(hourly.length - 1)}
                    </span>
                  </div>
                  {/* The line says the shape; this says the answer. A peak with
                      no hour and no amount is a picture of a busy evening, not
                      a fact an owner can staff against. */}
                  <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-hair pt-2.5">
                    <span className="text-[11.5px] font-medium text-gink">Busiest hour</span>
                    <span className="text-[11.5px] text-gink-46">{hourRangeLabel(peakIndex)}</span>
                    <span className="ml-auto text-[13px] font-semibold text-gink tabular-nums">
                      <Money value={hourly[peakIndex]} />
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <Empty>
              {chartable
                ? 'No settled payments yet today. The chart fills in as orders are paid for.'
                : 'Today has only just started. The chart needs an hour of trading before it can show a shape.'}
            </Empty>
          )}
        </Panel>

        <Panel title="Top items" meta={live ? 'Today · by quantity' : 'Sample · fictional'}>
          {itemRows.length > 0 ? (
            <ul className="flex flex-col" data-top-items>
              {itemRows.map((t, i) => (
                <li
                  key={t.name}
                  className="border-b border-hair py-2.5 last:border-b-0 first:pt-0 last:pb-0"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="tnum w-5 shrink-0 text-[11.5px] font-semibold text-gink-46">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-gink">{t.name}</span>
                    <span className="tnum shrink-0 text-[11.5px] text-gink-46">{t.qty} sold</span>
                    <span className="w-20 shrink-0 text-right text-[13px] font-medium text-gink">
                      <Money value={t.revenuePaise} />
                    </span>
                  </div>
                  {/* A ranking of numbers with no scale is a list. The bar is
                      each dish's quantity against the leader's, which is the
                      comparison the heading promises -- and it is drawn from
                      the same figure printed beside it, so the two cannot
                      disagree. */}
                  <div
                    aria-hidden="true"
                    className="mt-1.5 ml-8 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--p-ink)_6%,transparent)]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--p-accent)]/55"
                      style={{ width: `${Math.max(4, Math.round((t.qty / topQty) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing sold yet today. Items rank here once the first order of the day is placed.</Empty>
          )}
        </Panel>
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
            <Th>Table</Th>
            <Th>Placed</Th>
            <Th>Payment</Th>
            <Th>Status</Th>
            <Th align="right">Total</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <Tr key={o.key}>
              <Td className="tnum font-medium">{o.code}</Td>
              <Td>{o.table}</Td>
              <Td className="tnum text-gink-64">{o.placed}</Td>
              <Td>
                <PaymentPill state={o.payment} />
              </Td>
              <Td>
                <PrepPill state={o.prep} />
              </Td>
              <Td align="right">
                <Money value={o.totalPaise} strong />
              </Td>
            </Tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
