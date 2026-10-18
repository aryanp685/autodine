import Link from 'next/link';
import { directionList, screens } from '@/lib/directions';

export default function DesignHub() {
  return (
    <div className="hub">
      <header className="hub__head">
        <div className="hub__kicker">Phase 1 · Design direction review</div>
        <h1 className="hub__title">Three directions for AutoDine</h1>
        <p className="hub__lede">
          Each direction below is a complete, clickable prototype built from the same screen inventory and the
          same demo data — an Indian restaurant called <strong>Saffron &amp; Smoke</strong> in Nagpur, priced in
          INR. Open a direction, then switch screens with the menu in the black bar and flip between
          desktop, tablet and mobile widths.
        </p>
        <div className="hub__callout">
          <strong>What this is not:</strong> these are static visual prototypes. There is no backend, no
          database, no login, and no payment provider connected. Prices and totals in the customer flow are
          calculated in the browser for demonstration only — in production every total will be recomputed and
          enforced on the server.
        </div>
      </header>

      <section className="hub__grid">
        {directionList.map((d) => (
          <article key={d.id} className="hub__card">
            <div className="hub__cardTop">
              <div className="hub__code">{d.code}</div>
              <h2 className="hub__name">{d.name}</h2>
              <p className="hub__summary">{d.summary}</p>
            </div>

            <div className="hub__swatches">
              {d.palette.map((p) => (
                <div key={p.hex} className="hub__swatch" title={`${p.name} — ${p.role}`}>
                  <i style={{ background: p.hex }} />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>

            <div className="hub__meta">
              <div>
                <div className="hub__metaLabel">Type</div>
                <p>{d.typeNote}</p>
              </div>
              <div>
                <div className="hub__metaLabel">Navigation</div>
                <p>{d.navNote}</p>
              </div>
            </div>

            <ul className="hub__list hub__list--pro">
              {d.strengths.map((s) => (
                <li key={s}>
                  <span aria-hidden="true">+</span> {s}
                </li>
              ))}
            </ul>
            <ul className="hub__list hub__list--con">
              {d.weaknesses.map((s) => (
                <li key={s}>
                  <span aria-hidden="true">−</span> {s}
                </li>
              ))}
            </ul>

            <div className="hub__actions">
              <Link className="ui-btn ui-btn--primary" href={`/design/${d.id}/home`}>
                Open {d.code} →
              </Link>
              <Link className="ui-btn ui-btn--ghost" href={`/design/${d.id}/kitchen`}>
                Jump to kitchen board
              </Link>
            </div>
          </article>
        ))}
      </section>

      <section className="hub__section">
        <h2 className="hub__h2">Screen inventory in this review round</h2>
        <p className="hub__p">
          Thirteen representative screens per direction. Screens marked <em>bespoke</em> have a different
          layout built for each direction; the rest share structure and are re-skinned by each direction&apos;s
          design system, because the design question there is styling rather than layout.
        </p>
        <table className="ui-table hub__table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Screen</th>
              <th>What it shows</th>
              <th>Layout</th>
            </tr>
          </thead>
          <tbody>
            {screens.map((s) => (
              <tr key={s.slug}>
                <td>{s.group}</td>
                <td>
                  <div className="hub__screenLinks">
                    {directionList.map((d) => (
                      <Link key={d.id} href={`/design/${d.id}/${s.slug}`} className="hub__dirLink">
                        {d.id.toUpperCase()}
                      </Link>
                    ))}
                    <span>{s.title}</span>
                  </div>
                </td>
                <td className="hub__muted">{s.note}</td>
                <td>{s.bespoke ? <span className="ui-badge ui-badge--ink">Bespoke</span> : <span className="ui-badge ui-badge--outline">Shared + re-skinned</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="hub__section">
        <h2 className="hub__h2">How to review</h2>
        <ol className="hub__steps">
          <li>
            <strong>Compare like for like.</strong> Open the same screen in all three directions using the
            A / B / C switcher in the black bar. The switcher keeps you on the same screen.
          </li>
          <li>
            <strong>Check the pressure screens.</strong> The kitchen board, cashier queue and customer
            checkout are where the design has to work during a rush, not just on the marketing site.
          </li>
          <li>
            <strong>Test the states.</strong> The <em>States &amp; trial UI</em> screen shows loading, empty,
            error, success and disabled states, plus the trial countdown and the read-only expired state.
          </li>
          <li>
            <strong>Test mobile.</strong> Most customers will scan a QR and order on a phone. Use the
            Mobile toggle — the layout responds to the frame width.
          </li>
          <li>
            <strong>Mix and match.</strong> You can keep one direction&apos;s customer flow and another&apos;s
            dashboard. Tell me what to combine and I will revise before anything is locked.
          </li>
        </ol>
      </section>

      <section className="hub__section hub__section--note">
        <h2 className="hub__h2">Honest limits of this prototype</h2>
        <ul className="hub__bullets">
          <li>No backend, database, authentication, realtime layer, or payment provider is connected.</li>
          <li>Cart totals are computed in the browser for demonstration; they are not authoritative.</li>
          <li>The QR codes are decorative patterns, not scannable codes.</li>
          <li>Voice announcements are not implemented — the kitchen screen shows the audio controls and status only.</li>
          <li>Plan prices shown (₹899 / ₹1,599 / ₹2,699) are the locked values. The numeric usage limits on the pricing screen are a <strong>draft proposal</strong> awaiting your approval, and nothing is enforced yet.</li>
          <li>I verified every screen renders without errors, but I cannot see the pixels — your visual review is the real check.</li>
        </ul>
      </section>
    </div>
  );
}
