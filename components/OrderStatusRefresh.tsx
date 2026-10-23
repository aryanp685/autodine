'use client';

/**
 * Keeps the confirmation screen honest while the kitchen works.
 *
 * The order screen is a server component: it knows what the kitchen was doing
 * when the page was rendered, and nothing after that. A guest sits with it
 * open on the table for twenty minutes, so "Being cooked" is a claim that goes
 * stale in the most ordinary way possible -- the food arrives and the phone
 * still says it is being cooked.
 *
 * This re-renders the server component on a slow timer. Twenty-five seconds is
 * chosen against how the fact changes: a kitchen advances a ticket in minutes,
 * not seconds, and a faster poll would be load on the board with no more
 * truth.
 *
 * WHY IT IS ONLY MOUNTED WHEN THE ORDER IS LOCKED
 *
 * GuestOrderEditor holds the guest's unsaved quantities in local state. A
 * refresh replaces the props underneath it -- the lines and the subtotal --
 * while those edits are still sitting there, so a guest halfway through
 * removing a dish could watch the bill disagree with the list. Nobody is
 * editing once the kitchen has started, and that is exactly when the tracker
 * matters, so the poller is mounted then and only then.
 *
 * The chip it renders is part of the component rather than beside it, because
 * the claim "updates on its own" is only true while this is running.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function OrderStatusRefresh({ intervalMs = 25_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      // A background tab is not being read. Refreshing it would spend the
      // restaurant's database on a screen nobody is looking at.
      if (document.visibilityState === 'hidden') return;
      router.refresh();
    };

    const id = window.setInterval(tick, intervalMs);

    // Coming back to the tab is the moment the guest looks again, so that is
    // the moment worth a fresh read.
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, intervalMs]);

  return (
    <p className="inline-flex items-center gap-1.5 text-[11.5px] text-gink-46">
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-[var(--p-accent)] [animation:gbar_260ms_ease-out_both] motion-reduce:animate-none"
      />
      Status updates on its own — no need to reload
    </p>
  );
}
