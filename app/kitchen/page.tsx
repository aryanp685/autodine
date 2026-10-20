import type { Metadata } from 'next';
import { Kitchen } from '@/components/screens/KitchenScreen';
import { getKitchenScreenData } from '@/lib/db/kitchen-screen';

export const metadata: Metadata = {
  title: 'Kitchen display · AutoDine',
  robots: { index: false, follow: false },
};

// A kitchen board must never be served from a cache: a cook acting on a
// five-minute-old ticket is cooking food for a table that may have left.
export const dynamic = 'force-dynamic';

export default async function KitchenPage() {
  // Null means Supabase is not configured: the screen then renders its own
  // sample board, exactly as it did before the database existed.
  const data = await getKitchenScreenData();

  return <Kitchen data={data ?? undefined} />;
}
