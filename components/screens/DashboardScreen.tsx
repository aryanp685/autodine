import { rupeesToPaise } from '@/lib/money';
import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems } from '@/lib/demo-data';
import { Money, PaymentPill, PrepPill, Sparkline } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  BtnLink,
  Empty,
  OwnerPage,
  PageHead,
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
import { clockTimeInZone } from '@/lib/db/time';

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

  // One shape for both sources: the demo rows call the quantity 'sold' and the
  // live ones 'qty'. Normalising here keeps the union out of the markup.
  const itemRows: Array<{ name: string; qty: number; revenuePaise: number }> =
    live && data
      ? data.topItems
      // Demo rows hold rupees; the live ones hold paise. Money takes paise,
      // so the demo branch converts at the boundary rather than teaching the
      // component two units.
      : topItems.map((t) => ({ name: t.name, qty: t.sold, revenuePaise: rupeesToPaise(t.revenue) }));

  // The Sparkline divides by (length - 1); a single bucket at ten past
  // midnight would hand it a zero step and draw nothing. Two points minimum.
  const chartable = live && data ? data.hourlyPaise.length >= 2 : true;
  const chartHasValue = live && data ? data.hourlyPaise.some((v) => v > 0) : true;

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
            <BtnLink href="/kitchen" tone="solid">
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
        <div
          data-plan-line
          className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-hair bg-card px-4 py-3.5"
        >
          <Tag tone={data.access.readOnly ? 'due' : 'live'}>{accessSummary(data.access)}</Tag>
          <span className="text-[12.5px] leading-[1.5] text-gink-64">
            {planSentence(data.access)}
          </span>
          <Link
            href="/pricing"
            className="ml-auto text-[12.5px] font-semibold text-gink underline decoration-hair-strong underline-offset-[3px] hover:decoration-gink"
          >
            Plans
          </Link>
        </div>
      ) : null}

      {!blocked && !live && (
        <div
          role="note"
          className="mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[12px] border border-[var(--p-accent)]/20 bg-accent-soft px-3.5 py-2.5"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--p-accent)]" />
          <strong className="text-[12.5px] font-semibold text-gink">Preview mode</strong>
          <span className="text-[12.5px] text-gink-64">
            Metrics and orders are fictional. Live ordering and payment processing are disabled.
          </span>
          <Link
            href="/menu"
            className="ml-auto text-[12.5px] font-medium text-[var(--p-accent)] underline underline-offset-2"
          >
            Open the menu
          </Link>
        </div>
      )}

      {/*
        A live workspace with nothing in it yet. The four cards below all read
        zero, and two empty panels explain themselves -- but an owner opening
        this for the first time needs the next step, not four zeros. This strip
        is only the truthful next action: it does not invent an order, and it
        disappears the moment the first one lands.
      */}
      {!blocked && live && stats && stats.ordersToday === 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-hair bg-card px-4 py-3.5">
          <Tag tone="neutral">No orders yet</Tag>
          <span className="text-[12.5px] leading-[1.5] text-gink-64">
            Scan a table&rsquo;s QR and place one yourself &mdash; it reaches the kitchen board in
            seconds, and today&rsquo;s figures start filling in from there.
          </span>
          <Link
            href="/dashboard/tables"
            className="ml-auto text-[12.5px] font-semibold text-gink underline decoration-hair-strong underline-offset-[3px] hover:decoration-gink"
          >
            Tables &amp; QR
          </Link>
        </div>
      ) : null}

      {/* Four figures, each with the sentence that says what it counts. On a
          phone they are two by two, not one long column: a KPI you have to
          scroll past is not a KPI. */}
      {/* Four figures, each with the sentence that says what it counts. On a
          phone they are two by two, not one long column: a KPI you have to
          scroll past is not a KPI.

          These were hand-rolled copies of `Stat`, which is the kit's whole
          point -- one figure size, one label size, one note size, one border.
          The only difference the copy had was a slightly smaller numeral. */}
      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {cards.map((card) => (
          <Stat
            key={card.label}
            label={card.label}
            value={card.value}
            meta={card.meta}
            /* Green means "somebody is working right now", so it belongs on
               open orders and only when there are some. A permanently tinted
               card is decoration. */
            tone={card.label === 'Open orders' && openCount > 0 ? 'live' : 'plain'}
          />
        ))}
      </section>

      <div className="mt-5 grid gap-2.5 lg:grid-cols-[1.15fr_0.85fr]">
        {/* The chart is deliberately quiet: one line, no gridlines, no axis
            labels. The number above it is the reading; this is the shape. */}
        <Panel
          title="Revenue today"
          meta={live ? 'By hour, restaurant time' : 'Peak 8:30–9:30 PM'}
          action={<Tag tone="neutral">{live ? 'Live' : 'Sample'}</Tag>}
        >
          {chartable && chartHasValue ? (
            <div className="text-gink" data-chart>
              <Sparkline data={live && data ? data.hourlyPaise : sparkline} width={520} height={120} />
            </div>
          ) : (
            <Empty>
              {chartable
                ? 'No settled payments yet today. The chart fills in as orders are paid for.'
                : 'Today has only just started. The chart needs an hour of trading before it can show a shape.'}
            </Empty>
          )}
        </Panel>

        <Panel title="Top items" meta="Today, by quantity sold">
          {itemRows.length > 0 ? (
            <ul className="flex flex-col">
              {itemRows.map((t, i) => (
                <li
                  key={t.name}
                  className="flex items-baseline gap-3 border-b border-hair py-2.5 last:border-b-0 first:pt-0 last:pb-0"
                >
                  <span className="tnum w-5 shrink-0 text-[11.5px] font-semibold text-gink-46">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-gink">{t.name}</span>
                  <span className="tnum shrink-0 text-[11.5px] text-gink-46">{t.qty} sold</span>
                  <span className="w-20 shrink-0 text-right text-[13px] font-medium text-gink">
                    <Money value={t.revenuePaise} />
                  </span>
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
          title={live ? 'Orders today' : 'Live orders'}
          meta={
            live && stats
              ? `${stats.openOrders} open · ${stats.ordersToday} today`
              : '5 open · 2 awaiting counter payment'
          }
          bodyClassName=""
          action={
            <Link
              href="/dashboard/orders"
              className="text-[12.5px] font-medium text-gink-64 underline underline-offset-2 hover:text-gink"
            >
              All orders
            </Link>
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

      <p className="mt-4 text-[11.5px] text-gink-46">
        {live
          ? `${openCount} open now · figures are read from the restaurant’s clock, never the server’s.`
          : `${openCount} open now in the sample · figures below are fictional.`}
      </p>
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
