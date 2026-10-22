import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';
import { SiteNav } from '@/components/SiteNav';
import { SiteMotion } from '@/components/SiteMotion';
import { PlanMatcher } from '@/components/PlanMatcher';
import { SiteClosing } from '@/components/SiteClosing';
import { SiteFooter } from '@/components/SiteFooter';

/* ============================================================================
   Pricing — premium editorial.

   The same bones as Home so the two pages read as one product: a type-led
   header, a matcher, three plans on paper with one dark card, a spec list of
   what every plan shares and what still differs, then the questions worth
   asking. Billing is not enabled, and the page says so in three registers
   rather than once in small print.
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
    a: 'Not in this preview. Both paths are built — online and at the counter — but the gateway is not connected, so the guest is sent to the counter and the order shows as payment-pending until a cashier records it.',
  },
];

const INCLUDED = [
  ['Unlimited guest orders', 'Ordering is not metered on any plan, at any table, at any hour.'],
  ['Kitchen, cashier and bill', 'The operational screens are the product, not an add-on tier.'],
  ['Printed table cards', 'QR cards are generated per table and reprintable when a table moves.'],
];

const DIFFERS = [
  ['Menus', 'Starter runs the house menu. Professional and Business run several side by side — lunch and dinner, dine-in and takeaway.'],
  ['Menu import', 'Professional and Business read a photographed or pasted menu and draft it for review. Starter is entered by hand.'],
  ['Staff and roles', 'Starter has counter access. Professional adds manager roles; Business adds per-outlet roles across several rooms.'],
  ['Reporting', 'All plans show billed and collected separately. Professional and Business add item-level performance and exports.'],
  ['Still being set', 'Table counts, staff seats and storage per plan are not final, so they are deliberately not printed here.'],
];

export function PricingScreen() {
  return (
    <>
      <SiteNav
        links={[
          { label: 'Product', href: '/#product' },
          { label: 'How it works', href: '/#flow' },
          { label: 'Pricing', href: '/pricing', active: true },
        ]}
      />

      <main style={{ paddingTop: 118 }}>
        {/* ---------------------------------------------------------- header */}
        <section style={{ paddingBlock: 'clamp(48px, 8vh, 96px) clamp(36px, 5vh, 56px)' }}>
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">Pricing</div>
                <h1 className="p-display" style={{ marginTop: 26, maxWidth: '14ch' }}>
                  Priced for one restaurant, not a chain.
                </h1>
              </div>
              <div className="p-head__aside">
                <p className="p-lede">
                  Three plans, each built around a different size of operation. These are
                  planning figures — nothing is charged, and no card is asked for anywhere on
                  this page.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- plans */}
        <section style={{ paddingBottom: 'clamp(56px, 9vh, 104px)' }}>
          <div className="p-wrap">
            <div
              style={{ marginBottom: 'clamp(28px, 4vh, 40px)' }}
              data-reveal
            >
              <PlanMatcher
                options={[
                  {
                    planId: 'starter',
                    label: 'One outlet',
                    hint: 'Starter fits a single restaurant running one menu and one counter.',
                  },
                  {
                    planId: 'professional',
                    label: 'A busy floor',
                    hint: 'Professional fits a full floor with a kitchen board and a manager on shift.',
                  },
                  {
                    planId: 'business',
                    label: 'Several rooms',
                    hint: 'Business fits several outlets or rooms, each with its own screens and staff.',
                  },
                ]}
              />
            </div>

            <div className="p-plans" data-stagger>
              {plans.map((plan) => (
                <article
                  key={plan.id}
                  className={`plan${plan.highlight ? ' plan--featured' : ''}`}
                  data-plan-id={plan.id}
                >
                  {plan.highlight && <div className="plan__flag">Most complete</div>}
                  <div className="plan__name">{plan.name}</div>
                  <p className="plan__fit">{plan.fit}</p>
                  <div className="plan__price">
                    {inr(plan.price)}
                    <span>/month · planned</span>
                  </div>
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
              Features and entitlements are not yet available for purchase. Tax treatment and
              final prices require confirmation before billing launches.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------- what is shared */}
        <section className="statement">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">In every plan</div>
                <h2 className="p-h2 p-head__title">Nothing operational is gated.</h2>
              </div>
              <p className="p-lede p-head__aside">
                A restaurant that cannot take an order is not a smaller customer. The parts that
                run service are in all three plans.
              </p>
            </div>

            <div
              className="p-grid"
              style={{ marginTop: 'clamp(40px, 6vh, 64px)' }}
              data-stagger
            >
              {INCLUDED.map(([title, body], i) => (
                <article key={title} className="feat">
                  <hr className="p-rule feat__rule" data-draw />
                  <p className="feat__num">{String(i + 1).padStart(2, '0')}</p>
                  <h3 className="p-h3 feat__title">{title}</h3>
                  <p className="p-body feat__body">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- what differs */}
        <section className="p-sect">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">What differs</div>
                <h2 className="p-h2 p-head__title">The honest version.</h2>
              </div>
              <p className="p-lede p-head__aside">
                Rather than a grid of ticks, the four things that actually change — and the
                numbers that are not settled yet.
              </p>
            </div>

            <div className="spec" style={{ marginTop: 'clamp(32px, 5vh, 52px)' }} data-stagger>
              {DIFFERS.map(([label, value]) => (
                <div key={label} className="spec__row">
                  <p className="spec__label">{label}</p>
                  <p className="spec__value">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- FAQ */}
        <section className="p-sect p-sect--tight" style={{ paddingTop: 0 }}>
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">Questions</div>
                <h2 className="p-h2 p-head__title">The ones worth asking first.</h2>
              </div>
            </div>

            <div className="p-faqs" style={{ marginTop: 'clamp(28px, 4vh, 44px)' }} data-stagger>
              {FAQS.map((item) => (
                <details key={item.q} className="p-faq">
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <SiteClosing
          title="Start with the menu, decide later."
          body="Creating an account is free and starts a trial. Nothing is charged, and no card is asked for."
          primary={{ label: 'Create an account', href: '/signup' }}
          secondary={{ label: 'See the sample menu', href: '/demo/menu' }}
        />

        <SiteFooter
          note="Table QR ordering and restaurant operations."
          scope="Early product preview. Not for live restaurant operations."
          fineRight="Prices shown are planning figures"
        />

      </main>

      <SiteMotion />
    </>
  );
}
