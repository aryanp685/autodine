import type { ReactNode } from 'react';
import Link from 'next/link';

/* ============================================================================
   The shell for every screen a guest can reach without a session: the bare
   menu link, the table gate, and the six-digit code form.

   These are not error pages. They are the first thing a guest sees after
   scanning a card, and the design carries the same weight as the menu they are
   trying to open: one line of intent, one sentence of explanation, one action.

   Server Component -- the only client piece in this flow is the code input.
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
    <div className="gnote">
      <header className="gnote__bar">
        <Link href="/" className="gnote__brand">
          AutoDine
        </Link>
        {steps ? (
          <ol className="gnote__steps" aria-label="Opening the menu">
            {STEPS.map((step, index) => {
              const state =
                index < currentIndex ? 'is-done' : index === currentIndex ? 'is-now' : 'is-todo';
              return (
                <li key={step.key} className={`gnote__step ${state}`}>
                  {index > 0 ? <span className="gnote__stepRule" aria-hidden="true" /> : null}
                  <span className="gnote__stepNum tnum">{String(index + 1).padStart(2, '0')}</span>
                  <span className="gnote__stepLabel">{step.label}</span>
                  {index === currentIndex ? <span className="gnote__sr">— you are here</span> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </header>

      <main className="gnote__body">
        {eyebrow ? <p className="gnote__eyebrow">{eyebrow}</p> : null}
        <h1 className="gnote__title">{title}</h1>
        {children}
        {foot ? (
          <>
            <hr className="gnote__rule" />
            <p className="gnote__hint">{foot}</p>
          </>
        ) : null}
      </main>
    </div>
  );
}
