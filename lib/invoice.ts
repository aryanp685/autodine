import { formatBillMoney } from '@/lib/bill';
import { COMPOSITION_BILL_NOTICE } from '@/lib/gst/composition';
import type { VerifiedIrpCopy } from '@/lib/gst/irp/execution/presentation';
import { gstStateLabel } from '@/lib/gst/onboarding';

type ShareReceiptInput = {
  seller: {
    name: string; gstin?: string | null; stateCode?: string | null;
    address?: string | null; phone?: string | null; fssaiNumber?: string | null;
  };
  recipient?: { name: string; gstin: string | null; stateCode: string; address?: string | null; location?: string | null; pincode?: string | null; deliveryAddress?: string | null } | null;
  number: string;
  issuedAt: string;
  retailBill?: boolean;
  fulfilmentLabel?: string | null;
  privateDeliveryCopy?: boolean;
  documentType?: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
  irpStatus?: string;
  verifiedIrp?: VerifiedIrpCopy | null;
  status?: 'issued' | 'voided';
  gst?: {
    rateBps: number;
    cgstBps: number;
    sgstBps: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    placeOfSupplyStateCode: string | null;
    notice: string | null;
    profileNotification: string | null;
    serviceSac?: string | null;
    reverseCharge?: boolean;
  } | null;
  tableLabel: string | null;
  sessionReference: string;
  lines: Array<{
    quantity: number;
    itemName: string;
    variant: string | null;
    addons: string[];
    amountPaise: number;
  }>;
  totals: {
    subtotalPaise: number;
    ticketDiscountPaise: number;
    billDiscountPaise: number;
    taxPaise: number;
    otherChargesPaise: number;
    totalPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    paymentStatus: string;
  };
};

export function hasIrnHold(invoice: Pick<ShareReceiptInput, 'documentType' | 'irpStatus' | 'status' | 'verifiedIrp'>): boolean {
  if (invoice.documentType !== 'gst_tax_invoice' || invoice.irpStatus === 'not_required') return false;
  // A status, raw IRN, digest or simulator artifact on its own cannot release.
  return !(invoice.status==='issued' && ['pending','failed','generated'].includes(invoice.irpStatus??'') && invoice.verifiedIrp?.tier==='authority');
}

/** Do not re-label pre-onboarding ordinary receipts or infer from current settings. */
export function isRetailBill(invoice: Pick<ShareReceiptInput, 'documentType' | 'number' | 'retailBill'>): boolean {
  return (invoice.documentType ?? 'receipt') === 'receipt' && (invoice.retailBill === true || invoice.number.startsWith('RBL/'));
}

export function issuedDocumentTitle(invoice: Pick<ShareReceiptInput, 'documentType' | 'number' | 'irpStatus' | 'retailBill' | 'status' | 'verifiedIrp'>): string {
  if (invoice.documentType === 'gst_tax_invoice' && invoice.irpStatus === 'cancelled') return 'IRP cancellation recorded';
  if (hasIrnHold(invoice)) return 'Held GST document';
  if (invoice.documentType === 'gst_tax_invoice') return 'TAX INVOICE';
  if (invoice.documentType === 'bill_of_supply') return 'BILL OF SUPPLY';
  return isRetailBill(invoice) ? 'RETAIL BILL / CASH MEMO' : 'Receipt · Not a GST tax invoice';
}

/** A digital text copy of the saved document amounts, with the same hold/void status. */
export function buildReceiptMessage(invoice: ShareReceiptInput): string {
  const docType = invoice.documentType ?? 'receipt';
  const retail = isRetailBill(invoice);
  const held = hasIrnHold(invoice);
  if (invoice.privateDeliveryCopy) return 'Private delivery document. Print the complete customer copy from the authorized invoice screen.';
  if (invoice.documentType==='gst_tax_invoice' && invoice.verifiedIrp && !held) return 'Private e-invoice. Use the authorized copy with the signed QR.';
  if (held) return invoice.irpStatus === 'cancelled'
    ? 'IRP CANCELLATION RECORDED — NOT A VALID TAX INVOICE'
    : 'IRN HOLD — NOT A FINAL GST TAX INVOICE';
  const header = docType === 'receipt' && !retail ? 'RECEIPT — NOT A GST TAX INVOICE' : issuedDocumentTitle(invoice);
  const docLabel = docType === 'gst_tax_invoice' ? 'Tax invoice no.'
    : docType === 'bill_of_supply' ? 'Bill of supply no.'
    : retail ? 'Retail bill no.' : 'Receipt no.';
  const lines = [
    invoice.seller.name,
    ...(invoice.seller.address ? [invoice.seller.address] : []),
    ...(invoice.seller.phone ? [`Phone ${invoice.seller.phone}`] : []),
    ...(invoice.seller.fssaiNumber ? [`FSSAI ${invoice.seller.fssaiNumber}`] : []),
    ...(invoice.status === 'voided' ? ['VOID — NOT A LIVE DOCUMENT'] : []),
    header,
    ...(docType === 'bill_of_supply' ? [invoice.gst?.notice ?? COMPOSITION_BILL_NOTICE] : []),
    `${docLabel} ${invoice.number}`,
    `${invoice.issuedAt}${invoice.tableLabel ? ` · Table ${invoice.tableLabel}` : ''}`,
    `Session ${invoice.sessionReference.slice(0, 8).toUpperCase()}`,
  ];
  if (docType !== 'receipt' && invoice.seller.gstin) {
    lines.push(`GSTIN ${invoice.seller.gstin}`);
  }
  if (docType !== 'receipt' && invoice.gst?.serviceSac) lines.push(`Service SAC ${invoice.gst.serviceSac}`);
  if (docType === 'gst_tax_invoice') {
    const pos = invoice.gst?.placeOfSupplyStateCode;
    if (pos) lines.push(`Place of supply: ${gstStateLabel(pos) ?? pos}`);
    if (invoice.gst?.reverseCharge !== undefined) lines.push(`Reverse charge: ${invoice.gst.reverseCharge ? 'Yes' : 'No'}`);
    if (invoice.recipient) {
      lines.push(`Bill to ${invoice.recipient.name}${invoice.recipient.gstin ? ` · GSTIN ${invoice.recipient.gstin}` : ' · Unregistered'} · ${gstStateLabel(invoice.recipient.stateCode) ?? `State code ${invoice.recipient.stateCode}`}`);
      if (invoice.recipient.address) lines.push(invoice.recipient.address);
      if (invoice.recipient.location) lines.push([invoice.recipient.location, invoice.recipient.pincode].filter(Boolean).join(' '));
      if (invoice.recipient.deliveryAddress && invoice.fulfilmentLabel !== 'Direct delivery') lines.push(`Delivery address ${invoice.recipient.deliveryAddress}`);
    }
  }
  if (docType === 'bill_of_supply') {
    if (!invoice.gst?.serviceSac) lines.push('Historical record — service SAC not recorded. Do not use as a new Bill of Supply.');
  }
  lines.push(
    '',
    ...invoice.lines.map(
      (line) =>
        `${line.quantity} × ${[line.itemName, line.variant, ...line.addons].filter(Boolean).join(' · ')} — ${formatBillMoney(line.amountPaise)}`,
    ),
    '',
  );
  if (docType === 'gst_tax_invoice' && invoice.gst) {
    const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
    lines.push(
      `Taxable value: ${formatBillMoney(invoice.gst.taxablePaise)}`,
      ...(invoice.gst.igstPaise > 0
        ? [`IGST ${pct(invoice.gst.rateBps)}%: ${formatBillMoney(invoice.gst.igstPaise)}`]
        : [
            `CGST ${pct(invoice.gst.cgstBps)}%: ${formatBillMoney(invoice.gst.cgstPaise)}`,
            `SGST ${pct(invoice.gst.sgstBps)}%: ${formatBillMoney(invoice.gst.sgstPaise)}`,
          ]),
    );
  } else if (docType === 'bill_of_supply') {
    lines.push(`Supply value: ${formatBillMoney(invoice.gst?.taxablePaise ?? invoice.totals.subtotalPaise)}`);
  } else {
    lines.push(`Subtotal: ${formatBillMoney(invoice.totals.subtotalPaise)}`);
    if (!retail && invoice.totals.taxPaise > 0) {
      lines.push(`Tax amount (from ticket records): ${formatBillMoney(invoice.totals.taxPaise)}`);
    }
  }
  if (invoice.totals.ticketDiscountPaise > 0) {
    lines.push(`Ticket discounts (as recorded): −${formatBillMoney(invoice.totals.ticketDiscountPaise)}`);
  }
  if (invoice.totals.billDiscountPaise > 0) {
    lines.push(`Bill discount: −${formatBillMoney(invoice.totals.billDiscountPaise)}`);
  }
  if (invoice.totals.otherChargesPaise > 0) {
    lines.push(`Other charges: ${formatBillMoney(invoice.totals.otherChargesPaise)}`);
  }
  lines.push(
    `Total payable: ${formatBillMoney(invoice.totals.totalPaise)}`,
    `Amount paid: ${formatBillMoney(invoice.totals.paidPaise)}`,
    `Outstanding: ${formatBillMoney(invoice.totals.outstandingPaise)} (${invoice.totals.paymentStatus})`,
    '',
    ...(docType === 'receipt'
      ? retail ? [] : ['This receipt is not a GST tax invoice.']
      : docType === 'bill_of_supply'
        ? ['Bill of Supply. Composition taxable person.']
        : ['GST tax invoice. Place of supply as shown above.']),
    ...(docType !== 'receipt' ? ['Unsigned text copy — ask the supplier for the signed or otherwise compliant document.'] : []),
  );
  return lines.join('\n');
}
