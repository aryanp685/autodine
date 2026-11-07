'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PrintButton } from '@/components/PrintButton';
import { btn } from '@/components/owner/chrome';
import { formatBillMoney, paymentMethodLabel, whatsAppLink } from '@/lib/bill';
import { buildReceiptMessage } from '@/lib/invoice';
import type { ReceiptData } from '@/lib/db/invoice';

type Layout = 'a4' | '58mm' | '80mm';

const PAGE: Record<Layout, { size: string; margin: string; label: string }> = {
  a4: { size: 'A4', margin: '12mm', label: 'A4' },
  '58mm': { size: '58mm auto', margin: '2mm', label: '58 mm' },
  '80mm': { size: '80mm auto', margin: '3mm', label: '80 mm' },
};

export function InvoiceScreen({ invoice }: { invoice: ReceiptData }) {
  const [layout, setLayout] = useState<Layout>('a4');
  const page = PAGE[layout];
  const shareText = buildReceiptMessage(invoice);
  const paid = invoice.totals.paymentStatus === 'paid';

  function shareReceipt() {
    if (navigator.share) {
      void navigator.share({ title: `Receipt ${invoice.number}`, text: shareText }).catch(() => {});
      return;
    }
    window.open(whatsAppLink('', shareText), '_blank', 'noopener,noreferrer');
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
          <Link href="/dashboard" className={`${btn('quiet', 'sm')} -ml-2`}>
            ← Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-gink-64">
              Layout
              <select
                aria-label="Receipt print layout"
                value={layout}
                onChange={(event) => setLayout(event.target.value as Layout)}
                className="rounded border border-hair bg-card px-2 py-1.5 text-gink"
              >
                {Object.entries(PAGE).map(([value, choice]) => (
                  <option key={value} value={value}>{choice.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className={btn('ghost', 'sm')} onClick={shareReceipt}>
              Share receipt
            </button>
            <PrintButton className={btn('solid', 'sm')}>Print / Save PDF</PrintButton>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <article
          data-invoice-sheet
          data-layout={layout}
          className={`mx-auto rounded-[14px] border border-hair bg-card shadow-[0_10px_36px_rgba(30,31,24,.06)] print:rounded-none print:border-0 print:p-0 print:shadow-none ${layoutClass}`}
        >
          {invoice.status === 'voided' ? (
            <div className="mb-5 border-2 border-[var(--alert)] px-3 py-2 text-center text-[13px] font-bold tracking-[0.18em] text-[var(--alert)] uppercase">
              VOID — {invoice.voidReason}
            </div>
          ) : null}

          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {invoice.seller.logoUrl ? (
                <img src={invoice.seller.logoUrl} alt={`${invoice.seller.name} logo`} className="mb-3 max-h-14 max-w-28 object-contain print:max-h-12" />
              ) : null}
              <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.02em] print:text-[18px]">
                {invoice.seller.name}
              </h1>
              <p className="mt-1 max-w-[38ch] whitespace-pre-line text-[12px] leading-[1.45] text-gink-64 print:text-[10px]">
                {invoice.seller.address}
              </p>
              {invoice.seller.phone ? (
                <p className="mt-1 text-[11px] text-gink-64">Phone {invoice.seller.phone}</p>
              ) : null}
              <p className="mt-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
                Receipt · Not a GST tax invoice
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[9px] font-semibold tracking-[0.12em] text-gink-46 uppercase">Receipt no.</p>
              <p className="mt-1 font-mono text-[14px] font-semibold tabular-nums">{invoice.number}</p>
              <p className="mt-2 text-[11px] text-gink-64">{invoice.issuedAt}</p>
              <p className="mt-1 text-[11px] text-gink-64">{invoice.tableLabel ? `Table ${invoice.tableLabel}` : 'Table'}</p>
              <p className="mt-1 text-[9px] text-gink-46">Session {invoice.sessionReference.slice(0, 8).toUpperCase()}</p>
            </div>
          </header>

          <div className="mt-5 overflow-hidden border-y border-hair">
            <table className="w-full border-collapse text-[11.5px] print:text-[10px]">
              <thead>
                <tr className="text-[9px] font-semibold tracking-[0.08em] text-gink-46 uppercase">
                  <th className="py-2 text-left">Qty</th>
                  <th className="py-2 text-left">Item / ticket</th>
                  <th className="py-2 text-right">Rate</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.id} className="border-t border-hair align-top">
                    <td className="py-2 tabular-nums">{line.quantity}</td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{line.itemName}</div>
                      {(line.variant || line.addons.length) ? (
                        <div className="mt-0.5 text-[10px] text-gink-64">
                          {[line.variant, ...line.addons].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                      <div className="mt-0.5 text-[9px] text-gink-46">Ticket {line.ticketCode}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatBillMoney(line.unitPricePaise)}</td>
                    <td className="py-2 text-right tabular-nums">{formatBillMoney(line.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="ml-auto mt-4 w-full max-w-[310px] text-[11.5px] print:text-[10px]">
            <Summary label="Subtotal" value={formatBillMoney(invoice.totals.subtotalPaise)} />
            {invoice.totals.ticketDiscountPaise > 0 ? (
              <Summary label="Ticket discounts (as recorded)" value={`−${formatBillMoney(invoice.totals.ticketDiscountPaise)}`} />
            ) : null}
            {invoice.totals.billDiscountPaise > 0 ? (
              <Summary label="Bill discount" value={`−${formatBillMoney(invoice.totals.billDiscountPaise)}`} />
            ) : null}
            {invoice.totals.taxPaise > 0 ? (
              <Summary label="Tax amount (from ticket records)" value={formatBillMoney(invoice.totals.taxPaise)} />
            ) : null}
            {invoice.totals.otherChargesPaise > 0 ? (
              <Summary label="Other charges" value={formatBillMoney(invoice.totals.otherChargesPaise)} />
            ) : null}
            <div className="mt-1 flex justify-between gap-3 border-t border-gink py-2 font-semibold">
              <span>Total payable</span>
              <span className="tabular-nums">{formatBillMoney(invoice.totals.totalPaise)}</span>
            </div>
            <Summary label="Amount paid" value={formatBillMoney(invoice.totals.paidPaise)} />
            <Summary label="Outstanding" value={formatBillMoney(invoice.totals.outstandingPaise)} />
            <p className="mt-2 text-right text-[10px] font-semibold uppercase">
              Payment status: {paid ? 'Paid' : 'Unpaid'}
            </p>
          </section>

          <footer className="mt-5 border-t border-hair pt-3 text-[10px] text-gink-64">
            <p>Table session: {invoice.sessionReference}</p>
            <p className="mt-1">Opened {invoice.sessionOpenedAt} · Closed {invoice.sessionClosedAt}</p>
            {invoice.payments.length ? (
              <div className="mt-3 space-y-1">
                {invoice.payments.map((payment, index) => (
                  <p key={`${payment.receivedAt}-${index}`}>
                    {paymentMethodLabel(payment.method)} · {formatBillMoney(payment.amountPaise)} · {payment.receivedAt}
                  </p>
                ))}
              </div>
            ) : null}
            {invoice.supersedesInvoiceId ? (
              <p className="mt-2">Replacement receipt; previous receipt is voided.</p>
            ) : null}
            <p className="mt-3 text-center">Thank you.</p>
          </footer>
        </article>

        {invoice.paymentReceipts.length ? (
          <section data-supplemental-payment-receipts className="mx-auto mt-4 max-w-[760px] rounded-[14px] border border-hair bg-card p-5 print:hidden">
            <h2 className="text-[13px] font-semibold">Later payment receipts</h2>
            <p className="mt-1 text-[11px] leading-[1.45] text-gink-64">
              These are separate acknowledgements for payments received after this invoice was issued. They do not change the printed invoice above.
            </p>
            <ul className="mt-3 divide-y divide-hair">
              {invoice.paymentReceipts.map((receipt) => (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11px]">
                  <span>
                    <span className="font-mono font-medium">{receipt.reference}</span>
                    <span className="ml-2 text-gink-64">{receipt.receivedAt}</span>
                    <span className="ml-2 font-medium">{formatBillMoney(receipt.amountPaise)}</span>
                  </span>
                  <Link href={`/invoice/payment/${receipt.id}`} className="font-medium underline decoration-hair-strong underline-offset-2">
                    Open payment receipt
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-hair py-1.5">
      <span className="text-gink-64">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}
