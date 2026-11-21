import Image from 'next/image';
import Link from 'next/link';
import { LIVE, NOT_CONNECTED, PLANS, capabilitiesFor } from '@/lib/plans';
import { inr } from '@/lib/demo-data';
import { ProductScene } from '@/components/ProductScene';
import { SiteMotion } from '@/components/SiteMotion';
import { SectionRail } from '@/components/marketing/SectionRail';
import { HomeNav } from '@/components/HomeNav';
import { BrandLockup } from '@/components/BrandMark';
import { HeroTableScene } from '@/components/marketing/HeroTableScene';
import { HeroVisualMotion } from '@/components/marketing/HeroVisualMotion';
import { HeroMenuDemo } from '@/components/marketing/HeroMenuDemo';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { BRAND_GREEN } from '@/lib/brand';
import { TRIAL_DAYS } from '@/lib/trial';

/**
 * The landing page.
 *
 * REBUILT IN TAILWIND
 *
 * Every screen is being migrated off the hand-written class system onto
 * utilities, one page at a time, starting here. The shape follows the same
 * brief as before -- photograph, one confident line, then the product -- but
 * the surface is warm porcelain with deep forest accents, because
 * that is what the owner asked for and what the product now looks like.
 *
 * WHAT DID NOT CHANGE, ON PURPOSE
 *
 * The claims. Three tests pin them: no sample-menu detour, the "N things work"
 * count derived from the real lists rather than typed, and every plan card
 * linking to its own plan. A re-skin is exactly when a marketing page starts
 * quietly lying, so the assertions stay.
 *
 * MOTION
 *
 * SiteMotion (GSAP + ScrollTrigger) drives [data-reveal] and [data-stagger].
 * It stamps data-motion-ready and reverts everything under reduced motion, so
 * nothing here depends on JavaScript to be readable.
 */

const STEPS = [
  {
    n: '01',
    role: 'Before service',
    title: 'Make the menu yours.',
    body: 'Add dishes, prices and available options. Set up your tables, publish the menu and print a QR card for each table.',
    outcome: 'A table card that opens your menu.',
    icon: 'M5 4h14v16H5V4Zm4 4h6M9 12h6M9 16h3',
  },
  {
    n: '02',
    role: 'At the table',
    title: 'Scan. Choose. Send.',
    body: 'Guests scan the card on a connected phone, choose dishes and add notes. They review the total before sending the order.',
    outcome: 'An order with its table and guest notes.',
    icon: 'M8 3h8v18H8V3Zm3 15h2M11 6h2',
  },
  {
    n: '03',
    role: 'Kitchen & counter',
    title: 'Prepare, serve, settle.',
    body: 'Staff follow the kitchen tickets and update their status. At the counter, review the bill and record payment after checking it.',
    outcome: 'Service tracked. Payment recorded by staff.',
    icon: 'M4 5h16v12H4V5Zm4 16h8M12 17v4M8 10l3 3 5-5',
  },
];

const LOOP_STATIONS = [
  {
    n: '01',
    role: 'At the table',
    status: 'Order sent',
    body: 'The guest scans the table card, checks the dishes and their note, and sends the order from their own phone.',
    detail: 'Guest’s phone · no app to install',
  },
  {
    n: '02',
    role: 'On the pass',
    status: 'Preparing',
    body: 'The ticket reaches the kitchen board with its table, quantities and the guest’s note attached to the order.',
    detail: 'Kitchen board · table, dishes, note',
  },
  {
    n: '03',
    role: 'At the counter',
    status: 'Awaiting payment',
    body: 'Staff check the bill against what was served, then record payment at the counter. Nothing is charged online.',
    detail: 'Counter · checked, then recorded',
  },
];

const FEATURES = [
  {
    title: 'Let guests take their time.',
    body: 'Dishes, portions, extras and notes — guests build their order on their own phone, without installing an app.',
    role: 'For your guests',
    detail: 'A menu they can explore at their own pace.',
    icon: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM10 6h4M11 18h2',
  },
  {
    title: 'Keep the pass in the picture.',
    body: 'See the table, dishes and guest notes together. Move tickets through preparation, ready and served.',
    role: 'For the kitchen',
    detail: 'One place to follow what needs cooking next.',
    icon: 'M4 5h16v14H4V5ZM8 9h8M8 13h5M8 16h3',
  },
  {
    title: 'Update the menu, not the paper.',
    body: 'Change prices, organise dishes and mark unavailable items from the dashboard. Publish updates to the digital menu.',
    role: 'For the menu manager',
    detail: 'Your menu stays easier to maintain.',
    icon: 'M4 5h10M4 10h7M4 15h5m4 3 7-7-3-3-7 7-1 4 4-1ZM16 9l3 3',
  },
  {
    title: 'Keep billed and paid separate.',
    body: 'Review the outstanding bill, then record cash, card or UPI at the counter after checking the payment.',
    role: 'For the counter',
    detail: 'An order placed is not a payment received.',
    icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 7h6M9 11h6M9 15h3',
  },
];

export function Home() {
  return (
    <div className="public-landing min-h-screen bg-ink text-cream antialiased">
      <SiteMotion />
      <div data-page-progress className="page-progress" aria-hidden="true" />
      <HomeNav />
      <SectionRail />
      <Hero />
      <Problem />
      <Steps />
      <ServiceLoop />
      <Screens />
      <Features />
      <Trust />
      <Honest />
      <Pricing />
      <Close />
    </div>
  );
}

/* ------------------------------------------------------------------ nav */

/* ----------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-ink" data-hero>
      {/* A light, airy restaurant interior behind the product shot. The
          overlay keeps the charcoal type legible while letting the room show
          through on the right, where the phone sits. */}
      <div className="absolute inset-0 -z-20" data-hero-image>
        <Image
          src="/img/restaurant-interior-light.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(105deg,rgba(251,250,247,0.90)_0%,rgba(251,250,247,0.73)_42%,rgba(251,250,247,0.24)_100%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_82%_18%,rgba(31,77,58,0.08),transparent_68%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 -z-10 bg-[radial-gradient(50%_40%_at_10%_90%,rgba(185,138,75,0.06),transparent_70%)]"
        aria-hidden="true"
      />

      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-28 lg:pt-24">
        <div className="relative" data-hero-body>
          <p
            className="inline-flex items-center gap-2.5 rounded-full border border-forest/15 bg-white/70 px-3.5 py-1.5 text-[10.5px] font-semibold tracking-[0.16em] text-forest uppercase shadow-[0_1px_0_rgba(255,255,255,0.9)_inset] backdrop-blur"
            data-hero-step
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-forest" />
            Restaurant technology
          </p>

          <h1 className="mt-7 text-balance text-[clamp(2.45rem,6.4vw,4.85rem)] font-medium leading-[0.96] tracking-[-0.045em] text-cream">
            <span className="block overflow-hidden">
              <span className="block" data-line>Every table,</span>
            </span>
            <span className="block overflow-hidden">
              <span className="block text-mute" data-line>
                one <em className="hero-accent font-display font-normal italic tracking-[-0.015em] text-forest">seamless</em>
              </span>
            </span>
            <span className="block overflow-hidden">
              <span className="block" data-line>experience<span className="text-brass">.</span></span>
            </span>
          </h1>

          <p className="mt-7 max-w-[46ch] text-pretty text-[15.5px] leading-[1.7] text-mute" data-hero-step>
            Scan the table card. Order on the phone. Keep the table and kitchen connected — with the
            menu, the pass and the bill in one calm place.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3" data-hero-step>
            <AuthHandoffLink
              href="/signup"
              className="group inline-flex h-12 items-center gap-2.5 rounded-full bg-forest px-6 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(31,77,58,0.55)] transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:bg-forest-strong hover:shadow-[0_16px_36px_-12px_rgba(31,77,58,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              Start the {TRIAL_DAYS}-day trial
              <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
            </AuthHandoffLink>
            <Link
              href="#how"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-gink-12 bg-white/65 px-6 text-[14px] text-cream backdrop-blur transition-[background-color,border-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-forest/25 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              See how it works
            </Link>
          </div>
          <p className="mt-4 text-[12px] text-mute-dim" data-hero-step>
            No card. Nothing charged during preview.
          </p>

          <div className="mt-11 hidden items-center gap-3 lg:flex" aria-hidden="true" data-hero-step>
            <span className="scroll-cue-line" />
            <span className="text-[9.5px] font-medium uppercase tracking-[0.24em] text-mute-dim">
              Scroll to explore
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[560px] lg:mx-0 lg:ml-auto" data-hero-step>
          <div data-hero-visual className="relative">
            <HeroVisualMotion className="relative">
              <div className="relative aspect-[10/14] w-full overflow-hidden rounded-[38px] border border-white/70 bg-[radial-gradient(120%_100%_at_72%_8%,#fffdf8_0%,#f6efe1_52%,#eee4d2_100%)] shadow-[0_36px_80px_-48px_rgba(31,77,58,0.35)] sm:aspect-[5/4.5] lg:aspect-[5/4.9]">
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[radial-gradient(60%_45%_at_18%_12%,rgba(31,77,58,0.07),transparent_62%)]"
                />
                <HeroTableScene />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#eee4d2]/70 to-transparent" aria-hidden="true" />

                <div className="absolute left-1/2 top-1/2 w-[258px] -translate-x-1/2 -translate-y-1/2 sm:left-auto sm:right-3 sm:w-[260px] sm:translate-x-0 sm:-translate-y-1/2">
                  <HeroMenuDemo />
                </div>
              </div>
            </HeroVisualMotion>

            <div
              aria-hidden="true"
              className="absolute -left-3 bottom-6 hidden items-center gap-2.5 rounded-2xl border border-white/80 bg-white/85 px-3.5 py-2.5 shadow-[0_14px_36px_-20px_rgba(31,77,58,0.35)] backdrop-blur sm:flex"
            >
              <span className="grid size-8 place-items-center rounded-full bg-forest-soft text-[13px] text-forest">✓</span>
              <span>
                <span className="block text-[11px] font-medium text-cream">Order sent to the kitchen</span>
                <span className="block text-[10px] text-mute-dim">Table 05 · no app to install</span>
              </span>
            </div>
          </div>

          <div className="mt-4 flex justify-center sm:justify-end">
            <p
              className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[10.5px] font-medium text-forest backdrop-blur"
              data-hero-step
            >
              Interactive preview · sample dishes and prices
            </p>
          </div>
        </div>
      </div>

      <div className="relative border-t border-ink-line">
        <ul className="mx-auto flex max-w-[1180px] flex-wrap gap-x-10 gap-y-4 px-5 py-6 sm:px-8" data-hero-step>
          {[
            ['Digital menu', 'For your customers'],
            ['Live kitchen orders', 'For your staff'],
            ['Simple setup', 'Minutes, not weeks'],
            ['Works for all', 'Cafés, casual & fine dining'],
          ].map(([title, sub]) => (
            <li key={title} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-[13px] leading-none text-forest">✓</span>
              <span>
                <span className="block text-[13px] font-medium text-cream">{title}</span>
                <span className="block text-[11.5px] text-mute-dim">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- problem */

/**
 * The problem, before the product.
 *
 * No numbers, no percentages, no "restaurants lose ₹X crore a year". Those
 * figures would be invented, and an owner who has run a room for ten years can
 * tell an invented one from a real one in a line. Three sentences about what
 * actually happens on a Friday night do the job better.
 */
function Problem() {
  const items = [
    {
      title: 'The menu is on paper',
      body: 'A price changes or a dish runs out — the printed menu is already wrong.',
      detail: 'A menu that cannot keep up.',
      icon: 'M6 3h9l3 3v15H6V3Zm8 0v5h4M9 12h6M9 16h4',
    },
    {
      title: 'Orders are carried, not sent',
      body: 'Table, pad, pass. Every hand-off can lose a number or a note.',
      detail: 'One more hand-off. One more chance to miss.',
      icon: 'M4 7h11m-3-3 3 3-3 3M20 17H9m3-3-3 3 3 3',
    },
    {
      title: 'The bill comes last',
      body: 'The guest waits, the server walks, the table sits finished.',
      detail: 'A good meal, followed by a wait.',
      icon: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    },
  ];

  return (
    <section
      id="why"
      aria-labelledby="problem-heading"
      className="border-t border-ink-line bg-ink py-16 text-cream sm:py-24 lg:py-28"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-16">
          <div className="lg:pt-4">
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
              <span className="h-px w-7 bg-brass" aria-hidden="true" />
              Why it exists
            </p>
            <h2
              id="problem-heading"
              className="mt-6 max-w-[18ch] text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.08] tracking-[-0.04em]"
              data-reveal
            >
              Service is not slow.{' '}
              <span className="text-forest">
                The <em className="font-display font-normal italic">hand-offs</em> are.
              </span>
            </h2>
            <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
            <p className="mt-5 max-w-[42ch] text-[15px] leading-[1.8] text-mute" data-reveal>
              A busy room has enough moving parts. Your menu, orders and bills shouldn’t add to them.
            </p>
            <div className="mt-8 max-w-[42ch] border-l-2 border-brass/50 pl-5" data-reveal>
              <p className="text-[14px] font-medium leading-relaxed text-forest">Less back-and-forth. More hospitality.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-mute">
                AutoDine sends orders from the table to the kitchen. Your staff still run the room.
              </p>
            </div>
          </div>

          <ol className="grid min-w-0 gap-4" data-stagger>
            {items.map((item, index) => (
              <li
                key={item.title}
                className="group relative rounded-2xl border border-ink-line bg-ink-card p-5 shadow-[0_4px_24px_rgba(28,27,24,0.025)] motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-forest/20 motion-safe:hover:shadow-[0_10px_34px_rgba(31,77,58,0.08)] sm:p-7"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-5 left-0 w-px scale-y-0 rounded-full bg-brass transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-y-100"
                />
                <div className="flex items-start gap-4 sm:gap-5">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-forest-soft text-forest ring-1 ring-forest/10 transition-colors duration-300 group-hover:bg-forest group-hover:text-white"
                    aria-hidden="true"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[16px] font-medium leading-snug tracking-[-0.02em] sm:text-[18px]">{item.title}</h3>
                      <span className="pt-0.5 font-display text-[13px] italic tabular-nums tracking-[0.04em] text-mute-dim" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{item.body}</p>
                    <p className="mt-4 border-t border-ink-line/70 pt-3 text-[11px] font-medium leading-relaxed text-forest">{item.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- steps */

function Steps() {
  return (
    <section id="how" aria-labelledby="how-heading" className="border-t border-ink-line bg-white py-16 text-cream sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:gap-16">
          <div>
            <p className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.2em] text-forest uppercase"><span aria-hidden="true" className="h-px w-7 bg-brass" />How it works</p>
            <h2 id="how-heading" className="mt-6 max-w-[19ch] text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.08] tracking-[-0.04em]" data-reveal>From the first scan<br /><span className="text-forest">to the <em className="font-display font-normal italic">final bill.</em></span></h2>
            <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
          </div>
          <p className="max-w-[39ch] text-[15px] leading-[1.8] text-mute" data-reveal>Three steps, with your team in control. No guest app to download — just a table card and a connected phone.</p>
        </div>

        <div className="relative mt-10 flex items-center justify-between gap-4 md:mt-14" aria-hidden="true">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Scan</span>
          <div className="relative h-px flex-1 overflow-hidden bg-forest/10"><span data-service-progress className="absolute inset-0 origin-left bg-gradient-to-r from-forest to-brass" /></div>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Serve · Settle</span>
        </div>
        <ol aria-label="Restaurant service in three steps" className="mt-6 grid gap-4 md:grid-cols-3 md:gap-5" data-service-flow>
          {STEPS.map(step => (
            <li key={step.n} data-service-step={step.n} className="group relative flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-ink-line bg-ink p-6 motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:border-forest/20 motion-safe:hover:shadow-[0_14px_34px_rgba(31,77,58,0.08)] sm:p-7">
              <span aria-hidden="true" className="pointer-events-none absolute right-4 top-2 font-display text-[64px] leading-none tracking-[-0.06em] text-forest/[0.07] select-none transition-colors duration-500 group-hover:text-forest/[0.12]">{step.n}</span>
              <div className="relative flex items-center justify-between gap-4 border-b border-ink-line pb-5">
                <span className="text-[10px] font-semibold tracking-[0.14em] text-forest">STEP {step.n}</span>
                <p className="text-right text-[10px] font-medium tracking-[0.08em] text-mute uppercase">{step.role}</p>
              </div>
              <span data-service-icon className="relative mt-6 grid size-12 place-items-center rounded-xl border border-forest/10 bg-forest-soft text-forest transition-colors duration-300 group-hover:border-brass/40 group-hover:bg-forest group-hover:text-white" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={step.icon} /></svg></span>
              <h3 className="mt-6 text-[22px] font-medium leading-snug tracking-[-0.035em]">{step.title}</h3>
              <p className="mt-3 flex-1 text-[14px] leading-[1.8] text-mute">{step.body}</p>
              <p className="mt-7 flex items-start gap-2 border-t border-ink-line pt-4 text-[11px] font-medium leading-relaxed text-forest"><span aria-hidden="true" className="mt-[6px] size-1 shrink-0 rounded-full bg-brass" />{step.outcome}</p>
            </li>
          ))}
        </ol>
        <div className="group mt-6 flex flex-col items-start justify-between gap-5 rounded-2xl border border-ink-line bg-ink px-5 py-5 transition-colors duration-300 hover:border-forest/20 sm:px-6 lg:flex-row lg:items-center">
          <div><p className="text-[12px] font-medium text-cream">What you need to get started</p><p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-mute">Printed table cards, internet access for guests, and a compatible browser on a staff laptop or tablet.</p></div>
          <Link href="/#screens" className="inline-flex min-h-11 shrink-0 items-center gap-3 rounded-full px-2 text-[13px] font-medium text-forest hover:text-forest-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">See the screens <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">↗</span></Link>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- the loop */

/**
 * One order, passed hand to hand.
 *
 * On a desktop the stage pins and one ticket travels from the table, to the
 * pass, to the counter while the page scrolls. That pin is decoration: the
 * same three stations and the same ticket read in order on a phone, without
 * JavaScript, or with reduced motion -- SiteMotion only adds `is-live` at
 * 1024px and above, so nothing essential is ever hidden by the effect.
 */
function ServiceLoop() {
  return (
    <section
      aria-labelledby="loop-heading"
      data-rail-tone="dark"
      className="relative overflow-x-clip border-t border-forest-strong/40 bg-forest py-16 text-white sm:py-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(85%_60%_at_88%_0%,rgba(185,138,75,0.16),transparent_62%)]"
      />
      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:gap-16">
          <div>
            <p className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.2em] text-white/70 uppercase">
              <span aria-hidden="true" className="h-px w-7 bg-brass" />
              One order, end to end
            </p>
            <h2
              id="loop-heading"
              className="mt-6 max-w-[20ch] text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.08] tracking-[-0.04em]"
              data-reveal
            >
              A ticket, passed{' '}
              <em className="font-display font-normal italic text-brass">hand to hand.</em>
            </h2>
          </div>
          <p className="max-w-[40ch] text-[15px] leading-[1.8] text-white/65" data-reveal>
            One illustrative order — AD-1042, Table 05 — from the first scan to the moment the counter
            records payment.
          </p>
        </div>

        <div data-loop className="loop relative mt-12 sm:mt-16">
          <div data-loop-stage className="loop-stage">
            <div className="w-full">
              <p className="text-[10px] font-medium tracking-[0.18em] text-white/45 uppercase">
                Illustrative order · AD-1042
              </p>

              <div className="relative mt-6">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-8 top-[92px] hidden h-px bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.24)_0_6px,transparent_6px_14px)] lg:block"
                />
                <div
                  data-loop-ticket
                  aria-hidden="true"
                  className="loop-ticket relative z-10 mx-auto mb-6 w-[290px] max-w-full rounded-2xl bg-ink px-5 py-4 text-cream shadow-[0_24px_50px_-30px_rgba(0,0,0,0.55)] select-none"
                >
                  <span
                    aria-hidden="true"
                    className="absolute -top-2 left-1/2 h-4 w-16 -translate-x-1/2 rounded-full bg-brass/80"
                  />
                  <div className="flex items-center justify-between text-[10px] font-medium tracking-[0.14em] text-mute uppercase">
                    <span>AD-1042</span>
                    <span>Table 05</span>
                  </div>
                  <div className="mt-3 border-y border-dashed border-ink-line py-2.5 text-[12.5px] leading-relaxed">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>Paneer tikka</span>
                      <span className="tnum text-mute">×1</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <span>Butter chicken</span>
                      <span className="tnum text-mute">×1</span>
                    </div>
                  </div>
                  <p className="mt-2.5 text-[11px] italic text-mute">“Less spicy, please.”</p>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-[10px] font-medium tracking-[0.14em] text-mute uppercase">
                      2 dishes
                    </span>
                    <span className="font-display text-[20px] italic tnum text-forest">₹600</span>
                  </div>
                </div>

                <div className="loop-grid grid gap-4 md:grid-cols-3 md:gap-5">
                  {LOOP_STATIONS.map((station) => (
                    <article
                      key={station.n}
                      data-loop-station
                      className="loop-station relative flex flex-col overflow-hidden rounded-[22px] border border-white/12 bg-white/[0.045] p-6"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-2 right-5 font-display text-[56px] leading-none tracking-[-0.06em] text-white/[0.08] italic select-none"
                      >
                        {station.n}
                      </span>
                      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-1">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-brass" />
                        <span className="text-[10.5px] font-medium tracking-[0.12em] text-white/85 uppercase">
                          {station.status}
                        </span>
                      </span>
                      <h3 className="mt-6 text-[20px] font-medium tracking-[-0.03em]">{station.role}</h3>
                      <p className="mt-2.5 flex-1 text-[13.5px] leading-[1.75] text-white/65">{station.body}</p>
                      <p className="mt-6 border-t border-white/10 pt-3.5 text-[11px] font-medium text-white/55">
                        {station.detail}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- screens */

function Screens() {
  const panels = [
    { kicker: 'Guest menu', title: 'Browse the menu', body: 'Photos, prices and dish details, together on the guest’s phone.' },
    { kicker: 'Kitchen board', title: 'Follow the ticket', body: 'Keep table numbers, dishes and guest notes together. Staff update the ticket as preparation moves forward.' },
    { kicker: 'Counter bill', title: 'Review, then record', body: 'See what is billed, what is recorded as paid and what is still outstanding. Staff verify payment before recording it.' },
  ];
  return (
    <section id="screens" aria-labelledby="screens-heading" className="border-t border-ink-line bg-ink py-16 text-cream sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
          <span className="h-px w-7 bg-brass" aria-hidden="true" />A closer look
        </p>
        <h2 id="screens-heading" className="mt-5 max-w-[20ch] text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.08] tracking-[-0.04em]" data-reveal>
          Three screens, in <em className="font-display font-normal italic text-forest">service order.</em>
        </h2>
        <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-mute" data-reveal>One order, seen from the table, the pass and the counter. A focused view for each part of service.</p>
        <p className="mt-3 text-[12px] text-mute-dim">Illustrative product previews · sample dishes and tickets</p>

        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-3" data-screen-gallery>
          {panels.map((panel, index) => (
            <article key={panel.title} data-screen-card data-tour-panel className={`group flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-ink-line bg-ink-card shadow-[0_6px_28px_rgba(28,27,24,0.03)] motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:border-forest/20 motion-safe:hover:shadow-[0_16px_40px_rgba(31,77,58,0.1)] ${index === 1 ? 'md:mt-8' : ''}`}>
              <div className="relative overflow-hidden border-b border-ink-line bg-forest-soft/60 px-5 pt-6 sm:px-7" aria-hidden="true">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                <p className="relative mb-4 flex items-center justify-between text-[9px] font-medium tracking-[0.1em] text-forest uppercase"><span>{panel.kicker}</span><span>Illustration</span></p>
                <div data-screen-frame className="relative mx-auto min-h-[330px] max-w-[280px] rounded-t-2xl border border-ink-line bg-ink-card p-4 shadow-[0_6px_24px_rgba(31,77,58,0.06)]">
                  <div className="flex items-center justify-between border-b border-ink-line pb-3 text-[10px] text-mute">
                    <span className="font-semibold text-forest">AutoDine</span><span>{index === 1 ? 'Kitchen' : 'Table 05'}</span>
                  </div>
                  {index === 0 ? (
                    <>
                      <p className="mt-4 text-[17px] font-medium tracking-tight">Something delicious.</p>
                      <p className="mt-1 text-[10px] text-mute">Fresh picks from our kitchen</p>
                      <div className="mt-3 flex gap-2 text-[9px]"><span className="rounded-full bg-forest px-3 py-1 text-white">Popular</span><span className="rounded-full bg-ink px-3 py-1 text-mute">Mains</span></div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {[{ name: 'Paneer tikka', price: 260, image: 'paneer-tikka' }, { name: 'Butter chicken', price: 340, image: 'butter-chicken' }].map(dish => (
                          <div key={dish.name} className="overflow-hidden rounded-lg border border-ink-line">
                            <div className="relative h-20"><Image src={`/img/dishes/${dish.image}.jpg`} alt="" fill sizes="140px" className="object-cover" /></div>
                            <div className="p-2"><p className="text-[10px] font-medium">{dish.name}</p><p className="mt-1 text-[10px] text-forest">₹{dish.price}</p></div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : index === 1 ? (
                    <>
                      <div className="mt-4 flex items-center justify-between"><p className="text-[17px] font-medium tracking-tight">On the pass</p><span className="text-[9px] text-mute">2 tickets</span></div>
                      {[{ code: 'AD-1042', table: 'Table 05', state: 'New', dish: '1 × Paneer tikka', note: 'Less spicy, please.' }, { code: 'AD-1041', table: 'Table 03', state: 'Preparing', dish: '2 × Butter naan', note: 'No additional notes' }].map(ticket => (
                        <div key={ticket.code} className="mt-3 rounded-xl border border-ink-line border-l-[3px] border-l-forest bg-ink p-3">
                          <div className="flex justify-between gap-2 text-[10px] font-medium"><span>{ticket.table}</span><span className="rounded-full bg-forest-soft px-2 py-0.5 text-forest">{ticket.state}</span></div>
                          <p className="mt-2 text-[11px] font-medium">{ticket.dish}</p><p className="mt-1 text-[10px] text-mute">{ticket.note}</p>
                          <p className="mt-2 text-[8px] tracking-wider text-mute">{ticket.code}</p>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="mt-4 text-[17px] font-medium tracking-tight">At the counter</p>
                      <div className="mt-3 flex items-center justify-between text-[9px] text-mute"><span>AD-1042 · Table 05</span><span>Unpaid</span></div>
                      <div className="mt-4 flex justify-between gap-2 border-y border-ink-line py-3 text-[10px]"><span>1 × Paneer tikka</span><span>₹260</span></div>
                      <div className="mt-4 space-y-2 text-[10px]">
                        <div className="flex justify-between"><span className="text-mute">Bill total</span><span>₹260</span></div>
                        <div className="flex justify-between"><span className="text-mute">Recorded as paid</span><span>₹0</span></div>
                        <div className="flex justify-between border-t border-ink-line pt-3 font-medium text-forest"><span>Outstanding</span><span>₹260</span></div>
                      </div>
                      <div className="mt-4 rounded-lg bg-forest-soft px-3 py-2.5 text-[9px] leading-relaxed text-forest">Cash, card or UPI at the counter.<br />Payment is checked and recorded by staff.</div>
                    </>

                  )}
                </div>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-forest">{String(index + 1).padStart(2, '0')} / {panel.kicker}</p>
                <h3 className="mt-3 text-[19px] font-medium tracking-tight">{panel.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-mute">{panel.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="group relative mt-8 flex flex-col items-start justify-between gap-5 overflow-hidden rounded-2xl border border-ink-line bg-white p-6 transition-colors duration-300 hover:border-forest/20 sm:flex-row sm:items-center">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-brass" />
          <p className="max-w-[45ch] text-[14px] leading-relaxed text-mute">Your staff stay in control. Sending an order does not automatically mark its bill as paid.</p>
          <AuthHandoffLink href="/signup" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 rounded-full bg-forest px-6 py-3 text-[13px] font-medium text-white shadow-[0_10px_26px_-16px_rgba(31,77,58,0.6)] motion-safe:transition-[transform,background-color] motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:bg-forest-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Set up your restaurant <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">↗</span></AuthHandoffLink>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- features */

function Features() {
  return (
    <section id="product" aria-labelledby="features-heading" className="border-t border-ink-line bg-ink py-16 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div data-draw aria-hidden="true" className="mb-10 h-px origin-left bg-gradient-to-r from-forest/40 via-brass/40 to-transparent" />
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-16">
          <div className="min-w-0 lg:pt-3">
            <p className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.2em] text-forest uppercase"><span aria-hidden="true" className="h-px w-7 bg-brass" />Built around service</p>
            <h2 id="features-heading" className="mt-6 max-w-[16ch] text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.08] tracking-[-0.04em]" data-reveal>
              Less to pass around.<br /><span className="text-forest">More time for the <em className="font-display font-normal italic">room.</em></span>
            </h2>
            <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
            <p className="mt-5 max-w-[39ch] text-[15px] leading-[1.8] text-mute" data-reveal>
              A clear place for the menu, the kitchen ticket and the bill. Your team still does what matters most: look after the guest.
            </p>
            <div className="mt-7 max-w-[39ch] border-l-2 border-brass/50 pl-5" data-reveal>
              <p className="text-[13px] leading-relaxed text-mute">Guests order on their phone. Staff prepare, serve and record payment. Each step has its own place.</p>
            </div>
            <Link href="/#screens" className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full border border-forest/20 px-5 text-[13px] font-medium text-forest hover:bg-forest-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Explore the screens <span aria-hidden="true">↗</span></Link>
            <ProductScene />
          </div>

          <ul className="grid min-w-0 gap-4 sm:grid-cols-2" data-stagger>
            {FEATURES.map(feature => (
              <li key={feature.role} data-product-benefit className="group relative min-w-0 overflow-hidden rounded-[20px] border border-ink-line bg-ink-card p-6 shadow-[0_4px_24px_rgba(28,27,24,0.025)] motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:border-forest/20 motion-safe:hover:shadow-[0_14px_36px_rgba(31,77,58,0.09)]">
                <span aria-hidden="true" className="absolute left-6 top-0 h-px w-12 origin-left scale-x-0 bg-brass transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-forest-soft text-forest ring-1 ring-forest/10 transition-colors duration-300 group-hover:bg-forest group-hover:text-white" aria-hidden="true"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={feature.icon} /></svg></span>
                  <p className="text-right text-[10px] font-medium tracking-[0.08em] text-mute uppercase">{feature.role}</p>
                </div>
                <h3 className="mt-5 text-[18px] font-medium leading-snug tracking-[-0.025em]">{feature.title}</h3>
                <p className="mt-3 text-[13px] leading-[1.75] text-mute">{feature.body}</p>
                <p className="mt-5 border-t border-ink-line pt-4 text-[11px] font-medium leading-relaxed text-forest">{feature.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- trust */

/**
 * Built for the counter.
 *
 * The four things an owner actually worries about behind the till -- who takes
 * the money, who can see the rows, how amounts are stored, and what a guest
 * has to hand over. Every line here is enforced in the product (or stated in
 * the privacy note); none of it is a badge, a percentage or a certification.
 */
const TRUST_POINTS = [
  {
    n: '01',
    title: 'Payment ends at the counter.',
    body: 'Nothing is charged online. Staff check the bill against what was served, then record the payment.',
  },
  {
    n: '02',
    title: 'One restaurant per row.',
    body: 'Row-level security is enforced by the database, not just the screens — another restaurant’s rows are refused, even to a hand-made request.',
  },
  {
    n: '03',
    title: 'Amounts stay whole.',
    body: 'Order and bill amounts are stored as whole paise, not floating-point numbers, so totals do not drift.',
  },
  {
    n: '04',
    title: 'No guest accounts.',
    body: 'A guest needs a table, a menu and a phone — no sign-up, no card details and no marketing list.',
  },
];

function Trust() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-heading"
      data-rail-tone="dark"
      className="relative overflow-x-clip border-t border-forest-strong/40 bg-forest py-14 text-white sm:py-20"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_12%_0%,rgba(185,138,75,0.14),transparent_60%)]"
      />
      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:gap-16">
          <div>
            <p className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.2em] text-white/70 uppercase">
              <span aria-hidden="true" className="h-px w-7 bg-brass" />
              Built for the counter
            </p>
            <h2
              id="trust-heading"
              className="mt-5 max-w-[22ch] text-balance text-[clamp(1.8rem,3.4vw,2.6rem)] font-medium leading-[1.08] tracking-[-0.04em]"
              data-reveal
            >
              The unglamorous parts,{' '}
              <em className="font-display font-normal italic text-brass">handled.</em>
            </h2>
          </div>
          <div className="max-w-[40ch]">
            <p className="text-[15px] leading-[1.8] text-white/65" data-reveal>
              Money, data and the bill are the quiet parts of service. They are also the parts that
              should never be improvised.
            </p>
            <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/55">
              <span>How guest data is handled:</span>
              <Link
                href="/privacy"
                className="font-medium text-white/80 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Privacy note
              </Link>
              <Link
                href="/terms"
                className="font-medium text-white/80 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Terms
              </Link>
            </p>
          </div>
        </div>

        <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:mt-12 lg:grid-cols-4">
          {TRUST_POINTS.map((point) => (
            <li key={point.n} data-trust-point className="border-t border-white/15 pt-5">
              <span aria-hidden="true" className="font-display text-[13px] italic text-brass/90">
                {point.n}
              </span>
              <h3 className="mt-3 text-[16px] font-medium leading-snug tracking-[-0.02em]">{point.title}</h3>
              <p className="mt-2 text-[13px] leading-[1.7] text-white/65">{point.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- honest */

/** Keep the preview boundary visible without presenting an internal release log. */
function Honest() {
  return (
    <section id="status" aria-labelledby="status-heading" className="border-t border-ink-line bg-ink py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div data-draw aria-hidden="true" className="mb-10 h-px origin-left bg-gradient-to-r from-forest/40 via-brass/40 to-transparent" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Before you start</p>
        <h2 id="status-heading" className="mt-5 max-w-[22ch] text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.06] tracking-[-0.04em]" data-reveal>A clear picture.<br /><span className="text-forest">No <em className="font-display font-normal italic">surprises.</em></span></h2>
        <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-mute" data-reveal>AutoDine is a product preview. Explore the ordering workflow, and know what is not connected before you begin.</p>
        <div className="mt-10 grid gap-5 md:grid-cols-2" data-stagger>
          <div className="group rounded-[22px] border border-forest/20 bg-white p-6 transition-colors duration-300 hover:border-forest/35 sm:p-8">
            <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-forest"><span aria-hidden="true" className="size-1.5 rounded-full bg-forest" />Explore the workflow</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {LIVE.map(item => <li key={item.id} className="flex items-start gap-3 text-[14px] leading-relaxed"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-forest" />{item.label}</li>)}
            </ul>
            <p className="mt-6 border-t border-ink-line pt-4 text-[12px] leading-relaxed text-mute">Sample content demonstrates the product. This preview is not a certification for live restaurant operations.</p>
          </div>
          <div className="rounded-[22px] border border-ink-line bg-white p-6 transition-colors duration-300 hover:border-brass/30 sm:p-8">
            <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mute"><span aria-hidden="true" className="size-1.5 rounded-full bg-brass/70" />Not connected</p>
            <ul className="mt-5 space-y-4">
              {NOT_CONNECTED.map(item => <li key={item.id} className="flex gap-3 text-[13px] leading-relaxed text-mute"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-mute-dim" /><span><span className="font-medium text-cream">{item.label}</span><br />{item.id === 'payments' ? 'Guests pay at the counter. Staff check and record payment; AutoDine does not collect it online.' : item.id === 'billing' ? `Plans are not on sale. After the ${TRIAL_DAYS}-day trial, access becomes read-only until extended.` : 'No SMS or WhatsApp receipts or reminders are sent.'}</span></li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- pricing */

function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="border-t border-ink-line bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
          <span className="h-px w-7 bg-brass" aria-hidden="true" />Simple pricing
        </p>
        <h2 id="pricing-heading" className="mt-5 text-balance text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.04] tracking-[-0.04em]" data-reveal>
          Start with what you <em className="font-display font-normal italic text-forest">need.</em>
        </h2>
        <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
        <p className="mt-4 max-w-[52ch] text-[15px] leading-[1.6] text-mute" data-reveal>
          Three sizes. {TRIAL_DAYS} free days. No card to begin.
        </p>

        <div className="mt-12 grid gap-5 lg:grid-cols-3" data-pricing-grid>
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              data-pricing-card
              className="public-card relative flex min-w-0 flex-col rounded-2xl border border-ink-line bg-ink-card p-6 transition-[border-color,box-shadow] duration-300 hover:border-forest/20 sm:p-7"
            >
              <h3 className="font-display text-[19px] font-normal italic tracking-[-0.01em]">{plan.name}</h3>
              <p className="mt-1.5 min-h-[40px] max-w-[24ch] text-[12.5px] leading-relaxed text-mute">{plan.fit}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="tnum text-[44px] font-medium leading-none tracking-[-0.055em]">
                  {inr(plan.price)}
                </span>
                <span className="text-[12px] text-mute-dim">/month · planned</span>
              </p>

              <ul className="mt-6 space-y-2.5 text-[13px] text-mute">
                {capabilitiesFor(plan.id).map((capability) => (
                  <li key={capability.id} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest" aria-hidden="true" />
                    {capability.label}
                  </li>
                ))}
              </ul>

              <Link
                href={`/pricing#plan-${plan.id}`}
                className={`mt-7 inline-flex h-11 items-center justify-center rounded-full text-[13px] font-medium transition-colors duration-300 ${
                  plan.recommended
                    ? 'bg-forest text-white hover:bg-forest-strong'
                    : 'border border-forest/25 text-forest hover:bg-forest-soft'
                }`}
              >
                See {plan.name}
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-8 text-[12.5px] leading-relaxed text-mute-dim">
          Plans are not on sale yet: nothing can be bought on this site, and no card is taken. The
          trial lasts {TRIAL_DAYS} days — after it ends the workspace is
          read-only until access is extended, and nothing is deleted.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- close */

function Close() {
  return (
    <footer className="border-t border-ink-line bg-ink" aria-labelledby="close-heading">
      <div className="relative isolate overflow-hidden" data-close>
        <Image
          src="/img/restaurant-interior-light.jpg"
          alt=""
          fill
          sizes="100vw"
          className="-z-20 object-cover opacity-35"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink via-ink/85 to-ink" aria-hidden="true" />

        <div className="mx-auto max-w-[1180px] px-5 py-24 text-center sm:px-8">
          <h2 id="close-heading" data-reveal className="mx-auto max-w-[22ch] text-balance text-[clamp(2rem,4.4vw,3.2rem)] font-medium leading-[1.02] tracking-[-0.045em]">
            Give your next service a <em className="font-display font-normal italic text-forest">clearer flow.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[14.5px] leading-relaxed text-mute" data-reveal>
            A calmer service starts with a connected menu, kitchen and counter.
          </p>
          <p className="mt-4 text-[12px] leading-relaxed text-mute" data-reveal>Product preview · No paid subscription is activated at signup.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3" data-reveal>
            <AuthHandoffLink
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-forest px-7 text-[14px] font-medium text-white transition-colors hover:bg-forest-strong"
            >
              Start your {TRIAL_DAYS}-day trial <span aria-hidden="true">→</span>
            </AuthHandoffLink>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center rounded-full border border-forest/20 px-7 text-[14px] text-forest transition-colors hover:bg-forest-soft"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-ink-line">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <BrandLockup size={20} ink="currentColor" dot={BRAND_GREEN} />
            <p className="mt-3 max-w-[42ch] text-[12.5px] leading-relaxed text-mute-dim">
              QR menu, kitchen board, counter — one system.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-[12.5px] text-mute">
            <Link href="/#status" className="transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Preview details</Link>
            <Link href="/pricing" className="transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Pricing</Link>
            <Link href="/login" className="transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Sign in</Link>
            <AuthHandoffLink href="/signup" className="transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Create account</AuthHandoffLink>
            <Link href="/privacy" className="transition-colors hover:text-forest">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-forest">Terms</Link>
          </nav>
        </div>
      </div>
      <div className="overflow-hidden border-t border-ink-line px-5 pt-6" aria-hidden="true">
        <p
          className="select-none bg-gradient-to-b from-forest/30 via-forest/10 to-forest/0 bg-clip-text text-center text-[clamp(3.4rem,15vw,12rem)] font-medium leading-[0.82] tracking-[-0.07em] text-transparent [mask-image:linear-gradient(to_bottom,black_35%,transparent_100%)]"
          data-reveal
        >
          AutoDine
        </p>
      </div>
    </footer>
  );
}
