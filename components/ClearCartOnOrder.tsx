'use client';

/**
 * Empties the cart once the order it held has been placed.
 *
 * This is the bug that a guest would find before we did: the cart lives in
 * localStorage, the order is placed from it, and nothing ever cleared it. So
 * after ordering, going back to the menu showed the same dishes still in the
 * order -- with a bar offering to review them -- and a second tap on "Place
 * order" would have ordered the whole meal again.
 *
 * WHY IT WAITS FOR THE CONFIRMATION SCREEN
 *
 * Clearing on submit would be wrong: a failed order (sold out, session ended)
 * redirects back to the cart with a sentence, and the guest has to still have
 * their order to fix. The confirmation screen is only reachable when the
 * database actually wrote the order, so that is where the cart has served its
 * purpose.
 *
 * A cancelled order does NOT clear: nothing was cooked and nothing is owed, so
 * the guest's selection is still theirs and going back to the menu should not
 * mean rebuilding it from memory.
 *
 * It registers no UI. The screen it is mounted on already says the order was
 * placed; a second notice would be noise.
 */

import { useEffect, useRef } from 'react';
import { useCart } from '@/components/CartProvider';

export function ClearCartOnOrder({ clear }: { clear: boolean }) {
  const cart = useCart();
  const done = useRef(false);

  useEffect(() => {
    // Once per mount, and only after the stored cart has been read: clearing
    // before that would write an empty cart over the guest's real one during
    // the first render.
    if (!clear || done.current || !cart.ready) return;
    done.current = true;
    if (cart.count > 0) cart.clear();
  }, [clear, cart]);

  return null;
}
