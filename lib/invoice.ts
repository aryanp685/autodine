import { formatBillMoney } from '@/lib/bill';

type ShareReceiptInput = {
  seller: { name: string };
  number: string;
  issuedAt: string;
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

/** A digital text copy of the exact immutable receipt snapshot. */
export function buildReceiptMessage(invoice: ShareReceiptInput): string {
  const lines = [
    invoice.seller.name,
    'RECEIPT — NOT A GST TAX INVOICE',
    `Receipt ${invoice.number}`,
    `${invoice.issuedAt}${invoice.tableLabel ? ` · Table ${invoice.tableLabel}` : ''}`,
    `Session ${invoice.sessionReference.slice(0, 8).toUpperCase()}`,
    '',
    ...invoice.lines.map(
      (line) =>
        `${line.quantity} × ${[line.itemName, line.variant, ...line.addons].filter(Boolean).join(' · ')} — ${formatBillMoney(line.amountPaise)}`,
    ),
    '',
    `Subtotal: ${formatBillMoney(invoice.totals.subtotalPaise)}`,
  ];
  if (invoice.totals.ticketDiscountPaise > 0) {
    lines.push(`Ticket discounts (as recorded): −${formatBillMoney(invoice.totals.ticketDiscountPaise)}`);
  }
  if (invoice.totals.billDiscountPaise > 0) {
    lines.push(`Bill discount: −${formatBillMoney(invoice.totals.billDiscountPaise)}`);
  }
  if (invoice.totals.taxPaise > 0) {
    lines.push(`Tax amount (from ticket records): ${formatBillMoney(invoice.totals.taxPaise)}`);
  }
  if (invoice.totals.otherChargesPaise > 0) {
    lines.push(`Other charges: ${formatBillMoney(invoice.totals.otherChargesPaise)}`);
  }
  lines.push(
    `Total payable: ${formatBillMoney(invoice.totals.totalPaise)}`,
    `Amount paid: ${formatBillMoney(invoice.totals.paidPaise)}`,
    `Outstanding: ${formatBillMoney(invoice.totals.outstandingPaise)} (${invoice.totals.paymentStatus})`,
    '',
    'This receipt is not a GST tax invoice.',
  );
  return lines.join('\n');
}
