'use client';

/**
 * The live status of the guest's last order, on the Orders tab.
 *
 * WHAT THIS REPLACES
 *
 * The tab used to show the reference and the time it was placed, and a button
 * that opened the order page. A guest standing at the table with "Being cooked"
 * on another screen had to go and find it. This puts the answer where they
 * already are, and keeps it true.
 *
 * THE THREE HONEST STATES
 *
 *   checking      nothing has come back yet. Says so; does not assume "placed".
 *   live          a server answer is on screen, with when it was checked.
 *   reconnecting  the last read failed. The last KNOWN status stays on screen,
 *                 marked as possibly out of date -- it is not replaced by a
 *                 spinner, because the food is not un-cooked by a dead wifi.
 *
 * A status is only ever drawn from an answer the server gave. There is no
 * optimistic path here at all: this screen has nothing to be optimistic about.
 *
 * WHY THE ENGINE IS NOT IN THIS FILE
 *
 * See lib/order-status-poller.ts. Everything that can actually go wrong --
 * overlapping requests, backoff, visibility, terminal stop -- is tested there
 * without a browser. This file wires it to React and draws the result.
 */

import { useEffect, useRef, useState } from 'react';
import {
  checkedAgo,
  guestStatus,
  mayReplaceStatus,
  type GuestStatusKey,
  type OrderStatusSnapshot,
} from '@/lib/guest-order-status';
import { createStatusPoller, type PollerPhase } from '@/lib/order-status-poller';

/** Where the status is read from. Body-carried token, never a query string. */
const STATUS_PATH = '/menu/orders/status';

export async function readOrderStatus(input: {
  slug: string;
  code: string;
  token: string;
}): Promise<unknown> {
  const response = await fetch(STATUS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ s: input.slug, code: input.code, t: input.token }),
    cache: 'no-store',
  });

  /* A malformed record is not a network problem: retrying it forever would spin
     a phone's battery on a token that can never work. It becomes "not found",
     which stops the loop and tells the guest to look at the counter. */
  if (response.status === 400) return null;
  if (!response.ok) throw new Error(`status read failed: ${response.status}`);

  const payload = (await response.json()) as { ok?: unknown } & Record<string, unknown>;
  if (payload?.ok !== true) return null;
  return payload;
}

const TONE_CLASS: Record<string, string> = {
  // Waiting on a person: the calmest of the four, because nothing is late yet.
  wait: 'bg-[color-mix(in_oklab,var(--p-ink)_6%,transparent)] text-gink-64',
  live: 'bg-accent-soft text-[var(--p-accent)]',
  done: 'bg-[color-mix(in_oklab,var(--p-ink)_8%,transparent)] text-gink',
  stopped: 'bg-[color-mix(in_oklab,var(--alert)_12%,transparent)] text-[var(--alert)]',
  unknown: 'bg-[color-mix(in_oklab,var(--p-ink)_6%,transparent)] text-gink-46',
};

export function GuestLiveStatus({
  slug,
  code,
  token,
  className = '',
}: {
  slug: string;
  code: string;
  /** The guest credential for this order. Never rendered. */
  token: string;
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState<OrderStatusSnapshot | null>(null);
  const [phase, setPhase] = useState<PollerPhase>('idle');
  const [missing, setMissing] = useState(false);
  const [failures, setFailures] = useState(0);

  /** The newest status actually drawn. A ref so the stale guard sees it at once. */
  const shownRef = useRef<GuestStatusKey>('unknown');

  useEffect(() => {
    if (!slug || !code || !token) return;

    let alive = true;

    const poller = createStatusPoller({
      request: () => readOrderStatus({ slug, code, token }),
      onSnapshot: (next) => {
        if (!alive) return;
        const key = guestStatus({
          prepStatus: next.status,
          awaitingConfirmation: next.awaitingConfirmation,
        }).key;

        /* Out-of-order answers are real: a proxy cache, a retried request, a
           phone that slept between send and receive. A status that is further
           behind than what is already on screen is dropped, so "Ready to serve"
           can never fall back to "Being cooked". */
        if (!mayReplaceStatus(shownRef.current, key)) return;

        shownRef.current = key;
        setSnapshot(next);
      },
      onMissing: () => {
        if (alive) setMissing(true);
      },
      onState: (state) => {
        if (!alive) return;
        setPhase(state.phase);
        setFailures(state.failures);
      },
      isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    });

    poller.start();

    const onVisible = () => {
      if (document.visibilityState === 'visible') poller.pollNow();
    };
    // Back online after a dead patch: do not wait out the backoff.
    const onOnline = () => poller.pollNow();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      poller.stop();
    };
  }, [slug, code, token]);

  if (missing) {
    return (
      <div className={`rounded-[var(--p-r-card)] border border-hair bg-card px-4 py-3.5 ${className}`}>
        <p className="text-[13px] leading-[1.5] font-medium text-gink">
          This order could not be found
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.55] text-gink-64">
          It may have been placed on another phone, or the restaurant may have cancelled it. Your
          reference <strong className="tnum tracking-[0.08em] text-gink">{code}</strong> is still
          enough for the staff to find it at the counter.
        </p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div
        data-live-status="checking"
        className={`rounded-[var(--p-r-card)] border border-hair bg-card px-4 py-3.5 ${className}`}
        aria-live="polite"
      >
        <p className="text-[13px] leading-[1.5] font-medium text-gink">
          {phase === 'reconnecting' ? 'Checking again…' : 'Checking with the restaurant…'}
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.55] text-gink-64">
          {phase === 'reconnecting'
            ? 'The last check did not get through. Retrying by itself — you can also reload the page.'
            : 'This is the live status of your order. It updates by itself.'}
        </p>
        {/* The reference is how the counter finds this bill when everything
            else is broken, so it is on screen even before the first answer. */}
        <p className="mt-2 text-[11.5px] text-gink-46">
          Reference <strong className="tnum tracking-[0.08em] text-gink">{code}</strong>
        </p>
      </div>
    );
  }

  const status = guestStatus({
    prepStatus: snapshot.status,
    awaitingConfirmation: snapshot.awaitingConfirmation,
  });
  const stale = phase === 'reconnecting';
  const freshness = checkedAgo(snapshot.checkedAt, Date.now());

  return (
    <div
      data-live-status={status.key}
      data-live-phase={phase}
      className={`rounded-[var(--p-r-card)] border border-hair bg-card px-4 py-3.5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`g-badge ${TONE_CLASS[status.tone] ?? TONE_CLASS.unknown}`}>
          {status.label}
        </span>
        {!status.terminal ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gink-46">
            <span
              aria-hidden="true"
              className="g-live-dot size-1.5 rounded-full bg-[var(--p-accent)]"
            />
            Live
          </span>
        ) : null}
      </div>

      {/* Announced, not just drawn: the whole point of this block is that the
          guest does not have to keep looking at it. */}
      <p aria-live="polite" className="mt-2 text-[13.5px] leading-[1.5] font-medium text-gink">
        {status.headline}
      </p>
      <p className="mt-1 text-[12.5px] leading-[1.55] text-gink-64">{status.detail}</p>

      <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
        {stale ? (
          <>
            Showing the last status we received, {freshness}. Reconnecting to the restaurant — this
            page will catch up on its own.
          </>
        ) : status.terminal ? (
          <>Checked with the restaurant {freshness}.</>
        ) : (
          <>Checked with the restaurant {freshness}. Updates by itself.</>
        )}
        {failures >= 3 && stale ? (
          <>
            {' '}
            If this does not clear, the staff can always check the order from the counter.
          </>
        ) : null}
      </p>
    </div>
  );
}
