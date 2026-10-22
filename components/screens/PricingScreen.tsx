import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';
import { SiteNav } from '@/components/SiteNav';
import { SiteMotion } from '@/components/SiteMotion';

/* ============================================================================
   Pricing — premium editorial.

   The same bones as Home so the two pages read as one product: a type-led
   header, three plans on paper, one dark featured card, then quiet proof in
   the FAQ. Billing is not enabled, and the page says so three times in three
   different registers rather than once in small print.
   ========================================================================== */

const FAQS = [
  {
    q: 'Can I place a real order or make a payment?',
    a: 'The demo menu, cart, kitchen board and cashier are connected to a real database, so an order placed in the demo really does reach the board. Payments are not connected: nothing is charged to a card, and no subscription is active.',
  },
  {
    q: 'Are these prices final?',
    a: 'No. They are planning figures shown for product preview. Final prices, the tax treatment on them, and the shape of the trial are still being settled before billing launches.',
  },
  {
    q: 'What happens when the trial ends?',
    a: 'Your data stays. With no active plan the account moves to read-only: menus, orders, receipts and reports remain visible, but new customer orders and paid features are blocked on the server until a plan is activated.',
  },
  {
    q: 'Do I need any hardware?',
    a: 'No. Print the table QR cards on ordinary paper, run the kitchen board on any laptop, tablet or phone, and connect a Bluetooth speaker through the device if you want the ticket announcements louder.',
  },
  {
    q: 'Can guests pay online?',
    a: 'Not yet in this preview. Both paths are built — online and at the counter — but the gateway is not connected, so the guest is sent to the counter and the order shows as payment-pending until a cashier records it.',
  },
];

export function PricingScreen() {
  return (
    <>
      <SiteNav
        links={[
          { label: 'Product', href: '/#product' },
          { label: 'Pricing', href: '/pricing', active: true },
          { label: 'Menu demo', href: '/menu' },
        ]}
      />

      <main style={{ paddingTop: 116 }}>
        {/* ---------------------------------------------------------- header */}
        <section className="p-sect--tight" style={{ paddingTop: 'clamp(48px, 7vh, 88px)' }}>
          <div className="p-wrap">
            <div data-reveal>
              <div className="p-eyebrow">Pricing</div>
              <h1 className="p-display" style={{ marginTop: 24, maxWidth: '15ch' }}>
                Priced for one restaurant, not a chain.
              </h1>
              <p className="p-lede" style={{ marginTop: 26, maxWidth: '52ch' }}>
                Three plans, each one built around a different size of operation. These are
                planning figures — billing and subscriptions are not enabled in this preview,
                and no payment details are asked for anywhere on this page.
              </p>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- plans */}
        <section style={{ paddingBottom: 'clamp(56px, 9vh, 104px)' }}>
          <div className="p-wrap">
            <div className="p-plans" data-stagger>
              {plans.map((plan) => (
                <article key={plan.id} className={`plan${plan.highlight ? ' plan--featured' : ''}`}>
                  {plan.highlight && <div className="plan__flag">Most complete</div>}
                  <div className="plan__name">{plan.name}</div>
                  <div className="plan__price">
                    {inr(plan.price)}
                    <span>/month · planned</span>
                  </div>
                  <p className="plan__blurb">{plan.blurb}</p>
                  <div className="plan__rule" />
                  <ul className="plan__features">
                    {plan.features.map((feature) => (
                      <li key={feature} className="plan__feature">
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {/* Every plan leads to the same signup, where the plan is
                      chosen. Signup is real -- it creates the restaurant and
                      its trial -- so this is the conversion path, not a demo
                      link. */}
                  <Link
                    href="/signup"
                    className={`p-btn p-btn--block ${plan.highlight ? 'p-btn--onInk' : 'p-btn--line'}`}
                  >
                    Choose {plan.name}
                  </Link>
                </article>
              ))}
            </div>

            <p className="p-small" style={{ marginTop: 30, maxWidth: '68ch' }}>
              <strong style={{ color: 'var(--p-ink)', fontWeight: 500 }}>Preview only.</strong>{' '}
              Features and plan entitlements are not yet available for purchase. Tax treatment
              and final prices require confirmation before billing launches.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------ what is included */}
        <section className="p-band">
          <div className="p-wrap">
            <div className="p-band__grid" data-stagger>
              <div>
                <p className="feat__num">Included</p>
                <p className="p-stat__value" style={{ marginTop: 12 }}>
                  Unlimited guest orders
                </p>
                <p className="p-stat__label">Ordering is not metered on any plan.</p>
              </div>
              <div>
                <p className="feat__num">Included</p>
                <p className="p-stat__value" style={{ marginTop: 12 }}>
                  Kitchen, cashier and bill
                </p>
                <p className="p-stat__label">
                  The operational screens are the product, not an add-on.
                </p>
              </div>
              <div>
                <p className="feat__num">Changing</p>
                <p className="p-stat__value" style={{ marginTop: 12 }}>
                  Plan limits
                </p>
                <p className="p-stat__label">
                  Table counts and staff seats per plan are still being set.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- FAQ */}
        <section className="p-sect">
          <div className="p-wrap">
            <div data-reveal>
              <div className="p-eyebrow">Questions</div>
              <h2 className="p-h2" style={{ marginTop: 22, maxWidth: '14ch' }}>
                The ones worth asking first.
              </h2>
            </div>

            <div className="p-faqs" style={{ marginTop: 'clamp(32px, 4vh, 48px)' }} data-stagger>
              {FAQS.map((item) => (
                <details key={item.q} className="p-faq">
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- closing */}
        <section className="p-close">
          <div className="p-wrap p-close__inner">
            <div>
              <div className="p-eyebrow">Start here</div>
              <h2 className="p-h2 p-close__title" style={{ marginTop: 22 }}>
                Start with the menu, decide later.
              </h2>
              <p className="p-lede" style={{ marginTop: 20, maxWidth: '44ch' }}>
                Creating an account is free and starts a trial. Nothing is charged, and no
                card is asked for.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/signup" className="p-btn p-btn--solid">
                Create an account
              </Link>
              <Link href="/menu" className="p-btn p-btn--line">
                See the demo
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
                <p className="foot__note">Table QR ordering and restaurant operations.</p>
              </div>
              <div>
                <p className="foot__colTitle">Explore</p>
                <ul className="foot__links">
                  <li>
                    <Link href="/">Home</Link>
                  </li>
                  <li>
                    <Link href="/pricing">Pricing</Link>
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
                <p className="p-small">Early product preview. Not for live restaurant operations.</p>
              </div>
            </div>

            <div className="foot__fine">
              <span>AutoDine · Product preview</span>
              <span>Prices shown are planning figures</span>
            </div>
          </div>
        </footer>
      </main>

      <SiteMotion />
    </>
  );
}
