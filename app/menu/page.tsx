import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';

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
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;
  const data = await getMenuScreenData(s);

  // Null means demo mode only. A configured database with an unknown slug is
  // a real not-found state, never a reason to show the fictional sample menu.
  if (isSupabaseConfigured && !data) notFound();
  return <CustomerMenu data={data ?? undefined} />;
}
