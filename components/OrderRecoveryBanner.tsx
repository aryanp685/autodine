'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { browserStorage, rememberLastCart, rememberLastOrder } from '@/lib/guest-orders';
import {
  clearPendingOrderAttempt,
  markPendingOrderOutcome,
  readPendingOrderAttempt,
  type PendingOrderAttempt,
} from '@/lib/order-recovery';

/**
 * Keeps failed or dropped checkout attempts visibly surfaced and recovers
 * state on reconnect without creating duplicate orders.
 *
 * When a browser loses network right after submitting an order, the server may
 * have already committed it. Re-submitting with a fresh key would duplicate the
 * ticket; querying `/api/orders/recover` with the stored `attemptToken` first
 * resolves whether the kitchen already received it and lands straight on
 * `/menu/order` with zero duplicate.
 */
export function OrderRecoveryBanner({
  slug,
  placedError,
  placedErrorCode,
  mode = 'summary',
  onRetryForm,
}: {
  slug?: string | null;
  placedError?: string;
  placedErrorCode?: string;
  mode?: 'checkout' | 'summary';
  onRetryForm?: () => void;
}) {
  const cart = useCart();
  const [attempt, setAttempt] = useState<PendingOrderAttempt | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cleanSlug = slug?.trim() ?? '';

  const checkServer = useCallback(
    async (target: PendingOrderAttempt) => {
      if (!cleanSlug || checking) return;
      setChecking(true);
      setNotice(null);
      try {
        const res = await fetch('/api/orders/recover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ s: cleanSlug, attempt: target.attemptToken }),
        });
        if (!res.ok) {
          const updated = markPendingOrderOutcome(browserStorage(), cleanSlug, 'pending_recovery', {
            errorMessage: 'Still unable to reach the restaurant server. Your order draft is saved here.',
            lastCheckedAt: new Date().toISOString(),
          });
          if (updated) setAttempt(updated);
          setNotice('Server is still unreachable. Your order stays saved and will check again once reconnected.');
          return;
        }
        const data = (await res.json()) as {
          ok?: boolean;
          found?: boolean;
          code?: string;
          placedAt?: string;
        };
        if (data.ok && data.found && data.code) {
          const storage = browserStorage();
          if (cart.ready && cart.lines.length > 0) {
            rememberLastCart(storage, cleanSlug, cart.lines);
            cart.clear();
          }
          rememberLastOrder(storage, cleanSlug, {
            code: data.code,
            token: target.attemptToken,
            placedAt: data.placedAt || new Date().toISOString(),
          });
          clearPendingOrderAttempt(storage, cleanSlug);
          setAttempt(null);
          window.location.assign(
            `/menu/order?s=${encodeURIComponent(cleanSlug)}&code=${encodeURIComponent(data.code)}&t=${encodeURIComponent(target.attemptToken)}&placed=1`,
          );
          return;
        }

        const updated = markPendingOrderOutcome(browserStorage(), cleanSlug, 'failed', {
          errorMessage: target.errorMessage || 'The kitchen has not received this order yet.',
          lastCheckedAt: new Date().toISOString(),
        });
        if (updated) setAttempt(updated);
        setNotice('Checked with the server: not placed yet. Safe to retry with the same confirmation key.');
      } catch {
        const updated = markPendingOrderOutcome(browserStorage(), cleanSlug, 'pending_recovery', {
          errorMessage: 'Connection offline — saved locally until connection returns.',
          lastCheckedAt: new Date().toISOString(),
        });
        if (updated) setAttempt(updated);
        setNotice('Offline right now. Your pending order stays visible here.');
      } finally {
        setChecking(false);
      }
    },
    [cart, checking, cleanSlug],
  );

  const checkServerRef = useRef(checkServer);
  checkServerRef.current = checkServer;

  useEffect(() => {
    if (!cleanSlug) return;
    const storage = browserStorage();
    if (placedError) {
      const updated = markPendingOrderOutcome(storage, cleanSlug, 'failed', {
        errorMessage: placedError,
        errorCode: placedErrorCode ?? null,
      });
      if (updated) {
        setAttempt(updated);
        return;
      }
    }
    const existing = readPendingOrderAttempt(storage, cleanSlug);
    setAttempt(existing);
    if (existing && (existing.status === 'submitting' || existing.status === 'pending_recovery')) {
      void checkServerRef.current(existing);
    }
  }, [cleanSlug, placedError, placedErrorCode]);

  useEffect(() => {
    if (!cleanSlug || !attempt) return;
    const onOnline = () => {
      if (attempt.status === 'submitting' || attempt.status === 'pending_recovery') {
        void checkServer(attempt);
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [attempt, checkServer, cleanSlug]);

  if (!cleanSlug || !attempt) return null;

  const isPending = attempt.status === 'submitting' || attempt.status === 'pending_recovery';
  const checkoutHref = `/menu/checkout?s=${encodeURIComponent(cleanSlug)}`;

  return (
    <div
      role="status"
      data-order-recovery={attempt.status}
      className="g-panel border-[color-mix(in_oklab,var(--alert)_28%,transparent)] px-4 py-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklab,var(--alert)_12%,white)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--alert)]">
              {isPending ? 'Pending confirmation' : 'Order failed — saved'}
            </span>
            <span className="tnum text-[11.5px] text-gink-46">
              {attempt.itemCount} {attempt.itemCount === 1 ? 'item' : 'items'} · Key{' '}
              {attempt.attemptToken.slice(0, 8).toUpperCase()}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-gink-80">
            {attempt.errorMessage ??
              (isPending
                ? 'Checking whether the kitchen received your order. Do not worry — retrying with this key will never duplicate your order.'
                : 'Your previous order attempt did not go through. Your dishes and confirmation key are preserved.')}
          </p>
          {notice ? (
            <p className="mt-1 text-[11.5px] leading-[1.45] text-gink-64">{notice}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            clearPendingOrderAttempt(browserStorage(), cleanSlug);
            setAttempt(null);
          }}
          className="text-[11.5px] font-medium text-gink-46 underline underline-offset-2 hover:text-gink"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={checking}
          onClick={() => void checkServer(attempt)}
          className="g-quiet rounded-full px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Check server status'}
        </button>

        {mode === 'checkout' && onRetryForm ? (
          <button
            type="button"
            disabled={checking}
            onClick={onRetryForm}
            className="g-primary rounded-full px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-60"
          >
            Retry safely
          </button>
        ) : (
          <Link
            href={checkoutHref}
            className="g-primary rounded-full px-3.5 py-2 text-[12.5px] font-semibold"
          >
            Review &amp; retry safely
          </Link>
        )}
      </div>
    </div>
  );
}
