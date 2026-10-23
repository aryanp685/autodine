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
