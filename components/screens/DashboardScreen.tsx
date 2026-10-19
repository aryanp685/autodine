import Link from 'next/link';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems, trial } from '@/lib/demo-data';
import { Avatar, Money, Pill, PrepPill, Sparkline } from '@/components/ui';

const NAV_A = ['Overview', 'Menus', 'Tables & QR', 'Orders', 'Reports', 'Payments', 'Staff', 'Settings'];
/** Only these rail items have a built screen so far; the rest stay inert
 *  rather than linking somewhere that does not exist yet. */
const NAV_LINKS: Record<string, string> = {
  Overview: '/dashboard',
  Menus: '/dashboard/menus',
  'Tables & QR': '/dashboard/tables',
};

/* ============================================================================
   Editorial Minimal — locked design system dashboard
   Slim left rail, big numerals, hairlines, lots of air.
   ========================================================================== */
export function Dashboard() {
  return (
    <div className="dash">
      <aside className="dash__rail">
        <Link href="/" className="dash__brand">AutoDine</Link>
        <div className="dash__venue">
          <div className="dash__venueName">{restaurant.name}</div>
          <div className="dash__venueMeta">{restaurant.tagline}</div>
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
          <div className="dash__trialLine">Trial · {trial.remaining} days left</div>
          <div className="dash__trialBar">
            <i style={{ width: '40%' }} />
          </div>
        </div>
      </aside>

      <main className="dash__main">
        <header className="dash__head">
          <div>
            <div className="dash__kicker">Wednesday, 18 Oct · Dinner service</div>
            <h1 className="dash__h1">Good evening, Aryan</h1>
          </div>
          <div className="dash__headRight">
            <span className="dash__ghostBtn">Publish menu</span>
            <span className="dash__solidBtn">Open kitchen board</span>
            <Avatar initials="AP" />
          </div>
        </header>

        <div className="dash__trialStrip">
          <span className="dash__trialDot" />
          <strong>Free trial · {trial.remaining} days left</strong>
          <span className="dash__trialText">
            Started {trial.started} · ends {trial.expires}. All features are open. Choose a plan before it
            ends to keep taking orders.
          </span>
          <span className="dash__trialLink">View plans</span>
        </div>

        <section className="dash__stats">
          {dashboardStats.map((s) => (
            <div key={s.label} className="dash__stat">
              <div className="dash__statLabel">{s.label}</div>
              <div className="dash__statValue">{s.value}</div>
              <div className={`dash__statDelta is-${s.trend}`}>{s.delta}</div>
            </div>
          ))}
        </section>

        <section className="dash__split">
          <div className="dash__block">
            <div className="dash__blockHead">
              <h2>Revenue today</h2>
              <span className="dash__blockMeta">Peak 8:30–9:30 PM</span>
            </div>
            <div className="dash__chart">
              <Sparkline data={sparkline} width={520} height={120} />
            </div>
          </div>
          <div className="dash__block">
            <div className="dash__blockHead">
              <h2>Top items</h2>
              <span className="dash__blockMeta">Last 7 days</span>
            </div>
            <ul className="dash__rank">
              {topItems.map((t, i) => (
                <li key={t.name}>
                  <span className="dash__rankNum">{String(i + 1).padStart(2, '0')}</span>
                  <span className="dash__rankName">{t.name}</span>
                  <span className="dash__rankSold">{t.sold} sold</span>
                  <Money value={t.revenue} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="dash__block">
          <div className="dash__blockHead">
            <h2>Live orders</h2>
            <span className="dash__blockMeta">5 open · 2 awaiting counter payment</span>
          </div>
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
                  <td>{o.payment === 'Counter due' ? <Pill tone="alert">Counter due</Pill> : <Pill tone="sage">Paid online</Pill>}</td>
                  <td>{o.state === 'New' ? <PrepPill state="new" /> : o.state === 'Preparing' ? <PrepPill state="preparing" /> : o.state === 'Ready' ? <PrepPill state="ready" /> : <PrepPill state="served" />}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Money value={o.total} strong />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

