import type { Metadata } from 'next';
import Link from 'next/link';

import { BillScreen } from '@/components/screens/BillScreen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { getBillData } from '@/lib/db/bill';

export const metadata: Metadata = {
  title: 'Bill · AutoDine',
  // A bill carries a name, a phone number and a GSTIN. It is never indexed.
  robots: { index: false, follow: false },
};

// A bill printed from a cached page could show yesterday's totals.
export const dynamic = 'force-dynamic';

/**
 * /bill/<order id>
 *
 * Staff only -- see proxy.ts, which sends a signed-out visitor to the login
 * page before this renders. The order id is a UUID and is checked against the
 * caller's restaurant, so a bill belonging to somebody else's restaurant is
 * "not found" rather than forbidden: the answer never confirms that an order
 * exists somewhere.
 */
export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getBillData(id);

  if (result.ok) return <BillScreen bill={result.bill} />;

  return (
    <div className="bill">
      <div className="bill__missing">
        {result.reason === 'not-found' ? (
          <>
            <h1>Bill not found</h1>
            <p>
              That order does not exist, or it belongs to a different restaurant. Bills are only
              visible to the restaurant that took the order.
            </p>
            <p>
              <Link href="/cashier">Open the counter</Link>
              {' · '}
              <Link href="/dashboard/orders">Open the order ledger</Link>
            </p>
          </>
        ) : result.reason === 'unconfigured' ? (
          <>
            <h1>Not connected</h1>
            <p>
              This deployment has no database configured, so there is no bill to print. The rest of
              the app is showing sample data.
            </p>
            <p>
              <Link href="/cashier">Open the counter</Link>
            </p>
          </>
        ) : (
          <SignInPrompt reason={result.reason} screen="bill" />
        )}
      </div>
    </div>
  );
}
