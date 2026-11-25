'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WelcomeSplash } from '@/components/auth/WelcomeSplash';

const SEEN_KEY = 'autodine:signup-welcome-seen';

/**
 * Mounts the welcome splash on the confirmation-pending page.
 *
 * It plays on the first arrival after signup (whatever the signup result, so
 * the anti-enumeration response stays identical), once per browser session,
 * or whenever `?welcome=1` is present. The replay button is always there.
 */
export function SignupWelcome() {
  const [open, setOpen] = useState(false);
  const replayRef = useRef<HTMLButtonElement>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;

    const url = new URL(window.location.href);
    const forced = url.searchParams.get('welcome') === '1';
    if (forced) {
      url.searchParams.delete('welcome');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === '1';
      window.sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      seen = false;
    }

    if (forced || !seen) setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => replayRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <div className="mt-6 flex justify-center">
        <button
          ref={replayRef}
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hair px-4 text-[12.5px] font-medium text-gink-64 transition-colors duration-200 hover:border-forest/30 hover:text-gink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--auth-accent-ink)] motion-reduce:transition-none"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 9.5a5.5 5.5 0 0 1 10.4-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M13 3v4.5H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Replay welcome
        </button>
      </div>
      <WelcomeSplash open={open} onClose={close} />
    </>
  );
}
