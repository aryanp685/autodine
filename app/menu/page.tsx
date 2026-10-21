import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartProvider } from '@/components/CartProvider';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
import { MenuSlugNeeded } from '@/components/screens/MenuSlugNeeded';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';
import { isExpired, readTableSession } from '@/lib/table-session';

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

  // `m` names the menu. Unknown or draft ids fall back to the first published
  // one rather than erroring, so a stale link still shows a live menu.
  const data = await getMenuScreenData(s, m);

  // Null means demo mode only. A configured database with an unknown slug is
  // a real not-found state, never a reason to show the fictional sample menu.
  if (isSupabaseConfigured && !data) notFound();

  // Only claim a table if this restaurant is the one the session is for. A
  // session is issued per restaurant, and a guest following a link to another
  // venue while one is live would otherwise be shown a table number from a
  // building they are not in.
  const session = await readTableSession();
  const table =
    session && !isExpired(session) && session.slug === data?.restaurant.slug
      ? { label: session.tableLabel }
      : null;

  // The cart is keyed by restaurant, so it is mounted where the slug is known.
  return (
    <CartProvider slug={s}>
      <CustomerMenu data={data ? { ...data, table } : undefined} />
    </CartProvider>
  );
}
