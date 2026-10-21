import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartProvider } from '@/components/CartProvider';
import { ItemSheet } from '@/components/screens/CustomerMenu';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';
import { isExpired, readTableSession } from '@/lib/table-session';

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
 */
export default async function ItemPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; item?: string; m?: string }>;
}) {
  const { s, item, m } = await searchParams;
  const data = await getMenuScreenData(s, m);
  if (isSupabaseConfigured && !data) notFound();

  const session = await readTableSession();
  const table =
    session && !isExpired(session) && session.slug === data?.restaurant.slug
      ? { label: session.tableLabel }
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
