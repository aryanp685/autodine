import { rupeesToPaise } from '@/lib/money';
import { OutletSwitcher } from '@/components/OutletSwitcher';
import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems } from '@/lib/demo-data';
import { Avatar, Money, PaymentPill, PrepPill, Sparkline } from '@/components/ui';
import { signOutAction } from '@/app/auth/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import type { DashboardScreenData } from '@/lib/db/dashboard-screen';
import { clockTimeInZone } from '@/lib/db/time';

/**
 * Only destinations that actually exist are listed. "Orders" and "Reports"
 * used to be rendered as bare text here and on the other two screens, which
 * read as working navigation and did nothing when clicked.
 */
const NAV_LINKS: Record<string, string> = {
  Overview: '/dashboard',
  Menus: '/dashboard/menus',
  'Tables & QR': '/dashboard/tables',
  Orders: '/dashboard/orders',
  Reports: '/dashboard/reports',
};
const NAV_A = Object.keys(NAV_LINKS);

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

/** Up to two initials from the venue name. '—' rather than a made-up pair. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '—';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
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

  return (
    <div className="dash">
      <aside className="dash__rail">
        <Link href="/" className="dash__brand">
          AutoDine
        </Link>
        <div className="dash__venue">
          <div className="dash__venueName">{venueName}</div>
          <div className="dash__venueMeta">{venueMeta}</div>
        </div>
        <nav className="dash__nav">
          {NAV_A.map((n) => {
            const href = NAV_LINKS[n];
            return (
              <div key={n} className={`dash__navItem ${n === 'Overview' ? 'is-active' : ''}`}>
                {href ? <Link href={href}>{n}</Link> : n}
              </div>
            );
          })}
        </nav>
        <div className="dash__railFoot">
          <div className="dash__trialLine">
            {live ? 'Live workspace · your data' : 'Demo workspace · sample data'}
          </div>
        </div>
      </aside>

      <main className="dash__main">
        <header className="dash__head">
          <div>
            <div className="dash__kicker">
              {live ? 'Live dashboard · today' : 'Sample dashboard · fictional restaurant data'}
            </div>
            <h1 className="dash__h1">Restaurant overview</h1>
          </div>
          <div className="dash__headRight">
            {/* In the header, not the rail: the rail's venue block is hidden on
                phones, and switching outlets is exactly what an owner walking
                between two branches reaches for. */}
            {outlet && outlet.outlets.length > 0 && (
              <OutletSwitcher outlets={outlet.outlets} activeId={outlet.activeId} next="/dashboard" />
            )}
            <Link href="/dashboard/menus" className="dash__ghostBtn">
              Menu preview
            </Link>
            <Link href="/kitchen" className="dash__solidBtn">
              Kitchen preview
            </Link>
            {!blocked && (
              <form action={signOutAction}>
                <button type="submit" className="dash__ghostBtn">
                  Sign out
                </button>
              </form>
            )}
            <Avatar initials={live ? initialsOf(venueName) : 'AP'} />
          </div>
        </header>

        {blocked && <SignInPrompt reason={blocked} screen="dashboard" />}

        {!blocked && !live && (
          <div className="dash__trialStrip" role="note">
            <span className="dash__trialDot" />
            <strong>Preview mode</strong>
            <span className="dash__trialText">
              Metrics and orders are fictional. Live ordering and payment processing are disabled.
            </span>
            <Link href="/menu" className="dash__trialLink">
              Open menu demo
            </Link>
          </div>
        )}

        <section className="dash__stats">
          {cards.map((card) => (
            <div key={card.label} className="dash__stat">
              <div className="dash__statLabel">{card.label}</div>
              <div className="dash__statValue">{card.value}</div>
              <div className="dash__statDelta">{card.meta}</div>
            </div>
          ))}
        </section>

        <section className="dash__split">
          <div className="dash__block">
            <div className="dash__blockHead">
              <h2>Revenue today</h2>
              <span className="dash__blockMeta">
                {live ? 'By hour, restaurant time' : 'Peak 8:30–9:30 PM'}
              </span>
            </div>
            {chartable && chartHasValue ? (
              <div className="dash__chart">
                <Sparkline
                  data={live && data ? data.hourlyPaise : sparkline}
                  width={520}
                  height={120}
                />
              </div>
            ) : (
              <div className="kb__empty">
                {chartable
                  ? 'No settled payments yet today. The chart fills in as orders are paid for.'
                  : 'Today has only just started. The chart needs an hour of trading before it can show a shape.'}
              </div>
            )}
          </div>
          <div className="dash__block">
            <div className="dash__blockHead">
              <h2>Top items</h2>
              <span className="dash__blockMeta">Today, by quantity sold</span>
            </div>
            {itemRows.length > 0 ? (
              <ul className="dash__rank">
                {itemRows.map((t, i) => (
                  <li key={t.name}>
                    <span className="dash__rankNum">{String(i + 1).padStart(2, '0')}</span>
                    <span className="dash__rankName">{t.name}</span>
                    <span className="dash__rankSold">{t.qty} sold</span>
                    <Money value={t.revenuePaise} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="kb__empty">
                Nothing sold yet today. Items rank here once the first order of the day is placed.
              </div>
            )}
          </div>
        </section>

        <section className="dash__block">
          <div className="dash__blockHead">
            <h2>{live ? 'Orders today' : 'Live orders'}</h2>
            <span className="dash__blockMeta">
              {live && stats
                ? `${stats.openOrders} open · ${stats.ordersToday} today`
                : '5 open · 2 awaiting counter payment'}
            </span>
          </div>
          {live ? (
            data && data.orders.length > 0 ? (
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Table</th>
                    <th>Placed</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id}>
                      <td className="tnum">{o.code}</td>
                      <td>{o.table}</td>
                      <td className="tnum">{clockTimeInZone(timezone, o.placedAt)}</td>
                      <td>
                        <PaymentPill state={paymentState(o.paymentStatus)} />
                      </td>
                      <td>
                        <PrepPill state={prepState(o.prepStatus)} />
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        <Money value={o.totalPaise} strong />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="kb__empty">
                No orders yet today. Orders placed from the customer menu appear here as soon as
                they are sent to the kitchen.
              </div>
            )
          ) : (
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Table</th>
                  <th>Placed</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="tnum">{o.id}</td>
                    <td>{o.table}</td>
                    <td className="tnum">{o.at}</td>
                    <td>
                      <PaymentPill state={paymentState(o.payment)} />
                    </td>
                    <td>
                      <PrepPill state={prepState(o.state.toLowerCase())} />
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      <Money value={rupeesToPaise(o.total)} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
