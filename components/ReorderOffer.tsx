'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOptionalCart } from '@/components/CartProvider';
import { browserStorage, readLastCart } from '@/lib/guest-orders';
import type { StoredLine } from '@/lib/cart-storage';

/**
 * "Order these again" — the second round, without rebuilding the first.
 *
 * WHY IT EXISTS
 *
 * The thing a table does most often after ordering is order more of the same.
 * Until now the only way back was the menu, and the guest had to remember which
 * naan, which portion, which two extras. The cart they had just used is the
 * most accurate memory of that order that exists anywhere in the product — so
 * it is kept when the order is placed, and offered back here.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not place anything. The dishes go into the cart, the guest lands on
 * the cart, prices are read again from the database, and the order is placed
 * only by the same button as always. A sold-out dish is dropped there and
 * named, exactly as it would be for a cart built by hand — the cart screen
 * already owns that behaviour, and this does not duplicate it.
 *
 * WHY IT APPEARS ONLY AFTER MOUNT
 *
 * The dishes live in this browser's storage, which the server cannot read.
 * Rendering the button on the server would put a control on the screen that
 * does nothing for a guest on a new phone; rendering it after mount means the
 * button only exists when there is something to restore.
 */

export function ReorderButton({
  count,
  onRestore,
}: {
  /** How many items the remembered order will put back -- plates, same count the cart bar shows. */
  count: number;
  onRestore: () => void;
}) {
  return (
    <div className="mt-3 rounded-[16px] border border-hair bg-card px-4 py-3.5" data-reorder-offer="">
      <p className="m-0 text-[12.5px] leading-[1.5] text-gink-46">
        Ordered {count === 1 ? 'one item' : `${count} items`} on this phone before? Put the same ones
        back in your cart — you see the prices again before anything is sent.
      </p>
      <button
        type="button"
        onClick={onRestore}
        data-reorder-button=""
        className="g-quiet mt-3 inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] font-semibold"
      >
        Order these again
      </button>
    </div>
  );
}

export function ReorderOffer({
  slug,
  enabled = true,
}: {
  slug?: string;
  /** False on a cancelled order: that round is not one to offer back. */
  enabled?: boolean;
}) {
  // Optional on purpose: this is an enhancement, and a screen rendered without
  // a cart provider must still render.
  const cart = useOptionalCart();
  const router = useRouter();
  const [lines, setLines] = useState<StoredLine[]>([]);

  useEffect(() => {
    if (!enabled || !slug) return;
    setLines(readLastCart(browserStorage(), slug));
  }, [enabled, slug]);

  if (!enabled || !slug || !cart || !cart.ready || lines.length === 0) return null;

  const dishes = lines.reduce((sum, line) => sum + line.qty, 0);

  return (
    <ReorderButton
      count={dishes}
      onRestore={() => {
        cart.restore(lines);
        router.push(`/menu/cart?s=${encodeURIComponent(slug)}`);
      }}
    />
  );
}
