import type { Metadata } from 'next';
import Link from 'next/link';

import { BillScreen } from '@/components/screens/BillScreen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { btn } from '@/components/owner/chrome';
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

  /**
   * Everything that is not a bill: no order, no database, nobody signed in.
   *
   * It wears the same sheet as a real bill, because the person reading it is
   * standing at a counter holding a printout and needs to know in one glance
   * that this is not it.
   */
  return (
    <div
      data-surface="owner"
      className="min-h-dvh bg-paper-deep px-5 py-10 text-gink antialiased sm:py-16"
    >
      <main className="mx-auto w-full max-w-[520px]">
        <div className="rounded-[14px] border border-hair bg-card px-6 py-8 sm:px-8">
          {result.reason === 'not-found' ? (
            <>
              <div className="text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">
                Bill
              </div>
              <h1 className="mt-2 text-[21px] leading-[1.25] font-medium tracking-[-0.03em] text-gink">
                Bill not found
              </h1>
              <p className="mt-2 text-[13px] leading-[1.55] text-gink-64">
                That order does not exist, or it belongs to a different restaurant. Bills are only
                visible to the restaurant that took the order.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/cashier" className={btn('solid', 'sm')}>
                  Open the counter
                </Link>
                <Link href="/dashboard/orders" className={btn('ghost', 'sm')}>
                  Open the order ledger
                </Link>
              </div>
            </>
          ) : result.reason === 'unconfigured' ? (
            <>
              <div className="text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">
                Bill
              </div>
              <h1 className="mt-2 text-[21px] leading-[1.25] font-medium tracking-[-0.03em] text-gink">
                Not connected
              </h1>
              <p className="mt-2 text-[13px] leading-[1.55] text-gink-64">
                This deployment has no database configured, so there is no bill to print. The rest
                of the app is showing sample data.
              </p>
              <div className="mt-5">
                <Link href="/cashier" className={btn('solid', 'sm')}>
                  Open the counter
                </Link>
              </div>
            </>
          ) : (
            <SignInPrompt reason={result.reason} screen="bill" />
          )}
        </div>
      </main>
    </div>
  );
}
