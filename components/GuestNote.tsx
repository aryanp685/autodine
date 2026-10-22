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

export function GuestNote({
  eyebrow,
  title,
  children,
  foot,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  /** Quiet line under a hairline: where to go if this is not what was wanted. */
  foot?: ReactNode;
}) {
  return (
    <div className="gnote">
      <header className="gnote__bar">
        <Link href="/" className="gnote__brand">
          AutoDine
        </Link>
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
