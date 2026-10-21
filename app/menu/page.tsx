import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
import { MenuSlugNeeded } from '@/components/screens/MenuSlugNeeded';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';

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
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;

  // Asked for nothing, so show nothing -- not the sample menu, which would
  // read as this restaurant's dishes.
  if (isSupabaseConfigured && !s?.trim()) return <MenuSlugNeeded />;

  const data = await getMenuScreenData(s);

  // Null means demo mode only. A configured database with an unknown slug is
  // a real not-found state, never a reason to show the fictional sample menu.
  if (isSupabaseConfigured && !data) notFound();
  return <CustomerMenu data={data ?? undefined} />;
}
