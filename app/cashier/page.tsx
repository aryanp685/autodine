import type { Metadata } from 'next';
import { Cashier } from '@/components/screens/CashierScreen';
import { getCashierScreenData } from '@/lib/db/cashier-screen';

export const metadata: Metadata = {
  title: 'Counter · AutoDine',
  robots: { index: false, follow: false },
};

// The queue is live money. A cached page could show an order as unpaid after
// it has been settled, which is how a guest gets charged twice.
export const dynamic = 'force-dynamic';

export default async function CashierPage() {
  // Null means Supabase is not configured: the screen then renders its own
  // sample queue, exactly as it did before the database existed.
  const data = await getCashierScreenData();

  return <Cashier data={data ?? undefined} />;
}
