import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartProvider } from '@/components/CartProvider';
import { ItemSheet } from '@/components/screens/CustomerMenu';
import { TableGateScreen } from '@/components/screens/TableGateScreen';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';
import { loadTableAccess, verifyAgainHref } from '@/lib/table-access';

export const metadata: Metadata = { title: 'Customise · AutoDine' };

/**
 * ?s=<slug> picks the restaurant, ?item=<id> the dish to customise, ?m=<id>
 * the menu it came from.
 *
 * All three are query parameters so the locked screens' existing links to
 * /menu/item keep working unchanged.
 *
 * The menu matters here: a dish on the dinner menu is not in the breakfast
 * list, so opening this page without it would fall back to the first menu and
 * show the sheet for whatever dish happened to match -- or nothing.
 *
 * Gated like /menu. This page can add a dish to a cart, and the cart is what
 * checkout posts, so leaving it open would have been a way to fill a cart
 * without ever proving presence.
 */
export default async function ItemPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; item?: string; m?: string }>;
}) {
  const { s, item, m } = await searchParams;

  const access = await loadTableAccess(s);

  if (access.status === 'none') return <TableGateScreen reason="none" />;
  if (access.status === 'unavailable') return <TableGateScreen reason="unavailable" />;
  if (access.status === 'stale') {
    return <TableGateScreen reason="stale" verifyHref={verifyAgainHref(access)} />;
  }

  const data = await getMenuScreenData(s, m);
  if (isSupabaseConfigured && !data) notFound();

  const table =
    access.status === 'verified'
      ? { label: access.tableLabel }
      : access.status === 'demo' && access.tableLabel
        ? { label: access.tableLabel }
        : null;

  return (
    <CartProvider slug={s}>
      <ItemSheet
        data={data ? { ...data, itemId: item, table } : undefined}
        itemId={item}
      />
    </CartProvider>
  );
}
