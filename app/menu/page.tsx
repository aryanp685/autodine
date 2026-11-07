import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartProvider } from '@/components/CartProvider';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
import { MenuSlugNeeded } from '@/components/screens/MenuSlugNeeded';
import { StorefrontClosedScreen } from '@/components/screens/StorefrontClosedScreen';
import { TableGateScreen } from '@/components/screens/TableGateScreen';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';
import { getStorefrontStatusBySlug } from '@/lib/db/storefront-status';
import { loadTableAccess, verifyAgainHref } from '@/lib/table-access';
import { cookies } from 'next/headers';
import {
  THROTTLE_COOKIE,
  THROTTLE_PARAM,
  readThrottleFlag,
  throttleNotice,
} from '@/lib/scan-outcome';

export const metadata: Metadata = { title: 'Order · AutoDine' };

/**
 * ?s=<slug> picks the restaurant.
 *
 * The slug is a query parameter rather than a route segment so that every
 * existing link to /menu keeps working unchanged -- the locked screens and
 * their navigation reference /menu directly.
 *
 * With no slug there is no restaurant to ask about, and that is a different
 * state from one that does not exist. It used to fall back to a hard-coded
 * demo slug, so a configured database answered every bare /menu with a 404 and
 * the sample venue never resolved.
 *
 * THE TABLE GATE
 *
 * A slug is not access. The menu is rendered for a browser the database has
 * confirmed holds either a live table session OR a live card that was scanned
 * (the `browse` state). Both are resolved server-side from a cookie the guest
 * cannot usefully forge: the session token is hashed and re-read on every
 * request, and the card token is resolved through public_qr_intro, which
 * answers only for a live card on a table in service in a restaurant that is
 * taking orders.
 *
 * Browsing is deliberately not gated behind the six-digit code. The code is
 * asked for at checkout, at the one moment it changes anything -- whether an
 * order may be written. A guest who scanned a real card at a real table reads
 * the menu first and types six digits once, instead of twice nothing.
 */
export default async function CustomerMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; m?: string; v?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const { s, m } = params;
  // The parameter name is single-sourced with the handler that writes it.
  const v = params[THROTTLE_PARAM];

  // Asked for nothing, so show nothing -- not the sample menu, which would
  // read as this restaurant's dishes.
  if (isSupabaseConfigured && !s?.trim()) return <MenuSlugNeeded />;

  // A closed storefront answers before the table gate does: "scan the table"
  // or a 404 would both read as a broken link rather than a closed shop. The
  // order gate and the scan gate refuse this state too -- this is where the
  // guest is told, in the same words.
  let announcement: string | null = null;
  if (isSupabaseConfigured && s?.trim()) {
    const status = await getStorefrontStatusBySlug(s);
    if (status && !status.open) {
      return <StorefrontClosedScreen name={status.name} announcement={status.announcement} />;
    }
    announcement = status?.announcement ?? null;
  }

  const access = await loadTableAccess(s);

  if (access.status === 'none') return <TableGateScreen reason="none" />;
  if (access.status === 'unavailable') return <TableGateScreen reason="unavailable" />;
  if (access.status === 'stale') {
    return <TableGateScreen reason="stale" verifyHref={verifyAgainHref(access)} />;
  }

  // `m` names the menu. Unknown or draft ids fall back to the first published
  // one rather than erroring, so a stale link still shows a live menu.
  const data = await getMenuScreenData(s, m);

  // Null means demo mode only. A configured database with an unknown slug is
  // a real not-found state, never a reason to show the fictional sample menu.
  if (isSupabaseConfigured && !data) notFound();

  // Demo mode has no database to confirm a table, so the badge is drawn from
  // the cookie only -- the pre-existing behaviour of the sample screens, where
  // nothing real can be ordered.
  const table =
    access.status === 'verified' || access.status === 'browse'
      ? { label: access.tableLabel }
      : access.status === 'demo' && access.tableLabel
        ? { label: access.tableLabel }
        : null;

  /*
   * WERE WE TURNED AWAY AT THE DOOR?
   *
   * The scan handler puts the answer in the address (`?v=throttled`) and in a
   * short-lived cookie, because the guest needs it on this screen AND at
   * checkout. Both are read here, and neither grants anything: the notice is
   * copy, and the order path refuses a session-less order exactly as before.
   *
   * `throttleNotice()` deliberately says "a short while" rather than a number
   * when the database did not give one. The current `open_table_session` does
   * not return a retry time; inventing one would be worse than saying nothing,
   * and quoting one when it IS returned is the whole point of carrying it.
   *
   * The address wins over the cookie: a guest who has just been throttled has
   * both, and the address is the newer statement of the two.
   */
  const fromAddress = readThrottleFlag(v);
  const rawThrottleCookie = (await cookies()).get(THROTTLE_COOKIE)?.value;
  const fromCookie = readThrottleFlag(rawThrottleCookie);
  const throttle = fromAddress.throttled ? fromAddress : fromCookie;
  const throttleDebug = JSON.stringify({ v: v ?? null, cookie: rawThrottleCookie ?? null, fromAddress, fromCookie, throttle });

  // The cart is keyed by restaurant, so it is mounted where the slug is known.
  return (
    <>
      {process.env.AUTODINE_E2E_DEBUG === '1' ? (
        <span hidden data-e2e-throttle-debug={throttleDebug} />
      ) : null}
      <CartProvider slug={s}>
      <CustomerMenu
        data={data ? { ...data, table } : undefined}
        throttleNotice={throttle.throttled ? throttleNotice(throttle.retryAfterSeconds) : null}
        announcement={announcement}
        canCallWaiter={access.status === 'verified'}
        lang={params.lang}
      />
      </CartProvider>
    </>
  );
}
