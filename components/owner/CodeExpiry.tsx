'use client';

/**
 * "New code in 3:12" — and the refresh that makes it true.
 *
 * WHY A COUNTDOWN AND NOT JUST THE RULE
 *
 * The panel used to say "changes every 10 minutes", which is a fact about the
 * system rather than about the code on screen. A host reading digits to a
 * guest has one question -- do these still work? -- and a countdown answers it
 * without them doing arithmetic against a wall clock that may not agree with
 * the server's.
 *
 * WHY IT ALSO REFRESHES
 *
 * A dashboard tab left open on a host desk shows whatever was rendered when it
 * loaded, and the code is derived from a time window rather than stored, so
 * that render goes stale on its own. Half a second after the window ends this
 * asks the server for a re-render -- one timer, no polling loop -- and the
 * server decides the next code, exactly as it decided this one.
 *
 * The countdown only starts on the client, so the server-rendered markup has
 * no time in it to disagree with the browser's clock.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function CodeExpiry({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    const boundary = Date.parse(expiresAt);
    if (Number.isNaN(boundary)) return;

    setMsLeft(boundary - Date.now());
    const tick = setInterval(() => setMsLeft(boundary - Date.now()), 1000);
    const refreshAt = setTimeout(
      () => router.refresh(),
      // The next window has to exist before the refreshed render asks for it.
      Math.max(boundary - Date.now() + 800, 800),
    );

    return () => {
      clearInterval(tick);
      clearTimeout(refreshAt);
    };
  }, [expiresAt, router]);

  if (msLeft === null) {
    return (
      <span className="text-[10.5px] tracking-[0.06em] text-gink-46 uppercase">
        refreshes on its own
      </span>
    );
  }

  const total = Math.max(0, Math.floor(msLeft / 1000));
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  const ending = msLeft <= 30_000;

  return (
    <span
      aria-live="polite"
      className={[
        'tnum text-[10.5px] tracking-[0.06em] uppercase',
        ending ? 'text-[var(--p-due)]' : 'text-gink-46',
      ].join(' ')}
    >
      {ending ? `new code in ${clock}` : `works for ${clock}`}
    </span>
  );
}
