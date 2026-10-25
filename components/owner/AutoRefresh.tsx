'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A refresh that nobody has to ask for.
 *
 * THE PROBLEM
 *
 * Every owner screen is server-rendered from a database read. Only the kitchen
 * board ever refreshed itself, because a ticket that arrives late is food that
 * does not get cooked. The overview and the ledger had the same problem in a
 * quieter form: an order placed at 9:14 was invisible on the owner's laptop
 * until they pressed reload or changed a filter -- which is the manual work
 * this product exists to remove.
 *
 * WHAT THIS DOES
 *
 * Calls `router.refresh()` on an interval. That re-runs the Server Component
 * and patches the tree in place, so the filter in the URL, the scroll position
 * and any open menu all survive; a full reload would lose them every minute.
 * It also refreshes once when a background tab comes back into view, so a
 * laptop opened after lunch is not showing the morning.
 *
 * WHAT IT REFUSES TO DO
 *
 *   - Nothing while the tab is hidden: an overnight dashboard should not query
 *     the database every 45 seconds for a screen nobody is looking at.
 *   - Nothing while somebody is typing: re-rendering under a half-typed value
 *     is how a form loses a character and a user stops trusting the screen.
 *   - Nothing in demo mode, and nothing for a signed-out viewer.
 *   - Nothing during server rendering. The router hook is only reached after
 *     mount, inside its own component, so the server pass emits an empty
 *     string and never asks for a router that is not there.
 *
 * The interval is deliberately slow. This is an operator's overview, not a
 * ticker; the kitchen board already has a realtime channel and its own
 * five-second safety net.
 */

/** Exported for the test: the whole decision, with no DOM and no hooks. */
export function shouldSkipRefresh(
  doc: { hidden?: boolean; activeElement?: { tagName?: string; isContentEditable?: boolean } | null } | null,
): boolean {
  if (!doc) return true;
  if (doc.hidden) return true;
  const active = doc.activeElement ?? null;
  if (!active) return false;
  if (active.isContentEditable) return true;
  const tag = (active.tagName ?? '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/** The loop itself. Mounted only on the client, which is why it may use the router. */
function RefreshLoop({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const every = Math.max(15, seconds) * 1000;

    const tick = () => {
      if (shouldSkipRefresh(typeof document === 'undefined' ? null : document)) return;
      router.refresh();
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) tick();
    };

    const id = window.setInterval(tick, every);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [seconds, router]);

  return null;
}

export function AutoRefresh({
  enabled,
  seconds = 45,
}: {
  /** False in demo mode and for a signed-out viewer. */
  enabled: boolean;
  /** Floor of 15s, so a typo in a call site cannot turn this into a hammer. */
  seconds?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!enabled || !mounted) return null;
  return <RefreshLoop seconds={seconds} />;
}
