import Image from 'next/image';
import Link from 'next/link';
import { LIVE, NOT_CONNECTED, PLANS, capabilitiesFor } from '@/lib/plans';
import { inr } from '@/lib/demo-data';
import { ProductScene } from '@/components/ProductScene';
import { SiteMotion } from '@/components/SiteMotion';
import { HomeNav } from '@/components/HomeNav';
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
      <HomeNav />
      <Hero />
      <Problem />
      <Steps />
      <Screens />
      <Features />
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

      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 pb-24 pt-20 sm:px-8 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-32">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest" data-hero-step>
            Restaurant technology
          </p>

          <h1 className="mt-6 text-[clamp(2.35rem,6.2vw,4.6rem)] font-medium leading-[0.98] tracking-[-0.045em] text-cream">
            <span className="block overflow-hidden">
              <span className="block" data-line>Every table,</span>
            </span>
            <span className="block overflow-hidden">
              <span className="block text-mute" data-line>one seamless</span>
            </span>
            <span className="block overflow-hidden">
              <span className="block" data-line>experience.</span>
            </span>
          </h1>

          <p className="mt-7 max-w-[48ch] text-[15px] leading-[1.6] text-mute" data-hero-step>
            Scan the table card. Order on the phone. Keep the table and kitchen connected.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3" data-hero-step>
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-forest px-6 text-[14px] font-medium text-white transition-colors hover:bg-forest-strong"
            >
              Start the 7-day trial
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="#how"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-cream/15 px-6 text-[14px] text-cream transition-colors hover:border-cream/30 hover:bg-ink-soft"
            >
              See how it works
            </Link>
            <span className="text-[12px] text-mute-dim">No card. Nothing charged during preview.</span>
          </div>
        </div>

        <PhoneMockup />
      </div>

      <div className="relative border-t border-cream/10">
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

/**
 * The phone in the hero: the product's own guest menu, not a photograph of one.
 *
 * It uses the same dish photographs the menu uses, so the promise on the
 * landing page and the menu a guest actually opens are the same picture.
 */
function PhoneMockup() {
  const dishes = [
    { name: 'Butter Chicken', price: 469, img: '/img/dishes/butter-chicken.jpg' },
    { name: 'Paneer Tikka', price: 240, img: '/img/dishes/paneer-tikka.jpg' },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[330px] lg:mx-0 lg:ml-auto" data-hero-step>
      <div className="absolute -inset-8 -z-10 rounded-[48px] bg-[radial-gradient(60%_50%_at_50%_40%,rgba(31,77,58,0.10),transparent_70%)] blur-2xl" aria-hidden="true" />

      <div data-phone-float className="rounded-[34px] border border-cream/15 bg-ink-soft p-2.5 shadow-[0_40px_80px_-40px_rgba(28,27,24,0.22)]">
        <div className="overflow-hidden rounded-[26px] bg-ink">
          <div className="flex items-center justify-between px-4 pt-3 text-[10px] text-mute-dim">
            <span>9:41</span>
            <span className="h-1.5 w-16 rounded-full bg-cream/25" />
            <span>5G</span>
          </div>

          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-forest">Table 05</p>
              <p className="mt-1 text-[15px] font-medium tracking-tight">The Urban Table</p>
              <p className="text-[10px] text-mute-dim">North Indian · dine-in</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-soft text-mute">✕</span>
          </div>

          <div className="flex gap-1.5 px-4 pb-4 text-[10px]">
            {['All', 'Starters', 'Mains', 'Desserts'].map((tab, i) => (
              <span
                key={tab}
                className={
                  i === 0
                    ? 'rounded-full bg-forest px-3 py-1 font-medium text-white'
                    : 'rounded-full bg-ink-soft px-3 py-1 text-mute'
                }
              >
                {tab}
              </span>
            ))}
          </div>

          <ul className="space-y-2 px-3 pb-4">
            {dishes.map((dish) => (
              <li key={dish.name} className="flex gap-3 rounded-2xl border border-hair bg-white p-2.5">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl">
                  <Image src={dish.img} alt="" fill sizes="80px" className="object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{dish.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-mute-dim">
                    Cooked in rich tomato gravy with butter
                  </p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-forest">₹{dish.price}</span>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-forest text-[13px] font-medium text-white">+</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The table card, because the whole product starts with one. */}
      <div className="absolute -bottom-6 -left-4 hidden rounded-2xl border border-cream/15 bg-ink-card p-3 sm:block">
        <div className="grid h-16 w-16 place-items-center rounded-lg bg-ink">
          <div className="grid grid-cols-5 gap-0.5" aria-hidden="true">
            {Array.from({ length: 25 }).map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 ${i % 3 === 0 || i % 7 === 0 ? 'bg-cream' : 'bg-transparent'}`} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-center text-[9px] uppercase tracking-[0.14em] text-mute">Table 05</p>
      </div>
    </div>
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
      className="border-t border-[#E8E3DA] bg-[#FBFAF7] py-16 text-[#1C1B18] sm:py-24 lg:py-28"
    >
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-16">
          <div className="lg:pt-4">
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
              <span className="h-px w-7 bg-[#B98A4B]" aria-hidden="true" />
              Why it exists
            </p>
            <h2
              id="problem-heading"
              className="mt-6 max-w-[18ch] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.04em]"
              data-reveal
            >
              Service is not slow. <span className="text-forest">The hand-offs are.</span>
            </h2>
            <p className="mt-5 max-w-[42ch] text-[15px] leading-[1.8] text-[#6B665E]" data-reveal>
              A busy room has enough moving parts. Your menu, orders and bills shouldn’t add to them.
            </p>
            <div className="mt-8 max-w-[42ch] border-l-2 border-[#B98A4B]/50 pl-5" data-reveal>
              <p className="text-[14px] font-medium leading-relaxed text-forest">Less back-and-forth. More hospitality.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[#6B665E]">
                AutoDine sends orders from the table to the kitchen. Your staff still run the room.
              </p>
            </div>
          </div>

          <ol className="grid min-w-0 gap-4" data-stagger>
            {items.map((item, index) => (
              <li
                key={item.title}
                className="group relative rounded-2xl border border-[#E8E3DA] bg-white p-5 shadow-[0_4px_24px_rgba(28,27,24,0.025)] motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_8px_30px_rgba(31,77,58,0.07)] sm:p-7"
              >
                <div className="flex items-start gap-4 sm:gap-5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#E9F0EA] text-forest" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[16px] font-medium leading-snug tracking-[-0.02em] sm:text-[18px]">{item.title}</h3>
                      <span className="pt-0.5 text-[10px] font-medium tabular-nums tracking-[0.12em] text-[#6B665E]" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-[#6B665E]">{item.body}</p>
                    <p className="mt-4 border-t border-[#E8E3DA]/70 pt-3 text-[11px] font-medium leading-relaxed text-forest">{item.detail}</p>
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
            <p className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.2em] text-forest uppercase"><span aria-hidden="true" className="h-px w-7 bg-[#B98A4B]" />How it works</p>
            <h2 id="how-heading" className="mt-6 max-w-[19ch] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.04em]" data-reveal>From the first scan<br /><span className="text-forest">to the final bill.</span></h2>
          </div>
          <p className="max-w-[39ch] text-[15px] leading-[1.8] text-mute" data-reveal>Three steps, with your team in control. No guest app to download — just a table card and a connected phone.</p>
        </div>

        <div className="relative mt-10 flex items-center justify-between gap-4 md:mt-14" aria-hidden="true">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Scan</span>
          <div className="relative h-px flex-1 overflow-hidden bg-forest/10"><span data-service-progress className="absolute inset-0 origin-left bg-gradient-to-r from-forest to-[#B98A4B]" /></div>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Serve · Settle</span>
        </div>
        <ol aria-label="Restaurant service in three steps" className="mt-6 grid gap-4 md:grid-cols-3 md:gap-5" data-service-flow>
          {STEPS.map(step => (
            <li key={step.n} data-service-step={step.n} className="relative flex min-w-0 flex-col rounded-[22px] border border-ink-line bg-ink p-6 motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_12px_30px_rgba(31,77,58,0.06)] sm:p-7">
              <div className="flex items-center justify-between gap-4 border-b border-ink-line pb-5">
                <span className="text-[10px] font-semibold tracking-[0.14em] text-forest">STEP {step.n}</span>
                <p className="text-right text-[10px] font-medium tracking-[0.08em] text-mute uppercase">{step.role}</p>
              </div>
              <span data-service-icon className="mt-6 grid size-12 place-items-center rounded-xl border border-forest/10 bg-forest-soft text-forest" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={step.icon} /></svg></span>
              <h3 className="mt-6 text-[22px] font-medium leading-snug tracking-[-0.035em]">{step.title}</h3>
              <p className="mt-3 flex-1 text-[14px] leading-[1.8] text-mute">{step.body}</p>
              <p className="mt-7 border-t border-ink-line pt-4 text-[11px] font-medium leading-relaxed text-forest">{step.outcome}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-col items-start justify-between gap-5 rounded-2xl border border-ink-line px-5 py-5 sm:px-6 lg:flex-row lg:items-center">
          <div><p className="text-[12px] font-medium text-cream">What you need to get started</p><p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-mute">Printed table cards, internet access for guests, and a compatible browser on a staff laptop or tablet.</p></div>
          <Link href="/#screens" className="inline-flex min-h-11 shrink-0 items-center gap-3 rounded-full px-2 text-[13px] font-medium text-forest hover:text-forest-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">See the screens <span aria-hidden="true">↗</span></Link>
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
    <section id="screens" aria-labelledby="screens-heading" className="border-t border-[#E8E3DA] bg-[#FBFAF7] py-16 text-[#1C1B18] sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
          <span className="h-px w-7 bg-[#B98A4B]" aria-hidden="true" />A closer look
        </p>
        <h2 id="screens-heading" className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.04em]" data-reveal>
          Three screens, in service order.
        </h2>
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-[#6B665E]" data-reveal>One order, seen from the table, the pass and the counter. A focused view for each part of service.</p>
        <p className="mt-3 text-[12px] text-[#6B665E]">Illustrative product previews · sample dishes and tickets</p>

        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-3" data-screen-gallery>
          {panels.map((panel, index) => (
            <article key={panel.title} data-screen-card data-tour-panel className="group flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-ink-line bg-white shadow-[0_6px_28px_rgba(28,27,24,0.03)] motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_14px_36px_rgba(31,77,58,0.08)]">
              <div className="overflow-hidden border-b border-ink-line bg-forest-soft/60 px-5 pt-6 sm:px-7" aria-hidden="true">
                <p className="mb-4 flex items-center justify-between text-[9px] font-medium tracking-[0.1em] text-forest uppercase"><span>{panel.kicker}</span><span>Illustration</span></p>
                <div data-screen-frame className="mx-auto min-h-[330px] max-w-[280px] rounded-t-2xl border border-[#E8E3DA] bg-white p-4 shadow-[0_6px_24px_rgba(31,77,58,0.06)]">
                  <div className="flex items-center justify-between border-b border-[#E8E3DA] pb-3 text-[10px] text-[#6B665E]">
                    <span className="font-semibold text-forest">AutoDine</span><span>{index === 1 ? 'Kitchen' : 'Table 05'}</span>
                  </div>
                  {index === 0 ? (
                    <>
                      <p className="mt-4 text-[17px] font-medium tracking-tight">Something delicious.</p>
                      <p className="mt-1 text-[10px] text-[#6B665E]">Fresh picks from our kitchen</p>
                      <div className="mt-3 flex gap-2 text-[9px]"><span className="rounded-full bg-forest px-3 py-1 text-white">Popular</span><span className="rounded-full bg-[#FBFAF7] px-3 py-1 text-[#6B665E]">Mains</span></div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {[{ name: 'Paneer tikka', price: 260, image: 'paneer-tikka' }, { name: 'Butter chicken', price: 340, image: 'butter-chicken' }].map(dish => (
                          <div key={dish.name} className="overflow-hidden rounded-lg border border-[#E8E3DA]">
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
                <p className="mt-2 text-[14px] leading-relaxed text-[#6B665E]">{panel.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-start justify-between gap-5 rounded-2xl border border-[#E8E3DA] bg-white p-6 sm:flex-row sm:items-center">
          <p className="max-w-[45ch] text-[14px] leading-relaxed text-[#6B665E]">Your staff stay in control. Sending an order does not automatically mark its bill as paid.</p>
          <Link href="/signup" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 rounded-full bg-forest px-6 py-3 text-[13px] font-medium text-white motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Set up your restaurant <span aria-hidden="true">↗</span></Link>
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
        <div data-draw aria-hidden="true" className="mb-10 h-px origin-left bg-gradient-to-r from-forest/40 via-[#B98A4B]/40 to-transparent" />
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-16">
          <div className="min-w-0 lg:pt-3">
            <p className="flex items-center gap-3 text-[11px] font-semibold tracking-[0.2em] text-forest uppercase"><span aria-hidden="true" className="h-px w-7 bg-[#B98A4B]" />Built around service</p>
            <h2 id="features-heading" className="mt-6 max-w-[15ch] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.04em]" data-reveal>
              Less to pass around.<br /><span className="text-forest">More time for the room.</span>
            </h2>
            <p className="mt-5 max-w-[39ch] text-[15px] leading-[1.8] text-mute" data-reveal>
              A clear place for the menu, the kitchen ticket and the bill. Your team still does what matters most: look after the guest.
            </p>
            <div className="mt-7 max-w-[39ch] border-l-2 border-[#B98A4B]/50 pl-5" data-reveal>
              <p className="text-[13px] leading-relaxed text-mute">Guests order on their phone. Staff prepare, serve and record payment. Each step has its own place.</p>
            </div>
            <Link href="/#screens" className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full border border-forest/20 px-5 text-[13px] font-medium text-forest hover:bg-forest-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Explore the screens <span aria-hidden="true">↗</span></Link>
            <ProductScene />
          </div>

          <ul className="grid min-w-0 gap-4 sm:grid-cols-2" data-stagger>
            {FEATURES.map(feature => (
              <li key={feature.role} data-product-benefit className="group min-w-0 rounded-[20px] border border-ink-line bg-white p-6 shadow-[0_4px_24px_rgba(28,27,24,0.025)] motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_12px_30px_rgba(31,77,58,0.07)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-forest-soft text-forest" aria-hidden="true"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={feature.icon} /></svg></span>
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

/* --------------------------------------------------------------- honest */

/** Keep the preview boundary visible without presenting an internal release log. */
function Honest() {
  return (
    <section id="status" aria-labelledby="status-heading" className="border-t border-ink-line bg-ink py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div data-draw aria-hidden="true" className="mb-10 h-px origin-left bg-gradient-to-r from-forest/40 via-[#B98A4B]/40 to-transparent" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Before you start</p>
        <h2 id="status-heading" className="mt-5 max-w-[22ch] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.08] tracking-[-0.04em]" data-reveal>A clear picture.<br /><span className="text-forest">No surprises.</span></h2>
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-mute" data-reveal>AutoDine is a product preview. Explore the ordering workflow, and know what is not connected before you begin.</p>
        <div className="mt-10 grid gap-5 md:grid-cols-2" data-stagger>
          <div className="rounded-[22px] border border-forest/20 bg-white p-6 sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">Explore the workflow</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {LIVE.map(item => <li key={item.id} className="flex items-start gap-3 text-[14px] leading-relaxed"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-forest" />{item.label}</li>)}
            </ul>
            <p className="mt-6 border-t border-ink-line pt-4 text-[12px] leading-relaxed text-mute">Sample content demonstrates the product. This preview is not a certification for live restaurant operations.</p>
          </div>
          <div className="rounded-[22px] border border-ink-line bg-white p-6 sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mute">Not connected</p>
            <ul className="mt-5 space-y-4">
              {NOT_CONNECTED.map(item => <li key={item.id} className="flex gap-3 text-[13px] leading-relaxed text-mute"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[#8C857A]" /><span><span className="font-medium text-cream">{item.label}</span><br />{item.id === 'payments' ? 'Guests pay at the counter. Staff check and record payment; AutoDine does not collect it online.' : item.id === 'billing' ? 'Plans are not on sale. After the seven-day trial, access becomes read-only until extended.' : 'No SMS or WhatsApp receipts or reminders are sent.'}</span></li>)}
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Simple pricing</p>
        <h2 id="pricing-heading" className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          Start with what you need.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-[1.6] text-mute" data-reveal>
          Three sizes. Seven free days. No card to begin.
        </p>

        <div className="mt-12 grid gap-5 lg:grid-cols-3" data-pricing-grid>
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              data-pricing-card
              className={`public-card relative flex min-w-0 flex-col rounded-2xl border p-6 sm:p-7 ${
                'border-ink-line bg-ink-card'
              }`}
            >
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
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest" aria-hidden="true" />
                    {capability.label}
                  </li>
                ))}
              </ul>

              <Link
                href={`/pricing#plan-${plan.id}`}
                className={`mt-7 inline-flex h-11 items-center justify-center rounded-full text-[13px] font-medium transition-colors ${
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
          trial lasts seven days — after it ends the workspace is
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
          <h2 id="close-heading" data-reveal className="mx-auto max-w-[22ch] text-[clamp(2rem,4.4vw,3.2rem)] font-medium leading-[1.03] tracking-[-0.045em]">
            Give your next service a clearer flow.
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[14.5px] leading-relaxed text-mute" data-reveal>
            A calmer service starts with a connected menu, kitchen and counter.
          </p>
          <p className="mt-4 text-[12px] leading-relaxed text-mute" data-reveal>Product preview · No paid subscription is activated at signup.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3" data-reveal>
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-forest px-7 text-[14px] font-medium text-white transition-colors hover:bg-forest-strong"
            >
              Start your seven-day trial <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center rounded-full border border-cream/15 px-7 text-[14px] transition-colors hover:bg-forest-soft"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-cream/[0.12]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <BrandLockup size={20} ink="currentColor" dot={BRAND_GREEN} />
            <p className="mt-3 max-w-[42ch] text-[12.5px] leading-relaxed text-mute-dim">
              QR menu, kitchen board, counter — one system.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-[12.5px] text-mute">
            <Link href="/#status" className="hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Preview details</Link>
            <Link href="/pricing" className="hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Pricing</Link>
            <Link href="/login" className="hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Sign in</Link>
            <Link href="/signup" className="hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Create account</Link>
            <Link href="/privacy" className="hover:text-forest">Privacy</Link>
            <Link href="/terms" className="hover:text-forest">Terms</Link>
          </nav>
        </div>
      </div>
      <div className="overflow-hidden border-t border-ink-line px-5 pt-6 text-center" aria-hidden="true">
        <p className="select-none text-[clamp(3.4rem,15vw,12rem)] font-medium leading-none tracking-[-0.07em] text-forest/10" data-reveal>AutoDine</p>
      </div>
    </footer>
  );
}
