import type { Metadata } from 'next';
import { CustomerMenu } from '@/components/screens/CustomerMenu';
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

  // null means "use the screen's own sample content", which is what it did
  // before the database existed. See lib/db/menu-screen.ts.
  return <CustomerMenu data={data ?? undefined} />;
}
