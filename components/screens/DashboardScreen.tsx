import { dashboardStats, recentOrders, restaurant, sparkline, topItems, trial, inr } from '@/lib/demo-data';
import { Avatar, Money, PaymentPill, Pill, PrepPill, Sparkline } from '@/components/ui';

const NAV_A = ['Overview', 'Menus', 'Tables & QR', 'Orders', 'Reports', 'Payments', 'Staff', 'Settings'];
const NAV_B = [
  ['Overview', '◧'],
  ['Menus', '☰'],
  ['Tables & QR', '▣'],
  ['Live orders', '◷'],
  ['Kitchen', '◍'],
  ['Payments', '₹'],
  ['Reports', '▲'],
  ['Staff', '◍'],
  ['Settings', '⚙'],
] as const;

/* ============================================================================
   Option A — Editorial Minimal dashboard
   Slim left rail, big numerals, hairlines, lots of air.
   ========================================================================== */
export function DashboardA() {
  return (
    <div className="a-dash">
      <aside className="a-dash__rail">
        <div className="a-dash__brand">AutoDine</div>
        <div className="a-dash__venue">
          <div className="a-dash__venueName">{restaurant.name}</div>
          <div className="a-dash__venueMeta">{restaurant.tagline}</div>
        </div>
        <nav className="a-dash__nav">
          {NAV_A.map((n) => (
            <div key={n} className={`a-dash__navItem ${n === 'Overview' ? 'is-active' : ''}`}>
              {n}
            </div>
          ))}
        </nav>
        <div className="a-dash__railFoot">
          <div className="a-dash__trialLine">Trial · {trial.remaining} days left</div>
          <div className="a-dash__trialBar">
            <i style={{ width: '40%' }} />
          </div>
        </div>
      </aside>

      <main className="a-dash__main">
        <header className="a-dash__head">
          <div>
            <div className="a-dash__kicker">Wednesday, 18 Oct · Dinner service</div>
            <h1 className="a-dash__h1">Good evening, Aryan</h1>
          </div>
          <div className="a-dash__headRight">
            <span className="a-dash__ghostBtn">Publish menu</span>
            <span className="a-dash__solidBtn">Open kitchen board</span>
            <Avatar initials="AP" />
          </div>
        </header>

        <div className="a-dash__trialStrip">
          <span className="a-dash__trialDot" />
          <strong>Free trial · {trial.remaining} days left</strong>
          <span className="a-dash__trialText">
            Started {trial.started} · ends {trial.expires}. All features are open. Choose a plan before it
            ends to keep taking orders.
          </span>
          <span className="a-dash__trialLink">View plans</span>
        </div>

        <section className="a-dash__stats">
          {dashboardStats.map((s) => (
            <div key={s.label} className="a-dash__stat">
              <div className="a-dash__statLabel">{s.label}</div>
              <div className="a-dash__statValue">{s.value}</div>
              <div className={`a-dash__statDelta is-${s.trend}`}>{s.delta}</div>
            </div>
          ))}
        </section>

        <section className="a-dash__split">
          <div className="a-dash__block">
            <div className="a-dash__blockHead">
              <h2>Revenue today</h2>
              <span className="a-dash__blockMeta">Peak 8:30–9:30 PM</span>
            </div>
            <div className="a-dash__chart">
              <Sparkline data={sparkline} width={520} height={120} />
            </div>
          </div>
          <div className="a-dash__block">
            <div className="a-dash__blockHead">
              <h2>Top items</h2>
              <span className="a-dash__blockMeta">Last 7 days</span>
            </div>
            <ul className="a-dash__rank">
              {topItems.map((t, i) => (
                <li key={t.name}>
                  <span className="a-dash__rankNum">{String(i + 1).padStart(2, '0')}</span>
                  <span className="a-dash__rankName">{t.name}</span>
                  <span className="a-dash__rankSold">{t.sold} sold</span>
                  <Money value={t.revenue} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="a-dash__block">
          <div className="a-dash__blockHead">
            <h2>Live orders</h2>
            <span className="a-dash__blockMeta">5 open · 2 awaiting counter payment</span>
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

/* ============================================================================
   Option B — Modern Operations dashboard
   Dark top bar, icon sidebar, dense tables, state-forward.
   ========================================================================== */
export function DashboardB() {
  return (
    <div className="b-dash">
      <header className="b-dash__top">
        <div className="b-dash__brand">
          <span className="b-dash__mark">AD</span> AutoDine
        </div>
        <div className="b-dash__venue">
          {restaurant.name}
          <span className="b-dash__venueSwitch">▾</span>
        </div>
        <div className="b-dash__search">Search orders, items, tables…</div>
        <div className="b-dash__topRight">
          <span className="b-dash__chip">⌘K</span>
          <span className="b-dash__statusDot" /> Live
          <Avatar initials="AP" />
        </div>
      </header>

      <div className="b-dash__body">
        <aside className="b-dash__side">
          {NAV_B.map(([label, icon]) => (
            <div key={label} className={`b-dash__sideItem ${label === 'Overview' ? 'is-active' : ''}`}>
              <span className="b-dash__sideIcon">{icon}</span>
              <span className="b-dash__sideLabel">{label}</span>
              {label === 'Live orders' && <span className="b-dash__sideCount">5</span>}
            </div>
          ))}
          <div className="b-dash__sideFoot">
            <div className="b-dash__sideTrial">
              <div className="ui-spread">
                <strong>Trial</strong>
                <span className="tnum">{trial.remaining}d</span>
              </div>
              <div className="ui-progress" style={{ marginTop: 6 }}>
                <i style={{ width: '40%', background: '#e8b84b' }} />
              </div>
            </div>
          </div>
        </aside>

        <main className="b-dash__main">
          <div className="b-dash__tabs">
            <span className="is-active">Today</span>
            <span>Last 7 days</span>
            <span>Last 30 days</span>
            <div className="b-dash__tabRight">
              <span className="b-dash__btn b-dash__btn--line">Export</span>
              <span className="b-dash__btn b-dash__btn--solid">Open kitchen board</span>
            </div>
          </div>

          <div className="b-dash__trialRow">
            <span className="b-dash__warnIcon">!</span>
            <div>
              <strong>Free trial ends {trial.expires}</strong> — {trial.remaining} days left. After that the
              account becomes read-only until a plan is active.
            </div>
            <span className="b-dash__btn b-dash__btn--amber">Choose a plan</span>
          </div>

          <section className="b-dash__tiles">
            {dashboardStats.map((s) => (
              <div key={s.label} className="b-dash__tile">
                <div className="b-dash__tileLabel">{s.label}</div>
                <div className="ui-spread">
                  <div className="b-dash__tileValue tnum">{s.value}</div>
                  <Sparkline data={sparkline} width={64} height={26} />
                </div>
                <div className={`b-dash__tileDelta is-${s.trend}`}>{s.delta}</div>
              </div>
            ))}
          </section>

          <section className="b-dash__grid">
            <div className="b-dash__card">
              <div className="b-dash__cardHead">
                <h3>Open orders</h3>
                <span className="b-dash__cardMeta">Auto-refresh 5s</span>
              </div>
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tbl</th>
                    <th>Age</th>
                    <th>Pay</th>
                    <th>State</th>
                    <th style={{ textAlign: 'right' }}>₹</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr key={o.id} className={o.payment === 'Counter due' ? 'is-unpaid' : undefined}>
                      <td className="tnum">
                        <strong>{o.id}</strong>
                      </td>
                      <td>{o.table}</td>
                      <td className="tnum">{o.at}</td>
                      <td>{o.payment === 'Counter due' ? <Pill tone="alert">DUE</Pill> : <Pill tone="sage">PAID</Pill>}</td>
                      <td>
                        <span className={`b-dash__state b-dash__state--${o.state.toLowerCase()}`}>{o.state}</span>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        <Money value={o.total} strong />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="b-dash__card">
              <div className="b-dash__cardHead">
                <h3>Counter payments due</h3>
                <span className="b-dash__cardMeta">{inr(2964)} outstanding</span>
              </div>
              <ul className="b-dash__dueList">
                {recentOrders
                  .filter((o) => o.payment === 'Counter due')
                  .map((o) => (
                    <li key={o.id}>
                      <div>
                        <strong>{o.id}</strong> · {o.table}
                        <div className="b-dash__dueMeta">{o.state} · placed {o.at}</div>
                      </div>
                      <div className="b-dash__dueRight">
                        <Money value={o.total} strong />
                        <span className="b-dash__btn b-dash__btn--sm">Record</span>
                      </div>
                    </li>
                  ))}
              </ul>
              <div className="b-dash__cardHead" style={{ marginTop: 16 }}>
                <h3>Kitchen load</h3>
              </div>
              <div className="b-dash__load">
                {[
                  ['New', 3, 'is-new'],
                  ['Preparing', 2, 'is-prep'],
                  ['Ready', 1, 'is-ready'],
                  ['Served', 1, 'is-served'],
                ].map(([l, n, cls]) => (
                  <div key={l as string} className={`b-dash__loadRow ${cls}`}>
                    <span>{l as string}</span>
                    <div className="ui-progress">
                      <i style={{ width: `${(Number(n) / 4) * 100}%` }} />
                    </div>
                    <strong className="tnum">{n as number}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/* ============================================================================
   Option C — Warm Hospitality dashboard
   Card grid, soft shadows, calm warm hierarchy.
   ========================================================================== */
export function DashboardC() {
  return (
    <div className="c-dash">
      <header className="c-dash__top">
        <div className="c-dash__brand">
          <span className="c-dash__mark" /> AutoDine
        </div>
        <div className="c-dash__tabs">
          <span className="is-active">Home</span>
          <span>Menus</span>
          <span>Tables</span>
          <span>Orders</span>
          <span>Reports</span>
          <span>Team</span>
        </div>
        <div className="c-dash__topRight">
          <span className="c-dash__bell">🔔</span>
          <Avatar initials="AP" />
        </div>
      </header>

      <main className="c-dash__main">
        <div className="c-dash__hello">
          <div>
            <h1>Good evening, Aryan 👋</h1>
            <p>{restaurant.name} · {restaurant.tagline}</p>
          </div>
          <div className="c-dash__helloCard">
            <div className="c-dash__helloLabel">Trial</div>
            <div className="c-dash__helloValue">{trial.remaining} days left</div>
            <div className="ui-progress">
              <i style={{ width: '40%' }} />
            </div>
            <span className="c-dash__helloLink">Choose a plan →</span>
          </div>
        </div>

        <section className="c-dash__cards">
          {dashboardStats.map((s, i) => (
            <div key={s.label} className="c-dash__card">
              <div className="c-dash__cardLabel">{s.label}</div>
              <div className="c-dash__cardValue tnum">{s.value}</div>
              <div className={`c-dash__cardDelta is-${s.trend}`}>{s.delta}</div>
              {i === 0 && (
                <div className="c-dash__cardSpark">
                  <Sparkline data={sparkline} width={160} height={40} />
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="c-dash__split">
          <div className="c-dash__panel">
            <div className="c-dash__panelHead">
              <h2>Live orders</h2>
              <span>Updated just now</span>
            </div>
            {recentOrders.slice(0, 4).map((o) => (
              <div key={o.id} className="c-dash__order">
                <div className="c-dash__orderTop">
                  <div>
                    <strong>{o.id}</strong> <span className="c-dash__muted">· {o.table}</span>
                  </div>
                  <Money value={o.total} strong />
                </div>
                <div className="c-dash__orderMeta">{o.at} · 4 items</div>
                <div className="c-dash__orderFoot">
                  {o.payment === 'Counter due' ? <PaymentPill state="pending" /> : <PaymentPill state="paid" />}
                  <span className={`c-dash__state c-dash__state--${o.state.toLowerCase()}`}>{o.state}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="c-dash__panel">
            <div className="c-dash__panelHead">
              <h2>Tonight at a glance</h2>
            </div>
            <div className="c-dash__miniStats">
              <div>
                <strong>12</strong>
                <span>Tables active</span>
              </div>
              <div>
                <strong>2</strong>
                <span>Counter payments due</span>
              </div>
              <div>
                <strong>{inr(2964)}</strong>
                <span>Outstanding</span>
              </div>
              <div>
                <strong>14 min</strong>
                <span>Avg prep time</span>
              </div>
            </div>
            <div className="c-dash__panelHead" style={{ marginTop: 18 }}>
              <h2>Top sellers</h2>
            </div>
            <ul className="c-dash__rank">
              {topItems.slice(0, 4).map((t) => (
                <li key={t.name}>
                  <span>{t.name}</span>
                  <span className="c-dash__muted">{t.sold} sold</span>
                  <Money value={t.revenue} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
