import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteMotion } from '@/components/SiteMotion';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteClosing } from '@/components/SiteClosing';
import { PlanMatcher } from '@/components/PlanMatcher';
import { inr } from '@/lib/demo-data';
import {
  BILLING,
  DIFFERENCES,
  LIVE,
  PLANS,
  capabilitiesFor,
} from '@/lib/plans';

/* ============================================================================
   Pricing — what it costs, and what is actually true today.

   The page has one job beyond looking expensive: it must not sell anything
   that does not exist. Billing is not connected in this deployment, so:

     - no card carries a "Choose" button; there is nothing to choose, and a
       button that leads to a signup form that ignores the plan is a lie
     - every capability is labelled live or planned, from lib/plans.ts
     - "what you get today" is a list of built features, not of promises
     - the trial is described as it will work WHEN billing opens, in a section
       that says so, rather than in the present tense on a page with prices

   Section order is deliberate: price, then proof, then the differences, then
   the money mechanics, then the questions a person actually asks.
   ========================================================================== */

const FAQS = [
  {
    q: 'Can I buy a plan today?',
    a: 'No. Billing is not connected in this build: there is no gateway, no subscription record and no card is ever asked for. Accounts created now are free and stay free while the product is in preview.',
  },
  {
    q: 'What do I get if I create an account now?',
    a: 'Everything in the product: menus, table cards, guest ordering, the kitchen board, the counter and reports. Nothing is gated, metered or limited, and that will not change without telling you first.',
  },
  {
    q: 'Are these prices final?',
    a: 'They are planning figures. The monthly amounts are our intent, but final pricing and the tax treatment on it are not settled, so nothing here is a quote.',
  },
  {
    q: 'How will a subscription work when it opens?',
    a: 'Monthly, per restaurant, with a ten-day trial before the first charge. If a subscription lapses the account becomes read-only: menus, orders and reports stay visible and are never deleted. We will give notice before any of that is switched on.',
  },
  {
    q: 'Do I need any hardware?',
    a: 'No. Print the table cards on ordinary paper, run the kitchen board on any laptop or tablet, and print receipts from the same browser the counter already uses.',
  },
  {
    q: 'Can guests pay online?',
    a: 'Not in this build. Both paths are written — online and at the counter — but the payment gateway is not connected, so guests are asked to pay at the counter and the order shows as payment pending until it is recorded.',
  },
];

function TierTags({ tiers }: { tiers: string[] }) {
  return (
    <span className="diff__tiers">
      {tiers.map((tier) => (
        <span key={tier} className="diff__tier">
          {tier}
        </span>
      ))}
    </span>
  );
}

export function PricingScreen() {
  return (
    <>
      <SiteNav
        links={[
          { label: 'Product', href: '/#product' },
          { label: 'How it works', href: '/#flow' },
          { label: 'What is live', href: '/#status' },
          { label: 'Pricing', href: '/pricing', active: true },
        ]}
      />

      <main>
        {/* ---------------------------------------------------------- header */}
        <header className="p-sect pricing__head">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">01 · Plans</div>
                <h1 className="p-display p-head__title">
                  Priced for one restaurant,
                  <br />
                  not a chain.
                </h1>
              </div>
              <p className="p-lede p-head__aside">
                Three sizes of operation, one product. Everything below is a planning figure —
                plans are not on sale, and no account is limited by them today.
              </p>
            </div>

            <div className="pricing__bar" data-reveal>
              <PlanMatcher
                options={PLANS.map((plan) => ({
                  planId: plan.id,
                  label: plan.fit.split(',')[0],
                  hint: plan.fit,
                }))}
              />
              <span className="pricing__state">
                <span className="pricing__stateDot" aria-hidden="true" />
                {BILLING.connected ? 'Billing connected' : 'Preview · billing not connected'}
              </span>
            </div>
          </div>
        </header>

        {/* ----------------------------------------------------------- plans */}
        <section className="p-sect p-sect--tight" style={{ paddingTop: 0 }} id="plans">
          <div className="p-wrap">
            <div className="p-plans" data-stagger>
              {PLANS.map((plan) => {
                const included = capabilitiesFor(plan.id);
                return (
                  <article
                    key={plan.id}
                    id={`plan-${plan.id}`}
                    className={`plan${plan.recommended ? ' plan--featured' : ''}`}
                    data-plan-id={plan.id}
                  >
                    {plan.recommended && <div className="plan__flag">Recommended</div>}

                    <div className="plan__name">{plan.name}</div>
                    <p className="plan__fit">{plan.fit}</p>

                    <div className="plan__price">
                      {inr(plan.price)}
                      <span>/month · planned</span>
                    </div>

                    <div className="plan__rule" />

                    <ul className="plan__features">
                      {plan.id === 'starter' ? (
                        <>
                          <li className="plan__feature">All {LIVE.length} live capabilities</li>
                          <li className="plan__feature">Unlimited orders and tables</li>
                          <li className="plan__feature">Available today, nothing charged</li>
                        </>
                      ) : (
                        <>
                          <li className="plan__feature">
                            Everything in {PLANS[PLANS.indexOf(plan) - 1].name}, plus:
                          </li>
                          {/* Only what this tier adds over the one below it.
                              Repeating Professional's rows on Business reads as
                              a longer list and is the same list. */}
                          {included
                            .filter((c) => {
                              if (c.tiers === 'all') return false;
                              const below = PLANS[PLANS.indexOf(plan) - 1].id;
                              return !c.tiers.includes(below);
                            })
                            .map((c) => (
                              <li key={c.id} className="plan__feature">
                                {c.label}
                              </li>
                            ))}
                        </>
                      )}
                    </ul>
                    <p className="plan__stage">Planned · not on sale</p>
                  </article>
                );
              })}
            </div>

            {/* One action for the whole page. Three "Choose" buttons would be
                three ways to do the same thing, and none of them would put the
                account on a plan. */}
            <div className="pricing__action" data-reveal>
              <div>
                <Link href="/signup" className="p-btn p-btn--solid">
                  Create an account
                </Link>
                <p className="pricing__actionNote">
                  Free while the product is in preview. No card, nothing charged.
                </p>
              </div>
              <Link href="/demo/menu" className="p-arrow">
                See a sample menu <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ live today */}
        <section className="p-sect" id="live">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">02 · In the product today</div>
                <h2 className="p-h2 p-head__title">Built, and switched on.</h2>
              </div>
              <p className="p-lede p-head__aside">
                Not a roadmap. These six are running in this build, on every account, whatever
                the plans end up costing.
              </p>
            </div>

            <div className="p-grid" style={{ marginTop: 'clamp(48px, 7vh, 88px)' }} data-stagger>
              {LIVE.map((capability, index) => (
                <article key={capability.id} className="feat">
                  <hr className="p-rule feat__rule" data-draw />
                  <p className="feat__num">{String(index + 1).padStart(2, '0')}</p>
                  <h3 className="p-h3 feat__title">{capability.label}</h3>
                  <p className="p-body feat__body">{capability.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- statement */}
        <section className="statement">
          <div className="p-wrap">
            <p className="p-label" data-reveal>
              Why nothing is gated
            </p>
            <h2 className="statement__text" style={{ marginTop: 26 }} data-reveal>
              A restaurant that cannot take an order is not a smaller customer.
            </h2>
            <p className="p-lede statement__sub" data-reveal>
              The parts that run service are in every plan, and today they are not metered at
              all. Billing, when it arrives, will not take away the kitchen board.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------- differs */}
        <section className="p-sect" id="differs">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">03 · What the tiers change</div>
                <h2 className="p-h2 p-head__title">Five differences, not fifty.</h2>
              </div>
              <p className="p-lede p-head__aside">
                What each step up will add when billing opens. Nothing here exists yet, which is
                why every row is marked planned.
              </p>
            </div>

            <div className="diff" style={{ marginTop: 'clamp(32px, 5vh, 52px)' }} data-stagger>
              {DIFFERENCES.map((difference) => {
                const tiers = difference.tiers === 'all' ? [] : difference.tiers;
                return (
                  <div key={difference.id} className="diff__row">
                    <div className="diff__lead">
                      <p className="diff__label">{difference.label}</p>
                      <TierTags tiers={tiers.map((t) => PLANS.find((p) => p.id === t)!.name)} />
                    </div>
                    <p className="diff__detail">{difference.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- billing */}
        <section className="p-sect p-sect--tight" id="billing">
          <div className="p-wrap">
            <div className="flow">
              <div className="flow__aside">
                <div data-reveal>
                  <div className="p-eyebrow">04 · The money side</div>
                  <h2 className="p-h2" style={{ marginTop: 24, maxWidth: '14ch' }}>
                    How billing will work.
                  </h2>
                  <p className="p-lede" style={{ marginTop: 22, maxWidth: '34ch' }}>
                    None of this is switched on. It is written down so the shape is not a
                    surprise when it is.
                  </p>
                </div>
              </div>

              <div className="flow__steps" data-stagger>
                {[
                  {
                    n: '01',
                    title: `${BILLING.trialDays} days, everything on`,
                    body: 'A new account starts on the whole product. No card is taken to begin, and the trial is not a cut-down tier.',
                  },
                  {
                    n: '02',
                    title: 'Monthly, per restaurant',
                    body: 'One amount in rupees, once a month. No setup fee, no percentage of sales, no charge per order or per table.',
                  },
                  {
                    n: '03',
                    title: 'If it lapses, it goes quiet',
                    body: 'The account becomes read-only: menus, orders, receipts and reports stay visible and are never deleted. New orders stop until a plan is active.',
                  },
                ].map((step) => (
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

        {/* ------------------------------------------------------------- FAQ */}
        <section className="p-sect p-sect--tight" id="questions">
          <div className="p-wrap">
            <div className="p-head" data-reveal>
              <div>
                <div className="p-eyebrow">05 · Questions</div>
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

            <p className="p-small" style={{ marginTop: 30, maxWidth: '70ch' }}>
              {BILLING.note}
            </p>
          </div>
        </section>

        <SiteClosing
          title="Start with the product, decide later."
          body="An account is free today and gives you the entire product. When plans open, you will hear about it before anything is charged."
          primary={{ label: 'Create an account', href: '/signup' }}
          secondary={{ label: 'See the sample menu', href: '/demo/menu' }}
        />

        <SiteFooter
          note="Table QR ordering and restaurant operations."
          scope="Product preview. Billing is not connected and nothing is for sale."
          fineRight="Prices are planning figures"
        />
      </main>

      <SiteMotion />
    </>
  );
}
