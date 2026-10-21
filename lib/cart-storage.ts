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
  /**
   * Which portion was chosen, when the dish has portions.
   *
   * Absent means "the dish as it is priced on the menu", not "no portion".
   * The distinction matters at the till: a dish with no variants has no
   * choice to make, while a dish with variants that somehow arrives without
   * one is a bug and is priced at the base price rather than silently
   * dropped -- dropping it would lose the sale over a UI problem.
   */
  variantId?: string;
};

const PREFIX = 'autodine.cart.';
const MAX_QTY = 99;
const MAX_LINES = 100;

/**
 * What makes two cart lines the same line.
 *
 * Item id alone is not enough once portions exist. A half plate and a full
 * plate of the same dish are two different things at two different prices;
 * collapsing them by item id would mean adding "Full" after "Half" bumped the
 * half's quantity and charged the wrong price for both.
 *
 * This is the single place that rule lives, so `add` merging, quantity edits
 * and deduplication on read cannot disagree about it.
 */
export function lineKey(line: Pick<StoredLine, 'itemId' | 'variantId'>): string {
  return `${line.itemId}|${line.variantId ?? ''}`;
}

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
    const { itemId, qty, variantId } = entry as Record<string, unknown>;

    if (typeof itemId !== 'string' || !itemId) continue;

    // A variant id is optional but not free-form: a non-string is dropped
    // rather than coerced, because a coerced id would resolve to a different
    // dish's portion rather than to nothing.
    const variant = typeof variantId === 'string' && variantId ? variantId : undefined;

    // One line per portion. A duplicate means the second one wins, which is
    // what repeatedly pressing "add" should do.
    const key = lineKey({ itemId, variantId: variant });
    if (seen.has(key)) continue;
    if (typeof qty !== 'number' || !Number.isInteger(qty)) continue;
    if (qty <= 0 || qty > MAX_QTY) continue;

    seen.add(key);
    lines.push({ itemId, qty, ...(variant ? { variantId: variant } : {}) });
    if (lines.length >= MAX_LINES) break;
  }

  return lines;
}

export function serialiseCart(lines: StoredLine[]): string {
  return JSON.stringify(lines);
}

/**
 * Adds one, or bumps the quantity when that exact portion is already there.
 *
 * "Exact portion" is the point. Adding a full plate when a half is in the
 * cart starts a second line; adding another half bumps the first.
 */
export function addLine(
  lines: StoredLine[],
  itemId: string,
  by = 1,
  variantId?: string
): StoredLine[] {
  if (!itemId) return lines;

  const wanted = lineKey({ itemId, variantId });
  const existing = lines.findIndex((l) => lineKey(l) === wanted);
  const base = variantId ? { itemId, variantId } : { itemId };

  if (existing === -1) {
    if (lines.length >= MAX_LINES) return lines;
    return [...lines, { ...base, qty: Math.min(Math.max(by, 1), MAX_QTY) }];
  }

  return lines.map((l, i) =>
    i === existing ? { ...l, qty: Math.min(l.qty + by, MAX_QTY) } : l
  );
}

/** Removes the line when the quantity reaches zero, rather than showing a 0. */
export function setQty(
  lines: StoredLine[],
  itemId: string,
  qty: number,
  variantId?: string
): StoredLine[] {
  const wanted = lineKey({ itemId, variantId });
  const isTarget = (l: StoredLine) => lineKey(l) === wanted;

  if (!Number.isInteger(qty) || qty <= 0) {
    return lines.filter((l) => !isTarget(l));
  }
  const clamped = Math.min(qty, MAX_QTY);
  return lines.map((l) => (isTarget(l) ? { ...l, qty: clamped } : l));
}

export function removeLine(lines: StoredLine[], itemId: string, variantId?: string): StoredLine[] {
  const wanted = lineKey({ itemId, variantId });
  return lines.filter((l) => lineKey(l) !== wanted);
}

export function totalQty(lines: StoredLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export const CART_MAX_QTY = MAX_QTY;
