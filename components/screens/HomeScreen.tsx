import { inr, plans } from '@/lib/demo-data';

/* ============================================================================
   Option A — Editorial Minimal
   Full-bleed photography, display typography, hairline rules, no shadows.
   ========================================================================== */
export function HomeA() {
  return (
    <div className="a-home">
      <nav className="a-home__nav">
        <div className="a-home__brand">AutoDine</div>
        <ul className="a-home__links">
          <li>Product</li>
          <li>Pricing</li>
          <li>Demo</li>
          <li>FAQs</li>
          <li>Contact</li>
        </ul>
        <div className="a-home__navRight">
          <span className="a-home__navLink">Sign in</span>
          <span className="a-home__navCta">Start 10-day trial</span>
        </div>
      </nav>

      <header className="a-home__hero">
        <img className="a-home__heroImg" src="/img/restaurant-interior.jpg" alt="Restaurant dining room at dusk" />
        <div className="a-home__heroShade" />
        <div className="a-home__heroBody">
          <div className="a-home__kicker">Restaurant QR ordering &amp; management</div>
          <h1 className="a-home__h1">
            Every table,
            <br />
            one quiet system.
          </h1>
          <p className="a-home__lede">
            Publish your menu, print your table QR codes, take orders, tell the kitchen, take payment and
            issue the receipt — from one dashboard.
          </p>
          <div className="a-home__ctas">
            <span className="a-home__btn a-home__btn--solid">Start 10-day trial</span>
            <span className="a-home__btn a-home__btn--line">See the demo</span>
          </div>
          <div className="a-home__note">Plans start at {inr(899)}/month · 10-day trial on every new account</div>
        </div>
      </header>

      <section className="a-home__section">
        <div className="a-home__rule" />
        <div className="a-home__three">
          {[
            ['01', 'The menu, done once', 'Build it once with categories, variants and add-ons. Import a printed menu with AI and correct it before it goes live.'],
            ['02', 'Orders that reach the kitchen', 'Each table gets its own QR. Orders land on the kitchen board and are announced out loud, with no app install for the guest.'],
            ['03', 'Payment that reconciles', 'Online payment or pay at the counter — both tracked separately from preparation, so nothing is marked paid by mistake.'],
          ].map(([n, title, body]) => (
            <article key={n} className="a-home__col">
              <div className="a-home__num">{n}</div>
              <h3 className="a-home__colTitle">{title}</h3>
              <p className="a-home__colBody">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="a-home__band">
        <div className="a-home__bandInner">
          {[
            ['11 min', 'Average order to table'],
            ['0', 'Apps your guest must install'],
            ['2', 'Payment paths: online or counter'],
          ].map(([v, l]) => (
            <div key={l} className="a-home__stat">
              <div className="a-home__statValue">{v}</div>
              <div className="a-home__statLabel">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="a-home__section">
        <h2 className="a-home__h2">Plans</h2>
        <div className="a-home__plans">
          {plans.map((p) => (
            <div key={p.id} className="a-home__plan">
              <div className="a-home__planName">{p.name}</div>
              <div className="a-home__planPrice">
                {inr(p.price)}<span>/month</span>
              </div>
              <p className="a-home__planBlurb">{p.blurb}</p>
              <ul className="a-home__planList">
                {p.features.slice(0, 5).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <span className="a-home__planLink">Choose {p.name} →</span>
            </div>
          ))}
        </div>
        <p className="a-home__fine">
          Prices are listed in INR. The exact tax treatment and invoice presentation are being confirmed
          before subscriptions go live and will be stated clearly at checkout.
        </p>
      </section>

      <footer className="a-home__foot">
        <div className="a-home__footBrand">AutoDine</div>
        <div className="a-home__footCols">
          <div>
            <div className="a-home__footTitle">Product</div>
            <p>Menus · QR codes · Ordering · Kitchen · Payments · Reports</p>
          </div>
          <div>
            <div className="a-home__footTitle">Company</div>
            <p>About · Contact · Careers</p>
          </div>
          <div>
            <div className="a-home__footTitle">Legal</div>
            <p>Privacy · Terms · Refunds &amp; cancellation</p>
          </div>
        </div>
        <div className="a-home__footFine">Prototype screen · content is sample copy</div>
      </footer>
    </div>
  );
}

/* ============================================================================
   Option B — Modern Operations
   Dark top bar, product-forward hero, dense feature grid, operational proof.
   ========================================================================== */
export function HomeB() {
  return (
    <div className="b-home">
      <nav className="b-home__nav">
        <div className="b-home__brand">
          <span className="b-home__mark">AD</span> AutoDine
        </div>
        <ul className="b-home__links">
          <li>Product</li>
          <li>Pricing</li>
          <li>Demo</li>
          <li>Docs</li>
          <li>FAQs</li>
        </ul>
        <div className="b-home__navRight">
          <span className="b-home__navLink">Sign in</span>
          <span className="b-home__navCta">Start 10-day trial</span>
        </div>
      </nav>

      <header className="b-home__hero">
        <div className="b-home__heroCopy">
          <div className="b-home__eyebrow">BUILT FOR SERVICE, NOT FOR DEMOS</div>
          <h1 className="b-home__h1">Run every table, order and payment from one board.</h1>
          <p className="b-home__lede">
            QR ordering, a kitchen board that announces itself, counter payments with an audit trail, and
            server-enforced subscription rules — in one application.
          </p>
          <div className="b-home__ctas">
            <span className="b-home__btn b-home__btn--solid">Start 10-day trial</span>
            <span className="b-home__btn b-home__btn--line">Watch a 2-minute tour</span>
          </div>
          <div className="b-home__trust">
            <span>UPI, cards &amp; counter</span>
            <span>·</span>
            <span>No hardware to buy</span>
            <span>·</span>
            <span>Plans from {inr(899)}/month</span>
          </div>
        </div>

        <div className="b-home__panel">
          <div className="b-home__panelBar">
            <span className="b-home__panelDot" /> Kitchen · Saffron &amp; Smoke
            <span className="b-home__panelLive">LIVE</span>
          </div>
          <div className="b-home__panelCols">
            {[
              { t: 'NEW · 3', tone: 'new' },
              { t: 'PREPARING · 2', tone: 'prep' },
              { t: 'READY · 1', tone: 'ready' },
            ].map((col, i) => (
              <div key={col.t} className="b-home__panelCol">
                <div className={`b-home__panelHead b-home__panelHead--${col.tone}`}>{col.t}</div>
                {[0, 1].slice(0, i === 2 ? 1 : 2).map((k) => (
                  <div key={k} className="b-home__card">
                    <div className="b-home__cardTop">
                      <strong>A-{1042 - i * 3 - k}</strong>
                      <span className="b-home__cardTime">{4 + i * 7 + k * 3} min</span>
                    </div>
                    <div className="b-home__cardLine">1 × Butter Chicken · Hot</div>
                    <div className="b-home__cardLine">2 × Butter Naan</div>
                    <div className="b-home__cardFoot">
                      <span className="b-home__pill">{i === 1 && k === 0 ? 'T3 · COUNTER DUE' : 'T7 · PAID'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="b-home__features">
        {[
          ['Menu & AI import', 'Categories, variants, modifier groups. Scan a printed menu, review every line, then publish.'],
          ['Table QR codes', 'Per-table codes with revoke, regenerate and disable. Rotating on-site validation, checked server-side.'],
          ['Kitchen board', 'New / preparing / ready / served, with unpaid orders flagged and one-tap status changes.'],
          ['Voice announcements', 'New orders are spoken out loud. Replay anything. A failed announcement never loses an order.'],
          ['Payments & receipts', 'Online and counter paths kept separate from preparation status. Receipts print or save to PDF.'],
          ['Trial & plans', 'Ten days, all features. After that, server-side rules apply — no silent surprises.'],
        ].map(([t, d]) => (
          <div key={t} className="b-home__feature">
            <div className="b-home__featureIcon" />
            <div>
              <div className="b-home__featureTitle">{t}</div>
              <p className="b-home__featureBody">{d}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="b-home__plans">
        <div className="b-home__plansHead">
          <h2 className="b-home__h2">Simple monthly plans in INR</h2>
          <p>Every account starts with a 10-day trial. No feature is switched off during the trial.</p>
        </div>
        <table className="b-home__planTable">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Price / month</th>
              <th>Best for</th>
              <th>Includes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={p.highlight ? 'is-featured' : undefined}>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td className="tnum">{inr(p.price)}</td>
                <td>{p.blurb}</td>
                <td className="b-home__planIncludes">{p.features.slice(0, 3).join(' · ')}</td>
                <td>
                  <span className="b-home__btn b-home__btn--sm">Choose</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="b-home__foot">
        <span>AutoDine — prototype screen</span>
        <span>Product · Pricing · Docs · Privacy · Terms · Refunds</span>
      </footer>
    </div>
  );
}

/* ============================================================================
   Option C — Warm Hospitality
   Rounded surfaces, soft shadows, Sand-forward, friendly voice.
   ========================================================================== */
export function HomeC() {
  return (
    <div className="c-home">
      <nav className="c-home__nav">
        <div className="c-home__brand">
          <span className="c-home__mark" /> AutoDine
        </div>
        <ul className="c-home__links">
          <li>Product</li>
          <li>Pricing</li>
          <li>Demo</li>
          <li>FAQs</li>
        </ul>
        <span className="c-home__navCta">Start 10-day trial</span>
      </nav>

      <header className="c-home__hero">
        <div className="c-home__heroCopy">
          <div className="c-home__badge">Made for restaurants in India 🇮🇳</div>
          <h1 className="c-home__h1">
            Let guests order
            <br />
            the moment they sit down.
          </h1>
          <p className="c-home__lede">
            A warm, simple menu on their phone. A kitchen that hears every order. A counter that knows
            exactly what is paid. All from one friendly dashboard.
          </p>
          <div className="c-home__ctas">
            <span className="c-home__btn c-home__btn--solid">Start my 10-day trial</span>
            <span className="c-home__btn c-home__btn--soft">Try the live demo</span>
          </div>
          <div className="c-home__note">No card needed to start the trial · Plans from {inr(899)}/month</div>
        </div>
        <div className="c-home__heroArt">
          <img src="/img/restaurant-interior.jpg" alt="Warm restaurant interior" />
          <div className="c-home__floatCard">
            <div className="c-home__floatTop">Table 7 just ordered</div>
            <div className="c-home__floatRow">
              <span>Butter Chicken · Regular</span>
              <strong>{inr(469)}</strong>
            </div>
            <div className="c-home__floatRow">
              <span>Butter Naan × 2</span>
              <strong>{inr(158)}</strong>
            </div>
            <div className="c-home__floatFoot">Paid online · sent to kitchen</div>
          </div>
        </div>
      </header>

      <section className="c-home__cards">
        {[
          ['Your menu, beautifully', 'Photos, descriptions, variants and add-ons — presented the way your food deserves.'],
          ['QR on every table', 'Print a card per table. Revoke or regenerate a code whenever you need to.'],
          ['A kitchen that keeps up', 'Orders appear and are announced out loud. Replay anything you missed.'],
          ['Payment, sorted', 'Online or at the counter. Receipts that print cleanly and match the order.'],
        ].map(([t, d]) => (
          <article key={t} className="c-home__card">
            <div className="c-home__cardIcon" />
            <h3>{t}</h3>
            <p>{d}</p>
          </article>
        ))}
      </section>

      <section className="c-home__quote">
        <p>
          “We put the QR cards out on a Friday. By Sunday the kitchen was running entirely off the board, and
          the counter stopped asking me what was paid.”
        </p>
        <div className="c-home__quoteBy">Sample testimonial — placeholder copy for layout review</div>
      </section>

      <section className="c-home__plans">
        <h2 className="c-home__h2">Plans that grow with your service</h2>
        <div className="c-home__planGrid">
          {plans.map((p) => (
            <div key={p.id} className={`c-home__plan ${p.highlight ? 'is-featured' : ''}`}>
              {p.highlight && <div className="c-home__planFlag">Most chosen</div>}
              <div className="c-home__planName">{p.name}</div>
              <div className="c-home__planPrice">
                {inr(p.price)}<span>/month</span>
              </div>
              <p className="c-home__planBlurb">{p.blurb}</p>
              <ul>
                {p.features.slice(0, 6).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <span className="c-home__btn c-home__btn--solid">Choose {p.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="c-home__cta">
        <h2>Ready to see it on your own menu?</h2>
        <p>Start a 10-day trial. Bring your printed menu — the AI scanner will do the first pass.</p>
        <span className="c-home__btn c-home__btn--solid">Start 10-day trial</span>
      </section>

      <footer className="c-home__foot">
        <div>AutoDine · prototype screen</div>
        <div>Privacy · Terms · Refunds &amp; cancellation · Contact</div>
      </footer>
    </div>
  );
}
