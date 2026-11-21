import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OwnerPage, PageHead, SectionHead } from '@/components/owner/chrome';
import { PrintButton } from '@/components/PrintButton';
import { formatBillMoney } from '@/lib/bill';
import { RECEIPT_DISCLAIMER } from '@/lib/billing/catalog';
import { getSubscriptionReceipt } from '@/lib/db/subscription-screen';

export const metadata: Metadata = {
  title: 'Subscription receipt · AutoDine',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function when(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

/**
 * One subscription receipt.
 *
 * It says on its face that it is not a GST tax invoice, because the two look
 * alike to anybody who is not an accountant and only one of them can be filed.
 * The receipt is a record of money received for a subscription; the tax invoice
 * a restaurant issues its own guest is a different document entirely.
 *
 * The row it prints is immutable (migration 20261110001100): what was issued
 * cannot be edited, so a receipt an owner is looking at is the receipt that was
 * created, not a later version of it.
 */
export default async function SubscriptionReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getSubscriptionReceipt(id);

  // "Not yours" and "does not exist" are the same answer here: the second is
  // not a fact anybody outside the account is owed.
  if (!result.ok) notFound();

  const { receipt } = result;

  return (
    <OwnerPage active="subscription">
      <PageHead
        kicker="Account · receipt"
        title={receipt.receiptNumber}
        meta={RECEIPT_DISCLAIMER}
        actions={<PrintButton className="text-[12.5px]">Print receipt</PrintButton>}
      />

      <section className="rounded-[14px] border border-hair bg-card p-6" aria-label="Receipt">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[10.5px] font-semibold tracking-[0.18em] text-gink-46 uppercase">AutoDine</p>
            <p className="mt-2 text-[15px] font-semibold">Subscription payment receipt</p>
            <p className="mt-1 text-[12.5px] text-gink-64">
              {receipt.restaurantName ?? 'Account'} · {receipt.accountId.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
            <dt className="text-gink-64">Receipt</dt>
            <dd className="font-mono text-[12.5px]">{receipt.receiptNumber}</dd>
            <dt className="text-gink-64">Issued</dt>
            <dd>{when(receipt.issuedAt, true)}</dd>
            <dt className="text-gink-64">Paid</dt>
            <dd>{when(receipt.paidAt, true)}</dd>
            {receipt.provider ? (
              <>
                <dt className="text-gink-64">Provider</dt>
                <dd>{receipt.provider}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <thead className="border-b border-hair text-[10px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
              <tr>
                <th className="px-1 py-3">Item</th>
                <th className="px-1 py-3">Period</th>
                <th className="px-1 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hair">
                <td className="px-1 py-3">
                  <p className="font-medium">{receipt.planLabel} plan</p>
                  <p className="mt-0.5 text-[12.5px] text-gink-64">Monthly subscription, one account, every outlet</p>
                </td>
                <td className="px-1 py-3 text-gink-64">
                  {receipt.periodStart ? `${when(receipt.periodStart)} – ${when(receipt.periodEnd)}` : '—'}
                </td>
                <td className="px-1 py-3 text-right font-medium tabular-nums">
                  {formatBillMoney(receipt.amountPaise)}
                </td>
              </tr>
              <tr>
                <td className="px-1 py-3 text-gink-64">Tax</td>
                <td className="px-1 py-3" />
                <td className="px-1 py-3 text-right tabular-nums text-gink-64">Shown on the tax invoice</td>
              </tr>
              <tr>
                <td className="px-1 py-4 text-[15px] font-semibold">Total received</td>
                <td className="px-1 py-4" />
                <td className="px-1 py-4 text-right text-[15px] font-semibold tabular-nums">
                  {formatBillMoney(receipt.amountPaise)} {receipt.currency}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-6 max-w-[70ch] text-[12.5px] leading-[1.6] text-gink-46">{RECEIPT_DISCLAIMER}</p>
      </section>

      <section className="mt-6" aria-label="Back to subscription">
        <SectionHead title="This receipt" />
        <p className="text-[12.5px] leading-[1.6] text-gink-64">
          Receipts are immutable: this one cannot be edited or deleted, and a refund or a correction
          is recorded as its own payment.{' '}
          <Link
            className="underline decoration-hair-strong underline-offset-2"
            href="/dashboard/subscription"
          >
            Back to subscription
          </Link>
        </p>
      </section>
    </OwnerPage>
  );
}
