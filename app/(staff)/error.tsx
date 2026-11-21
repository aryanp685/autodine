'use client';

import { useEffect } from 'react';
import { btn } from '@/components/owner/chrome';

/**
 * A page crashed. The navigation did not.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * There was no staff error boundary, so a throw inside any staff screen was
 * caught by `app/error.tsx` -- a boundary that sits ABOVE the shell. The whole
 * document was replaced, rail included, and the person was left on an error
 * card with no navigation and no way back except the browser's Back button.
 *
 * Because this file sits inside `app/(staff)/`, it renders BELOW the layout:
 * the rail is still there, still highlights the section, and every other
 * destination still works. Only the content is replaced.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not retry automatically -- an error loop that re-runs the failing
 * query every 200ms is worse for the database than for the person. It offers a
 * retry, and it says what the person can do right now, because a staff member
 * on a shift needs an action rather than a stack trace. The digest is shown
 * because it is the one thing that makes a support message traceable, and it
 * is the only detail Next guarantees is safe to display.
 */
export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged this; the browser console keeps the correlation
    // between what the person saw and what the log says.
    console.error('[staff] screen failed', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-[560px] py-10">
      <p className="text-[10.5px] font-semibold tracking-[0.18em] text-gink-46 uppercase">
        Something broke on this screen
      </p>
      <h1 className="mt-3 text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] text-gink">
        The rest of the dashboard still works
      </h1>
      <p className="mt-3 text-[13.5px] leading-[1.6] text-gink-64">
        This page could not be loaded. The navigation on the left is unaffected, so you can open
        another screen, or try this one again. Nothing was saved by the attempt that failed.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={reset} className={btn('solid')}>
          Try again
        </button>
        <a href="/dashboard" className={btn('ghost')}>
          Back to overview
        </a>
      </div>

      {error.digest ? (
        <p className="mt-5 text-[11.5px] text-gink-46">
          Reference for support: <span className="font-mono text-gink-64">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
