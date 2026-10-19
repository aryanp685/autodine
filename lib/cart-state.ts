import type { Paise } from './money';

export type CartLine = {
  key: string;
  id: string;
  name: string;
  unitPricePaise: Paise;
  qty: number;
  variant?: string;
  addons?: string[];
  veg: boolean;
};

export type NewCartLine = Omit<CartLine, 'key'>;

export function addCartLine(lines: CartLine[], line: NewCartLine): CartLine[] {
  const key = `${line.id}|${line.variant ?? ''}|${(line.addons ?? []).join(',')}`;
  const existing = lines.find((item) => item.key === key);
  return existing
    ? lines.map((item) => item.key === key ? { ...item, qty: item.qty + line.qty } : item)
    : [...lines, { ...line, key }];
}

export function setCartLineQuantity(lines: CartLine[], key: string, qty: number): CartLine[] {
  return qty <= 0
    ? lines.filter((line) => line.key !== key)
    : lines.map((line) => line.key === key ? { ...line, qty } : line);
}

export function updateScopedCart(
  current: Map<string, CartLine[]>,
  scope: string,
  update: (lines: CartLine[]) => CartLine[],
): Map<string, CartLine[]> {
  const next = new Map(current);
  next.set(scope, update(current.get(scope) ?? []));
  return next;
}
