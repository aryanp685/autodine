'use client';

/**
 * Prototype-only cart state. It lives in memory and resets on reload; checkout
 * never submits an order. Each restaurant slug gets its own isolated cart so
 * switching venue context cannot carry items from another restaurant.
 *
 * Prices in this browser cart are for preview only. Trusted order totals are
 * recalculated by the database RPC, not by this state.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { computeOrderTotals, computeSubtotal, type OrderTotals } from '@/lib/pricing';
import type { Paise } from '@/lib/money';
import { addCartLine, setCartLineQuantity, updateScopedCart, type CartLine, type NewCartLine } from '@/lib/cart-state';

type CartApi = {
  scope: string;
  lines: CartLine[];
  add: (line: NewCartLine) => void;
  remove: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  count: number;
  subtotalPaise: Paise;
  totals: OrderTotals;
};

type CartStore = {
  linesByScope: Map<string, CartLine[]>;
  updateScope: (scope: string, update: (lines: CartLine[]) => CartLine[]) => void;
};

const StoreContext = createContext<CartStore | null>(null);
const ScopeContext = createContext('unscoped');

export function CartScope({ scope, children }: { scope: string; children: ReactNode }) {
  return <ScopeContext.Provider value={scope || 'unscoped'}>{children}</ScopeContext.Provider>;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [linesByScope, setLinesByScope] = useState<Map<string, CartLine[]>>(() => new Map());
  const updateScope = useCallback((scope: string, update: (lines: CartLine[]) => CartLine[]) => {
    setLinesByScope((current) => updateScopedCart(current, scope, update));
  }, []);

  const store = useMemo(() => ({ linesByScope, updateScope }), [linesByScope, updateScope]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useCart(): CartApi {
  const store = useContext(StoreContext);
  const scope = useContext(ScopeContext);
  if (!store) throw new Error('useCart must be used inside CartProvider');

  const lines = store.linesByScope.get(scope) ?? [];
  const add = useCallback<CartApi['add']>((line) => {
    store.updateScope(scope, (current) => addCartLine(current, line));
  }, [scope, store.updateScope]);
  const remove = useCallback<CartApi['remove']>((key) => {
    store.updateScope(scope, (current) => current.filter((line) => line.key !== key));
  }, [scope, store.updateScope]);
  const setQty = useCallback<CartApi['setQty']>((key, qty) => {
    store.updateScope(scope, (current) => setCartLineQuantity(current, key, qty));
  }, [scope, store.updateScope]);
  const clear = useCallback(() => store.updateScope(scope, () => []), [scope, store.updateScope]);

  return useMemo(() => ({
    scope,
    lines,
    add,
    remove,
    setQty,
    clear,
    count: lines.reduce((count, line) => count + line.qty, 0),
    subtotalPaise: computeSubtotal(lines),
    totals: computeOrderTotals({ lines }),
  }), [scope, lines, add, remove, setQty, clear]);
}
