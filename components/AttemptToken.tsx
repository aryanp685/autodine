'use client';

/**
 * One checkout attempt, one key.
 *
 * Persists and reuses the active attempt UUID when the guest retries or
 * reloads the exact same cart after a failed/dropped submission, so network
 * retries and double-taps always converge on at most one server order.
 *
 * When the previous order was confirmed (`ClearCartOnOrder` removes the pending
 * entry) or when the guest modifies the cart, a fresh UUID is minted.
 */
import { useEffect, useRef } from 'react';
import { ensurePendingAttemptToken, generateAttemptUuid, readPendingOrderAttempt } from '@/lib/order-recovery';
import { browserStorage } from '@/lib/guest-orders';
import type { StoredLine } from '@/lib/cart-storage';

export function AttemptToken({
  name = 'attempt',
  slug,
  lines = [],
  cartSignature = '',
}: {
  name?: string;
  slug?: string;
  lines?: StoredLine[];
  cartSignature?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const linesRef = useRef<StoredLine[]>(lines);
  linesRef.current = lines;

  useEffect(() => {
    const syncToken = () => {
      if (!ref.current) return;
      if (slug && linesRef.current.length > 0) {
        const { token } = ensurePendingAttemptToken(browserStorage(), slug, linesRef.current);
        ref.current.value = token;
        return;
      }
      ref.current.value = generateAttemptUuid();
    };

    syncToken();

    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !ref.current) return;
      if (slug) {
        const pending = readPendingOrderAttempt(browserStorage(), slug);
        if (pending) {
          ref.current.value = pending.attemptToken;
          return;
        }
      }
      syncToken();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [slug, cartSignature]);

  return <input ref={ref} type="hidden" name={name} defaultValue="" />;
}
