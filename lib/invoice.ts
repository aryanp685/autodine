import { formatBillMoney } from '@/lib/bill';

type ShareReceiptInput = {
  seller: {
    name: string;
    gstin?: string | null;
    stateCode?: string | null;
    fssaiNumber?: string | null;
    billFooterNote?: string | null;
  };
  number: string;
  issuedAt: string;
  documentType?: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
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
    serviceChargePaise?: number;
    packagingChargePaise?: number;
    deliveryChargePaise?: number;
    roundOffPaise?: number;
    taxPaise: number;
    otherChargesPaise: number;
    totalPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    paymentStatus: string;
  };
};

/** A digital text copy of the exact immutable receipt snapshot. */
export function buildReceiptMessage(invoice: ShareReceiptInput): string {
  const docType = invoice.documentType ?? 'receipt';
  const header =
    docType === 'gst_tax_invoice' ? 'GST TAX INVOICE'
    : docType === 'bill_of_supply' ? 'BILL OF SUPPLY'
    : 'RECEIPT — NOT A GST TAX INVOICE';
  const docLabel =
    docType === 'gst_tax_invoice' ? 'Tax invoice no.'
    : docType === 'bill_of_supply' ? 'Bill of supply no.'
    : 'Receipt no.';
  const lines = [
    invoice.seller.name,
    header,
    `${docLabel} ${invoice.number}`,
    `${invoice.issuedAt}${invoice.tableLabel ? ` · Table ${invoice.tableLabel}` : ''}`,
    `Session ${invoice.sessionReference.slice(0, 8).toUpperCase()}`,
  ];
  if (docType !== 'receipt' && invoice.seller.gstin) {
    lines.push(`GSTIN ${invoice.seller.gstin}${invoice.gst?.placeOfSupplyStateCode ? ` · Place of supply ${invoice.gst.placeOfSupplyStateCode}` : ''}`);
  }
  if (invoice.seller.fssaiNumber) {
    lines.push(`FSSAI Lic. No. ${invoice.seller.fssaiNumber}`);
  }
  if (docType === 'bill_of_supply' && invoice.gst?.notice) {
    lines.push(invoice.gst.notice);
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
  } else {
    lines.push(`Subtotal: ${formatBillMoney(invoice.totals.subtotalPaise)}`);
    if (invoice.totals.taxPaise > 0) {
      lines.push(`Tax amount (from ticket records): ${formatBillMoney(invoice.totals.taxPaise)}`);
    }
  }
  if (invoice.totals.ticketDiscountPaise > 0) {
    lines.push(`Ticket discounts (as recorded): −${formatBillMoney(invoice.totals.ticketDiscountPaise)}`);
  }
  if (invoice.totals.billDiscountPaise > 0) {
    lines.push(`Bill discount: −${formatBillMoney(invoice.totals.billDiscountPaise)}`);
  }
  const itemizedCharges =
    (invoice.totals.serviceChargePaise ?? 0) +
    (invoice.totals.packagingChargePaise ?? 0) +
    (invoice.totals.deliveryChargePaise ?? 0);
  if (itemizedCharges > 0) {
    if ((invoice.totals.serviceChargePaise ?? 0) > 0) {
      lines.push(`Service charge: ${formatBillMoney(invoice.totals.serviceChargePaise ?? 0)}`);
    }
    if ((invoice.totals.packagingChargePaise ?? 0) > 0) {
      lines.push(`Packaging charge: ${formatBillMoney(invoice.totals.packagingChargePaise ?? 0)}`);
    }
    if ((invoice.totals.deliveryChargePaise ?? 0) > 0) {
      lines.push(`Delivery charge: ${formatBillMoney(invoice.totals.deliveryChargePaise ?? 0)}`);
    }
  } else if (invoice.totals.otherChargesPaise > 0) {
    lines.push(`Other charges: ${formatBillMoney(invoice.totals.otherChargesPaise)}`);
  }
  if ((invoice.totals.roundOffPaise ?? 0) !== 0) {
    const ro = invoice.totals.roundOffPaise ?? 0;
    lines.push(`Round-off: ${ro > 0 ? '+' : '−'}${formatBillMoney(Math.abs(ro))}`);
  }
  lines.push(
    `Total payable: ${formatBillMoney(invoice.totals.totalPaise)}`,
    `Amount paid: ${formatBillMoney(invoice.totals.paidPaise)}`,
    `Outstanding: ${formatBillMoney(invoice.totals.outstandingPaise)} (${invoice.totals.paymentStatus})`,
    '',
    ...(docType === 'receipt'
      ? ['This receipt is not a GST tax invoice.']
      : docType === 'bill_of_supply'
        ? ['Bill of Supply. Composition taxable person.']
        : ['GST tax invoice. Place of supply as shown above.']),
    ...(invoice.seller.billFooterNote ? [invoice.seller.billFooterNote] : []),
  );
  return lines.join('\n');
}
