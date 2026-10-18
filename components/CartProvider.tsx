'use client';

/**
 * Prototype-only cart state. Client side, in-memory, resets on reload.
 * It exists so the customer flow (menu → item sheet → cart → checkout) can be
 * clicked through. It is NOT the real cart: no server validation, no prices
 * trusted from the browser, no persistence.
 */

import { createContext, useContext, useMemo, useState } from 'react';

export type CartLine = {
  key: string;
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
  variant?: string;
  addons?: string[];
  veg: boolean;
};

type CartApi = {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'key'>) => void;
  remove: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  count: number;
  subtotal: number;
};

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([
    {
      key: 'seed-1',
      id: 'it-butter-chicken',
      name: 'Butter Chicken',
      unitPrice: 469,
      qty: 1,
      variant: 'Regular · 4 pcs',
      addons: ['Hot', 'Butter naan'],
      veg: false,
    },
    {
      key: 'seed-2',
      id: 'it-naan',
      name: 'Butter Naan',
      unitPrice: 79,
      qty: 2,
      veg: true,
    },
    {
      key: 'seed-3',
      id: 'it-lassi',
      name: 'Mango Lassi',
      unitPrice: 149,
      qty: 1,
      veg: true,
    },
  ]);

  const api = useMemo<CartApi>(() => {
    const add: CartApi['add'] = (line) => {
      setLines((prev) => {
        const key = `${line.id}|${line.variant ?? ''}|${(line.addons ?? []).join(',')}`;
        const found = prev.find((l) => l.key === key);
        if (found) {
          return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + line.qty } : l));
        }
        return [...prev, { ...line, key }];
      });
    };
    const remove: CartApi['remove'] = (key) => setLines((p) => p.filter((l) => l.key !== key));
    const setQty: CartApi['setQty'] = (key, qty) =>
      setLines((p) => (qty <= 0 ? p.filter((l) => l.key !== key) : p.map((l) => (l.key === key ? { ...l, qty } : l))));
    return {
      lines,
      add,
      remove,
      setQty,
      clear: () => setLines([]),
      count: lines.reduce((n, l) => n + l.qty, 0),
      subtotal: lines.reduce((n, l) => n + l.qty * l.unitPrice, 0),
    };
  }, [lines]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
