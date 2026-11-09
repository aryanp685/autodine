import Link from 'next/link';
import { HomeNav } from '@/components/HomeNav';
import { SiteMotion } from '@/components/SiteMotion';
import { SiteFooter } from '@/components/SiteFooter';
import { inr } from '@/lib/demo-data';
import { BILLING, LIVE, PLANS } from '@/lib/plans';

const FAQS = [
  { q: 'Can I purchase a plan now?', a: 'Not yet. These are indicative monthly prices, not an offer to purchase. Final pricing and applicable taxes will be confirmed before plans go on sale.' },
  { q: 'What happens after the trial?', a: `The current trial lasts ${BILLING.trialDays} days. When access expires, the restaurant becomes read-only until access is extended. Creating an account does not purchase or activate a paid subscription.` },
  { q: 'Do I need special hardware?', a: 'Use a phone for guest ordering and a compatible browser on a laptop or tablet for staff. Table cards can be printed on ordinary paper. Receipt printing depends on your browser and printer setup.' },
  { q: 'How do guests pay?', a: 'Guests pay at the counter. Staff record cash, card or UPI after checking the payment. AutoDine does not collect an online payment from the guest.' },
];

const CAPABILITY_COPY: Record<string, string> = {
  menus: 'Organise dishes, portions, add-ons and prices. Publish updates from the dashboard.',
  qr: 'Give each table a QR card, with short-lived guest sessions for ordering.',
  ordering: 'Guests browse, customise and place an order from their phone. No app to install.',
  kitchen: 'Track tickets and preparation stages. Voice announcements depend on the device and sound settings.',
  cashier: 'Review the bill and record cash, card or UPI at the counter. Print from a compatible browser.',
  reports: 'Review daily sales and item performance, with CSV exports.',
};

const FOCUS = {
  starter: ['A straightforward setup', 'For a single-room restaurant or café.'],
  professional: ['A busier service', 'For a full floor with a dedicated kitchen team.'],
  business: ['A larger operation', 'For teams planning service across several rooms.'],
};

/** Public pricing is informational, not a checkout or an entitlement promise.
 * Keep anchors used by the landing page; do not imply unlimited capacity,
 * recommend an unpurchasable tier, or promise an indefinite free account. */
export function PricingScreen() {
  return (
    <div className="public-landing min-h-screen bg-ink text-cream antialiased">
      <HomeNav activePricing />
      <main id="pricing-content">
        <header className="relative overflow-hidden border-b border-cream/10 px-5 pt-14 pb-12 sm:px-8 sm:pt-20 sm:pb-16">
          <div aria-hidden="true" className="pointer-events-none absolute -top-40 right-[-10%] size-[550px] rounded-full bg-forest/[0.05] blur-3xl" />
          <div className="relative mx-auto max-w-[1116px]">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-forest uppercase">Pricing</p>
            <div className="mt-6 grid gap-7 md:grid-cols-[1.2fr_0.8fr] md:items-end md:gap-16">
              <div>
                <h1 className="max-w-[15ch] text-[clamp(42px,6vw,76px)] leading-[1.02] font-semibold tracking-[-0.055em] text-balance">Good service.<br />A clearer price.</h1>
                <p className="mt-6 max-w-[42ch] text-[16px] leading-relaxed text-mute">From the first scan to the final bill. Explore the planned pricing for your restaurant.</p>
              </div>
              <div className="rounded-2xl border border-forest/15 bg-forest-soft p-6">
                <p className="flex items-center gap-2 text-[12px] font-semibold text-forest"><span aria-hidden="true" className="size-1.5 rounded-full bg-forest" />Plans are not on sale yet</p>
                <p className="mt-3 text-[14px] leading-relaxed text-mute">You can create an account for a {BILLING.trialDays}-day trial. No subscription is purchased when you sign up.</p>
                <Link href="/signup" className="mt-5 inline-flex min-h-11 items-center gap-3 rounded-full bg-forest px-5 text-[13px] font-medium text-white hover:bg-forest-strong">Start your trial <span aria-hidden="true">↗</span></Link>
              </div>
            </div>
          </div>
        </header>

        <section id="plans" aria-labelledby="plans-heading" className="px-5 py-12 sm:px-8 sm:py-16">
          <div className="mx-auto max-w-[1116px]">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
              <h2 id="plans-heading" className="text-[25px] font-semibold tracking-[-0.03em] sm:text-[30px]">One product. Room to grow.</h2>
              <p className="text-[12px] text-mute">Indicative prices · per restaurant / month</p>
            </div>
            <div data-stagger className="grid gap-4 md:grid-cols-3">
              {PLANS.map((plan, index) => (
                <article id={`plan-${plan.id}`} data-plan-id={plan.id} key={plan.id} className="public-card scroll-mt-24 rounded-[22px] border border-cream/10 bg-white p-6 sm:p-7">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[16px] font-semibold tracking-[-0.02em]">{plan.name}</h3>
                    <span aria-hidden="true" className="tnum text-[11px] text-mute-dim">0{index + 1}</span>
                  </div>
                  <p className="mt-2 min-h-12 text-[13px] leading-relaxed text-mute">{plan.fit}</p>
                  <p className="mt-7 flex flex-wrap items-baseline gap-2"><span className="tnum text-[42px] leading-none font-semibold tracking-[-0.05em]">{inr(plan.price)}</span><span className="text-[12px] text-mute">/ month</span></p>
                  <div className="my-7 h-px bg-cream/10" />
                  <p className="text-[13px] font-medium text-forest">{FOCUS[plan.id][0]}</p>
                  <p className="mt-2 min-h-12 text-[13px] leading-relaxed text-mute">{FOCUS[plan.id][1]}</p>
                  <p className="mt-6 text-[10px] font-medium tracking-[0.12em] text-mute uppercase">Planned · not on sale</p>
                </article>
              ))}
            </div>
            <p className="mt-5 max-w-[70ch] text-[12px] leading-relaxed text-mute">These are proposed plans, not selectable packages. Final features, limits and taxes will be confirmed before purchase is available.</p>
          </div>
        </section>

        <section aria-labelledby="included-heading" className="border-y border-cream/10 bg-ink-soft px-5 py-12 sm:px-8 sm:py-16">
          <div className="mx-auto grid max-w-[1116px] gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div data-reveal>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-forest uppercase">The essentials</p>
              <h2 id="included-heading" className="mt-4 max-w-[15ch] text-[clamp(30px,4vw,42px)] leading-[1.1] font-semibold tracking-[-0.04em]">Built around your service.</h2>
              <p className="mt-4 max-w-[35ch] text-[14px] leading-relaxed text-mute">Explore the core workflow during your trial, from setting up your menu to recording payments.</p>
            </div>
            <div data-stagger className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {LIVE.map(capability => <div key={capability.id} className="border-t border-cream/15 pt-4"><h3 className="flex items-center gap-2 text-[14px] font-semibold"><span aria-hidden="true" className="text-forest">↗</span>{capability.label}</h3><p className="mt-2 text-[13px] leading-relaxed text-mute">{CAPABILITY_COPY[capability.id]}</p></div>)}
            </div>
          </div>
        </section>

        <section aria-labelledby="questions-heading" className="px-5 py-12 sm:px-8 sm:py-16">
          <div className="mx-auto grid max-w-[1116px] gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
            <h2 id="questions-heading" data-reveal className="text-[32px] leading-tight font-semibold tracking-[-0.04em]">Before you start.</h2>
            <div className="divide-y divide-cream/10 border-y border-cream/10">
              {FAQS.map(item => <details key={item.q} className="group py-5"><summary className="flex min-h-6 cursor-pointer list-none items-center justify-between gap-5 text-[14px] font-medium marker:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">{item.q}<span aria-hidden="true" className="text-xl text-forest motion-safe:transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 max-w-[58ch] text-[13px] leading-relaxed text-mute">{item.a}</p></details>)}
            </div>
          </div>
        </section>
        <section className="px-5 pb-12 sm:px-8 sm:pb-16">
          <div className="mx-auto flex max-w-[1116px] flex-col items-start justify-between gap-6 rounded-[24px] bg-forest px-7 py-9 text-white sm:flex-row sm:items-center sm:px-10">
            <div><h2 className="text-[clamp(26px,3vw,36px)] font-semibold tracking-[-0.035em]">See how it fits your restaurant.</h2><p className="mt-2 text-[14px] leading-relaxed text-white/75">Start with a {BILLING.trialDays}-day trial. No automatic subscription purchase.</p></div>
            <Link href="/signup" className="inline-flex min-h-12 shrink-0 items-center gap-4 rounded-full bg-white px-6 text-[13px] font-semibold text-forest hover:bg-white/90">Create account <span aria-hidden="true">↗</span></Link>
          </div>
        </section>
      </main>
      <SiteFooter note="Table QR ordering and restaurant operations." scope="Planned pricing. Paid plans are not currently available." fineRight="Made for restaurant service" />
      <SiteMotion />
    </div>
  );
}
