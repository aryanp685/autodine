import type { Metadata } from 'next';
import { Kitchen } from '@/components/screens/KitchenScreen';
import { getKitchenScreenData } from '@/lib/db/kitchen-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

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
  //
  // The outlet bar is fetched alongside it because the board now renders the
  // shared staff shell: the rail names the venue and, with more than one
  // outlet, offers the switcher. It returns null with no session, and the bar
  // then renders without one -- which is the honest state in demo mode.
  const [data, outlet] = await Promise.all([getKitchenScreenData(), getOutletBar()]);

  return <Kitchen data={data ?? undefined} outlet={outlet} signOut={!data?.blocked} />;
}
