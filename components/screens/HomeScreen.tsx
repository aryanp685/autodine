import Image from 'next/image';
import Link from 'next/link';
import { LIVE, NOT_CONNECTED, PLANS, capabilitiesFor } from '@/lib/plans';
import { inr } from '@/lib/demo-data';
import { ProductScene } from '@/components/ProductScene';
import { SiteMotion } from '@/components/SiteMotion';
import { SectionRail } from '@/components/marketing/SectionRail';
import { HomeNav } from '@/components/HomeNav';
import { BrandLockup } from '@/components/BrandMark';
import { HeroMenuDemo } from '@/components/marketing/HeroMenuDemo';
import { HeroVisualMotion } from '@/components/marketing/HeroVisualMotion';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { CornerGarden, LeafFrond, Sprig } from '@/components/marketing/Botanical';
import { TRIAL_DAYS } from '@/lib/trial';

/**
 * The landing page.
 *
 * REBUILT IN TAILWIND
 *
 * The public surface follows the owner's reference sheet: cream paper, deep
 * forest panels, one burnt-saffron action colour, a soft serif display face
 * and olive botanical line work. The palette lives in one place
 * (`app/globals.css`, `.public-landing`) so a colour can never drift between
 * sections; this file only composes with those tokens.
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
 * nothing here depends on JavaScript to be readable. The botanical sway and
 * the phone drift are CSS-only and opt in through the same media query.
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

/* -------------------------------------------------------------- pieces */

function Eyebrow({ children, tone = 'dark' }: { children: string; tone?: 'dark' | 'light' }) {
  return (
    <p
      className={`flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] ${
        tone === 'dark' ? 'text-forest' : 'text-white'
      }`}
    >
      <span aria-hidden="true" className="h-px w-8 bg-brass" />
      {children}
    </p>
  );
}

function Tick({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${
        tone === 'dark' ? 'bg-forest-soft text-forest' : 'bg-white/12 text-brass-soft'
      }`}
    >
      <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m2.5 6.2 2.3 2.3 4.7-5" />
      </svg>
    </span>
  );
}

export function Home() {
  return (
    <div className="public-landing min-h-screen overflow-x-clip bg-ink text-cream antialiased">
      <SiteMotion />
      <div data-page-progress className="page-progress" aria-hidden="true" />
      <HomeNav glass />
      <SectionRail />
      <main>
        <Hero />
        <Problem />
        <Steps />
        <ServiceLoop />
        <Screens />
        <Features />
        <Trust />
        <Honest />
        <Pricing />
      </main>
      <Close />
    </div>
  );
}

/* ----------------------------------------------------------------- hero */

function Hero() {
  return (
    <section
      data-hero
      aria-labelledby="hero-heading"
      className="relative isolate -mt-[74px] overflow-hidden border-b border-ink-line"
    >
      {/* Reference hero: the dining-room photo runs edge-to-edge over the
          whole section, warmed into the cream paper on the left. On top: a
          deep-forest arc on the right, content on the left. */}
      <div className="pointer-events-none absolute inset-0 -z-20">
        <Image
          src="/img/restaurant-interior-light.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[68%_50%]"
        />
        {/* Warm the photo into the cream paper: strong on the left where the
            text sits, clearing to the photo on the right. */}
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(250,245,236,0.96)_0%,rgba(250,245,236,0.82)_34%,rgba(250,245,236,0.38)_58%,rgba(250,245,236,0.12)_100%)]" />
        {/* Soft light wash so the text contrast holds over the busy parts. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(250,245,236,0.55)_0%,rgba(250,245,236,0)_30%,rgba(250,245,236,0)_72%,rgba(250,245,236,0.5)_100%)]" />
      </div>

      <CornerGarden className="right-6 top-24 hidden lg:block" tone="text-forest" />

      <div className="relative mx-auto grid max-w-[1180px] gap-12 px-5 pb-16 pt-24 sm:px-8 sm:pt-28 lg:grid-cols-[1fr_0.92fr] lg:items-center lg:gap-8 lg:pb-20 lg:pt-32">
        <div className="relative z-10 max-w-[36rem]">
          <p
            className="inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-forest/70"
            data-hero-step
          >
            Restaurant technology
            <span aria-hidden="true" className="h-px w-10 bg-forest/30" />
          </p>

          <h1
            id="hero-heading"
            className="display mt-7 text-[clamp(2.75rem,6.4vw,5.05rem)] leading-[1.02]"
          >
            <span className="block overflow-hidden pb-[0.06em]"><span className="block" data-line>Every table,</span></span>
            <span className="block overflow-hidden pb-[0.06em]"><span className="block" data-line>one seamless</span></span>
            <span className="block overflow-hidden pb-[0.08em]"><span className="block text-brass" data-line>experience.</span></span>
          </h1>

          <p className="mt-7 max-w-[42ch] text-pretty text-[15.5px] leading-[1.75] text-mute" data-hero-step>
            Scan the table card. Order on the phone. Keep the table and the kitchen connected — and
            let your team look after the room.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center" data-hero-step>
            <AuthHandoffLink
              href="/signup"
              className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-brass px-7 text-[14px] font-bold text-cream shadow-[0_8px_16px_rgba(244,123,41,0.3)] transition-[background-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              Start your {TRIAL_DAYS}-day trial
              <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
            </AuthHandoffLink>
            <Link
              href="/#how"
              className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-full border border-forest/20 bg-ink-card/70 px-6 text-[14px] font-medium text-forest backdrop-blur-sm transition-colors duration-300 hover:border-forest/35 hover:bg-ink-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
            >
              <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-forest text-white transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">
                <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6h7M6 2.5 9.5 6 6 9.5" /></svg>
              </span>
              See how it works
            </Link>
          </div>

          <p className="mt-5 text-[12px] leading-relaxed text-mute-dim" data-hero-step>
            No card to begin · Nothing is charged online · Guests never need an app
          </p>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[520px] lg:mx-0 lg:ml-auto" data-hero-step>
          <div data-hero-visual className="relative">
            <HeroVisualMotion className="relative">
              {/* The phone floats directly over the full-bleed photo, no card
                  behind it — the framed card is a small-screen-only stage. */}
              <div className="relative hidden sm:block sm:w-[300px] lg:ml-auto lg:mr-6 lg:w-[320px] xl:mr-16">
                <HeroMenuDemo />
              </div>

              {/* Small screens keep the framed card so the phone still has a
                  stage. */}
              <div className="hero-halo relative isolate aspect-[10/14] w-full overflow-hidden rounded-[42px] border border-white/70 bg-[radial-gradient(120%_100%_at_72%_8%,#fffdf8_0%,#f7efe0_52%,#ecdfc9_100%)] shadow-[0_40px_90px_-52px_rgba(28,59,43,0.45)] sm:hidden">
                {/* Reference hero: real dining-room photo bleeding into the
                    paper, deep-forest arc on the right, phone floating over
                    both. Photo is from the signature frontend's own asset. */}
                <div
                  aria-hidden="true"
                  className="absolute -inset-x-6 -top-10 bottom-0 rounded-[45%_0_0_0] bg-[linear-gradient(90deg,rgba(251,245,236,0.92)_0%,rgba(251,245,236,0.35)_55%,rgba(251,245,236,0.05)_100%)]"
                />
                <div
                  aria-hidden="true"
                  className="absolute -right-24 -top-28 h-[130%] w-[86%] rotate-[25deg] rounded-[50%] bg-forest shadow-[0_30px_70px_-40px_rgba(16,53,45,0.8)]"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[radial-gradient(60%_45%_at_18%_12%,rgba(28,59,43,0.08),transparent_62%)]"
                />
                <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#e9dcc4]/80 to-transparent" aria-hidden="true" />

                <div className="absolute left-1/2 top-1/2 w-[276px] -translate-x-1/2 -translate-y-1/2 sm:left-auto sm:right-2 sm:w-[284px] sm:translate-x-0 sm:-translate-y-1/2">
                  <HeroMenuDemo />
                </div>

                <Sprig className="pointer-events-none absolute -right-2 -top-2 h-32 w-auto rotate-[132deg] text-forest opacity-25" weight={1.2} />
                <Sprig className="pointer-events-none absolute -bottom-6 -left-3 h-36 w-auto rotate-[8deg] text-forest opacity-20" weight={1.2} />

                <div
                  aria-hidden="true"
                  className="absolute bottom-5 right-4 flex items-center gap-2 rounded-xl border border-white/80 bg-white/95 px-2.5 py-2 shadow-[0_16px_34px_-20px_rgba(28,59,43,0.55)] sm:-right-4 sm:-bottom-4"
                >
                  <svg viewBox="0 0 24 24" className="size-9" role="img">
                    <g fill="#17483d">
                      <rect x="1" y="1" width="7" height="7" rx="1" fillOpacity="0.12" />
                      <rect x="3" y="3" width="3" height="3" />
                      <rect x="16" y="1" width="7" height="7" rx="1" fillOpacity="0.12" />
                      <rect x="18" y="3" width="3" height="3" />
                      <rect x="1" y="16" width="7" height="7" rx="1" fillOpacity="0.12" />
                      <rect x="3" y="18" width="3" height="3" />
                      <rect x="11" y="2" width="2" height="2" />
                      <rect x="12" y="6" width="2" height="2" />
                      <rect x="10" y="11" width="3" height="3" />
                      <rect x="15" y="12" width="2" height="2" />
                      <rect x="18" y="15" width="2" height="2" />
                      <rect x="20" y="19" width="3" height="3" />
                      <rect x="12" y="17" width="2" height="2" />
                      <rect x="16" y="20" width="2" height="2" />
                      <rect x="10" y="20" width="1.5" height="3" />
                    </g>
                  </svg>
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-forest">Table 05</span>
                </div>
              </div>
            </HeroVisualMotion>

            {/* Reference-style floating "Order sent" toast + QR chip, over
                the full-bleed photo on large screens. */}
            <div
              aria-hidden="true"
              className="absolute -left-3 bottom-6 hidden items-center gap-2.5 rounded-2xl border border-white/80 bg-ink-card/90 px-3.5 py-2.5 shadow-[0_18px_40px_-24px_rgba(28,59,43,0.45)] backdrop-blur sm:flex"
            >
              <span className="grid size-8 place-items-center rounded-full bg-forest-soft text-[13px] text-forest">✓</span>
              <span>
                <span className="block text-[11px] font-medium text-cream">Order sent to the kitchen</span>
                <span className="block text-[10px] text-mute-dim">Table 05 · no app to install</span>
              </span>
            </div>

            <div
              aria-hidden="true"
              className="absolute bottom-8 right-4 hidden items-center gap-2 rounded-xl border border-white/80 bg-white/95 px-2.5 py-2 shadow-[0_16px_34px_-20px_rgba(28,59,43,0.55)] backdrop-blur lg:flex xl:right-16"
            >
              <svg viewBox="0 0 24 24" className="size-9" role="img">
                <g fill="#17483d">
                  <rect x="1" y="1" width="7" height="7" rx="1" fillOpacity="0.12" />
                  <rect x="3" y="3" width="3" height="3" />
                  <rect x="16" y="1" width="7" height="7" rx="1" fillOpacity="0.12" />
                  <rect x="18" y="3" width="3" height="3" />
                  <rect x="1" y="16" width="7" height="7" rx="1" fillOpacity="0.12" />
                  <rect x="3" y="18" width="3" height="3" />
                  <rect x="11" y="2" width="2" height="2" />
                  <rect x="12" y="6" width="2" height="2" />
                  <rect x="10" y="11" width="3" height="3" />
                  <rect x="15" y="12" width="2" height="2" />
                  <rect x="18" y="15" width="2" height="2" />
                  <rect x="20" y="19" width="3" height="3" />
                  <rect x="12" y="17" width="2" height="2" />
                  <rect x="16" y="20" width="2" height="2" />
                  <rect x="10" y="20" width="1.5" height="3" />
                </g>
              </svg>
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-forest">Table 05</span>
            </div>

            <div
              aria-hidden="true"
              className="absolute -bottom-10 -left-12 -z-10 size-[220px] rounded-full bg-brass/15"
            />
          </div>

          <div className="mt-4 flex justify-center sm:justify-end">
            <p className="rounded-full border border-white/70 bg-ink-card/80 px-3.5 py-1.5 text-[10.5px] font-medium text-forest backdrop-blur">
              Live demo · sample dishes and prices
            </p>
          </div>
        </div>
      </div>

      <div className="relative border-t border-ink-line bg-ink/60 backdrop-blur-sm">
        <ul className="mx-auto flex max-w-[1180px] flex-wrap gap-x-10 gap-y-4 px-5 py-6 sm:px-8" data-hero-step>
          {[
            ['Digital menu', 'For your customers'],
            ['Live kitchen orders', 'For your staff'],
            ['Simple setup', 'Minutes, not weeks'],
            ['Works for all', 'Cafés, casual & fine dining'],
          ].map(([title, sub]) => (
            <li key={title} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-[13px] leading-none text-brass-strong">✓</span>
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

/* -------------------------------------------------------------- problem */

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
      className="relative overflow-x-clip border-t border-ink-line bg-ink py-16 text-cream sm:py-24 lg:py-28"
    >
      <Sprig className="pointer-events-none absolute -bottom-6 left-4 hidden h-52 w-auto text-forest opacity-[0.12] lg:block" />
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:pt-2">
            <Eyebrow>Why it exists</Eyebrow>
            <h2
              id="problem-heading"
              className="display mt-6 max-w-[18ch] text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]"
              data-reveal
            >
              Service is not slow.{' '}
              <span className="text-forest">
                The <em className="font-normal italic">hand-offs</em> are.
              </span>
            </h2>
            <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
            <p className="mt-5 max-w-[42ch] text-[15px] leading-[1.8] text-mute" data-reveal>
              A busy room has enough moving parts. Your menu, orders and bills shouldn’t add to them.
            </p>
            <div className="mt-8 max-w-[42ch] border-l-2 border-brass/60 pl-5" data-reveal>
              <p className="font-display text-[17px] italic text-forest">Less back-and-forth. More hospitality.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-mute">
                AutoDine sends orders from the table to the kitchen. Your staff still run the room.
              </p>
            </div>
          </div>

          <ol className="grid min-w-0 gap-4" data-stagger>
            {items.map((item, index) => (
              <li
                key={item.title}
                className="group relative rounded-[22px] border border-ink-line bg-ink-card p-5 shadow-[0_2px_18px_rgba(60,40,20,0.05)] motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-brass/30 motion-safe:hover:shadow-[0_22px_44px_-30px_rgba(60,40,20,0.45)] sm:p-7"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-5 left-0 w-[3px] scale-y-0 rounded-full bg-brass transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-y-100"
                />
                <div className="flex items-start gap-4 sm:gap-5">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brass/10 text-brass-strong ring-1 ring-brass/15 transition-colors duration-300 group-hover:bg-brass group-hover:text-cream"
                    aria-hidden="true"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-[19px] font-medium leading-snug tracking-[-0.01em] sm:text-[21px]">{item.title}</h3>
                      <span className="pt-1 font-display text-[14px] italic tabular-nums tracking-[0.04em] text-brass-strong/80" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{item.body}</p>
                    <p className="mt-4 border-t border-ink-line/80 pt-3 text-[11px] font-medium leading-relaxed text-forest">{item.detail}</p>
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
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-20 border-t border-ink-line bg-white py-16 text-cream sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:gap-16">
          <div>
            <Eyebrow>How it works</Eyebrow>
            <h2 id="how-heading" className="display mt-6 max-w-[19ch] text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]" data-reveal>
              From the first scan<br />
              <span className="text-forest">to the <em className="font-normal italic">final bill.</em></span>
            </h2>
            <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
          </div>
          <p className="max-w-[39ch] text-[15px] leading-[1.8] text-mute" data-reveal>
            Three steps, with your team in control. No guest app to download — just a table card and a
            connected phone.
          </p>
        </div>

        <div className="relative mt-10 flex items-center justify-between gap-4 md:mt-14" aria-hidden="true">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Scan</span>
          <div className="relative h-px flex-1 overflow-hidden bg-forest/10"><span data-service-progress className="absolute inset-0 origin-left bg-gradient-to-r from-forest to-brass" /></div>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Serve · Settle</span>
        </div>
        <ol aria-label="Restaurant service in three steps" className="mt-6 grid gap-4 md:grid-cols-3 md:gap-5" data-service-flow>
          {STEPS.map((step) => (
            <li
              key={step.n}
              data-service-step={step.n}
              className="group relative flex min-w-0 flex-col overflow-hidden rounded-[24px] border border-ink-line bg-ink p-6 motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:border-brass/30 motion-safe:hover:shadow-[0_24px_44px_-32px_rgba(60,40,20,0.5)] sm:p-7"
            >
              <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1 select-none font-display text-[68px] leading-none tracking-[-0.06em] text-forest/[0.08] transition-colors duration-500 group-hover:text-brass/20">
                {step.n}
              </span>
              <div className="relative flex items-center justify-between gap-4 border-b border-ink-line pb-5">
                <span className="inline-flex items-center gap-2 rounded-full bg-brass/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-brass-strong">STEP {step.n}</span>
                <p className="text-right text-[10px] font-medium uppercase tracking-[0.08em] text-mute">{step.role}</p>
              </div>
              <span data-service-icon className="relative mt-6 grid size-12 place-items-center rounded-xl border border-forest/10 bg-forest-soft text-forest transition-colors duration-300 group-hover:border-brass/40 group-hover:bg-forest group-hover:text-white" aria-hidden="true">
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={step.icon} /></svg>
              </span>
              <h3 className="mt-6 font-display text-[24px] font-medium leading-snug tracking-[-0.015em]">{step.title}</h3>
              <p className="mt-3 flex-1 text-[14px] leading-[1.8] text-mute">{step.body}</p>
              <p className="mt-7 flex items-start gap-2 border-t border-ink-line pt-4 text-[11px] font-medium leading-relaxed text-forest">
                <span aria-hidden="true" className="mt-[6px] size-1 shrink-0 rounded-full bg-brass" />
                {step.outcome}
              </p>
            </li>
          ))}
        </ol>
        <div className="group mt-6 flex flex-col items-start justify-between gap-5 rounded-[22px] border border-ink-line bg-ink px-5 py-5 transition-colors duration-300 hover:border-brass/30 sm:px-6 lg:flex-row lg:items-center">
          <div>
            <p className="text-[12px] font-semibold text-cream">What you need to get started</p>
            <p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-mute">Printed table cards, internet access for guests, and a compatible browser on a staff laptop or tablet.</p>
          </div>
          <Link href="/#screens" className="inline-flex min-h-11 shrink-0 items-center gap-3 rounded-full px-2 text-[13px] font-medium text-forest hover:text-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">
            See the screens <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">↗</span>
          </Link>
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
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(85%_60%_at_88%_0%,rgba(191,84,28,0.22),transparent_62%)]"
      />
      <LeafFrond className="pointer-events-none absolute -right-6 bottom-0 hidden h-[420px] w-auto text-white opacity-[0.07] lg:block" />
      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:gap-16">
          <div>
            <Eyebrow tone="light">One order, end to end</Eyebrow>
            <h2
              id="loop-heading"
              className="display mt-6 max-w-[20ch] text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]"
              data-reveal
            >
              A ticket, passed{' '}
              <em className="font-normal italic text-brass-soft">hand to hand.</em>
            </h2>
          </div>
          <p className="max-w-[40ch] text-[15px] leading-[1.8] text-white" data-reveal>
            One illustrative order — AD-1042, Table 05 — from the first scan to the moment the counter
            records payment.
          </p>
        </div>

        <div data-loop className="loop relative mt-12 sm:mt-16">
          <div data-loop-stage className="loop-stage">
            <div className="w-full">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white">
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
                  className="loop-ticket relative z-10 mx-auto mb-6 w-[290px] max-w-full select-none rounded-2xl bg-ink px-5 py-4 text-cream shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)]"
                >
                  <span aria-hidden="true" className="absolute -top-2 left-1/2 h-4 w-16 -translate-x-1/2 rounded-full bg-brass/80" />
                  <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-mute">
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
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-mute">2 dishes</span>
                    <span className="font-display text-[22px] italic tnum text-forest">₹600</span>
                  </div>
                </div>

                <div className="loop-grid grid gap-4 md:grid-cols-3 md:gap-5">
                  {LOOP_STATIONS.map((station) => (
                    <article
                      key={station.n}
                      data-loop-station
                      className="loop-station relative flex flex-col overflow-hidden rounded-[22px] border border-white/12 bg-white/[0.055] p-6 transition-colors duration-300 hover:bg-white/[0.09]"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-5 top-2 select-none font-display text-[56px] italic leading-none tracking-[-0.06em] text-white/[0.09]"
                      >
                        {station.n}
                      </span>
                      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-1">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-brass" />
                        <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-white">{station.status}</span>
                      </span>
                      <h3 className="mt-6 font-display text-[23px] leading-tight tracking-[-0.01em]">{station.role}</h3>
                      <p className="mt-2.5 flex-1 text-[13.5px] leading-[1.75] text-white">{station.body}</p>
                      <p className="mt-6 border-t border-white/10 pt-3.5 text-[11px] font-medium text-white">{station.detail}</p>
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
    <section id="screens" aria-labelledby="screens-heading" className="relative scroll-mt-20 overflow-x-clip border-t border-ink-line bg-ink py-16 text-cream sm:py-24 lg:py-28">
      <Sprig className="pointer-events-none absolute -left-10 top-24 hidden h-56 w-auto rotate-[18deg] text-forest opacity-[0.1] lg:block" />
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Eyebrow>A closer look</Eyebrow>
        <h2 id="screens-heading" className="display mt-5 max-w-[20ch] text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]" data-reveal>
          Three screens, in <em className="font-normal italic text-brass-strong">service order.</em>
        </h2>
        <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-mute" data-reveal>
          One order, seen from the table, the pass and the counter. A focused view for each part of service.
        </p>
        <p className="mt-3 text-[12px] text-mute-dim">Illustrative screens · sample dishes and tickets</p>

        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-3" data-screen-gallery>
          {panels.map((panel, index) => (
            <article key={panel.title} data-screen-card data-tour-panel className={`group flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-ink-line bg-ink-card shadow-[0_4px_22px_rgba(60,40,20,0.05)] motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:border-brass/30 motion-safe:hover:shadow-[0_28px_50px_-36px_rgba(60,40,20,0.5)] ${index === 1 ? 'md:mt-8' : ''}`}>
              <div className="relative overflow-hidden border-b border-ink-line bg-forest-soft/70 px-5 pt-6 sm:px-7" aria-hidden="true">
                <span className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                <p className="relative mb-4 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.1em] text-forest"><span>{panel.kicker}</span><span>Illustration</span></p>
                <div data-screen-frame className="relative mx-auto min-h-[330px] max-w-[280px] rounded-t-2xl border border-ink-line bg-ink-card p-4 shadow-[0_6px_24px_rgba(31,77,58,0.06)]">
                  <div className="flex items-center justify-between border-b border-ink-line pb-3 text-[10px] text-mute">
                    <span className="font-semibold text-forest">AutoDine</span><span>{index === 1 ? 'Kitchen' : 'Table 05'}</span>
                  </div>
                  {index === 0 ? (
                    <>
                      <p className="mt-4 font-display text-[20px] leading-tight">Something delicious.</p>
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
                      <div className="mt-4 flex items-center justify-between"><p className="font-display text-[20px] leading-tight">On the pass</p><span className="text-[9px] text-mute">2 tickets</span></div>
                      {[{ code: 'AD-1042', table: 'Table 05', state: 'New', dish: '1 × Paneer tikka', note: 'Less spicy, please.' }, { code: 'AD-1041', table: 'Table 03', state: 'Preparing', dish: '2 × Butter naan', note: 'No additional notes' }].map(ticket => (
                        <div key={ticket.code} className="mt-3 rounded-xl border border-ink-line border-l-[3px] border-l-brass bg-ink p-3">
                          <div className="flex justify-between gap-2 text-[10px] font-medium"><span>{ticket.table}</span><span className="rounded-full bg-forest-soft px-2 py-0.5 text-forest">{ticket.state}</span></div>
                          <p className="mt-2 text-[11px] font-medium">{ticket.dish}</p><p className="mt-1 text-[10px] text-mute">{ticket.note}</p>
                          <p className="mt-2 text-[8px] tracking-wider text-mute">{ticket.code}</p>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="mt-4 font-display text-[20px] leading-tight">At the counter</p>
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-brass-strong">{String(index + 1).padStart(2, '0')} / {panel.kicker}</p>
                <h3 className="mt-3 font-display text-[23px] leading-tight">{panel.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-mute">{panel.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="group relative mt-8 flex flex-col items-start justify-between gap-5 overflow-hidden rounded-[22px] border border-ink-line bg-white p-6 transition-colors duration-300 hover:border-brass/30 sm:flex-row sm:items-center">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-brass" />
          <p className="max-w-[45ch] text-[14px] leading-relaxed text-mute">Your staff stay in control. Sending an order does not automatically mark its bill as paid.</p>
          <AuthHandoffLink href="/signup" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 rounded-full bg-brass px-6 py-3 text-[13px] font-semibold text-cream shadow-[0_14px_28px_-18px_rgba(255,112,37,0.9)] motion-safe:transition-[transform,background-color,color] motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:bg-brass-strong motion-safe:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass">
            Set up your restaurant <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">↗</span>
          </AuthHandoffLink>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- features */

function Features() {
  return (
    <section id="product" aria-labelledby="features-heading" className="relative scroll-mt-20 overflow-x-clip border-t border-ink-line bg-ink py-16 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div data-draw aria-hidden="true" className="mb-10 h-px origin-left bg-gradient-to-r from-forest/40 via-brass/40 to-transparent" />
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-16">
          <div className="min-w-0 lg:sticky lg:top-28 lg:pt-1">
            <Eyebrow>Built around service</Eyebrow>
            <h2 id="features-heading" className="display mt-6 max-w-[16ch] text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]" data-reveal>
              Less to pass around.<br />
              <span className="text-forest">More time for the <em className="font-normal italic">room.</em></span>
            </h2>
            <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
            <p className="mt-5 max-w-[39ch] text-[15px] leading-[1.8] text-mute" data-reveal>
              A clear place for the menu, the kitchen ticket and the bill. Your team still does what
              matters most: look after the guest.
            </p>
            <div className="mt-7 max-w-[39ch] border-l-2 border-brass/50 pl-5" data-reveal>
              <p className="text-[13px] leading-relaxed text-mute">Guests order on their phone. Staff prepare, serve and record payment. Each step has its own place.</p>
            </div>
            <Link href="/#screens" className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full border border-forest/20 px-5 text-[13px] font-medium text-forest hover:bg-forest-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">
              Explore the screens <span aria-hidden="true">↗</span>
            </Link>
            <ProductScene />
          </div>

          <ul className="grid min-w-0 gap-4 sm:grid-cols-2" data-stagger>
            {FEATURES.map((feature, index) => {
              const featured = index === 1;
              return (
                <li
                  key={feature.role}
                  data-product-benefit
                  className={`group relative min-w-0 overflow-hidden rounded-[22px] border p-6 motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 ${
                    featured
                      ? 'border-forest bg-forest text-white shadow-[0_22px_46px_-34px_rgba(28,59,43,0.8)] motion-safe:hover:shadow-[0_30px_60px_-36px_rgba(28,59,43,0.9)]'
                      : 'border-ink-line bg-ink-card shadow-[0_2px_18px_rgba(60,40,20,0.05)] motion-safe:hover:border-brass/30 motion-safe:hover:shadow-[0_24px_44px_-32px_rgba(60,40,20,0.5)]'
                  }`}
                >
                  <span aria-hidden="true" className="absolute left-6 top-0 h-px w-12 origin-left scale-x-0 bg-brass transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
                  <div className="flex items-center justify-between gap-3">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-xl transition-colors duration-300 ${featured ? 'bg-white/10 text-brass-soft ring-1 ring-white/15' : 'bg-brass/10 text-brass-strong ring-1 ring-brass/15 group-hover:bg-brass group-hover:text-white'}`} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={feature.icon} /></svg>
                    </span>
                    <p className={`text-right text-[10px] font-medium uppercase tracking-[0.08em] ${featured ? 'text-white' : 'text-mute'}`}>{feature.role}</p>
                  </div>
                  <h3 className="mt-5 font-display text-[22px] leading-tight tracking-[-0.01em]">{feature.title}</h3>
                  <p className={`mt-3 text-[13px] leading-[1.75] ${featured ? 'text-white' : 'text-mute'}`}>{feature.body}</p>
                  <p className={`mt-5 flex items-start gap-2 border-t pt-4 text-[11px] font-medium leading-relaxed ${featured ? 'border-white/15 text-brass-soft' : 'border-ink-line text-forest'}`}>
                    <Tick tone={featured ? 'light' : 'dark'} />
                    {feature.detail}
                  </p>
                </li>
              );
            })}
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
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_12%_0%,rgba(191,84,28,0.2),transparent_60%)]"
      />
      <Sprig className="pointer-events-none absolute -left-6 top-6 hidden h-64 w-auto text-white opacity-[0.08] lg:block" />
      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end lg:gap-16">
          <div>
            <Eyebrow tone="light">Built for the counter</Eyebrow>
            <h2 id="trust-heading" className="display mt-5 max-w-[22ch] text-[clamp(1.9rem,3.6vw,2.85rem)] leading-[1.03]" data-reveal>
              The unglamorous parts,{' '}
              <em className="font-normal italic text-brass-soft">handled.</em>
            </h2>
          </div>
          <div className="max-w-[40ch]">
            <p className="text-[15px] leading-[1.8] text-white" data-reveal>
              Money, data and the bill are the quiet parts of service. They are also the parts that
              should never be improvised.
            </p>
            <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white">
              <span>How guest data is handled:</span>
              <Link href="/privacy" className="font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Privacy note</Link>
              <Link href="/terms" className="font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Terms</Link>
            </p>
          </div>
        </div>

        <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:mt-12 lg:grid-cols-4">
          {TRUST_POINTS.map((point) => (
            <li key={point.n} data-trust-point className="border-t border-white/15 pt-5">
              <span aria-hidden="true" className="font-display text-[13px] italic text-brass-soft">({point.n})</span>
              <h3 className="mt-3 font-display text-[20px] leading-snug">{point.title}</h3>
              <p className="mt-2 text-[13px] leading-[1.7] text-white">{point.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- honest */

/** Keep the service boundary visible without presenting an internal release log. */
function Honest() {
  return (
    <section id="status" aria-labelledby="status-heading" className="border-t border-ink-line bg-ink py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div data-draw aria-hidden="true" className="mb-10 h-px origin-left bg-gradient-to-r from-forest/40 via-brass/40 to-transparent" />
        <Eyebrow>Before you start</Eyebrow>
        <h2 id="status-heading" className="display mt-5 max-w-[22ch] text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]" data-reveal>
          A clear picture.<br /><span className="text-forest">No <em className="font-normal italic">surprises.</em></span>
        </h2>
        <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-mute" data-reveal>
          AutoDine runs as one system. Here is exactly what works together, and how billing
          works, before you begin.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2" data-stagger>
          <div className="group rounded-[24px] border border-forest/20 bg-white p-6 transition-colors duration-300 hover:border-forest/35 sm:p-8">
            <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-forest"><span aria-hidden="true" className="size-1.5 rounded-full bg-forest" />Explore the workflow</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {LIVE.map(item => <li key={item.id} className="flex items-start gap-2.5 text-[14px] leading-relaxed"><Tick />{item.label}</li>)}
            </ul>
            <p className="mt-6 border-t border-ink-line pt-4 text-[12px] leading-relaxed text-mute">Every outlet, menu row and order lives in your workspace from day one — no sample data mixed in.</p>
          </div>
          <div className="rounded-[24px] border border-ink-line bg-white p-6 transition-colors duration-300 hover:border-brass/30 sm:p-8">
            <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mute"><span aria-hidden="true" className="size-1.5 rounded-full bg-brass/70" />Not connected</p>
            <ul className="mt-5 space-y-4">
              {NOT_CONNECTED.map(item => (
                <li key={item.id} className="flex gap-3 text-[13px] leading-relaxed text-mute">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-mute-dim" />
                  <span>
                    <span className="font-medium text-cream">{item.label}</span><br />
                    {item.id === 'payments'
                      ? 'Guests pay at the counter. Staff check and record payment; AutoDine does not collect it online.'
                      : item.id === 'billing'
                        ? `New accounts start with a ${TRIAL_DAYS}-day trial. After it, pick a plan — checkout is handled securely through Cashfree.`
                        : 'No SMS or WhatsApp receipts or reminders are sent.'}
                  </span>
                </li>
              ))}
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
        <div className="max-w-[46ch]">
          <Eyebrow>Simple &amp; transparent</Eyebrow>
          <h2 id="pricing-heading" className="display mt-5 text-[clamp(2.1rem,4.2vw,3.35rem)] leading-[1.02]" data-reveal>
            Start with what you <em className="font-normal italic text-brass-strong">need.</em>
          </h2>
          <div data-rule className="rule-draw mt-6 h-px w-16" aria-hidden="true" />
          <p className="mt-4 text-[15px] leading-[1.6] text-mute" data-reveal>
            Three sizes. {TRIAL_DAYS} free days. No card to begin.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3" data-pricing-grid>
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              data-pricing-card
              className={`public-card relative flex min-w-0 flex-col rounded-[26px] border bg-ink-card p-6 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 sm:p-7 ${
                plan.recommended
                  ? 'border-brass/70 shadow-[0_26px_60px_-42px_rgba(191,84,28,0.9)]'
                  : 'border-ink-line hover:border-forest/25 hover:shadow-[0_22px_44px_-34px_rgba(60,40,20,0.45)]'
              }`}
            >
              {plan.recommended ? (
                <span className="absolute -top-3 left-6 rounded-full bg-brass px-3 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-cream shadow-[0_8px_18px_-10px_rgba(191,84,28,0.9)]">
                  Best fit for growing rooms
                </span>
              ) : null}
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-[24px] italic leading-none">{plan.name}</h3>
                <span aria-hidden="true" className="font-display text-[13px] italic text-brass/60">({String(PLANS.indexOf(plan) + 1).padStart(2, '0')})</span>
              </div>
              <p className="mt-2 min-h-[40px] max-w-[24ch] text-[12.5px] leading-relaxed text-mute">{plan.fit}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-display tnum text-[46px] leading-none tracking-[-0.03em]">{inr(plan.price)}</span>
                <span className="text-[12px] text-mute-dim">/month · billed through Cashfree</span>
              </p>

              <div className="mt-5 h-px bg-ink-line" aria-hidden="true" />

              <ul className="mt-5 space-y-2.5 text-[13px] text-mute">
                {capabilitiesFor(plan.id).map((capability) => (
                  <li key={capability.id} className="flex items-start gap-2.5">
                    <Tick />
                    {capability.label}
                  </li>
                ))}
              </ul>

              <Link
                href={`/pricing#plan-${plan.id}`}
                className={`mt-7 inline-flex h-11 items-center justify-center rounded-full text-[13px] font-semibold transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 ${
                  plan.recommended
                    ? 'bg-brass text-cream hover:bg-brass-strong focus-visible:outline-brass'
                    : 'border border-forest/25 text-forest hover:bg-forest-soft focus-visible:outline-forest'
                }`}
              >
                See {plan.name}
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-8 max-w-[70ch] text-[12.5px] leading-relaxed text-mute-dim">
          Simple monthly plans, billed securely through Cashfree — cancel anytime. The
          trial lasts {TRIAL_DAYS} days and needs no card; when it ends nothing is deleted and
          your workspace stays readable until you choose a plan.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- close */

function Close() {
  return (
    <footer className="relative overflow-x-clip border-t border-ink-line bg-ink" aria-labelledby="close-heading">
      <div className="relative isolate overflow-hidden" data-close>
        <Image
          src="/img/restaurant-interior-light.jpg"
          alt=""
          fill
          sizes="100vw"
          className="-z-20 object-cover opacity-35"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink via-ink/85 to-ink" aria-hidden="true" />
        <CornerGarden className="bottom-6 left-4 hidden lg:block" tone="text-forest" flip />

        <div className="mx-auto max-w-[1180px] px-5 py-24 text-center sm:px-8">
          <p className="font-display text-[13px] italic text-brass-strong" data-reveal>Swagat, always.</p>
          <h2 id="close-heading" data-reveal className="display mx-auto mt-4 max-w-[22ch] text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.0]">
            Give your next service a <em className="font-normal italic text-forest">clearer flow.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[14.5px] leading-relaxed text-mute" data-reveal>
            A calmer service starts with a connected menu, kitchen and counter.
          </p>
          <p className="mt-4 text-[12px] leading-relaxed text-mute" data-reveal>No card needed at signup · {TRIAL_DAYS}-day free trial.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3" data-reveal>
            <AuthHandoffLink
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-brass px-7 text-[14px] font-semibold text-cream shadow-[0_18px_34px_-22px_rgba(191,84,28,0.95)] transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              Start your {TRIAL_DAYS}-day trial <span aria-hidden="true">→</span>
            </AuthHandoffLink>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center rounded-full border border-forest/20 px-7 text-[14px] text-forest transition-colors hover:bg-forest-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-ink-line">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <BrandLockup variant="stacked" height={86} />
            <p className="mt-3 max-w-[42ch] text-[12.5px] leading-relaxed text-mute-dim">
              QR menu, kitchen board, counter — one system.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-[12.5px] text-mute">
            <Link href="/#status" className="transition-colors hover:text-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">How billing works</Link>
            <Link href="/pricing" className="transition-colors hover:text-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Pricing</Link>
            <Link href="/login" prefetch={false} className="transition-colors hover:text-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Sign in</Link>
            <AuthHandoffLink href="/signup" className="transition-colors hover:text-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Create account</AuthHandoffLink>
            <Link href="/privacy" className="transition-colors hover:text-brass-strong">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-brass-strong">Terms</Link>
          </nav>
        </div>
      </div>
      <div className="overflow-hidden border-t border-ink-line px-5 pt-6" aria-hidden="true">
        <p
          className="select-none bg-gradient-to-b from-forest/30 via-forest/10 to-forest/0 bg-clip-text text-center font-display text-[clamp(3.4rem,15vw,12rem)] font-medium leading-[0.82] tracking-[-0.05em] text-transparent [mask-image:linear-gradient(to_bottom,black_35%,transparent_100%)]"
          data-reveal
        >
          AutoDine
        </p>
      </div>
    </footer>
  );
}
