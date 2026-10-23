import type { ReactNode } from 'react';
import Link from 'next/link';

/* ============================================================================
   The shell for every screen a guest can reach without a session: the bare
   menu link, the table gate, the six-digit code form, the dead-card page, the
   404 and the error screen.

   These are not error pages. They are the first thing a guest sees after
   scanning a card, and the design carries the same weight as the menu they are
   trying to open: one line of intent, one sentence of explanation, one action.

   WHY THE PIECES ARE EXPORTED

   Every one of these screens needs the same three elements -- a paragraph, a
   primary action, a quiet one -- and before this they each wrote their own
   class names against the guest stylesheet. Six screens meant six chances to
   drift. They now share these components, so a quieter button is quieter
   everywhere and a second action can never quietly become a second primary.

   Server Component -- the only client pieces in this flow are the code input
   and the error screen's retry.
   ========================================================================== */

/**
 * Where the guest is in the three steps that open a menu.
 *
 * The gate, the code form and the card-problem page are three answers to the
 * same question, and a guest can arrive at any of them from a link, a card or
 * a wrong code. Without this they cannot tell whether they are looking at the
 * start of the flow or two steps into it, which is the difference between
 * "scan a card" and "you are halfway there".
 *
 * Only the three real steps are named. Nothing here is a progress bar over
 * work the product does by itself -- each one is an action the guest takes.
 */
export type GuestStep = 'scan' | 'code' | 'menu';

const STEPS: ReadonlyArray<{ key: GuestStep; label: string }> = [
  { key: 'scan', label: 'Scan' },
  { key: 'code', label: 'Code' },
  { key: 'menu', label: 'Menu' },
];

export function GuestNote({
  eyebrow,
  title,
  steps,
  children,
  foot,
}: {
  eyebrow?: string;
  title: string;
  /** Which step this screen is, when the screen is part of opening a menu. */
  steps?: GuestStep;
  children: ReactNode;
  /** Quiet line under a hairline: where to go if this is not what was wanted. */
  foot?: ReactNode;
}) {
  const currentIndex = steps ? STEPS.findIndex((step) => step.key === steps) : -1;

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-gink">
      <header className="border-b border-hair">
        <div className="mx-auto flex h-14 w-full max-w-[620px] items-center gap-4 px-5">
          <Link
            href="/"
            className="text-[13px] font-semibold tracking-[0.14em] text-gink uppercase"
          >
            AutoDine
          </Link>

          {steps ? (
            <ol data-gnote-steps="" aria-label="Opening the menu" className="ml-auto flex items-center gap-2.5">
              {STEPS.map((step, index) => {
                const state =
                  index < currentIndex ? 'done' : index === currentIndex ? 'now' : 'todo';
                return (
                  <li
                    key={step.key}
                    data-gnote-step={state}
                    className={[
                      'flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.09em] uppercase',
                      state === 'now'
                        ? 'text-gink'
                        : state === 'done'
                          ? 'text-gink-46'
                          : 'text-gink-28',
                    ].join(' ')}
                  >
                    {/* The rule belongs to the step after the first: it is what
                        joins three words into one path. */}
                    {index > 0 ? (
                      <span
                        aria-hidden="true"
                        className={[
                          'h-px w-3',
                          state === 'todo' ? 'bg-gink-12' : 'bg-gink-28',
                        ].join(' ')}
                      />
                    ) : null}
                    <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <span>{step.label}</span>
                    {index === currentIndex ? <span className="sr-only">— you are here</span> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      </header>

      <main data-gnote-body="" className="mx-auto w-full max-w-[620px] flex-1 px-5 py-12">
        {eyebrow ? (
          <p
            data-gnote-eyebrow=""
            className="text-[10.5px] font-semibold tracking-[0.13em] text-gink-46 uppercase"
          >
            {eyebrow}
          </p>
        ) : null}

        <h1 className="mt-2.5 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance text-gink">
          {title}
        </h1>

        <div className="mt-4 text-[14.5px] leading-[1.6] text-gink-64">{children}</div>

        {foot ? (
          <>
            <hr className="mt-8 mb-3 border-hair" />
            <p className="text-[12px] leading-[1.6] text-gink-46 [&_a]:font-medium [&_a]:text-gink-64 [&_a]:underline [&_a]:underline-offset-2">
              {foot}
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

/** A paragraph in the body of a note. One measure, one colour. */
export function GuestNoteText({ children }: { children: ReactNode }) {
  return <p className="max-w-[54ch]">{children}</p>;
}

/** A stack of actions. The row wraps rather than shrinking a button. */
export function GuestNoteActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap items-center gap-2.5">{children}</div>;
}

/**
 * The one thing to do on this screen.
 *
 * `href` renders a link and no href a button, so the action is the element it
 * actually is -- a retry that is a link, or a navigation that is a button, is
 * both a lie to a keyboard.
 */
export function GuestNoteCta({
  href,
  onClick,
  quiet,
  children,
}: {
  href?: string;
  onClick?: () => void;
  /** The second action: same size, no fill, so there is one primary. */
  quiet?: boolean;
  children: ReactNode;
}) {
  const className = [
    'inline-flex h-11 items-center justify-center rounded-full px-5 text-[13px] font-semibold transition active:scale-[0.99]',
    quiet
      ? 'border border-hair-strong text-gink hover:bg-gink-07'
      : 'bg-gink text-onink hover:opacity-90',
  ].join(' ');

  if (href) {
    return (
      <Link href={href} data-gnote-cta={quiet ? 'quiet' : 'primary'} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" data-gnote-cta="primary" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

/** The quietest action: a link, not a button, because it is not the next step. */
export function GuestNoteGhost({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      data-gnote-ghost=""
      className="inline-flex h-11 items-center text-[13px] font-medium text-gink-64 underline decoration-gink-28 underline-offset-4 transition hover:text-gink"
    >
      {children}
    </Link>
  );
}

/** Something the guest must read before going on. Not red: nothing is broken. */
export function GuestNoteAlert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-2xl border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-4 py-3"
    >
      <strong className="block text-[13px] font-semibold text-gink">{title}</strong>
      <p className="mt-0.5 text-[12.5px] leading-[1.55] text-gink-64">{children}</p>
    </div>
  );
}
