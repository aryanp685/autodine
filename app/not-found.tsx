import type { Metadata } from 'next';
import Link from 'next/link';

import { GuestNote } from '@/components/GuestNote';

/**
 * The 404.
 *
 * Every route the product can reach ends somewhere sensible -- a dead QR card
 * goes to /t/problem, an old dish link says the dish is gone -- but a mistyped
 * address, a stale bookmark or a link to a deleted order still lands here, and
 * until now "here" was Next's own page: system font, black on white, no way
 * back into the product. It was the least designed screen in the app and the
 * one a visitor is most likely to see when something has already gone wrong.
 *
 * Written as a guest note, because that is the shell for every screen a person
 * reaches without a session: a wordmark, one sentence of explanation, one
 * action. It is a server component and it reads no data, so it renders even
 * when the database is down -- which is often why a 404 was reached at all.
 */

export const metadata: Metadata = {
  title: 'Page not found · AutoDine',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <GuestNote
      eyebrow="404"
      title="This page does not exist"
      foot={
        <>
          Scanning a card on a table? Ask staff for the current code — the card in
          front of you opens the menu, not an address you have to type.
        </>
      }
    >
      <p className="gnote__text">
        The link may be old, or the address may have a letter wrong in it. Nothing here is a
        dead end: the menu and the dashboard both have a way in.
      </p>

      <div className="gnote__actions">
        <Link className="gnote__cta" href="/">
          AutoDine home
        </Link>
        <Link className="gnote__cta gnote__cta--quiet" href="/pricing">
          What it costs
        </Link>
      </div>
    </GuestNote>
  );
}
