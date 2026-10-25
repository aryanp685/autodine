'use client';

/**
 * The board a guest reads the code off.
 *
 * WHAT IT IS FOR
 *
 * The six digits a guest types are derived from a per-restaurant secret and the
 * current ten-minute window, so they change on their own and there is nothing
 * for staff to reset. What was missing was somewhere to SHOW them: the code
 * lived in a small panel at the top of the Tables screen, which is a screen an
 * owner uses, not one a guest can see. This page is that panel, at full size,
 * meant to be left open on a tablet or a TV facing the room.
 *
 * WHY IT REFRESHES ITSELF
 *
 * A tab left open shows whatever was rendered when it loaded. A host reading
 * yesterday's digits to a guest produces a wrong-code rejection that looks
 * exactly like a broken feature. So it asks the server to re-render half a
 * second after the window ends -- one timer, one navigation, no polling loop --
 * and the countdown says how long the digits on screen have left.
 *
 * WHY THE COUNTDOWN IS ALLOWED HERE
 *
 * On the guest's phone a ticking number next to the input would pull the eye
 * away from the thing they are typing; on a board that everybody is reading
 * from a distance, "new code in 3:12" is the whole point. It is also the only
 * honest way to explain why a code that worked a minute ago does not.
 *
 * Nothing here is a secret beyond the room: the code is only reachable through
 * current_verification_code(), which is granted to signed-in staff and checks
 * membership of the restaurant itself. There is no public endpoint for it.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dot } from '@/components/owner/chrome';

function clock(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function CodeDisplay({
  code,
  expiresAt,
  windowSeconds,
  restaurantName,
}: {
  code: string;
  /** When these digits stop working, from the database's own answer. */
  expiresAt: string;
  windowSeconds: number;
  restaurantName: string;
}) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const boundary = Date.parse(expiresAt);
    if (Number.isNaN(boundary)) return;

    // A second of ticking, and one navigation after the boundary. The extra
    // 800ms is slack for the next window to exist in the database before the
    // refreshed render asks for it.
    const tick = setInterval(() => setLeft(boundary - Date.now()), 1000);
    const refreshAt = setTimeout(
      () => router.refresh(),
      Math.max(boundary - Date.now() + 800, 800),
    );

    return () => {
      clearInterval(tick);
      clearTimeout(refreshAt);
    };
  }, [expiresAt, router]);

  const minutes = Math.max(1, Math.round(windowSeconds / 60));
  const endingSoon = left !== null && left <= 30_000;

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-gink">
      <div className="flex items-center justify-between gap-4 px-6 pt-5">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-gink-46 uppercase">
          {restaurantName} · Guest code
        </span>
        <a
          href="/dashboard/tables"
          className="text-[11.5px] font-medium text-gink-46 underline decoration-hair-strong underline-offset-4 hover:text-gink"
        >
          Tables &amp; QR
        </a>
      </div>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <p className="m-0 text-[13px] leading-[1.55] text-gink-64">
          Scan the QR code on your table, then type these six digits.
        </p>

        <div
          aria-live="polite"
          className="mt-6 rounded-[var(--p-r-card)] border border-hair bg-card px-6 py-8 sm:px-14 sm:py-10"
        >
          <div className="tnum text-[clamp(4rem,15vw,10rem)] leading-none font-medium tracking-[0.14em] text-gink">
            {code}
          </div>
        </div>

        <p className="mt-6 mb-0 flex items-center gap-2 text-[12.5px] text-gink-46">
          <Dot tone={endingSoon ? 'alert' : 'live'} />
          {left === null
            ? `New code every ${minutes === 1 ? 'minute' : `${minutes} minutes`}`
            : endingSoon
              ? `New code in ${clock(left)}`
              : `This code works for another ${clock(left)}`}
        </p>

        <p className="mt-8 max-w-[52ch] text-[11.5px] leading-[1.6] text-gink-46">
          Keep this screen where guests can see it. It changes by itself every{' '}
          {minutes === 1 ? 'minute' : `${minutes} minutes`} — nothing to reset, and nothing to
          send to anyone. A guest who cannot see it can ask any member of staff.
        </p>
      </main>
    </div>
  );
}
