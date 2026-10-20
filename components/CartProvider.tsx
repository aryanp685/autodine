'use client';

/**
 * Guest cart state lives in memory and resets on reload. Each restaurant/table
 * gets an isolated cart so switching venue context cannot carry items across.
 *
 * Browser prices are for display only. Guest checkout sends menu item IDs,
 * quantities and stable variant IDs; the server-side database RPC revalidates
 * availability and recalculates the trusted order totals.
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
const ScopeContext = createContext({ scope: 'unscoped', cartKey: 'unscoped' });

export function CartScope({ scope, cartKey, children }: { scope: string; cartKey?: string; children: ReactNode }) {
  return (
    <ScopeContext.Provider value={{ scope: scope || 'unscoped', cartKey: cartKey || scope || 'unscoped' }}>
      {children}
    </ScopeContext.Provider>
  );
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
  const scopeContext = useContext(ScopeContext);
  if (!store) throw new Error('useCart must be used inside CartProvider');

  const { scope, cartKey } = scopeContext;
  const lines = store.linesByScope.get(cartKey) ?? [];
  const add = useCallback<CartApi['add']>((line) => {
    store.updateScope(cartKey, (current) => addCartLine(current, line));
  }, [cartKey, store.updateScope]);
  const remove = useCallback<CartApi['remove']>((key) => {
    store.updateScope(cartKey, (current) => current.filter((line) => line.key !== key));
  }, [cartKey, store.updateScope]);
  const setQty = useCallback<CartApi['setQty']>((key, qty) => {
    store.updateScope(cartKey, (current) => setCartLineQuantity(current, key, qty));
  }, [cartKey, store.updateScope]);
  const clear = useCallback(() => store.updateScope(cartKey, () => []), [cartKey, store.updateScope]);

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
