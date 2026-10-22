import type { Metadata } from 'next';
import { Cashier } from '@/components/screens/CashierScreen';
import { DashboardBar } from '@/components/DashboardBar';
import { getCashierScreenData } from '@/lib/db/cashier-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

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
  const [data, outlet] = await Promise.all([getCashierScreenData(), getOutletBar()]);

  /**
   * The bar is rendered HERE, on the server, and handed to the client screen
   * as a prop.
   *
   * WHY NOT INSIDE THE SCREEN
   *
   * The bar's sign-out control is a `<form action={serverAction}>`. Importing
   * DashboardBar into a Client Component would drag the action module -- and
   * through it lib/supabase/admin.ts, which is marked `server-only` -- into
   * the browser bundle, and the build fails. Passing the already-rendered
   * tree down keeps the server code on the server and still gives the counter
   * the same navigation, outlet switcher and sign-out as every other screen.
   *
   * Before this, the counter had no navigation at all: no bar, no sign-out,
   * no link back to the dashboard.
   */
  return (
    <Cashier
      data={data ?? undefined}
      nav={
        <DashboardBar
          active="counter"
          outlet={outlet}
          signOut={!data?.blocked}
        />
      }
    />
  );
}
