import Image from 'next/image';
import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';
import { SiteNav } from '@/components/SiteNav';
import { SiteMotion } from '@/components/SiteMotion';
import { SiteClosing } from '@/components/SiteClosing';
import { SiteFooter } from '@/components/SiteFooter';

/* ============================================================================
   Home — premium editorial.

   A full-bleed photograph, one confident line anchored to the bottom of the
   frame, a thin meta strip under it, then air. Three sections follow, each
   with its own shape so the page has a rhythm rather than a scroll of cards:

     product     three columns of type on a hairline
     flow        a sticky heading beside four numbered rows
     statement   one large line on a beige band
     plans       three cards, one of them ink
     close       the last action, on paper
     footer      ink, with the wordmark set enormous and faded into it

   Everything here is a Server Component. The two client pieces render nothing
   but an effect: SiteNav owns the bar's scrolled state, SiteMotion owns the
   animation. Neither pulls this markup into the browser bundle as JavaScript.
   ========================================================================== */

const FEATURES = [
  {
    n: '01',
    title: 'A menu that stays current',
    body: 'Every dish, price and section is edited and published from the dashboard. Several menus run side by side — lunch and dinner, dine-in and takeaway — without reprinting a single table card.',
  },
  {
    n: '02',
    title: 'One service thread',
    body: 'A guest scans the table code, types the six digits showing in the room, and the order lands on the kitchen board in the same second. The ticket is spoken aloud, and settled at the counter.',
  },
  {
    n: '03',
    title: 'Money that reconciles',
    body: 'Cash, card and UPI collected at the counter are recorded against the bill. Billed and collected stay two numbers, so the day’s takings are never an estimate.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Scan',
    body: 'The QR on the table resolves to that table, in that restaurant — not to a generic menu. A card from a closed table is refused, and says so.',
  },
  {
    n: '02',
    title: 'Verify',
    body: 'A six-digit code, changed by staff and shown in the room, stands in for a guest account. No app to install, no account to create, nothing to remember tomorrow.',
  },
  {
    n: '03',
    title: 'Order',
    body: 'The kitchen board picks the ticket up and orders it by what needs cooking next, not by when it was placed. Aging tickets get louder as they get older.',
  },
  {
    n: '04',
    title: 'Settle',
    body: 'Paid at the counter and recorded against the bill, or printed and handed over. The receipt and the record are the same document.',
  },
];

export function Home() {
  return (
    <>
      <SiteNav
        onImage
        links={[
          { label: 'Product', href: '/#product' },
          { label: 'How it works', href: '/#flow' },
          { label: 'Pricing', href: '/pricing' },
        ]}
      />

      <main>
        {/* ------------------------------------------------------------ hero */}
        <header className="hero" data-hero>
          <div className="hero__media">
            <Image
              className="hero__img"
              src="/img/restaurant-interior.jpg"
              alt="A restaurant dining room at dusk, tables laid and lamps lit"
              fill
              priority
              sizes="100vw"
              data-hero-image
            />
          </div>
          <div className="hero__scrim" />
          <div className="grain" />

          <div className="hero__body" data-hero-body>
            <div className="p-eyebrow p-eyebrow--onInk" data-hero-step>
              Restaurant QR ordering
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
              The menu a guest reads, the board a kitchen works from, and the counter that
              settles the bill — one continuous system, built around table service.
            </p>

            <div className="hero__ctas" data-hero-step>
              <Link href="/demo/menu" className="p-btn p-btn--solid">
                Open the sample menu
              </Link>
              <Link href="/pricing" className="p-btn p-btn--glass">
                See pricing
              </Link>
            </div>

            <div className="hero__meta" data-hero-step>
              <div className="hero__metaItem">
                <p className="hero__metaValue">No app</p>
                <p className="hero__metaLabel">the browser is the client</p>
              </div>
              <div className="hero__metaItem">
                <p className="hero__metaValue">No account</p>
                <p className="hero__metaLabel">a six-digit code at the table</p>
              </div>
              <div className="hero__metaItem">
                <p className="hero__metaValue">No hardware</p>
                <p className="hero__metaLabel">print the cards, keep the phones</p>
              </div>
            </div>

            <p className="hero__note" data-hero-step>
              <i aria-hidden="true" />
              Ordering is live in this preview · online payments are not connected
            </p>
          </div>

          <div className="hero__cue" aria-hidden="true" />
        </header>

        {/* --------------------------------------------------------- product */}
        <section className="p-sect" id="product">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">The product</div>
                <h2 className="p-h2 p-head__title">Three screens. One service.</h2>
              </div>
              <p className="p-lede p-head__aside">
                Most restaurant software is a dashboard with a menu attached. This is the other
                way round: the guest’s table is the centre, and everything else is plumbing.
              </p>
            </div>

            <div className="p-grid" style={{ marginTop: 'clamp(48px, 7vh, 88px)' }} data-stagger>
              {FEATURES.map((f) => (
                <article key={f.n} className="feat">
                  <hr className="p-rule feat__rule" data-draw />
                  <p className="feat__num">{f.n}</p>
                  <h3 className="p-h3 feat__title">{f.title}</h3>
                  <p className="p-body feat__body">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ flow */}
        <section className="p-sect p-sect--tight" id="flow">
          <div className="p-wrap">
            <div className="flow">
              <div className="flow__aside">
                <div data-reveal>
                  <div className="p-eyebrow">How it works</div>
                  <h2 className="p-h2" style={{ marginTop: 24, maxWidth: '12ch' }}>
                    Four steps, no ceremony.
                  </h2>
                  <p className="p-lede" style={{ marginTop: 22, maxWidth: '34ch' }}>
                    The whole guest journey is under a minute, and none of it needs an install.
                  </p>
                  <Link href="/demo/menu" className="p-arrow" style={{ marginTop: 28 }}>
                    Read the menu <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>

              <div className="flow__steps" data-stagger>
                {STEPS.map((step) => (
                  <div key={step.n} className="flow__step">
                    <p className="flow__num">{step.n}</p>
                    <div>
                      <h3 className="p-h3 flow__title">{step.title}</h3>
                      <p className="p-body flow__body">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- statement */}
        <section className="statement">
          <div className="p-wrap">
            <p className="p-label" data-reveal>
              Why it is quiet
            </p>
            <h2 className="statement__text" style={{ marginTop: 26 }} data-reveal>
              A restaurant is already loud. The software does not need to be.
            </h2>
            <p className="p-lede statement__sub" data-reveal>
              No dashboards competing for attention during service. One board the kitchen reads,
              one screen the counter works from, and a menu that behaves like a menu.
            </p>
          </div>
        </section>

        {/* ----------------------------------------------------------- plans */}
        <section className="p-sect">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">Pricing</div>
                <h2 className="p-h2 p-head__title">Planned, not yet charged.</h2>
              </div>
              <Link href="/pricing" className="p-arrow" style={{ alignSelf: 'flex-end' }}>
                Full comparison <span aria-hidden="true">→</span>
              </Link>
            </div>

            <div className="p-plans" style={{ marginTop: 'clamp(40px, 6vh, 64px)' }} data-stagger>
              {plans.map((p) => (
                <article
                  key={p.id}
                  className={`plan${p.highlight ? ' plan--featured' : ''}`}
                  data-plan-id={p.id}
                >
                  {p.highlight && <div className="plan__flag">Most complete</div>}
                  <div className="plan__name">{p.name}</div>
                  <p className="plan__fit">{p.fit}</p>
                  <div className="plan__price">
                    {inr(p.price)}
                    <span>/month</span>
                  </div>
                  <div className="plan__rule" />
                  <ul className="plan__features">
                    {p.features.slice(0, 4).map((f) => (
                      <li key={f} className="plan__feature">
                        {f}
                      </li>
                    ))}
                    {p.features.length > 4 && (
                      <li className="plan__feature" style={{ color: 'var(--p-ink-46)' }}>
                        + {p.features.length - 4} more
                      </li>
                    )}
                  </ul>
                  <Link
                    href="/pricing"
                    className={`p-btn p-btn--block ${p.highlight ? 'p-btn--onInk' : 'p-btn--line'}`}
                  >
                    See {p.name}
                  </Link>
                </article>
              ))}
            </div>

            <p className="p-small" style={{ marginTop: 30, maxWidth: '64ch' }}>
              Prices are planning figures shown for product preview. Trials, subscriptions and
              billing are not enabled.
            </p>
          </div>
        </section>

        <SiteClosing
          title="Look at it the way a guest would."
          body="The sample menu is open, set exactly as a guest reads it at the table. Ordering itself starts with the QR code on a table card."
          primary={{ label: 'Open the sample menu', href: '/demo/menu' }}
          secondary={{ label: 'Create an account', href: '/signup' }}
        />

        <SiteFooter />

      </main>

      <SiteMotion />
    </>
  );
}
