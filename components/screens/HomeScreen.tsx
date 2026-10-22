import Image from 'next/image';
import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';
import { SiteNav } from '@/components/SiteNav';
import { SiteMotion } from '@/components/SiteMotion';

/* ============================================================================
   Home — premium editorial.

   A full-bleed photograph, one confident line of type anchored to the bottom
   of the frame, then air. The sections below alternate between type on paper
   and a beige band so the page has a rhythm rather than a scroll of boxes.

   Everything here is a Server Component. The two client pieces are imports
   that render nothing but an effect: SiteNav owns the bar's scrolled state,
   SiteMotion owns the animation. Neither pulls the markup into the browser
   bundle as JavaScript.
   ========================================================================== */

const FEATURES = [
  {
    n: '01',
    title: 'A menu that stays current',
    body: 'Every dish, price and section is edited and published from the dashboard. Several menus can run side by side — lunch and dinner, dine-in and takeaway — without touching a single QR card.',
  },
  {
    n: '02',
    title: 'One service thread',
    body: 'A guest scans the table code, types the six digits showing in the room, and the order lands on the kitchen board immediately. The ticket is spoken out loud, and settled at the counter.',
  },
  {
    n: '03',
    title: 'Money that reconciles',
    body: 'Cash, card and UPI collected at the counter are recorded against the bill. Billed and collected are kept as two numbers, so the day’s takings are never an estimate.',
  },
];

const STEPS = [
  ['Scan', 'The QR on the table resolves to that table, in that restaurant.'],
  ['Verify', 'A six-digit code stands in for a guest account. No app, no signup.'],
  ['Order', 'The kitchen board picks the ticket up, ordered by what needs cooking next.'],
  ['Settle', 'Paid at the counter, recorded against the bill, printed or sent.'],
];

export function Home() {
  return (
    <>
      <SiteNav
        onImage
        links={[
          { label: 'Product', href: '/#product' },
          { label: 'Pricing', href: '/pricing' },
          { label: 'Menu demo', href: '/menu' },
        ]}
      />

      <main>
        {/* ------------------------------------------------------------ hero */}
        <header className="hero" data-hero>
          <div className="hero__media">
            <Image
              className="hero__img"
              src="/img/restaurant-interior.jpg"
              alt="Restaurant dining room at dusk"
              fill
              priority
              sizes="100vw"
              data-hero-image
            />
          </div>
          <div className="hero__scrim" />

          <div className="hero__body" data-hero-body>
            <div className="p-eyebrow hero__eyebrow" data-hero-step>
              Restaurant QR ordering &amp; management
            </div>

            <h1 className="hero__title">
              {['Every table,', 'one quiet', 'system.'].map((line) => (
                <span key={line} className="hero__lineMask">
                  <span className="hero__line" data-line>
                    {line}
                  </span>
                </span>
              ))}
            </h1>

            <p className="hero__lede" data-hero-step>
              A working preview of the ordering experience we are building: the menu a guest
              reads, the board a kitchen works from, and the counter that settles the bill.
            </p>

            <div className="hero__ctas" data-hero-step>
              <Link href="/menu" className="p-btn p-btn--solid">
                See the demo
              </Link>
              <Link href="/signup" className="p-btn p-btn--glass">
                Create an account
              </Link>
            </div>

            <p className="hero__note" data-hero-step>
              <i aria-hidden="true" />
              Ordering is live · online payments and subscriptions are not enabled yet
            </p>
          </div>

          <div className="hero__cue" aria-hidden="true" />
        </header>

        {/* --------------------------------------------------------- product */}
        <section className="p-sect" id="product">
          <div className="p-wrap">
            <div data-reveal>
              <div className="p-eyebrow">The product</div>
              <h2 className="p-h2" style={{ marginTop: 22, maxWidth: '18ch' }}>
                Three screens. One service.
              </h2>
              <p className="p-lede" style={{ marginTop: 20 }}>
                Most restaurant software is a dashboard with a menu attached. This is the other
                way round — the guest’s table is the centre, and everything else is plumbing.
              </p>
            </div>

            <div className="p-grid" style={{ marginTop: 'clamp(44px, 6vh, 72px)' }} data-stagger>
              {FEATURES.map((f) => (
                <article key={f.n} className="feat">
                  <hr className="p-rule feat__rule" data-draw />
                  <div className="feat__num">{f.n}</div>
                  <h3 className="p-h3 feat__title">{f.title}</h3>
                  <p className="p-body feat__body">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ flow */}
        <section className="p-band">
          <div className="p-wrap">
            <div className="p-steps" data-stagger>
              {STEPS.map(([label, body], i) => (
                <div key={label} className="step">
                  <hr className="p-rule step__rule" data-draw />
                  <p className="step__num">{String(i + 1).padStart(2, '0')}</p>
                  <p className="step__label">{label}</p>
                  <p className="step__body">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- plans */}
        <section className="p-sect">
          <div className="p-wrap">
            <div
              data-reveal
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 32,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div className="p-eyebrow">Pricing</div>
                <h2 className="p-h2" style={{ marginTop: 22, maxWidth: '16ch' }}>
                  Planned, not yet charged.
                </h2>
              </div>
              <Link href="/pricing" className="p-link" style={{ fontSize: '0.9375rem', fontWeight: 500 }}>
                See the full comparison
              </Link>
            </div>

            <div className="p-plans" style={{ marginTop: 'clamp(36px, 5vh, 56px)' }} data-stagger>
              {plans.map((p) => (
                <article key={p.id} className={`plan${p.highlight ? ' plan--featured' : ''}`}>
                  {p.highlight && <div className="plan__flag">Most complete</div>}
                  <div className="plan__name">{p.name}</div>
                  <div className="plan__price">
                    {inr(p.price)}
                    <span>/month</span>
                  </div>
                  <p className="plan__blurb">{p.blurb}</p>
                  <div className="plan__rule" />
                  <ul className="plan__features">
                    {p.features.slice(0, 5).map((f) => (
                      <li key={f} className="plan__feature">
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/pricing"
                    className={`p-btn p-btn--block ${p.highlight ? 'p-btn--onInk' : 'p-btn--line'}`}
                  >
                    Preview {p.name}
                  </Link>
                </article>
              ))}
            </div>

            <p className="p-small" style={{ marginTop: 28, maxWidth: '62ch' }}>
              Plan names, prices and features are illustrative preview content. Trials,
              subscriptions and billing are not enabled.
            </p>
          </div>
        </section>

        {/* ----------------------------------------------------- closing note */}
        <section className="p-close">
          <div className="p-wrap p-close__inner">
            <div>
              <div className="p-eyebrow">Start here</div>
              <h2 className="p-h2 p-close__title" style={{ marginTop: 22 }}>
                Look at it the way a guest would.
              </h2>
              <p className="p-lede" style={{ marginTop: 20, maxWidth: '46ch' }}>
                The demo menu is open. Browse it, build an order, and watch what the kitchen
                and the counter would see.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/menu" className="p-btn p-btn--solid">
                Open the menu
              </Link>
              <Link href="/pricing" className="p-btn p-btn--line">
                Planned pricing
              </Link>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- footer */}
        <footer className="foot">
          <div className="p-wrap">
            <div className="foot__grid">
              <div>
                <div className="foot__brand">AutoDine</div>
                <p className="foot__note">
                  Table QR ordering and restaurant operations, built around the service a
                  restaurant actually runs.
                </p>
              </div>
              <div>
                <p className="foot__colTitle">Explore</p>
                <ul className="foot__links">
                  <li>
                    <Link href="/#product">Product</Link>
                  </li>
                  <li>
                    <Link href="/pricing">Planned pricing</Link>
                  </li>
                  <li>
                    <Link href="/menu">Menu demo</Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="foot__colTitle">Accounts</p>
                <ul className="foot__links">
                  <li>
                    <Link href="/login">Sign in</Link>
                  </li>
                  <li>
                    <Link href="/signup">Create account</Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="foot__colTitle">Scope</p>
                <p className="p-small">
                  Sample restaurant content. No live orders, payment collection or
                  subscriptions.
                </p>
              </div>
            </div>

            <div className="foot__fine">
              <span>AutoDine · Product preview</span>
              <span>Not for live restaurant operations</span>
            </div>
          </div>
        </footer>
      </main>

      <SiteMotion />
    </>
  );
}
