'use client';

/** Refresh only when the server's order state changes. An unchanged status
 * must not replace props under unsaved guest edits. New/editable orders still
 * need polling: the kitchen can start or cancel them at any moment. */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createStatusPoller } from '@/lib/order-status-poller';
import { readOrderStatus } from '@/components/GuestLiveStatus';
import type { OrderStatusSnapshot } from '@/lib/guest-order-status';

export function OrderStatusRefresh({ slug, code, token, status, awaitingConfirmation, paymentStatus }: {
  slug: string; code: string; token: string;
  status: OrderStatusSnapshot['status']; awaitingConfirmation: boolean;
  paymentStatus: OrderStatusSnapshot['paymentStatus'];
}) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    let refreshing = false;
    const poller = createStatusPoller({
      request: () => readOrderStatus({ slug, code, token }),
      isHidden: () => document.visibilityState === 'hidden',
      onSnapshot: next => {
        if (!alive || refreshing) return;
        if (next.status !== status || next.awaitingConfirmation !== awaitingConfirmation || next.paymentStatus !== paymentStatus) {
          refreshing = true;
          router.refresh();
        }
      },
    });
    const onVisible = () => { if (document.visibilityState === 'visible') poller.pollNow(); };
    const onOnline = () => poller.pollNow();
    poller.start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      poller.stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [router, slug, code, token, status, awaitingConfirmation, paymentStatus]);

  return (
    <p className="inline-flex items-center gap-1.5 text-[11.5px] text-gink-46">
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-grass [animation:gbar_260ms_ease-out_both] motion-reduce:animate-none"
      />
      Status updates on its own — no need to reload
    </p>
  );
}
