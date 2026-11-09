import Image from 'next/image';
import Link from 'next/link';
import { LIVE, NOT_CONNECTED, NumberWord, PLANS, capabilitiesFor } from '@/lib/plans';
import { inr } from '@/lib/demo-data';
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
    title: 'Set up the menu',
    body: 'Dishes, prices, photos, tables. Print a card per table.',
  },
  {
    n: '02',
    title: 'Guests scan and order',
    body: 'The card opens the menu. Guests choose dishes and send their order with notes.',
  },
  {
    n: '03',
    title: 'Cook, serve, bill',
    body: 'The board shows every ticket. Review the bill and record payment at the counter.',
  },
];

const FEATURES = [
  {
    title: 'Better dining experience',
    body: 'Guests order from their own phone, at their own pace.',
    icon: 'M4 7h16M4 12h16M4 17h10',
  },
  {
    title: 'Smoother operations',
    body: 'Orders arrive on the kitchen board with the guest’s notes attached.',
    icon: 'M12 3v18M5 10l7-7 7 7',
  },
  {
    title: 'Easy menu management',
    body: 'Edit once — live everywhere the menu is.',
    icon: 'M4 6h16M4 12h10M4 18h7',
  },
  {
    title: 'Works for every room',
    body: 'Cafés to family restaurants. One product.',
    icon: 'M4 20V8l8-4 8 4v12M9 20v-6h6v6',
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
  const icons = [
    'M5 4h14v16H5V4Zm4 4h6M9 12h6M9 16h3',
    'M8 3h8v18H8V3Zm3 15h2M11 6h2',
    'M4 5h16v12H4V5Zm4 16h8M12 17v4M8 10l3 3 5-5',
  ];
  return (
    <section id="how" aria-labelledby="how-heading" className="border-t border-[#E8E3DA] bg-white py-16 text-[#1C1B18] sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
              <span className="h-px w-7 bg-[#B98A4B]" aria-hidden="true" />Simple process
            </p>
            <h2 id="how-heading" className="mt-5 max-w-[20ch] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.04em]" data-reveal>
              From scan <span className="text-forest">to serving.</span>
            </h2>
          </div>
          <p className="max-w-[36ch] text-[15px] leading-relaxed text-[#6B665E]" data-reveal>
            Three steps. No guest app to download. Just a table card and a connected phone.
          </p>
        </div>

        <ol className="mt-10 grid gap-4 md:mt-14 md:grid-cols-3 md:gap-5" data-stagger>
          {STEPS.map((step, index) => (
            <li key={step.n} className="relative min-w-0 rounded-2xl border border-[#E8E3DA] bg-[#FBFAF7] p-6 motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-1 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-xl border border-[#E8E3DA] bg-white text-forest" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icons[index]} /></svg>
                </span>
                <span className="text-[11px] font-semibold tracking-[0.16em] text-[#6B665E]">STEP {step.n}</span>
              </div>
              <h3 className="mt-7 text-[19px] font-medium tracking-tight">{step.title}</h3>
              <p className="mt-3 text-[14px] leading-[1.75] text-[#6B665E]">{step.body}</p>
              <div className="mt-6 flex items-center gap-3 text-[11px] font-medium text-forest">
                <span className="h-px w-5 bg-[#B98A4B]" aria-hidden="true" />
                {['Your menu, ready for the room', 'Their phone. Your menu.', 'Your team stays in control'][index]}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-7 text-[12px] leading-relaxed text-[#6B665E]">Guests order in their browser. Staff manage service from the kitchen and counter screens.</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- screens */

function Screens() {
  const panels = [
    { kicker: 'Guest menu', title: 'Browse the menu', body: 'Photos, prices and dish details, together on the guest’s phone.' },
    { kicker: 'Guest order', title: 'Customise the order', body: 'Choose available portions and add-ons. Check the total before ordering.' },
    { kicker: 'Kitchen board', title: 'Keep service moving', body: 'See the table, dishes and notes. Update each ticket as the kitchen works.' },
  ];
  return (
    <section id="screens" aria-labelledby="screens-heading" className="border-t border-[#E8E3DA] bg-[#FBFAF7] py-16 text-[#1C1B18] sm:py-24 lg:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">
          <span className="h-px w-7 bg-[#B98A4B]" aria-hidden="true" />The product
        </p>
        <h2 id="screens-heading" className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.04em]" data-reveal>
          Three screens, in service order.
        </h2>
        <p className="mt-5 max-w-[55ch] text-[15px] leading-relaxed text-[#6B665E]" data-reveal>One journey from the first look at the menu to the ticket on the kitchen board.</p>
        <p className="mt-3 text-[12px] text-[#6B665E]">Illustrative product previews · sample dishes and tickets</p>

        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-3" data-stagger>
          {panels.map((panel, index) => (
            <article key={panel.title} data-tour-panel className="min-w-0 overflow-hidden rounded-2xl border border-[#E8E3DA] bg-white shadow-[0_6px_28px_rgba(28,27,24,0.03)]">
              <div className="overflow-hidden border-b border-[#E8E3DA] bg-[#E9F0EA]/60 px-5 pt-7 sm:px-7" aria-hidden="true">
                <div className="mx-auto h-[280px] max-w-[280px] overflow-hidden rounded-t-2xl border border-[#E8E3DA] bg-white p-4 shadow-[0_6px_24px_rgba(31,77,58,0.06)]">
                  <div className="flex items-center justify-between border-b border-[#E8E3DA] pb-3 text-[10px] text-[#6B665E]">
                    <span className="font-semibold text-forest">AutoDine</span><span>Table 05</span>
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
                      <p className="mt-4 text-[17px] font-medium tracking-tight">Make it yours.</p>
                      <p className="mt-1 text-[10px] text-[#6B665E]">Paneer tikka · ₹260</p>
                      <p className="mt-5 text-[10px] font-medium">Portion</p>
                      <div className="mt-2 flex gap-2 text-[10px]"><span className="rounded-lg border border-forest bg-[#E9F0EA] px-3 py-2 text-forest">Full</span><span className="rounded-lg border border-[#E8E3DA] px-3 py-2">Half</span></div>
                      <div className="mt-4 rounded-lg border border-[#E8E3DA] bg-[#FBFAF7] p-3 text-[10px] text-[#6B665E]">Kitchen note: less spicy, please.</div>
                      <div className="mt-4 flex justify-between rounded-lg bg-forest p-3 text-[11px] font-medium text-white"><span>1 item · Full portion</span><span>₹260</span></div>
                    </>
                  ) : (
                    <>
                      <div className="mt-4 flex items-center justify-between"><p className="text-[17px] font-medium tracking-tight">In the kitchen</p><span className="h-2 w-2 rounded-full bg-forest" /></div>
                      {[{ code: 'A-1042', state: 'New', dish: '1 × Paneer tikka', note: 'Less spicy, please.' }, { code: 'A-1041', state: 'Preparing', dish: '2 × Butter naan', note: 'Table 03' }].map(ticket => (
                        <div key={ticket.code} className="mt-3 rounded-xl border border-[#E8E3DA] p-3">
                          <div className="flex justify-between gap-2 text-[10px] font-medium"><span>{ticket.code}</span><span className="rounded-full bg-[#E9F0EA] px-2 py-0.5 text-forest">{ticket.state}</span></div>
                          <p className="mt-2 text-[11px]">{ticket.dish}</p><p className="mt-1 text-[10px] text-[#6B665E]">{ticket.note}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
              <div className="p-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-forest">{String(index + 1).padStart(2, '0')} / {panel.kicker}</p>
                <h3 className="mt-3 text-[19px] font-medium tracking-tight">{panel.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#6B665E]">{panel.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-start justify-between gap-5 rounded-2xl border border-[#E8E3DA] bg-white p-6 sm:flex-row sm:items-center">
          <p className="max-w-[45ch] text-[14px] leading-relaxed text-[#6B665E]">Built around your menu, your tables and the people running your restaurant.</p>
          <Link href="/signup" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 rounded-full bg-forest px-6 py-3 text-[13px] font-medium text-white motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest">Set up your restaurant <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- features */

function Features() {
  return (
    <section id="product" aria-labelledby="features-heading" className="border-t border-ink-line bg-white py-16 sm:py-24">
      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Built for real restaurants</p>
          <h2 id="features-heading" className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
            Made for the people running the room.
          </h2>
          <p className="mt-4 max-w-[42ch] text-[15px] leading-[1.6] text-mute" data-reveal>
            For the room, not a dashboard with a menu bolted on.
          </p>


        </div>

        <ul className="grid gap-4 sm:grid-cols-2" data-stagger>
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="public-card rounded-2xl border border-ink-line bg-ink p-6"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-forest-soft text-forest" aria-hidden="true">
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
    <section id="status" aria-labelledby="status-heading" className="border-t border-ink-line bg-ink py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <h2 id="status-heading" className="text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          {/* Spelled out from the lists, never typed: a number in a headline
              is the first thing to go stale. */}
          {`${NumberWord(LIVE.length)} things work. ${NumberWord(NOT_CONNECTED.length)} do not.`}
        </h2>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-[1.6] text-mute" data-reveal>
          A working product in preview. Its real state, not a launch badge.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-forest/20 bg-white p-6 sm:p-8" data-reveal>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Live now</p>
            <ul className="mt-5 space-y-3">
              {LIVE.map((item) => (
                <li key={item.id} className="flex gap-3 text-[13.5px] leading-relaxed text-mute">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-forest" aria-hidden="true" />
                  <span><span className="text-cream">{item.label}</span> — {item.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-ink-line bg-white p-6 sm:p-8" data-reveal>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-mute">Not connected</p>
            <ul className="mt-5 space-y-3">
              {NOT_CONNECTED.map((item) => (
                <li key={item.id} className="flex gap-3 text-[13.5px] leading-relaxed text-mute">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8C857A]" aria-hidden="true" />
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
    <section id="pricing" aria-labelledby="pricing-heading" className="border-t border-ink-line bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Simple pricing</p>
        <h2 id="pricing-heading" className="mt-5 text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.04em]" data-reveal>
          Start with what you need.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-[1.6] text-mute" data-reveal>
          Three sizes. Seven free days. No card to begin.
        </p>

        <div className="mt-12 grid gap-5 lg:grid-cols-3" data-stagger>
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`public-card relative flex min-w-0 flex-col rounded-2xl border p-6 sm:p-7 ${
                plan.recommended
                  ? 'border-forest/40 bg-forest-soft'
                  : 'border-ink-line bg-ink-card'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-7 rounded-full bg-forest px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                  Recommended
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
          trial is a real seven days, enforced on the server — after it ends the workspace is
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
      <div className="relative isolate overflow-hidden">
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
            Bring a better ordering experience to your restaurant.
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[14.5px] leading-relaxed text-mute" data-reveal>
            A calmer service starts with a connected menu, kitchen and counter.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3" data-reveal>
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-forest px-7 text-[14px] font-medium text-white transition-colors hover:bg-forest-strong"
            >
              Create your restaurant <span aria-hidden="true">→</span>
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
            <Link href="/pricing" className="hover:text-cream">Pricing</Link>
            <Link href="/login" className="hover:text-cream">Sign in</Link>
            <Link href="/signup" className="hover:text-cream">Create account</Link>
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
