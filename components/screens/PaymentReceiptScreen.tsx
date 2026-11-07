'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PrintButton } from '@/components/PrintButton';
import { btn } from '@/components/owner/chrome';
import { formatBillMoney, paymentMethodLabel, whatsAppLink } from '@/lib/bill';
import type { PaymentReceiptData } from '@/lib/db/payment-receipt';

type Layout = 'a4' | '58mm' | '80mm';
const PAGE: Record<Layout, { size: string; margin: string }> = {
  a4: { size: 'A4', margin: '12mm' },
  '58mm': { size: '58mm auto', margin: '2mm' },
  '80mm': { size: '80mm auto', margin: '3mm' },
};

export function PaymentReceiptScreen({ receipt }: { receipt: PaymentReceiptData }) {
  const [layout, setLayout] = useState<Layout>('a4');
  const page = PAGE[layout];
  const message = [
    receipt.seller.name,
    'PAYMENT RECEIPT',
    `Reference ${receipt.reference}`,
    `For invoice ${receipt.invoiceNumber}`,
    `${paymentMethodLabel(receipt.method)} · ${formatBillMoney(receipt.amountPaise)}`,
    `Received ${receipt.receivedAt}`,
    `Paid to date ${formatBillMoney(receipt.totalPaidPaise)}`,
    `Outstanding ${formatBillMoney(receipt.outstandingPaise)}`,
    `Status ${receipt.paymentStatus === 'paid' ? 'Paid' : 'Partially paid'}`,
    '',
    'This acknowledges payment only. It does not replace or change the issued invoice.',
  ].join('\n');

  function share() {
    if (navigator.share) {
      void navigator.share({ title: `Payment receipt ${receipt.reference}`, text: message }).catch(() => {});
    } else {
      window.open(whatsAppLink('', message), '_blank', 'noopener,noreferrer');
    }
  }

  const layoutClass = layout === 'a4'
    ? 'max-w-[760px] p-6'
    : layout === '58mm'
      ? 'max-w-[58mm] p-3 text-[10px]'
      : 'max-w-[80mm] p-3 text-[11px]';

  return (
    <div className="min-h-dvh bg-paper-deep text-gink antialiased">
      <style>{`@media print { @page { size: ${page.size}; margin: ${page.margin}; } }`}</style>
      <div className="sticky top-0 z-10 border-b border-hair bg-paper/95 px-4 py-3 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-3">
          <Link href={`/invoice/${receipt.invoiceId}`} className={`${btn('quiet', 'sm')} -ml-2`}>
            ← Invoice
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-gink-64">
              Layout
              <select aria-label="Payment receipt print layout" value={layout} onChange={(e) => setLayout(e.target.value as Layout)} className="rounded border border-hair bg-card px-2 py-1.5 text-gink">
                <option value="a4">A4</option>
                <option value="58mm">58 mm</option>
                <option value="80mm">80 mm</option>
              </select>
            </label>
            <button type="button" className={btn('ghost', 'sm')} onClick={share}>Share receipt</button>
            <PrintButton className={btn('solid', 'sm')}>Print / Save PDF</PrintButton>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <article data-payment-receipt className={`mx-auto rounded-[14px] border border-hair bg-card shadow-[0_10px_36px_rgba(30,31,24,.06)] print:rounded-none print:border-0 print:p-0 print:shadow-none ${layoutClass}`}>
          <header className="border-b border-hair pb-4 text-center">
            <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{receipt.seller.name}</h1>
            <p className="mt-1 text-[12px] text-gink-64">{receipt.seller.address}</p>
            {receipt.seller.phone ? <p className="mt-0.5 text-[11px] text-gink-64">Phone {receipt.seller.phone}</p> : null}
            <p className="mt-4 text-[12px] font-semibold tracking-[0.1em] uppercase">Payment receipt</p>
            <p className="mt-1 font-mono text-[13px] font-semibold">{receipt.reference}</p>
          </header>

          <div className="mt-4 space-y-2 text-[12px]">
            <Line label="For invoice" value={receipt.invoiceNumber} />
            {receipt.tableLabel ? <Line label="Table" value={receipt.tableLabel} /> : null}
            <Line label="Payment method" value={paymentMethodLabel(receipt.method)} />
            <Line label="Payment received" value={receipt.receivedAt} />
            <Line label="Amount received now" value={formatBillMoney(receipt.amountPaise)} strong />
            <Line label="Total paid to date" value={formatBillMoney(receipt.totalPaidPaise)} />
            <Line label="Outstanding balance" value={formatBillMoney(receipt.outstandingPaise)} />
            <Line label="Status" value={receipt.paymentStatus === 'paid' ? 'Paid' : 'Partially paid'} strong />
          </div>
          <footer className="mt-5 border-t border-hair pt-3 text-center text-[10.5px] leading-[1.5] text-gink-64">
            This acknowledges payment only. It does not replace or change the issued invoice.
          </footer>
        </article>
      </main>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hair pb-2">
      <span className="text-gink-64">{label}</span>
      <span className={`text-right tabular-nums ${strong ? 'font-semibold text-gink' : 'text-gink'}`}>{value}</span>
    </div>
  );
}
