import type { Metadata } from 'next';
import { Dashboard } from '@/components/screens/DashboardScreen';
import { getDashboardScreenData } from '@/lib/db/dashboard-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = {
  title: 'Dashboard · AutoDine',
  robots: { index: false, follow: false },
};

// The overview is a money screen: a cached copy would show an owner takings
// that are hours old and quietly wrong. Never serve it from the CDN cache.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Null means Supabase is not configured: the screen then renders its sample
  // rows and says it is doing so, exactly as it did before the database existed.
  const [data, outlet] = await Promise.all([getDashboardScreenData(), getOutletBar()]);

  return <Dashboard data={data ?? undefined} outlet={outlet} />;
}
