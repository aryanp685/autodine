/**
 * What the browser is allowed to remember about an order.
 *
 * Only the item id and a quantity. Not the name, not the price, not whether it
 * is vegetarian -- all of that is read from the database again when the cart is
 * shown and when the order is placed.
 *
 * The reason is that localStorage is the customer's to edit. Anything stored
 * there is a suggestion, not a fact. A price kept in the browser is a price a
 * customer can set; the only amount that counts is the one the server reads
 * back at the moment the order is written.
 *
 * Carts are keyed by restaurant slug. Sharing one cart across restaurants
 * would let a diner carry a dish from one kitchen into another's order.
 */

export type StoredLine = {
  itemId: string;
  qty: number;
};

const PREFIX = 'autodine.cart.';
const MAX_QTY = 99;
const MAX_LINES = 100;

export function cartKey(slug: string): string {
  return `${PREFIX}${slug}`;
}

/**
 * Reads a cart back into a form the rest of the app can rely on.
 *
 * Everything here is treated as untrusted: the payload is JSON written by a
 * page the customer controls, so a hand-edited value, a stale id from a deleted
 * item, or a quantity of -4 are all expected rather than exceptional. Bad lines
 * are dropped rather than thrown, because a corrupt cart should show as an
 * emptier cart, not as a broken page.
 */
export function parseCart(raw: string | null): StoredLine[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const lines: StoredLine[] = [];
  const seen = new Set<string>();

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { itemId, qty } = entry as Record<string, unknown>;

    if (typeof itemId !== 'string' || !itemId) continue;
    // One line per item. A duplicated id means the second one wins, which is
    // what repeatedly pressing "add" should do.
    if (seen.has(itemId)) continue;
    if (typeof qty !== 'number' || !Number.isInteger(qty)) continue;
    if (qty <= 0 || qty > MAX_QTY) continue;

    seen.add(itemId);
    lines.push({ itemId, qty });
    if (lines.length >= MAX_LINES) break;
  }

  return lines;
}

export function serialiseCart(lines: StoredLine[]): string {
  return JSON.stringify(lines);
}

/** Adds one, or bumps the quantity if the item is already in the cart. */
export function addLine(lines: StoredLine[], itemId: string, by = 1): StoredLine[] {
  if (!itemId) return lines;

  const existing = lines.findIndex((l) => l.itemId === itemId);

  if (existing === -1) {
    if (lines.length >= MAX_LINES) return lines;
    return [...lines, { itemId, qty: Math.min(Math.max(by, 1), MAX_QTY) }];
  }

  return lines.map((l, i) =>
    i === existing ? { ...l, qty: Math.min(l.qty + by, MAX_QTY) } : l
  );
}

/** Removes the line when the quantity reaches zero, rather than showing a 0. */
export function setQty(lines: StoredLine[], itemId: string, qty: number): StoredLine[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    return lines.filter((l) => l.itemId !== itemId);
  }
  const clamped = Math.min(qty, MAX_QTY);
  return lines.map((l) => (l.itemId === itemId ? { ...l, qty: clamped } : l));
}

export function removeLine(lines: StoredLine[], itemId: string): StoredLine[] {
  return lines.filter((l) => l.itemId !== itemId);
}

export function totalQty(lines: StoredLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export const CART_MAX_QTY = MAX_QTY;
