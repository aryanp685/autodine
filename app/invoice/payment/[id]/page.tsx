import type { Metadata } from 'next';
import Link from 'next/link';

import { PaymentReceiptScreen } from '@/components/screens/PaymentReceiptScreen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { btn } from '@/components/owner/chrome';
import { getPaymentReceiptData } from '@/lib/db/payment-receipt';

export const metadata: Metadata = {
  title: 'Payment receipt · AutoDine',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPaymentReceiptData(id);
  if (result.ok) return <PaymentReceiptScreen receipt={result.receipt} />;

  return (
    <div data-surface="owner" className="min-h-dvh bg-paper-deep px-5 py-10 text-gink antialiased">
      <main className="mx-auto w-full max-w-[520px]">
        <div className="rounded-[14px] border border-hair bg-card px-6 py-8 sm:px-8">
          {result.reason === 'not-found' ? (
            <>
              <div className="text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">Payment receipt</div>
              <h1 className="mt-2 text-[21px] font-medium tracking-[-0.03em]">Receipt not found</h1>
              <p className="mt-2 text-[13px] leading-[1.55] text-gink-64">
                This payment receipt does not exist, or it belongs to a different restaurant.
              </p>
              <div className="mt-5"><Link href="/cashier" className={btn('solid', 'sm')}>Open counter</Link></div>
            </>
          ) : result.reason === 'unconfigured' ? (
            <>
              <div className="text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">Payment receipt</div>
              <h1 className="mt-2 text-[21px] font-medium tracking-[-0.03em]">Not connected</h1>
              <p className="mt-2 text-[13px] leading-[1.55] text-gink-64">This deployment has no database configured.</p>
              <div className="mt-5"><Link href="/cashier" className={btn('solid', 'sm')}>Open counter</Link></div>
            </>
          ) : (
            <SignInPrompt reason={result.reason} screen="bill" />
          )}
        </div>
      </main>
    </div>
  );
}
