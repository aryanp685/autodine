import type { Metadata } from 'next';
import { InvoiceScreen } from '@/components/screens/InvoiceScreen';
import { getSharedInvoiceData } from '@/lib/db/invoice-share';

export const metadata: Metadata = {
  title: 'Shared receipt · AutoDine',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

export default async function SharedReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await getSharedInvoiceData(token);
  if (invoice) return <InvoiceScreen invoice={invoice} shared />;

  return (
    <main data-surface="owner" className="min-h-dvh bg-paper-deep px-5 py-10 text-gink antialiased">
      <section className="mx-auto max-w-[520px] rounded-[14px] border border-hair bg-card px-6 py-8 sm:px-8">
        <p className="text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">Shared receipt</p>
        <h1 className="mt-2 text-[21px] font-medium tracking-[-0.03em]">This link is unavailable</h1>
        <p className="mt-2 text-[13px] leading-[1.55] text-gink-64">
          It may have expired, been revoked, or be incorrect. Ask the restaurant for a current receipt link.
        </p>
      </section>
    </main>
  );
}
