import Image from 'next/image';
import Link from 'next/link';
import { LIVE, NOT_CONNECTED, NumberWord, PLANS, capabilitiesFor } from '@/lib/plans';
import { inr } from '@/lib/demo-data';
import { SiteMotion } from '@/components/SiteMotion';
import { BrandLockup } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';

/**
 * The landing page.
 *
 * REBUILT IN TAILWIND
 *
 * Every screen is being migrated off the hand-written class system onto
 * utilities, one page at a time, starting here. The shape follows the same
 * brief as before -- photograph, one confident line, then the product -- but
 * the surface is now warm near-black with a single gold for action, because
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
    title: 'Scan QR',
    body: 'The card on the table resolves to that table in that restaurant. A card from a closed table is refused, and says so.',
  },
  {
    n: '02',
    title: 'Explore Menu',
    body: 'Dishes with photographs, prices and what is in them. Sold-out dishes say so instead of taking the order.',
  },
  {
    n: '03',
    title: 'Place Order',
    body: 'A portion, an add-on, a note for the kitchen. The ticket lands on the board in the same second.',
  },
  {
    n: '04',
    title: 'Kitchen Dashboard',
    body: 'Tickets ordered by what needs cooking next, read aloud in Hindi, and settled at the counter.',
  },
];

const FEATURES = [
  {
    title: 'Better dining experience',
    body: 'Guests order from their own phone, at their own pace, with a menu that has pictures.',
    icon: 'M4 7h16M4 12h16M4 17h10',
  },
  {
    title: 'Smoother operations',
    body: 'Orders reach the kitchen in the same second, with the notes attached, in the order they matter.',
    icon: 'M12 3v18M5 10l7-7 7 7',
  },
  {
    title: 'Easy menu management',
    body: 'Prices, photographs and availability, edited once and live everywhere the menu is.',
    icon: 'M4 6h16M4 12h10M4 18h7',
  },
  {
    title: 'Works for every room',
    body: 'Cafés, casual dining and family restaurants. One product, no per-restaurant code.',
    icon: 'M4 20V8l8-4 8 4v12M9 20v-6h6v6',
  },
];

const FAQ = [
  {
    q: 'Do customers need to install an app?',
    a: 'No. They scan the card on the table and the menu opens in the browser. Nothing to download, no account to create.',
  },
  {
    q: 'How does the QR ordering work?',
    a: 'The card resolves to a table and a restaurant. A six-digit code shown in the room proves the guest is actually seated there, and the order is tied to that table.',
  },
  {
    q: 'Can I customise my restaurant menu?',
    a: 'Yes — dishes, sections, prices, portions, add-ons and photographs are yours to edit, and you publish when you are ready.',
  },
  {
    q: 'Is my restaurant data secure?',
    a: 'Every screen is behind a signed-in account, and a restaurant can only ever read and write its own rows. Guests see a menu, never a dashboard.',
  },
];

export function Home() {
  return (
    <div className="min-h-screen bg-ink text-cream antialiased">
      <SiteMotion />
      <Nav />
      <Hero />
      <Steps />
      <Screens />
      <Features />
      <Honest />
      <Pricing />
      <Faq />
      <Close />
    </div>
  );
}

/* ------------------------------------------------------------------ nav */

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-8 px-5 sm:px-8">
        <Link href="/" aria-label="AutoDine home" className="shrink-0">
          <BrandLockup size={21} ink="#f7f3ea" dot={BRAND_GREEN} />
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 md:block">
          <ul className="flex items-center gap-7 text-[13px] text-mute">
            <li><Link href="#product" className="transition-colors hover:text-cream">Product</Link></li>
            <li><Link href="#how" className="transition-colors hover:text-cream">How it works</Link></li>
            <li><Link href="#screens" className="transition-colors hover:text-cream">Screens</Link></li>
            <li><Link href="/pricing" className="transition-colors hover:text-cream">Pricing</Link></li>
            <li><Link href="#faq" className="transition-colors hover:text-cream">FAQ</Link></li>
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link href="/login" className="hidden text-[13px] text-mute transition-colors hover:text-cream sm:block">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-full bg-gold px-5 text-[13px] font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden" data-hero>
      <div className="absolute inset-0 -z-10" data-hero-image>
        <Image
          src="/img/restaurant-interior.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-55"
        />
      </div>
      {/* Two gradients, not one: a vertical wash that makes the copy legible,
          and a warm glow from the right so the photograph does not read as a
          grey rectangle behind white text. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/70 via-ink/55 to-ink" aria-hidden="true" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_60%_at_85%_35%,rgba(224,168,106,0.18),transparent_65%)]" aria-hidden="true" />

      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 pb-24 pt-20 sm:px-8 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-32">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold" data-hero-step>
            Restaurant technology
          </p>

          <h1
            className="mt-6 text-[clamp(2.6rem,6.4vw,4.6rem)] font-medium leading-[0.98] tracking-[-0.045em]"
            data-line
          >
            Every table,
            <br />
            <span className="text-gold">one seamless</span>
            <br />
            experience.
          </h1>

          <p className="mt-7 max-w-[46ch] text-[15px] leading-relaxed text-mute" data-hero-step>
            A modern ordering system designed for restaurants. QR menu, faster ordering and
            smoother operations — all in one place.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3" data-hero-step>
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-gold px-6 text-[14px] font-medium text-ink transition-colors hover:bg-gold-bright"
            >
              Create your restaurant
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="#how"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/15 px-6 text-[14px] text-cream transition-colors hover:border-white/30 hover:bg-white/[0.04]"
            >
              See how it works
            </Link>
          </div>
        </div>

        <PhoneMockup />
      </div>

      <div className="relative border-t border-white/[0.07]">
        <ul className="mx-auto grid max-w-[1180px] grid-cols-2 gap-px px-5 sm:px-8 lg:grid-cols-4">
          {[
            ['Digital menu', 'For your customers'],
            ['Live kitchen orders', 'For your staff'],
            ['Simple setup', 'Minutes, not weeks'],
            ['Works for all', 'Cafés, casual & fine dining'],
          ].map(([title, sub]) => (
            <li key={title} className="flex items-start gap-3 py-6">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-gold" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="m5 12 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>
                <span className="block text-[13px] font-medium text-cream">{title}</span>
                <span className="block text-[12px] text-mute-dim">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The phone in the hero: the product's own guest menu, not a photograph of one.
 *
 * It uses the same dish photographs the menu uses, so the promise on the
 * landing page and the menu a guest actually opens are the same picture.
 */
function PhoneMockup() {
  const dishes = [
    { name: 'Butter Chicken', price: 469, img: '/img/dishes/butter-chicken.jpg' },
    { name: 'Paneer Tikka', price: 240, img: '/img/dishes/chicken-malai-tikka.jpg' },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[330px] lg:mx-0 lg:ml-auto" data-hero-step>
      <div className="absolute -inset-8 -z-10 rounded-[48px] bg-[radial-gradient(60%_50%_at_50%_40%,rgba(224,168,106,0.22),transparent_70%)] blur-2xl" aria-hidden="true" />

      <div className="rounded-[34px] border border-white/10 bg-ink-soft p-2.5 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
        <div className="overflow-hidden rounded-[26px] bg-ink">
          <div className="flex items-center justify-between px-4 pt-3 text-[10px] text-mute-dim">
            <span>9:41</span>
            <span className="h-1.5 w-16 rounded-full bg-white/10" />
            <span>5G</span>
          </div>

          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-gold">Table 05</p>
              <p className="mt-1 text-[15px] font-medium tracking-tight">The Urban Table</p>
              <p className="text-[10px] text-mute-dim">North Indian · dine-in</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-mute">✕</span>
          </div>

          <div className="flex gap-1.5 px-4 pb-4 text-[10px]">
            {['All', 'Starters', 'Mains', 'Desserts'].map((tab, i) => (
              <span
                key={tab}
                className={
                  i === 0
                    ? 'rounded-full bg-gold px-3 py-1 font-medium text-ink'
                    : 'rounded-full bg-white/[0.05] px-3 py-1 text-mute'
                }
              >
                {tab}
              </span>
            ))}
          </div>

          <ul className="space-y-2 px-3 pb-4">
            {dishes.map((dish) => (
              <li key={dish.name} className="flex gap-3 rounded-2xl bg-white/[0.03] p-2.5">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl">
                  <Image src={dish.img} alt="" fill sizes="80px" className="object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{dish.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-mute-dim">
                    Cooked in rich tomato gravy with butter
                  </p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-gold">₹{dish.price}</span>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-[13px] font-medium text-ink">+</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The table card, because the whole product starts with one. */}
      <div className="absolute -bottom-6 -left-4 hidden rounded-2xl border border-white/10 bg-ink-card p-3 sm:block">
        <div className="grid h-16 w-16 place-items-center rounded-lg bg-cream">
          <div className="grid grid-cols-5 gap-0.5" aria-hidden="true">
            {Array.from({ length: 25 }).map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 ${i % 3 === 0 || i % 7 === 0 ? 'bg-ink' : 'bg-transparent'}`} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-center text-[9px] uppercase tracking-[0.14em] text-mute">Table 05</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- steps */

function Steps() {
  return (
    <section id="how" className="border-t border-white/[0.06] py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">Simple process</p>
        <h2 className="mt-5 max-w-[20ch] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          From scan to serving.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-mute" data-reveal>
          Four steps, under a minute, and none of it needs an install.
        </p>

        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-stagger>
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="group rounded-2xl border border-white/[0.07] bg-ink-card/60 p-6 transition-colors hover:border-white/15 hover:bg-ink-card"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-[0.16em] text-mute-dim">{step.n}</span>
                <span className="h-px flex-1 bg-white/[0.07]" aria-hidden="true" />
              </div>
              <h3 className="mt-6 text-[17px] font-medium tracking-tight">{step.title}</h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-mute">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- screens */

function Screens() {
  const panels = [
    {
      kicker: 'Guest',
      title: 'Browse the menu',
      body: 'Every dish with a photograph, a price and what is in it.',
      img: '/img/dishes/butter-chicken.jpg',
    },
    {
      kicker: 'Guest',
      title: 'Customise the order',
      body: 'A portion, an add-on, a note for the kitchen. Priced as it is chosen.',
      img: '/img/dishes/paneer-tikka.jpg',
    },
    {
      kicker: 'Kitchen',
      title: 'Watch it cook',
      body: 'The ticket arrives with its table, its note and its place in the queue.',
      img: '/img/dishes/butter-naan.jpg',
    },
  ];

  return (
    <section id="screens" className="border-t border-white/[0.06] py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">The product</p>
        <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          Three screens, in service order.
        </h2>

        <div className="mt-14 grid gap-5 md:grid-cols-3" data-tour>
          {panels.map((panel, index) => (
            <article
              key={panel.title}
              data-tour-panel
              className="overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-card"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={panel.img}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 380px"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-card via-ink-card/20 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-gold backdrop-blur">
                  {panel.kicker}
                </span>
              </div>
              <div className="p-6">
                <h3 className="text-[17px] font-medium tracking-tight">
                  {String(index + 1).padStart(2, '0')} · {panel.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-mute">{panel.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- features */

function Features() {
  return (
    <section id="product" className="border-t border-white/[0.06] py-24">
      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">Built for real restaurants</p>
          <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
            Why restaurants choose AutoDine.
          </h2>
          <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-mute" data-reveal>
            A practical solution designed for modern dining spaces — not a dashboard with a menu
            bolted on.
          </p>

          <blockquote className="mt-10 rounded-2xl border border-white/[0.07] bg-ink-card p-6">
            <p className="text-[17px] leading-snug tracking-tight text-cream">
              “Technology that fits your restaurant, not the other way around.”
            </p>
          </blockquote>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2" data-stagger>
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="rounded-2xl border border-white/[0.07] bg-ink-card/60 p-6 transition-colors hover:border-white/15"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold/10 text-gold" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d={feature.icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h3 className="mt-5 text-[15px] font-medium tracking-tight">{feature.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-mute">{feature.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- honest */

/**
 * What is live and what is not.
 *
 * Both counts come from the same lists the rest of the site reads, so the line
 * cannot drift from the truth the way a typed "six and three" did.
 */
function Honest() {
  return (
    <section className="border-t border-white/[0.06] py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <h2 className="text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          {/* Spelled out from the lists, never typed: a number in a headline
              is the first thing to go stale. */}
          {`${NumberWord(LIVE.length)} things work. ${NumberWord(NOT_CONNECTED.length)} do not.`}
        </h2>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-mute" data-reveal>
          This is a working product in preview, not a finished one. The honest version of its state
          is more useful than a launch badge.
        </p>

        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-soft">Live now</p>
            <ul className="mt-5 space-y-3">
              {LIVE.map((item) => (
                <li key={item.id} className="flex gap-3 text-[13.5px] leading-relaxed text-mute">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-soft" aria-hidden="true" />
                  <span><span className="text-cream">{item.label}</span> — {item.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-dim">Not connected</p>
            <ul className="mt-5 space-y-3">
              {NOT_CONNECTED.map((item) => (
                <li key={item.id} className="flex gap-3 text-[13.5px] leading-relaxed text-mute">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-dim" aria-hidden="true" />
                  <span><span className="text-cream">{item.label}</span> — {item.detail}</span>
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
    <section id="pricing" className="border-t border-white/[0.06] py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">Simple pricing</p>
        <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          Start with what you need.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-mute" data-reveal>
          Planned pricing for restaurants of all sizes. Nothing is charged while the product is in
          preview.
        </p>

        <div className="mt-12 grid gap-5 lg:grid-cols-3" data-stagger>
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-7 ${
                plan.recommended
                  ? 'border-gold/40 bg-gold/[0.06]'
                  : 'border-white/[0.07] bg-ink-card/60'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-7 rounded-full bg-gold px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
                  Most popular
                </span>
              )}

              <h3 className="text-[15px] font-medium tracking-tight">{plan.name}</h3>
              <p className="mt-1.5 min-h-[40px] text-[12.5px] leading-relaxed text-mute">{plan.fit}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-[40px] font-medium leading-none tracking-[-0.05em]">
                  {inr(plan.price)}
                </span>
                <span className="text-[12px] text-mute-dim">/month · planned</span>
              </p>

              <ul className="mt-6 space-y-2.5 text-[13px] text-mute">
                {capabilitiesFor(plan.id).map((capability) => (
                  <li key={capability.id} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    {capability.label}
                  </li>
                ))}
              </ul>

              <Link
                href={`/pricing#plan-${plan.id}`}
                className={`mt-7 inline-flex h-11 items-center justify-center rounded-full text-[13px] font-medium transition-colors ${
                  plan.recommended
                    ? 'bg-gold text-ink hover:bg-gold-bright'
                    : 'border border-white/15 text-cream hover:bg-white/[0.05]'
                }`}
              >
                See {plan.name}
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-8 text-[12.5px] leading-relaxed text-mute-dim">
          Plans are not on sale. Nothing is charged, no card is taken, and no account is limited by
          which of these you would pick.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ faq */

function Faq() {
  return (
    <section id="faq" className="border-t border-white/[0.06] py-24">
      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">FAQ</p>
          <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
            Frequently asked questions.
          </h2>
          <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-mute">
            Still have questions? Write to us and a person answers.
          </p>
        </div>

        <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[15px] text-cream marker:hidden">
                {item.q}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-mute transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- close */

function Close() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="relative isolate overflow-hidden">
        <Image
          src="/img/restaurant-interior.jpg"
          alt=""
          fill
          sizes="100vw"
          className="-z-10 object-cover opacity-25"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink via-ink/85 to-ink" aria-hidden="true" />

        <div className="mx-auto max-w-[1180px] px-5 py-24 text-center sm:px-8">
          <h2 className="mx-auto max-w-[22ch] text-[clamp(2rem,4.4vw,3.2rem)] font-medium leading-[1.03] tracking-[-0.045em]">
            Bring a better ordering experience to your restaurant.
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[14.5px] leading-relaxed text-mute">
            Simple setup. Modern experience. Built for real restaurants.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-gold px-7 text-[14px] font-medium text-ink transition-colors hover:bg-gold-bright"
            >
              Create your restaurant <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center rounded-full border border-white/15 px-7 text-[14px] transition-colors hover:bg-white/[0.05]"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <BrandLockup size={20} ink="#f7f3ea" dot={BRAND_GREEN} />
            <p className="mt-3 max-w-[42ch] text-[12.5px] leading-relaxed text-mute-dim">
              A modern ordering system for modern restaurants. QR menu, kitchen board, counter.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-[12.5px] text-mute">
            <Link href="/pricing" className="hover:text-cream">Pricing</Link>
            <Link href="/login" className="hover:text-cream">Sign in</Link>
            <Link href="/signup" className="hover:text-cream">Create account</Link>
            <Link href="/menu" className="hover:text-cream">The menu</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
