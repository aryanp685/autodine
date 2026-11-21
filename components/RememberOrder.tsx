'use client';

import { useEffect } from 'react';
import { browserStorage, rememberLastOrder } from '@/lib/guest-orders';

/**
 * Writes the order this guest just placed into their own browser, so the
 * Orders tab can find it later.
 *
 * WHY A COMPONENT AND NOT A LINE IN THE SERVER PAGE
 *
 * The token is in the URL the guest was redirected to. Storing it is a browser
 * fact, and the confirmation screen is a server component -- it has no
 * business touching localStorage, and it must render whether or not storage
 * works.
 *
 * It renders nothing. It runs once, on mount, and every failure is silent by
 * design: a guest who has just paid should never see an error about caching.
 * The cost of a failure is that the Orders tab shows its empty state, which
 * still offers the menu and still tells them the counter can look the order up.
 */
export function RememberOrder({
  slug,
  code,
  token,
  placedAt,
  enabled = true,
}: {
  slug?: string | null;
  code?: string | null;
  token?: string | null;
  placedAt?: string | null;
  /** False for a cancelled order, which is not something to offer back. */
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled || !slug || !code || !token) return;
    rememberLastOrder(browserStorage(), slug, {
      code,
      token,
      // The server's timestamp when it has one; the client's clock is only a
      // fallback for the demo path, where nothing was read from a database.
      placedAt: placedAt && !Number.isNaN(Date.parse(placedAt)) ? placedAt : new Date().toISOString(),
    });
  }, [enabled, slug, code, token, placedAt]);

  return null;
}
