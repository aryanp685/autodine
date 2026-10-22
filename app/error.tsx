'use client';

import Link from 'next/link';

import { GuestNote } from '@/components/GuestNote';

/**
 * What a break in a page looks like.
 *
 * Without this, a thrown error in any route renders Next's built-in screen:
 * black on white, system font, and a stack-trace-shaped void where the product
 * should be. That is the worst moment to look like a different application —
 * a manager whose dashboard failed needs to know whether the kitchen is still
 * running and how to get back, not how to read a React stack.
 *
 * Two deliberate things here:
 *
 *   - `reset()` retries the render. React unmounts and remounts the segment, so
 *     a temporary failure (a dropped request, a database that blinked) is one
 *     tap from working again, rather than a reload of the whole app.
 *   - it says what still works. Prep and payment are recorded on the server;
 *     a client crash does not lose an order that has already been written, and
 *     saying so stops somebody re-entering an order they think is gone.
 */

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <GuestNote
      eyebrow="Something went wrong"
      title="This screen could not load"
      foot={
        <>
          Nothing already recorded is lost — orders, payments and menu changes are written
          on the server, not in this tab. Reloading or opening another screen is safe.
        </>
      }
    >
      <p className="gnote__text">
        The page hit an error while it was being built. It is usually a dropped connection or a
        momentary database hiccup, and trying again is often enough.
      </p>

      <div className="gnote__actions">
        <button type="button" className="gnote__cta" onClick={() => reset()}>
          Try again
        </button>
        <Link className="gnote__cta gnote__cta--quiet" href="/dashboard">
          Back to the dashboard
        </Link>
      </div>
    </GuestNote>
  );
}
