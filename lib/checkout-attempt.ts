import { cartKey, lineKey, parseCart, type StoredLine } from './cart-storage';
import { rememberLastCart, rememberLastOrder, type StorageLike } from './guest-orders';

export type CheckoutAttempt = { token: string; lines: StoredLine[]; note: string };
export const checkoutAttemptKey = (slug: string, table: string) => `ad_checkout:${slug}:${table}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tolerant cart parsing is for browsing only. Never change a basket while
 * saving or replaying the identity of a write. Prices are not taken from it. */
export function isExactCheckoutBasket(raw: unknown, parsed: StoredLine[]): boolean {
  return Array.isArray(raw) && raw.length === parsed.length && parsed.every((line, i) => {
    const input = raw[i];
    if (!input || input.itemId !== line.itemId || input.qty !== line.qty || input.variantId !== line.variantId) return false;
    if (input.addonIds === undefined) return !line.addonIds?.length;
    const addons = line.addonIds ?? [];
    return Array.isArray(input.addonIds) && input.addonIds.length === addons.length &&
      input.addonIds.every((value: unknown) => typeof value === 'string') && [...input.addonIds].sort().every((value, index) => value === addons[index]);
  });
}

export function readCheckoutAttempt(storage: StorageLike, key: string): CheckoutAttempt | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  const lines = parseCart(JSON.stringify(value?.lines));
  if (typeof value?.token !== 'string' || !UUID.test(value.token) || !lines.length || !isExactCheckoutBasket(value.lines, lines) ||
      typeof value.note !== 'string' || value.note.length > 300) {
    throw new Error('Invalid stored checkout attempt');
  }
  return { token: value.token, lines, note: value.note };
}

export function saveCheckoutAttempt(storage: StorageLike, key: string, attempt: CheckoutAttempt): void {
  // Do this before sending anything. A browser that cannot keep a recovery
  // key cannot safely start a write, so do not silently fall back to a new one.
  storage.setItem(key, JSON.stringify(attempt));
  if (readCheckoutAttempt(storage, key)?.token !== attempt.token) throw new Error('Checkout storage unavailable');
}

export function sameCheckoutCart(a: StoredLine[], b: StoredLine[]): boolean {
  return a.length === b.length && a.every((line, index) => line.qty === b[index].qty && lineKey(line) === lineKey(b[index]));
}

export function finishCheckoutAttempt(storage: StorageLike, slug: string, key: string, attempt: CheckoutAttempt, code: string): boolean {
  // A URL (even a real, bookmarked order URL) cannot clear a cart. Only the
  // acknowledged response for the exact pending write may consume it.
  if (readCheckoutAttempt(storage, key)?.token !== attempt.token) return false;
  if (!rememberLastOrder(storage, slug, { code, token: attempt.token, placedAt: new Date().toISOString() })) {
    throw new Error('Could not retain the order reference');
  }
  rememberLastCart(storage, slug, attempt.lines);
  const current = parseCart(storage.getItem(cartKey(slug)));
  const clear = sameCheckoutCart(current, attempt.lines);
  if (clear) storage.removeItem(cartKey(slug));
  storage.removeItem(key);
  return clear;
}
