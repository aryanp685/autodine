import type { Metadata } from 'next';
import { Cashier } from '@/components/screens/CashierScreen';
import { DashboardBar } from '@/components/DashboardBar';
import { AutoRefresh } from '@/components/owner/AutoRefresh';
import { getCashierScreenData } from '@/lib/db/cashier-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = {
  title: 'Counter · AutoDine',
  robots: { index: false, follow: false },
};

// The queue is live money. A cached page could show an order as unpaid after
// it has been settled, which is how a guest gets charged twice.
export const dynamic = 'force-dynamic';

export default async function CashierPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  // Null means Supabase is not configured: the screen then renders its own
  // sample queue, exactly as it did before the database existed.
  const [data, outlet, params] = await Promise.all([
    getCashierScreenData(),
    getOutletBar(),
    searchParams,
  ]);
  // "Collect" on a ledger row arrives here as ?order=<id>. The screen opens on
  // that ticket instead of the oldest one; an id that is no longer waiting is
  // reported rather than swapped out silently.
  const focus = typeof params.order === 'string' ? params.order : undefined;

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
    <>
      {/*
        A guest pays at the counter, so the counter has to see the bill without
        anybody pressing reload. Until now the queue only moved when a cashier
        settled something (that path refreshes itself) or a person reloaded the
        page -- which meant a ticket could sit unseen while its guest waited.

        Twenty seconds, not the dashboard's forty-five: this is money walking
        towards a till, not an overview. AutoRefresh refuses to fire while the
        tab is hidden, while somebody is typing, or in demo mode, so a counter
        left open overnight does not query a database for no one.
      */}
      <AutoRefresh enabled={Boolean(data) && !data?.blocked} seconds={20} />
      <Cashier
        data={data ?? undefined}
        focus={focus}
        nav={
          <DashboardBar
            active="counter"
            outlet={outlet}
            signOut={!data?.blocked}
          />
        }
      />
    </>
  );
}
