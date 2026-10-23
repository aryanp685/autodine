'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GuestFlow } from '@/components/GuestFlow';
import { GuestTabs } from '@/components/GuestTabs';
import { guestAccentStyle } from '@/lib/branding/palette';
import {
  browserStorage,
  forgetLastOrder,
  orderHref,
  readLastOrder,
  type RememberedOrder,
} from '@/lib/guest-orders';

/**
 * The orders this device knows about.
 *
 * There is exactly one, and the screen says so rather than implying a history
 * it does not have. A guest who has ordered twice sees the newer one; a guest
 * with somebody else's phone sees an empty state. Both of those are the truth.
 *
 * THREE STATES, ALL DESIGNED
 *
 *   checking   one line of text, not a spinner: the read from storage takes a
 *              frame and a spinner would flash.
 *   none       what to do next, not an apology.
 *   found      the code, when it was placed, and one button to the live order.
 *
 * WHY THE ORDER IS NOT SUMMARISED HERE
 *
 * A total cached in a browser goes stale the moment the guest adds a dish, and
 * a stale total next to a real code is worse than no total. The one place that
 * knows what the order contains is the order page, so this screen hands over
 * to it.
 */
export function GuestOrdersScreen({
  slug,
  restaurantName,
  tableLabel,
}: {
  slug?: string | null;
  restaurantName?: string | null;
  tableLabel?: string | null;
}) {
  const [state, setState] = useState<'checking' | 'none' | 'found'>('checking');
  const [order, setOrder] = useState<RememberedOrder | null>(null);

  useEffect(() => {
    if (!slug) {
      setState('none');
      return;
    }
    const found = readLastOrder(browserStorage(), slug);
    setOrder(found);
    setState(found ? 'found' : 'none');
  }, [slug]);

  const menuHref = slug ? `/menu?s=${encodeURIComponent(slug)}` : '/menu';

  return (
    <GuestFlow
      /* Not a step in the flow: this is somewhere the tabs can take you. */
      venue={restaurantName}
      table={tableLabel}
      style={guestAccentStyle()}
      back={{ href: menuHref, label: 'Back to the menu' }}
      tabs={<GuestTabs slug={slug} active="orders" />}
    >
      <header className="px-4 pt-6 pb-4">
        <p className="g-eyebrow">Your order</p>
        <h1 className="g-display mt-1.5">On this device</h1>
        <p className="g-lede mt-1.5">
          {state === 'found'
            ? 'The last order placed from this phone. Open it to see how the kitchen is doing.'
            : 'Orders are tied to the phone that placed them. This one has none yet.'}
        </p>
      </header>

      <div className="px-4 pb-8">
        {state === 'checking' && (
          <p className="text-[13.5px] text-gink-46">
            Checking this device…
            {/* Without JavaScript the read never happens, so the screen would sit
                on that sentence for ever. Say what is true instead. */}
            <noscript>
              <span className="mt-2 block text-[12.5px] leading-[1.5]">
                This needs JavaScript on. Your order code is still at the counter —
                the staff can look it up there.
              </span>
            </noscript>
          </p>
        )}

        {state === 'none' && (
          <div className="g-card px-5 py-8 text-center">
            <p className="text-[16px] font-semibold tracking-[-0.01em] text-gink">Nothing ordered yet</p>
            <p className="mx-auto mt-1.5 max-w-[36ch] text-[13px] leading-[1.55] text-gink-64">
              Once you order, it will be here with its status, and you can open it again without
              scanning the card.
            </p>
            <Link
              href={menuHref}
              className="g-primary mt-5 inline-flex rounded-full px-4 py-2.5 text-[13px] font-semibold"
            >
              Browse the menu
            </Link>
          </div>
        )}

        {state === 'found' && order && slug && (
          <div className="g-panel px-4 py-4">
            <dl className="text-[13.5px]">
              <div className="flex items-baseline justify-between py-1.5">
                <dt className="text-[11px] font-semibold tracking-[0.09em] text-gink-46 uppercase">Order</dt>
                <dd className="tnum text-[15px] font-semibold tracking-[0.12em] text-gink">{order.code}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-hair py-1.5">
                <dt className="text-[11px] font-semibold tracking-[0.09em] text-gink-46 uppercase">Placed</dt>
                <dd className="text-gink-64">{formatPlacedAt(order.placedAt)}</dd>
              </div>
            </dl>

            <Link
              href={orderHref(order, slug)}
              className="g-primary mt-4 flex h-11 items-center justify-center rounded-full text-[13.5px] font-semibold"
            >
              Track this order
            </Link>
            <Link
              href={menuHref}
              className="g-quiet mt-2 flex h-11 items-center justify-center rounded-full text-[13.5px] font-semibold"
            >
              Order something else
            </Link>

            <p className="mt-3 text-[11.5px] leading-[1.55] text-gink-46">
              Only the most recent order is kept here, and only on this phone.{' '}
              <button
                type="button"
                className="font-semibold text-[var(--p-accent)] underline underline-offset-2"
                onClick={() => {
                  forgetLastOrder(browserStorage(), slug);
                  setOrder(null);
                  setState('none');
                }}
              >
                Forget it
              </button>{' '}
              to clear it. Staff can always find it by the code at the counter.
            </p>
          </div>
        )}
      </div>
    </GuestFlow>
  );
}

/**
 * "Today at 8:12 pm", or the date when it was not today.
 *
 * Formatted here rather than on the server because the browser knows the
 * guest's own time zone, and a guest reading "3:42 am" for a meal they ate at
 * dinner is the kind of detail that makes an app feel foreign.
 */
function formatPlacedAt(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'earlier';

  const now = new Date();
  const sameDay =
    when.getDate() === now.getDate() &&
    when.getMonth() === now.getMonth() &&
    when.getFullYear() === now.getFullYear();

  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today at ${time}` : `${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}
