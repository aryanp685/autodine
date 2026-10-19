import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
import { CartScope } from '@/components/CartProvider';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { DEFAULT_SLUG, getMenuScreenData } from '@/lib/db/menu-screen';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Order · AutoDine' };

/**
 * ?s=<slug> picks the restaurant; it defaults to the seeded demo venue.
 *
 * The slug is a query parameter rather than a route segment so that every
 * existing link to /menu keeps working unchanged -- the locked screens and
 * their navigation reference /menu directly.
 */
export default async function CustomerMenuPage({
  searchParams,
}: {
    searchParams: Promise<{ s?: string | string[] }>;
  }) {
  const { s: rawSlug } = await searchParams;
  const slug = getSingleSearchParam(rawSlug);
  if (!slug.valid) notFound();
  const s = slug.value;
  const data = await getMenuScreenData(s);

  // Null means demo mode only. A configured database with an unknown slug is
  // a real not-found state, never a reason to show the fictional sample menu.
  if (isSupabaseConfigured && !data) notFound();
  const scope = data?.restaurant.slug ?? s?.trim() ?? DEFAULT_SLUG;
  return (
    <CartScope scope={scope}>
      <CustomerMenu key={scope} data={data ?? undefined} />
    </CartScope>
  );
}
