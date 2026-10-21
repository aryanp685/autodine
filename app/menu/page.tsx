import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartProvider } from '@/components/CartProvider';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
import { MenuSlugNeeded } from '@/components/screens/MenuSlugNeeded';
import { TableGateScreen } from '@/components/screens/TableGateScreen';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';
import { loadTableAccess, verifyAgainHref } from '@/lib/table-access';

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
 * A slug is not access. The menu is now only rendered for a browser the
 * database has confirmed is at a live table in this restaurant: a session
 * that has not expired, has not been revoked, belongs to a table that is
 * still in service, and was issued against a card that is still live. The
 * check is loadTableAccess(), which asks the database rather than reading the
 * cookie, because every field in the cookie is the guest's to edit.
 *
 * The menu data itself has to be loaded to know the restaurant's name, so the
 * order here is: resolve access first, then load the menu only for an allowed
 * guest. A refused guest gets the gate screen, which says what to do about it.
 */
export default async function CustomerMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; m?: string }>;
}) {
  const { s, m } = await searchParams;

  // Asked for nothing, so show nothing -- not the sample menu, which would
  // read as this restaurant's dishes.
  if (isSupabaseConfigured && !s?.trim()) return <MenuSlugNeeded />;

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
    access.status === 'verified'
      ? { label: access.tableLabel }
      : access.status === 'demo' && access.tableLabel
        ? { label: access.tableLabel }
        : null;

  // The cart is keyed by restaurant, so it is mounted where the slug is known.
  return (
    <CartProvider slug={s}>
      <CustomerMenu data={data ? { ...data, table } : undefined} />
    </CartProvider>
  );
}
