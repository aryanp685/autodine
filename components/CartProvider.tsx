'use client';

/**
 * The customer's cart.
 *
 * It remembers item ids and quantities, and nothing else -- no names, no
 * prices. localStorage belongs to the customer and can be edited freely, so
 * nothing stored here is trusted: the cart is a list of intentions, and every
 * amount shown or charged is read back from the database at the time it is
 * needed. A price kept in the browser is a price a customer can set.
 *
 * It is keyed by restaurant slug. One cart spanning two kitchens would let a
 * dish ordered in one turn up on another's bill.
 *
 * Quantities survive a reload, which an in-memory cart did not: a diner who
 * refreshes or locks their phone mid-order should not lose the order.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  addLine,
  cartKey,
  parseCart,
  removeLine,
  serialiseCart,
  setQty as setLineQty,
  totalQty,
  type StoredLine,
} from '@/lib/cart-storage';

export type { StoredLine };

type CartApi = {
  /** Item ids, portions and quantities only. Names and prices come from the server. */
  lines: StoredLine[];
  /**
   * Adds one, or `by` when the dish was added from a quantity stepper.
   *
   * `variantId` is the chosen portion. It identifies the line as much as the
   * item does: a half plate and a full plate of the same dish are two lines,
   * because they are two different prices.
   */
  add: (itemId: string, by?: number, variantId?: string) => void;
  remove: (itemId: string, variantId?: string) => void;
  setQty: (itemId: string, qty: number, variantId?: string) => void;
  clear: () => void;
  count: number;
  /**
   * False until the stored cart has been read. The server renders an empty
   * cart, so anything that counts items has to wait rather than flashing zero
   * over a cart that is not empty.
   */
  ready: boolean;
};

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({
  children,
  slug,
}: {
  children: React.ReactNode;
  /** Restaurant the cart belongs to. */
  slug?: string;
}) {
  const [lines, setLines] = useState<StoredLine[]>([]);
  const [ready, setReady] = useState(false);

  const key = cartKey(slug?.trim() || 'demo');

  // Read after mount, not during render: the server has no localStorage, and
  // reading it while rendering would produce markup that cannot match.
  useEffect(() => {
    setReady(false);
    try {
      setLines(parseCart(window.localStorage.getItem(key)));
    } catch {
      // Private browsing and disabled storage both throw here. An empty cart
      // is the right answer -- the order can still be placed, it just will not
      // survive a reload.
      setLines([]);
    }
    setReady(true);
  }, [key]);

  // Write on change, but not before the first read, or the stored cart would
  // be overwritten by the empty one rendered on the server.
  const persist = useCallback(
    (next: StoredLine[]) => {
      setLines(next);
      try {
        if (next.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, serialiseCart(next));
      } catch {
        // Nothing useful to do. The cart still works for this page view.
      }
    },
    [key]
  );

  const api = useMemo<CartApi>(
    () => ({
      lines,
      ready,
      add: (itemId, by = 1, variantId) => persist(addLine(lines, itemId, by, variantId)),
      remove: (itemId, variantId) => persist(removeLine(lines, itemId, variantId)),
      setQty: (itemId, qty, variantId) => persist(setLineQty(lines, itemId, qty, variantId)),
      clear: () => persist([]),
      count: totalQty(lines),
    }),
    [lines, ready, persist]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
