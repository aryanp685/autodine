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
  NumberWord,
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
    a: `Monthly, per restaurant, with a ${BILLING.trialDays}-day trial before the first charge. If a subscription lapses the account becomes read-only: menus, orders and reports stay visible and are never deleted. We will give notice before any of that is switched on.`,
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
    <span className="mt-2 flex flex-wrap gap-1.5">
      {tiers.map((tier) => (
        <span
          key={tier}
          className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-medium tracking-[0.06em] text-mute uppercase"
        >
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
          { label: 'The screens', href: '/#tour' },
          { label: 'What is live', href: '/#status' },
          { label: 'Pricing', href: '/pricing', active: true },
        ]}
        onImage
      />

      <main className="bg-ink text-cream antialiased">
        {/* ---------------------------------------------------------- header */}
        <header className="border-b border-white/[0.07] px-5 pt-20 pb-14 sm:px-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gold-dim uppercase">01 · Plans</p>

            <div className="mt-6 grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-end">
              <h1 className="max-w-[15ch] text-[clamp(34px,5.6vw,62px)] leading-[0.98] font-semibold tracking-[-0.04em] text-balance">
                Priced for one restaurant, not a chain.
              </h1>
              <p className="max-w-[46ch] text-[15px] leading-[1.65] text-mute">
                Three sizes of operation, one product. Everything below is a planning figure —
                plans are not on sale, and no account is limited by them today.
              </p>
            </div>

            <div
              data-reveal
              className="mt-10 flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-ink-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <PlanMatcher
                options={PLANS.map((plan) => ({
                  planId: plan.id,
                  label: plan.fit.split(',')[0],
                  hint: plan.fit,
                }))}
              />
              <span className="inline-flex items-center gap-2 text-[11.5px] font-medium tracking-[0.03em] text-mute">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
                {BILLING.connected ? 'Billing connected' : 'Preview · billing not connected'}
              </span>
            </div>
          </div>
        </header>

        {/* ----------------------------------------------------------- plans */}
        <section id="plans" className="px-5 pt-14 pb-16 sm:px-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <div data-stagger className="grid gap-4 md:grid-cols-3">
              {PLANS.map((plan) => {
                const included = capabilitiesFor(plan.id);
                return (
                  <article
                    key={plan.id}
                    id={`plan-${plan.id}`}
                    data-plan-id={plan.id}
                    className={[
                      'relative flex flex-col rounded-[22px] border p-6',
                      /* The middle tier is lifted rather than decorated: a
                         warmer ground and a gold rule say "this one" without a
                         badge shouting over the other two. */
                      plan.recommended
                        ? 'border-gold/35 bg-ink-card shadow-[0_40px_80px_-50px_rgba(224,168,106,0.55)]'
                        : 'border-white/[0.09] bg-ink-soft',
                    ].join(' ')}
                  >
                    {plan.recommended && (
                      <div className="absolute -top-3 left-6 rounded-full bg-gold px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-ink uppercase">
                        Recommended
                      </div>
                    )}

                    <h2 className="text-[13px] font-semibold tracking-[0.09em] text-mute uppercase">
                      {plan.name}
                    </h2>
                    <p className="mt-2 min-h-10 text-[13.5px] leading-[1.5] text-cream/75">{plan.fit}</p>

                    <div className="mt-5 flex items-baseline gap-1.5">
                      <span className="tnum text-[34px] leading-none font-semibold tracking-[-0.03em] text-cream">
                        {inr(plan.price)}
                      </span>
                      <span className="text-[12px] text-mute-dim">/month · planned</span>
                    </div>

                    <hr className="my-5 border-white/[0.08]" />

                    <ul className="flex flex-1 flex-col gap-2.5 text-[13.5px] leading-[1.45] text-cream/80">
                      {plan.id === 'starter' ? (
                        <>
                          <li>All {LIVE.length} live capabilities</li>
                          <li>Unlimited orders and tables</li>
                          <li>Available today, nothing charged</li>
                        </>
                      ) : (
                        <>
                          <li>Everything in {PLANS[PLANS.indexOf(plan) - 1].name}, plus:</li>
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
                              <li key={c.id} className="flex gap-2">
                                <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-gold-dim" />
                                {c.label}
                              </li>
                            ))}
                        </>
                      )}
                    </ul>

                    <p className="mt-5 border-t border-white/[0.08] pt-3 text-[10.5px] font-medium tracking-[0.09em] text-mute-dim uppercase">
                      Planned · not on sale
                    </p>
                  </article>
                );
              })}
            </div>

            {/* One action for the whole page. Three "Choose" buttons would be
                three ways to do the same thing, and none of them would put the
                account on a plan. */}
            <div data-reveal className="mt-10 flex flex-col items-start gap-2">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center rounded-full bg-gold px-6 text-[14px] font-medium text-ink transition-colors hover:bg-gold-bright"
              >
                Create an account
              </Link>
              <p className="text-[12px] text-mute-dim">
                Free while the product is in preview. No card, nothing charged.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ live today */}
        <section id="live" className="border-t border-white/[0.07] px-5 py-16 sm:px-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <div data-reveal className="grid gap-6 md:grid-cols-[1fr_0.9fr] md:items-end">
              <div>
                <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gold-dim uppercase">
                  02 · In the product today
                </p>
                <h2 className="mt-4 max-w-[16ch] text-[clamp(28px,4vw,44px)] leading-[1.03] font-semibold tracking-[-0.035em]">
                  Built, and switched on.
                </h2>
              </div>
              <p className="max-w-[44ch] text-[14.5px] leading-[1.65] text-mute">
                Not a roadmap. Every one of these is running in this build, on every account,
                whatever the plans end up costing.
              </p>
            </div>

            <div data-stagger className="mt-12 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {LIVE.map((capability, index) => (
                <article key={capability.id} className="border-t border-white/[0.12] pt-4">
                  <p className="tnum text-[10.5px] font-semibold tracking-[0.1em] text-mute-dim">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="mt-2 text-[16px] font-semibold tracking-[-0.015em] text-cream">
                    {capability.label}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-mute">{capability.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- statement */}
        <section className="border-y border-white/[0.07] bg-ink-soft px-5 py-20 sm:px-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <p data-reveal className="text-[10.5px] font-semibold tracking-[0.14em] text-mute-dim uppercase">
              Why nothing is gated
            </p>
            <h2
              data-reveal
              className="mt-6 max-w-[24ch] text-[clamp(26px,4vw,42px)] leading-[1.06] font-semibold tracking-[-0.035em] text-cream"
            >
              A restaurant that cannot take an order is not a smaller customer.
            </h2>
            <p data-reveal className="mt-5 max-w-[52ch] text-[14.5px] leading-[1.65] text-mute">
              The parts that run service are in every plan, and today they are not metered at
              all. Billing, when it arrives, will not take away the kitchen board.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------- differs */}
        <section id="differs" className="px-5 py-16 sm:px-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <div data-reveal className="grid gap-6 md:grid-cols-[1fr_0.9fr] md:items-end">
              <div>
                <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gold-dim uppercase">
                  03 · What the tiers change
                </p>
                <h2 className="mt-4 max-w-[18ch] text-[clamp(28px,4vw,44px)] leading-[1.03] font-semibold tracking-[-0.035em]">
                  {`${NumberWord(DIFFERENCES.length)} differences, not fifty.`}
                </h2>
              </div>
              <p className="max-w-[44ch] text-[14.5px] leading-[1.65] text-mute">
                What each step up will add when billing opens. Nothing here exists yet, which is
                why every row is marked planned.
              </p>
            </div>

            <div data-stagger className="mt-10 divide-y divide-white/[0.08] border-y border-white/[0.08]">
              {DIFFERENCES.map((difference) => {
                const tiers = difference.tiers === 'all' ? [] : difference.tiers;
                return (
                  <div key={difference.id} className="grid gap-2 py-5 md:grid-cols-[0.8fr_1.2fr] md:gap-8">
                    <div>
                      <p className="text-[14.5px] font-medium text-cream">{difference.label}</p>
                      <TierTags tiers={tiers.map((t) => PLANS.find((p) => p.id === t)!.name)} />
                    </div>
                    <p className="text-[13.5px] leading-[1.6] text-mute">{difference.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- billing */}
        <section id="billing" className="border-t border-white/[0.07] px-5 py-16 sm:px-8">
          <div className="mx-auto grid w-full max-w-[1180px] gap-10 md:grid-cols-[0.85fr_1.15fr]">
            <div data-reveal>
              <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gold-dim uppercase">
                04 · The money side
              </p>
              <h2 className="mt-4 max-w-[14ch] text-[clamp(26px,3.6vw,40px)] leading-[1.04] font-semibold tracking-[-0.035em]">
                How billing will work.
              </h2>
              <p className="mt-4 max-w-[34ch] text-[14px] leading-[1.65] text-mute">
                None of this is switched on. It is written down so the shape is not a
                surprise when it is.
              </p>
            </div>

            <div data-stagger className="flex flex-col gap-6">
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
                <div key={step.n} className="grid grid-cols-[auto_1fr] gap-4 border-t border-white/[0.1] pt-4">
                  <p className="tnum text-[11px] font-semibold tracking-[0.08em] text-gold-dim">{step.n}</p>
                  <div>
                    <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] text-cream">{step.title}</h3>
                    <p className="mt-1.5 text-[13.5px] leading-[1.6] text-mute">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- FAQ */}
        <section id="questions" className="border-t border-white/[0.07] px-5 py-16 sm:px-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <div data-reveal>
              <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gold-dim uppercase">05 · Questions</p>
              <h2 className="mt-4 max-w-[20ch] text-[clamp(26px,3.6vw,40px)] leading-[1.04] font-semibold tracking-[-0.035em]">
                The ones worth asking first.
              </h2>
            </div>

            <div data-stagger className="mt-8 max-w-[820px] divide-y divide-white/[0.08] border-y border-white/[0.08]">
              {FAQS.map((item) => (
                <details key={item.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-medium text-cream marker:hidden">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-[18px] leading-none text-mute transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-[1.65] text-mute">{item.a}</p>
                </details>
              ))}
            </div>

            <p className="mt-7 max-w-[70ch] text-[12px] leading-[1.6] text-mute-dim">{BILLING.note}</p>
          </div>
        </section>

        <SiteClosing
          title="Start with the product, decide later."
          body="An account is free today and gives you the entire product. When plans open, you will hear about it before anything is charged."
          primary={{ label: 'Create an account', href: '/signup' }}
          secondary={{ label: 'See what is live', href: '/#status' }}
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
