'use client';

import Link from 'next/link';
import { gstStateLabel } from '@/lib/gst/onboarding';
import { useState } from 'react';
import { createInvoiceShareLinkAction, revokeInvoiceShareLinkAction } from '@/app/(staff)/dashboard/share-actions';

import { InvoiceVoidPanel } from './InvoiceVoidPanel';
import { VerifiedIrpBlock } from './VerifiedIrpBlock';
import { PrintButton } from '@/components/PrintButton';
import { EinvoiceAttemptButton } from '@/components/screens/EinvoiceAttemptButton';
import { btn } from '@/components/owner/chrome';
import { formatBillMoney, paymentMethodLabel, whatsAppLink } from '@/lib/bill';
import { buildReceiptMessage, hasIrnHold, isRetailBill, issuedDocumentTitle } from '@/lib/invoice';
import type { ReceiptData } from '@/lib/db/invoice';
import { COMPOSITION_BILL_NOTICE } from '@/lib/gst/composition';

type Layout = 'a4' | '58mm' | '80mm';

const PAGE: Record<Layout, { size: string; margin: string; label: string }> = {
  a4: { size: 'A4', margin: '12mm', label: 'A4' },
  '58mm': { size: '58mm auto', margin: '2mm', label: '58 mm' },
  '80mm': { size: '80mm auto', margin: '3mm', label: '80 mm' },
};

export function InvoiceScreen({ invoice, shared = false, staffRole, canWrite = false, offlineIrp = false }: {
  invoice: ReceiptData;
  shared?: boolean;
  staffRole?: string;
  canWrite?: boolean;
  offlineIrp?: boolean;
}) {
  const [layout, setLayout] = useState<Layout>('a4');
  const [shareLinks, setShareLinks] = useState(invoice.shareLinks ?? []);
  const [createdLink, setCreatedLink] = useState<{ id: string; href: string; expiresAt: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const page = PAGE[layout];
  const paid = invoice.totals.paymentStatus === 'paid';
  const docType = invoice.documentType;
  const gstDoc = docType !== 'receipt';
  const held = hasIrnHold(invoice);
  const copy = held ? null : invoice.verifiedIrp;
  const cancelled = invoice.irpStatus === 'cancelled';
  const canShare = !held && !copy && !invoice.privateDeliveryCopy && invoice.status === 'issued';
  const retail = isRetailBill(invoice);
  const docTitle = issuedDocumentTitle(invoice);
  const numberLabel = cancelled ? 'Cancelled document' : held ? 'Held document' : docType === 'gst_tax_invoice' ? 'Tax invoice'
    : docType === 'bill_of_supply' ? 'Bill of supply' : retail ? 'Retail bill' : 'Receipt';
  const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);

  async function createSecureLink() {
    if (shareBusy || !canShare) return;
    setShareBusy(true);
    setShareMessage('');
    const result = await createInvoiceShareLinkAction(invoice.id);
    setShareBusy(false);
    if (!result.ok || !result.path || !result.expiresAt) {
      setShareMessage(result.ok ? 'The link could not be verified.' : result.error);
      return;
    }
    const href = `${window.location.origin}${result.path}`;
    setCreatedLink({ id: result.id, href, expiresAt: result.expiresAt });
    setShareLinks((current) => [{
      id: result.id,
      createdAt: new Date().toISOString(),
      expiresAt: result.expiresAt!,
      revokedAt: null,
      lastAccessedAt: null,
      accessCount: 0,
    }, ...current]);
    try {
      await navigator.clipboard.writeText(href);
      setShareMessage('Secure receipt link copied. It expires in 24 hours.');
    } catch {
      setShareMessage('Secure link created. Copy it from the field below; it expires in 24 hours.');
    }
  }

  async function revokeLink(id: string) {
    if (shareBusy) return;
    setShareBusy(true);
    setShareMessage('');
    const result = await revokeInvoiceShareLinkAction(id);
    setShareBusy(false);
    if (!result.ok) {
      setShareMessage(result.error);
      return;
    }
    const revokedAt = new Date().toISOString();
    setShareLinks((current) => current.map((link) => link.id === id ? { ...link, revokedAt } : link));
    if (createdLink?.id === id) setCreatedLink(null);
    setShareMessage('Receipt link revoked.');
  }

  function shareReceipt() {
    if (!canShare) return;
    const shareText = buildReceiptMessage(invoice);
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
      : 'max-w-[80mm] p-3 text-[11.5px]';

  return (
    <div className="min-h-dvh bg-paper-deep text-gink antialiased">
      <style>{`@media print { @page { size: ${page.size}; margin: ${page.margin}; } }`}</style>
      <div className="sticky top-0 z-10 border-b border-hair bg-paper px-4 py-3 print:hidden">
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard" className={`${btn('quiet', 'sm')} -ml-2`}>
            ← Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {!held && !copy ? <label className="flex items-center gap-2 text-[11.5px] text-gink-64">
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
            </label> : null}
            {canShare ? (
              <button type="button" className={btn('ghost', 'sm')} onClick={shareReceipt}>Share receipt text</button>
            ) : null}
            {!shared && canShare ? (
              <button type="button" className={btn('ghost', 'sm')} onClick={createSecureLink} disabled={shareBusy}>
                {shareBusy ? 'Working…' : 'Create 24-hour link'}
              </button>
            ) : null}
            {!shared && held && (staffRole==='owner'||staffRole==='manager') ? <Link href="/dashboard/reports/irp" className={btn('ghost','sm')}>IRP register</Link> : null}
            {!shared && held && canWrite && offlineIrp && invoice.status === 'issued' && staffRole === 'owner' ? (
              <EinvoiceAttemptButton invoiceId={invoice.id} irpStatus={invoice.irpStatus} />
            ) : null}
            {!held ? <PrintButton className={btn('solid', 'sm')}>{invoice.status === 'voided' ? 'Print voided copy' : 'Print / Save PDF'}</PrintButton> : null}
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        {invoice.privateDeliveryCopy ? <p className="mb-3 text-sm print:hidden">Print the complete customer copy privately. Sharing an incomplete delivery invoice is disabled.</p> : null}
        {held ? <p className="hidden p-4 text-sm font-semibold print:block">{cancelled ? 'IRP cancellation recorded — no printable tax document is available.' : 'IRN hold — no printable tax document is available.'}</p> : null}
        <article
          data-invoice-sheet
          data-layout={layout}
          className={`mx-auto rounded-[14px] border border-hair bg-card shadow-[0_10px_36px_rgba(30,31,24,.06)] print:rounded-none print:border-0 print:p-0 print:shadow-none ${held ? 'print:hidden' : ''} ${layoutClass}`}
        >
          {held ? (
            <div className="mb-5 border-2 border-[var(--p-due)] px-3 py-2 text-center text-[12.5px] font-semibold text-[var(--p-due)] uppercase">
              {cancelled ? 'IRP cancellation recorded — not a valid tax invoice. Do not reissue this number.'
                : `${invoice.irpStatus === 'pending' ? 'IRN pending' : 'IRN on hold'} — not a final tax invoice. Do not supply as a tax invoice.`}
            </div>
          ) : null}
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
              <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] print:text-[18px]">
                {invoice.seller.name}
              </h1>
              <p className="mt-1 max-w-[38ch] whitespace-pre-line text-[12.5px] leading-[1.45] text-gink-64 print:text-[10px]">
                {invoice.seller.address}
              </p>
              {invoice.seller.premisesAddress && invoice.seller.premisesAddress !== invoice.seller.address ? (
                <p className="text-[11.5px] text-gink-64">Service premises: {invoice.seller.premisesAddress}</p>
              ) : null}
              {invoice.seller.phone ? (
                <p className="mt-1 text-[11.5px] text-gink-64">Phone {invoice.seller.phone}</p>
              ) : null}
              {invoice.seller.fssaiNumber ? (
                <p className="mt-1 text-[11.5px] text-gink-64">FSSAI <span className="font-mono">{invoice.seller.fssaiNumber}</span></p>
              ) : null}
              {gstDoc && invoice.seller.gstin ? (
                <div className="mt-1.5 text-[11.5px] leading-[1.5] text-gink-64">
                  {invoice.seller.legalName && invoice.seller.legalName !== invoice.seller.name ? (
                    <p className="font-medium text-gink">{invoice.seller.legalName}</p>
                  ) : null}
                  <p>GSTIN <span className="font-mono">{invoice.seller.gstin}</span></p>
                  {invoice.seller.stateCode ? <p>State code {invoice.seller.stateCode}</p> : null}
                </div>
              ) : null}
              <p className="mt-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
                {docTitle}
              </p>
              {docType === 'bill_of_supply' ? <p className="mt-1 text-[10px] font-semibold leading-[1.5]">{invoice.gst?.notice ?? COMPOSITION_BILL_NOTICE}</p> : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-gink-46 uppercase">{numberLabel} no.</p>
              <p className="mt-1 font-mono text-[13.5px] font-semibold tabular-nums">{invoice.number}</p>
              <p className="mt-2 text-[11.5px] text-gink-64">{invoice.issuedAt}</p>
              <p className="mt-1 text-[11.5px] text-gink-64">{invoice.fulfilmentLabel ?? (invoice.tableLabel ? `Table ${invoice.tableLabel}` : 'Table')}</p>
              <p className="mt-1 text-[10px] text-gink-46">Session {invoice.sessionReference.slice(0, 8).toUpperCase()}</p>
            </div>
          </header>

          {docType === 'gst_tax_invoice' && invoice.recipient ? (
            <section aria-label="Buyer details" className="mt-4 border border-hair px-3 py-2 text-[11.5px] leading-[1.5] text-gink-64 break-inside-avoid">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gink-46">Bill to (buyer)</p>
              <p className="mt-0.5 font-medium text-gink">{invoice.recipient.name}</p>
              <p>{invoice.recipient.gstin ? <>GSTIN <span className="font-mono">{invoice.recipient.gstin}</span> · </> : 'Unregistered · '}{gstStateLabel(invoice.recipient.stateCode) ?? `State code ${invoice.recipient.stateCode}`}</p>
              {invoice.recipient.address ? <p className="whitespace-pre-line">{invoice.recipient.address}</p> : null}
              {invoice.recipient.location ? <p>{invoice.recipient.location} {invoice.recipient.pincode}</p> : null}
              {invoice.recipient.deliveryAddress ? <p>Delivery address: {invoice.recipient.deliveryAddress}</p> : null}
              {invoice.recipient.phone ? <p>{invoice.recipient.phone}</p> : null}
              {invoice.recipient.email ? <p>{invoice.recipient.email}</p> : null}
            </section>
          ) : null}

          {gstDoc && invoice.gst?.serviceSac ? (
            <p className="mt-4 text-[11.5px] text-gink-64">Service SAC {invoice.gst.serviceSac}</p>
          ) : null}
          {docType === 'bill_of_supply' && !invoice.gst?.serviceSac ? <p className="mt-3 text-sm font-semibold">Historical record — service SAC not recorded. Do not use as a new Bill of Supply.</p> : null}
          <div className="mt-5 overflow-hidden border-y border-hair">
            <table className="w-full border-collapse text-[11.5px] print:text-[10px]">
              <thead>
                <tr className="text-[10px] font-semibold tracking-[0.08em] text-gink-46 uppercase">
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
                      <div className="mt-0.5 text-[10px] text-gink-46">Ticket {line.ticketCode}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatBillMoney(line.unitPricePaise)}</td>
                    <td className="py-2 text-right tabular-nums">{formatBillMoney(line.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="ml-auto mt-4 w-full max-w-[310px] text-[11.5px] print:text-[10px]">
            {docType === 'gst_tax_invoice' && invoice.gst ? (
              <>
                <Summary label="Taxable value" value={formatBillMoney(invoice.gst.taxablePaise)} />
                {invoice.gst.igstPaise > 0 ? (
                  <Summary label={`IGST @ ${pct(invoice.gst.rateBps)}%`} value={formatBillMoney(invoice.gst.igstPaise)} />
                ) : (
                  <>
                    <Summary label={`CGST @ ${pct(invoice.gst.cgstBps)}%`} value={formatBillMoney(invoice.gst.cgstPaise)} />
                    <Summary label={`SGST @ ${pct(invoice.gst.sgstBps)}%`} value={formatBillMoney(invoice.gst.sgstPaise)} />
                  </>
                )}
                <Summary label="Total tax" value={formatBillMoney(invoice.totals.taxPaise)} />
              </>
            ) : docType === 'bill_of_supply' ? (
              <>
                <Summary label="Supply value" value={formatBillMoney(invoice.gst?.taxablePaise ?? invoice.totals.subtotalPaise)} />
              </>
            ) : (
              <>
                <Summary label="Subtotal" value={formatBillMoney(invoice.totals.subtotalPaise)} />
              </>
            )}
            {invoice.totals.ticketDiscountPaise > 0 ? (
              <Summary label="Ticket discounts (as recorded)" value={`−${formatBillMoney(invoice.totals.ticketDiscountPaise)}`} />
            ) : null}
            {invoice.totals.billDiscountPaise > 0 ? (
              <Summary label="Bill discount" value={`−${formatBillMoney(invoice.totals.billDiscountPaise)}`} />
            ) : null}
            {docType === 'receipt' && !retail && invoice.totals.taxPaise > 0 ? (
              <Summary label="Tax amount (from ticket records)" value={formatBillMoney(invoice.totals.taxPaise)} />
            ) : null}
            {invoice.totals.otherChargesPaise > 0 ? (
              <Summary label="Other charges" value={formatBillMoney(invoice.totals.otherChargesPaise)} />
            ) : null}
            <div className="mt-1 flex justify-between gap-3 border-t border-gink py-2 font-semibold">
              <span>Total payable</span>
              <span data-invoice-total className="tabular-nums">{formatBillMoney(invoice.totals.totalPaise)}</span>
            </div>
            <Summary label="Amount paid" value={formatBillMoney(invoice.totals.paidPaise)} />
            <Summary label="Outstanding" value={formatBillMoney(invoice.totals.outstandingPaise)} />
            <p className="mt-2 text-right text-[10px] font-semibold uppercase">
              Payment status: {paid ? 'Paid' : 'Unpaid'}
            </p>
          </section>

          <footer className="mt-5 border-t border-hair pt-3 text-[10px] text-gink-64">
            {docType === 'gst_tax_invoice' && invoice.gst ? (
              <>
                <p>Place of supply: {gstStateLabel(invoice.gst.placeOfSupplyStateCode) ?? invoice.gst.placeOfSupplyStateCode ?? '—'} · {invoice.gst.interState ? 'IGST (inter-State)' : 'CGST + SGST (intra-State)'} · GSTIN {invoice.seller.gstin}</p>
                {invoice.gst.reverseCharge !== undefined ? <p>Reverse charge: {invoice.gst.reverseCharge ? 'Yes' : 'No'}</p> : null}
                {invoice.gst.profileNotification ? <p className="mt-1">{invoice.gst.profileNotification}</p> : null}
                {copy ? <VerifiedIrpBlock copy={copy} /> : !held ? <p className="mt-1">IRN not required for this document.</p> : null}
              </>
            ) : null}
            {docType === 'bill_of_supply' && invoice.gst ? (
              <p>Place of supply: {gstStateLabel(invoice.gst.placeOfSupplyStateCode) ?? invoice.gst.placeOfSupplyStateCode ?? '—'}</p>
            ) : null}
            {gstDoc && !held && invoice.status === 'issued' ? <div className="my-3">
              <p>Supplier or authorized representative signature: ____________________</p>
              <p className="print:hidden">This system does not sign the document or validate an electronic-signature exception.</p>
            </div> : null}
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
              <p className="mt-2">Replacement document. {shared ? 'The previous document is voided.' : (
                <Link className="underline" href={`/invoice/${invoice.supersedesInvoiceId}`}>View the previous voided document.</Link>
              )}</p>
            ) : null}
            <p className="mt-3 text-center">Thank you.</p>
          </footer>
        </article>

        {!shared ? (
          <section aria-label="Secure receipt links" className="mx-auto mt-4 max-w-[760px] rounded-[14px] border border-hair bg-card p-5 print:hidden">
            <h2 className="text-[13px] font-semibold">Secure receipt links</h2>
            <p className="mt-1 text-[11.5px] leading-[1.45] text-gink-64">
              {canShare ? 'Links show this issued receipt only, expire after 24 hours, and can be revoked. The raw link is shown only when first created.'
                : 'This document cannot be shared. Previously created links to it are unavailable.'}
            </p>
            {shareMessage ? <p role="status" className="mt-2 text-[11.5px] text-gink-64">{shareMessage}</p> : null}
            {canShare && createdLink ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  aria-label="New secure receipt link"
                  readOnly
                  value={createdLink.href}
                  className="min-w-0 flex-1 rounded border border-hair bg-paper px-2 py-1.5 text-[11.5px]"
                />
                <button type="button" className={btn('ghost', 'sm')} onClick={() => void navigator.clipboard.writeText(createdLink.href)}>
                  Copy link
                </button>
                <span className="self-center text-[10.5px] text-gink-46">Expires {new Date(createdLink.expiresAt).toLocaleString()}</span>
              </div>
            ) : null}
            {shareLinks.length ? (
              <ul className="mt-3 divide-y divide-hair">
                {shareLinks.map((link) => {
                  const expired = Date.now() >= new Date(link.expiresAt).getTime();
                  const status = link.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active';
                  return (
                    <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11.5px]">
                      <span>
                        {status} · expires {new Date(link.expiresAt).toLocaleString()} · opened {link.accessCount} time{link.accessCount === 1 ? '' : 's'}
                        {link.lastAccessedAt ? ` · last opened ${new Date(link.lastAccessedAt).toLocaleString()}` : ''}
                      </span>
                      {!link.revokedAt && !expired ? (
                        <button type="button" className={btn('quiet', 'sm')} onClick={() => void revokeLink(link.id)} disabled={shareBusy}>
                          Revoke link
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-3 text-[11.5px] text-gink-46">No receipt links have been created.</p>}
          </section>
        ) : null}

        {!shared && canWrite && staffRole === 'owner' && invoice.status === 'issued'
          && !copy && invoice.irpStatus !== 'generated' && invoice.irpStatus !== 'cancelled' ? <InvoiceVoidPanel id={invoice.id} /> : null}

        {invoice.paymentReceipts.length ? (
          <section data-supplemental-payment-receipts className="mx-auto mt-4 max-w-[760px] rounded-[14px] border border-hair bg-card p-5 print:hidden">
            <h2 className="text-[13px] font-semibold">Later payment receipts</h2>
            <p className="mt-1 text-[11.5px] leading-[1.45] text-gink-64">
              These are separate acknowledgements for payments received after this invoice was issued. They do not change the printed invoice above.
            </p>
            <ul className="mt-3 divide-y divide-hair">
              {invoice.paymentReceipts.map((receipt) => (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11.5px]">
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
