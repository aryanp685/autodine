/**
 * The last order this device placed, so the Orders tab has something to open.
 *
 * WHY THIS IS A DEVICE FACT AND NOT A SERVER ONE
 *
 * A guest is not signed in. The only credential for reading an order is the
 * `guest_token` in the link they were redirected to -- and that is exactly the
 * right design, because it means guessing a five-character code gets you
 * nothing. The cost is that the app cannot list "your orders": there is no
 * account to list them under.
 *
 * So the Orders tab remembers the most recent order ON THIS DEVICE, in that
 * guest's own browser, and nothing else. It is not a history, it is not
 * synced, and it is not shared between phones. Order history -- which needs a
 * real guest identity and a conversation about retention -- is deliberately
 * deferred.
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT
 *
 * It is pure: it takes a storage object and does nothing else. Every entry
 * point swallows its own failures, because localStorage throws in Safari's
 * private mode and in a browser with site data disabled, and an exception
 * thrown while rendering a thank-you screen is a blank page after a successful
 * order. A lost pointer is an inconvenience; a crashed confirmation is a bug.
 */

import { parseCart, serialiseCart, type StoredLine } from '@/lib/cart-storage';

/** The subset of the Web Storage API this needs. Lets tests pass a plain object. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * One order, as much as is needed to open it again.
 *
 * `token` is the guest credential from the URL. It never leaves the device
 * except to open the order it belongs to.
 */
export type RememberedOrder = {
  code: string;
  token: string;
  /** ISO timestamp of when it was placed. Used to show how long ago, never to decide access. */
  placedAt: string;
};

/** Scoped by restaurant: one account, one phone, two restaurants a week is normal. */
export function lastOrderKey(slug: string): string {
  return `ad_last_order:${slug.trim().toLowerCase()}`;
}

/**
 * Read a stored value back into an order, or give up.
 *
 * Anything unexpected -- a different shape from an older build, a half-written
 * value, a string somebody typed into the console -- returns null rather than
 * being "repaired" into something that opens the wrong page.
 */
export function parseRememberedOrder(raw: string | null): RememberedOrder | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  const code = typeof candidate.code === 'string' ? candidate.code.trim() : '';
  const token = typeof candidate.token === 'string' ? candidate.token.trim() : '';
  const placedAt = typeof candidate.placedAt === 'string' ? candidate.placedAt : '';

  // The token is the credential; without it the entry is useless, and keeping
  // a code-only entry would render a "track it" button that cannot work.
  if (!code || !token) return null;
  if (Number.isNaN(Date.parse(placedAt))) return null;

  return { code, token, placedAt };
}

export function readLastOrder(storage: StorageLike | null | undefined, slug: string): RememberedOrder | null {
  if (!storage) return null;
  try {
    return parseRememberedOrder(storage.getItem(lastOrderKey(slug)));
  } catch {
    return null;
  }
}

/** Returns whether it stuck, so a caller can warn instead of pretending. */
export function rememberLastOrder(
  storage: StorageLike | null | undefined,
  slug: string,
  order: RememberedOrder,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(lastOrderKey(slug), JSON.stringify(order));
    return true;
  } catch {
    return false;
  }
}

export function forgetLastOrder(storage: StorageLike | null | undefined, slug: string): void {
  if (!storage) return;
  try {
    storage.removeItem(lastOrderKey(slug));
  } catch {
    // Nothing to do: the entry is already unreachable if removal fails.
  }
}

/**
 * Where "Track this order" goes.
 *
 * The same route the redirect after ordering uses, so there is exactly one
 * order page and one way to prove ownership of it.
 */
export function orderHref(order: Pick<RememberedOrder, 'code' | 'token'>, slug: string): string {
  const params = new URLSearchParams({ s: slug, code: order.code, t: order.token });
  return `/menu/order?${params.toString()}`;
}

/** The browser's own storage, or null during SSR and in locked-down browsers. */
export function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}


/* --------------------------------------------------------- the last cart */

/**
 * The dishes that were just ordered, kept so a table can order them again.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A table that enjoyed the naan orders another round. Until now that meant
 * going back to the menu and rebuilding the same order from memory, dish by
 * dish, portion by portion, add-on by add-on — the most common thing a table
 * does after the first order, made the slowest.
 *
 * WHY IT IS NOT READ FROM THE ORDER
 *
 * The order page is served from `get_public_order`, which returns what the
 * kitchen prints — names, quantities, prices at the time — and deliberately
 * not the menu ids, because a price on a page must come from the database, not
 * from a link. Rebuilding a cart needs ids, and the cart is the one thing this
 * browser legitimately owns. So the cart is remembered as it was, with ids
 * only, exactly like the cart itself.
 *
 * WHAT IT IS NOT
 *
 * It is not an order. Nothing is sent, reserved or priced by remembering it;
 * the guest lands on the cart, sees prices read fresh from the database, and
 * decides again. If a dish has since sold out or left the menu, the cart screen
 * already names it and drops it — that path exists and is tested.
 */
export function lastCartKey(slug: string): string {
  return `ad_last_cart:${slug.trim().toLowerCase()}`;
}

/**
 * Remember what was just ordered. Silent on failure, like everything else here.
 *
 * An empty list is a removal, not a stash: a guest who emptied their cart and
 * pressed back must not find "order these again" offering nothing.
 */
export function rememberLastCart(
  storage: StorageLike | null | undefined,
  slug: string,
  lines: StoredLine[],
): void {
  if (!storage || !slug.trim()) return;
  try {
    if (lines.length === 0) {
      storage.removeItem(lastCartKey(slug));
      return;
    }
    storage.setItem(lastCartKey(slug), serialiseCart(lines));
  } catch {
    // Private mode, a full quota, disabled site data. The order still exists;
    // only the shortcut back to it is lost.
  }
}

/**
 * The remembered dishes, or an empty list.
 *
 * Read through `parseCart`, so this is the same validation the cart itself
 * uses: an id that is not a string, a quantity of -4, or a payload written by
 * an older build all become fewer lines rather than a broken page.
 */
export function readLastCart(storage: StorageLike | null | undefined, slug: string): StoredLine[] {
  if (!storage || !slug.trim()) return [];
  try {
    return parseCart(storage.getItem(lastCartKey(slug)));
  } catch {
    return [];
  }
}

/** Drop it. Used when the restaurant slug is unknown, or a test needs a reset. */
export function forgetLastCart(storage: StorageLike | null | undefined, slug: string): void {
  if (!storage || !slug.trim()) return;
  try {
    storage.removeItem(lastCartKey(slug));
  } catch {
    // Nothing to do.
  }
}
