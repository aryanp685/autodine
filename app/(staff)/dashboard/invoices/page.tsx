import type { Metadata } from 'next';
import { InvoiceHistoryScreen } from '@/components/screens/InvoiceHistoryScreen';
import { getInvoiceHistory } from '@/lib/db/invoice-history';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = { title: 'Invoice history · AutoDine', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function InvoiceHistoryPage() {
  const [result, outlet] = await Promise.all([getInvoiceHistory(), getOutletBar()]);
  if (!result.ok) {
    const message = result.reason === 'role-denied'
      ? 'Invoice history is available only to owner, manager and cashier roles.'
      : result.reason === 'unconfigured'
        ? 'Connect the restaurant database to view saved invoice history.'
        : 'Sign in with an authorized restaurant account to view invoice history.';
    return (
      <main data-surface="owner" className="min-h-dvh bg-paper-deep p-6 text-gink">
        <section className="mx-auto max-w-[620px] rounded-[14px] border border-hair bg-card p-6">
          <h1 className="text-[20px] font-semibold">Invoice history unavailable</h1>
          <p className="mt-2 text-[13px] text-gink-64">{message}</p>
        </section>
      </main>
    );
  }
  return <InvoiceHistoryScreen rows={result.rows} outlet={outlet} />;
}
