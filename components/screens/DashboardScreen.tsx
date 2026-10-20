import Link from 'next/link';
import { dashboardStats, recentOrders, restaurant, sparkline, topItems } from '@/lib/demo-data';
import { Avatar, Money, Pill, PrepPill, Sparkline } from '@/components/ui';
import { signOutAction } from '@/app/auth/actions';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

const NAV_A = ['Overview', 'Menus', 'Tables & QR', 'Settings'];
/** Only show dashboard destinations that currently have a screen. */
const NAV_LINKS: Record<string, string> = {
  Overview: '/dashboard',
  Menus: '/dashboard/menus',
  'Tables & QR': '/dashboard/tables',
  Settings: '/dashboard/settings',
};

/* ============================================================================
   Editorial Minimal — locked design system dashboard
   Slim left rail, big numerals, hairlines, lots of air.
   ========================================================================== */
export function Dashboard({
  workspace,
  workspaces,
}: {
  workspace?: AuthorizedWorkspace;
  workspaces?: AuthorizedWorkspace[];
} = {}) {
  const isLiveContext = Boolean(workspace);
  const workspaceQuery = workspace ? `?workspace=${encodeURIComponent(workspace.slug)}` : '';

  return (
    <div className="dash">
      <aside className="dash__rail">
        <Link href="/" className="dash__brand">AutoDine</Link>
        <div className="dash__venue">
          <div className="dash__venueName">{workspace?.name ?? restaurant.name}</div>
          <div className="dash__venueMeta">{workspace ? `Authorized workspace · ${workspace.role}` : restaurant.tagline}</div>
        </div>
        {workspace && workspaces && (
          <WorkspaceSwitcher workspaces={workspaces} selectedSlug={workspace.slug} pathname="/dashboard" />
        )}
        <nav className="dash__nav">
          {NAV_A.map((n) => {
            const href = NAV_LINKS[n];
            return (
              <div key={n} className={`dash__navItem ${n === 'Overview' ? 'is-active' : ''}`}>
                {href ? <Link href={`${href}${workspaceQuery}`}>{n}</Link> : n}
              </div>
            );
          })}
        </nav>
        <div className="dash__railFoot">
          <div className="dash__trialLine">{isLiveContext ? 'Workspace verified · metrics still demo' : 'Demo — not saved'}</div>
        </div>
      </aside>

      <main className="dash__main">
        <header className="dash__head">
          <div>
            <div className="dash__kicker">{isLiveContext ? 'Live workspace selected · demo metrics' : 'Demo dashboard · fictional restaurant data'}</div>
            <h1 className="dash__h1">Restaurant overview</h1>
          </div>
          <div className="dash__headRight">
            <Link href={`/dashboard/menus${workspaceQuery}`} className="dash__ghostBtn">Menu preview</Link>
            <Link href="/kitchen" className="dash__solidBtn">Kitchen preview</Link>
            {isLiveContext && (
              <form action={signOutAction}>
                <button type="submit" className="dash__ghostBtn">Sign out</button>
              </form>
            )}
            <Avatar initials={isLiveContext ? workspace!.name.slice(0, 2).toUpperCase() : 'AP'} />
          </div>
        </header>

        <div className="dash__trialStrip" role="note">
          <span className="dash__trialDot" />
          <strong>{isLiveContext ? 'Workspace verified' : 'Demo — not saved'}</strong>
          <span className="dash__trialText">
            {isLiveContext
              ? 'Workspace access is verified, but dashboard metrics and orders below are still fictional demo data.'
              : 'Metrics and orders are fictional. No data is saved and live order/payment actions are disabled.'}
          </span>
          <Link href="/menu" className="dash__trialLink">Open menu demo</Link>
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
            <h2>Sample orders · demo</h2>
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

