import { inr, plans } from '@/lib/demo-data';

/* ============================================================================
   Editorial Minimal — locked design system
   Full-bleed photography, display typography, hairline rules, no shadows.
   ========================================================================== */
export function Home() {
  return (
    <div className="home">
      <nav className="home__nav">
        <div className="home__brand">AutoDine</div>
        <ul className="home__links">
          <li>Product</li>
          <li>Pricing</li>
          <li>Demo</li>
          <li>FAQs</li>
          <li>Contact</li>
        </ul>
        <div className="home__navRight">
          <span className="home__navLink">Sign in</span>
          <span className="home__navCta">Start 10-day trial</span>
        </div>
      </nav>

      <header className="home__hero">
        <img className="home__heroImg" src="/img/restaurant-interior.jpg" alt="Restaurant dining room at dusk" />
        <div className="home__heroShade" />
        <div className="home__heroBody">
          <div className="home__kicker">Restaurant QR ordering &amp; management</div>
          <h1 className="home__h1">
            Every table,
            <br />
            one quiet system.
          </h1>
          <p className="home__lede">
            Publish your menu, print your table QR codes, take orders, tell the kitchen, take payment and
            issue the receipt — from one dashboard.
          </p>
          <div className="home__ctas">
            <span className="home__btn home__btn--solid">Start 10-day trial</span>
            <span className="home__btn home__btn--line">See the demo</span>
          </div>
          <div className="home__note">Plans start at {inr(899)}/month · 10-day trial on every new account</div>
        </div>
      </header>

      <section className="home__section">
        <div className="home__rule" />
        <div className="home__three">
          {[
            ['01', 'The menu, done once', 'Build it once with categories, variants and add-ons. Import a printed menu with AI and correct it before it goes live.'],
            ['02', 'Orders that reach the kitchen', 'Each table gets its own QR. Orders land on the kitchen board and are announced out loud, with no app install for the guest.'],
            ['03', 'Payment that reconciles', 'Online payment or pay at the counter — both tracked separately from preparation, so nothing is marked paid by mistake.'],
          ].map(([n, title, body]) => (
            <article key={n} className="home__col">
              <div className="home__num">{n}</div>
              <h3 className="home__colTitle">{title}</h3>
              <p className="home__colBody">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home__band">
        <div className="home__bandInner">
          {[
            ['11 min', 'Average order to table'],
            ['0', 'Apps your guest must install'],
            ['2', 'Payment paths: online or counter'],
          ].map(([v, l]) => (
            <div key={l} className="home__stat">
              <div className="home__statValue">{v}</div>
              <div className="home__statLabel">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="home__section">
        <h2 className="home__h2">Plans</h2>
        <div className="home__plans">
          {plans.map((p) => (
            <div key={p.id} className="home__plan">
              <div className="home__planName">{p.name}</div>
              <div className="home__planPrice">
                {inr(p.price)}<span>/month</span>
              </div>
              <p className="home__planBlurb">{p.blurb}</p>
              <ul className="home__planList">
                {p.features.slice(0, 5).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <span className="home__planLink">Choose {p.name} →</span>
            </div>
          ))}
        </div>
        <p className="home__fine">
          Prices are listed in INR. The exact tax treatment and invoice presentation are being confirmed
          before subscriptions go live and will be stated clearly at checkout.
        </p>
      </section>

      <footer className="home__foot">
        <div className="home__footBrand">AutoDine</div>
        <div className="home__footCols">
          <div>
            <div className="home__footTitle">Product</div>
            <p>Menus · QR codes · Ordering · Kitchen · Payments · Reports</p>
          </div>
          <div>
            <div className="home__footTitle">Company</div>
            <p>About · Contact · Careers</p>
          </div>
          <div>
            <div className="home__footTitle">Legal</div>
            <p>Privacy · Terms · Refunds &amp; cancellation</p>
          </div>
        </div>
        <div className="home__footFine">Prototype screen · content is sample copy</div>
      </footer>
    </div>
  );
}

/* ============================================================================
   Option B — Modern Operations
   Dark top bar, product-forward hero, dense feature grid, operational proof.
   ========================================================================== */

/* ============================================================================
   Option C — Warm Hospitality
   Rounded surfaces, soft shadows, Sand-forward, friendly voice.
   ========================================================================== */
