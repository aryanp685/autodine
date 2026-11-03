/**
 * Four visual directions for the landing surface, built from the REAL UI
 * (same tokens, same type scale, same components-in-spirit) so the choice is
 * made on the actual product, not on an AI picture of it.
 *
 * The brief from the owner, applied to every option:
 *   - the restaurant photograph is good but must READ — darker treatment
 *   - cut the AI-flavoured filler lines everywhere; one thought per line
 *   - simple, professional, modern tech; minimalist; nothing extra
 *   - proper colour grades, sizes and shapes; easy to understand
 *
 * TEMPORARY review surface — one option wins, this route retires.
 */

import Image from 'next/image';
import Link from 'next/link';

const FEATURES = [
  {
    title: 'QR ordering',
    body: 'No app, no account. Scan the table card and order.',
  },
  {
    title: 'Kitchen display',
    body: 'Tickets arrive live, with the table and the note.',
  },
  {
    title: 'Counter billing',
    body: 'Cash or UPI, confirmed in one tap.',
  },
];

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${dark ? 'text-white/70' : 'text-plum'}`}
    >
      {children}
    </p>
  );
}

function PrimaryCta() {
  return (
    <Link
      href="/signup"
      className="inline-flex h-12 items-center gap-2 rounded-full bg-plum px-6 text-[14px] font-medium text-white transition-colors hover:bg-plum-strong"
    >
      Start the 7-day trial
      <span aria-hidden="true">→</span>
    </Link>
  );
}

function OutlineCta({ dark = false }: { dark?: boolean }) {
  return (
    <Link
      href="/pricing"
      className={`inline-flex h-12 items-center rounded-full border px-6 text-[14px] transition-colors ${
        dark
          ? 'border-white/35 text-white hover:bg-white/10'
          : 'border-cream/20 text-cream hover:bg-cream/[0.05]'
      }`}
    >
      See pricing
    </Link>
  );
}

function FeatureCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {FEATURES.map((f) => (
        <div key={f.title} className="rounded-[18px] border border-cream/15 bg-ink-card p-5">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-cream">{f.title}</h3>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-mute">{f.body}</p>
        </div>
      ))}
    </div>
  );
}

function ClosingBand() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[18px] border border-cream/15 bg-ink-card px-6 py-5">
      <p className="text-[15px] font-medium text-cream">Start the 7-day trial — no card.</p>
      <div className="ml-auto">
        <PrimaryCta />
      </div>
    </div>
  );
}

function OptionLabel({ id, title }: { id: string; title: string }) {
  return (
    <div className="mb-6 flex items-baseline gap-3">
      <span className="rounded-full bg-plum-soft px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-plum">
        Option {id}
      </span>
      <h2 className="text-[15px] font-semibold text-cream">{title}</h2>
    </div>
  );
}

/* ------------------------------------------------------------------ 1 */

function OptionOne() {
  return (
    <section id="opt-1" className="scroll-mt-16 border-t border-cream/12 py-10">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <OptionLabel id="1" title="Photo hero — the room speaks first" />
      </div>

      <div className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Image
            src="/img/restaurant-interior.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(12_11_9/0.82),rgb(12_11_9/0.42)_55%,rgb(12_11_9/0.62))]"
          aria-hidden="true"
        />

        <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-20 sm:px-8 sm:pt-28">
          <Eyebrow dark>QR ordering · Kitchen · Billing</Eyebrow>
          <h1 className="mt-5 max-w-[15ch] text-[clamp(2.5rem,6vw,4.2rem)] font-medium leading-[1.0] tracking-[-0.04em] text-white">
            Every table, one seamless experience.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.6] text-white/80">
            Scan the table card. Order on the phone. The kitchen sees it instantly.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryCta />
            <OutlineCta dark />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8">
        <FeatureCards />
        <div className="mt-6">
          <ClosingBand />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 2 */

function OptionTwo() {
  return (
    <section id="opt-2" className="scroll-mt-16 border-t border-cream/12 py-10">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <OptionLabel id="2" title="Porcelain hero, photo band below" />

        <Eyebrow>QR ordering · Kitchen · Billing</Eyebrow>
        <h1 className="mt-5 max-w-[16ch] text-[clamp(2.5rem,6vw,4.2rem)] font-medium leading-[1.0] tracking-[-0.04em] text-cream">
          One system, from scan to bill.
        </h1>
        <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.6] text-mute">
          The guest orders from the table. The kitchen and the counter work the same live ticket.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <PrimaryCta />
          <OutlineCta />
        </div>
      </div>

      <div className="relative isolate mt-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Image
            src="/img/restaurant-interior.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(12_11_9/0.78),rgb(12_11_9/0.3))]"
          aria-hidden="true"
        />
        <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8">
          <p className="max-w-[22ch] text-[clamp(1.35rem,2.6vw,1.9rem)] font-medium leading-[1.25] tracking-[-0.02em] text-white">
            The room stays calm because the software stays quiet.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8">
        <FeatureCards />
        <div className="mt-6">
          <ClosingBand />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 3 */

function OptionThree() {
  return (
    <section id="opt-3" className="scroll-mt-16 border-t border-cream/12 py-10">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <OptionLabel id="3" title="Split — calm type left, the room right" />

        <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <Eyebrow>QR ordering · Kitchen · Billing</Eyebrow>
            <h1 className="mt-5 text-[clamp(2.4rem,5.4vw,3.9rem)] font-medium leading-[1.02] tracking-[-0.04em] text-cream">
              Run the room,
              <br />
              not the paperwork.
            </h1>
            <p className="mt-6 max-w-[42ch] text-[15px] leading-[1.6] text-mute">
              Menu on the wall, orders in the kitchen, bills at the counter — one system.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryCta />
              <OutlineCta />
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[22px]">
            <Image
              src="/img/restaurant-interior.jpg"
              alt="A restaurant dining room"
              width={1200}
              height={900}
              className="h-[320px] w-full object-cover object-center sm:h-[420px]"
            />
            <div
              className="absolute inset-0 bg-[linear-gradient(to_top,rgb(12_11_9/0.55),rgb(12_11_9/0.1))]"
              aria-hidden="true"
            />
            <div className="absolute bottom-4 left-4 right-4 rounded-[14px] border border-white/25 bg-white/12 px-4 py-3 backdrop-blur-md">
              <p className="text-[12.5px] font-medium text-white">Table 05 · 2 guests</p>
              <p className="mt-0.5 text-[11.5px] text-white/75">Order placed · kitchen cooking</p>
            </div>
          </div>
        </div>

        <div className="mt-12">
          <FeatureCards />
        </div>
        <div className="mt-6">
          <ClosingBand />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 4 */

function OptionFour() {
  return (
    <section id="opt-4" className="scroll-mt-16 border-t border-cream/12 py-10">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <OptionLabel id="4" title="Centred and quiet — one message" />

        <div className="mx-auto max-w-[640px] text-center">
          <Eyebrow>QR ordering · Kitchen · Billing</Eyebrow>
          <h1 className="mt-5 text-[clamp(2.5rem,6vw,4.1rem)] font-medium leading-[1.0] tracking-[-0.04em] text-cream">
            Every table, one seamless experience.
          </h1>
          <p className="mx-auto mt-6 max-w-[42ch] text-[15px] leading-[1.6] text-mute">
            Scan. Order. Cook. Bill. Nothing extra.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCta />
            <OutlineCta />
          </div>
        </div>
      </div>

      <div className="relative isolate mt-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Image
            src="/img/restaurant-interior.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(12_11_9/0.72),rgb(12_11_9/0.5))]"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-[1180px] gap-8 px-5 py-14 sm:grid-cols-3 sm:px-8">
          {[
            ['40s', 'from scan to a kitchen ticket'],
            ['0', 'apps for a guest to install'],
            ['1', 'live ticket from order to bill'],
          ].map(([n, line]) => (
            <div key={n}>
              <p className="text-[clamp(1.8rem,3vw,2.4rem)] font-semibold tracking-[-0.02em] text-white">
                {n}
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.5] text-white/75">{line}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8">
        <FeatureCards />
        <div className="mt-6">
          <ClosingBand />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- shell */

const OPTIONS = [
  ['1', 'Photo hero'],
  ['2', 'Porcelain hero'],
  ['3', 'Split'],
  ['4', 'Centred'],
] as const;

export function DesignOptionsScreen() {
  return (
    <div className="min-h-screen bg-ink text-cream antialiased">
      <header className="sticky top-0 z-50 border-b border-cream/12 bg-ink/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-4 px-5 sm:px-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-plum">
            Design review
          </p>
          <nav aria-label="Options" className="ml-auto flex items-center gap-1.5">
            {OPTIONS.map(([id, label]) => (
              <a
                key={id}
                href={`#opt-${id}`}
                className="rounded-full border border-cream/15 px-3 py-1.5 text-[12px] text-cream transition-colors hover:bg-cream/[0.06]"
              >
                {id} · {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <p className="mx-auto max-w-[1180px] px-5 pt-8 text-[12.5px] leading-[1.6] text-mute-dim sm:px-8">
        Four directions, same product. Restaurant photo darker and visible, filler copy cut,
        everything else the existing system.
      </p>

      <OptionOne />
      <OptionTwo />
      <OptionThree />
      <OptionFour />
    </div>
  );
}
