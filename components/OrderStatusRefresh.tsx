'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createStatusPoller } from '@/lib/order-status-poller';
import { readOrderStatus } from '@/components/GuestLiveStatus';
import { guestStatus, mayReplaceStatus } from '@/lib/guest-order-status';
import { revisionNumber } from '@/lib/realtime-revisions';

/** An unchanged version never interrupts the editor. A failed RSC refresh
 * doesn't acknowledge the revision: retry until the page has actually caught up. */
export function OrderStatusRefresh({ slug, code, token, status, awaitingConfirmation, paymentStatus, revision }: {
  slug: string; code: string; token: string;
  status: string; awaitingConfirmation: boolean; paymentStatus: string; revision?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    let alive = true;
    let lastRequest = -Infinity;
    const refresh = () => {
      if (!alive || performance.now() - lastRequest < 4_000) return;
      lastRequest = performance.now();
      startTransition(() => router.refresh());
    };
    const poller = createStatusPoller({
      watchPayment: true, stopAtTerminal: false,
      request: signal => readOrderStatus({ slug, code, token }, signal),
      isHidden: () => document.hidden || !navigator.onLine,
      onSnapshot: next => {
        const current = revisionNumber(revision);
        const received = revisionNumber(next.revision);
        if (current !== null && received !== null) {
          if (received > current) refresh();
          return;
        }
        const before = guestStatus({ prepStatus: status, awaitingConfirmation }).key;
        const after = guestStatus({ prepStatus: next.status, awaitingConfirmation: next.awaitingConfirmation }).key;
        if (mayReplaceStatus(before, after) && (before !== after || next.paymentStatus !== paymentStatus)) refresh();
      },
      onMissing: refresh,
      onState: state => { if (alive) setDegraded(state.failures > 0); },
    });
    const onVisible = () => { if (!document.hidden) poller.pollNow(); };
    const onOffline = () => setDegraded(true);
    poller.start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('offline', onOffline);
    return () => {
      alive = false;
      poller.stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('offline', onOffline);
    };
  }, [router, slug, code, token, status, awaitingConfirmation, paymentStatus, revision, startTransition]);

  return (
    <p role="status" className="inline-flex items-center gap-1.5 text-[11.5px] text-gink-46">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${degraded ? 'bg-gink-28' : 'bg-grass'}`} />
      {degraded ? 'Showing the last received status — checking again' : 'Status updates on its own — no need to reload'}
    </p>
  );
}
