import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { InvoiceScreen } from './InvoiceScreen';
import type { ReceiptData } from '@/lib/db/invoice';
import { buildReceiptMessage } from '@/lib/invoice';

const invoice = (overrides: Partial<ReceiptData> = {}): ReceiptData => ({
  id: 'invoice-1',
  restaurantId: 'restaurant-1',
  number: 'INV/26-27/000042',
  financialYear: '26-27',
  documentType: 'receipt',
  status: 'issued',
  issuedAt: '08 Nov 2026, 8:00 pm',
  issuedBy: 'staff-1',
  supersedesInvoiceId: null,
  voidReason: null,
  tableLabel: 'T3',
  sessionReference: '12345678-1234-1234-1234-123456789012',
  sessionOpenedAt: '08 Nov 2026, 7:00 pm',
  sessionClosedAt: '08 Nov 2026, 8:00 pm',
  seller: {
    name: 'Maddi',
    address: '12 Baner Road, Pune 411045',
    phone: '9876543210',
    logoUrl: null,
  },
  totals: {
    subtotalPaise: 100_000,
    ticketDiscountPaise: 0,
    billDiscountPaise: 0,
    taxablePaise: null,
    taxPaise: 0,
    otherChargesPaise: 0,
    totalPaise: 100_000,
    paidPaise: 0,
    outstandingPaise: 100_000,
    paymentStatus: 'unpaid',
  },
  payments: [],
  paymentReceipts: [],
  lines: [
    {
      id: 'line-1',
      ticketCode: 'MA-4F2K1',
      itemName: 'Butter Chicken',
      variant: 'Half',
      addons: ['Extra cheese'],
      quantity: 2,
      unitPricePaise: 50_000,
      amountPaise: 100_000,
      isVeg: false,
    },
  ],
  ...overrides,
});

function html(data: ReceiptData = invoice()) {
  return renderToStaticMarkup(<InvoiceScreen invoice={data} />);
}

describe('P10 real-world receipt scenarios', () => {
  it('01 — identifies an issued receipt and never presents it as a GST tax invoice', () => {
    const output = html();
    expect(output).toContain('INV/26-27/000042');
    expect(output).toContain('Receipt · Not a GST tax invoice');
    expect(output).not.toContain('GST Tax Invoice');
  });

  it('02 — starts on A4 and offers both common thermal widths plus Save as PDF', () => {
    const output = html();
    expect(output).toContain('data-layout="a4"');
    expect(output).toContain('>58 mm</option>');
    expect(output).toContain('>80 mm</option>');
    expect(output).toContain('Print / Save PDF');
  });

  it('03 — preserves quantity, ticket reference, portion, add-ons, and the charged amount', () => {
    const output = html();
    expect(output).toContain('Butter Chicken');
    expect(output).toContain('Half · Extra cheese');
    expect(output).toContain('Ticket MA-4F2K1');
    expect(output).toContain('₹1,000.00');
  });

  it('04 — keeps an unpaid final receipt explicit about the full outstanding balance', () => {
    const output = html();
    expect(output).toContain('Payment status: Unpaid');
    expect(output).toContain('Outstanding');
    expect(output).toContain('₹1,000.00');
    expect(output).toContain('Amount paid');
  });

  it('05 — shows ticket discounts as recorded instead of silently rewriting ticket prices', () => {
    const output = html(invoice({ totals: { ...invoice().totals, ticketDiscountPaise: 1_000, totalPaise: 99_000, outstandingPaise: 99_000 } }));
    expect(output).toContain('Ticket discounts (as recorded)');
    expect(output).toContain('−₹10.00');
    expect(output).toContain('₹990.00');
  });

  it('06 — shows an authorized bill-level discount as its own amount', () => {
    const output = html(invoice({ totals: { ...invoice().totals, billDiscountPaise: 2_500, totalPaise: 97_500, outstandingPaise: 97_500 } }));
    expect(output).toContain('Bill discount');
    expect(output).toContain('−₹25.00');
    expect(output).toContain('₹975.00');
  });

  it('07 — accounts for both ticket and bill discounts in the same receipt', () => {
    const output = html(invoice({ totals: { ...invoice().totals, ticketDiscountPaise: 1_000, billDiscountPaise: 2_500, totalPaise: 96_500, outstandingPaise: 96_500 } }));
    expect(output).toContain('Ticket discounts (as recorded)');
    expect(output).toContain('Bill discount');
    expect(output).toContain('₹965.00');
  });

  it('08 — prints only the tax amount actually recorded for the tickets', () => {
    const output = html(invoice({ totals: { ...invoice().totals, taxablePaise: 100_000, taxPaise: 5_000, totalPaise: 105_000, outstandingPaise: 105_000 } }));
    expect(output).toContain('Tax amount (from ticket records)');
    expect(output).toContain('₹50.00');
  });

  it('09 — does not invent a tax line for a zero-tax restaurant', () => {
    expect(html()).not.toContain('Tax amount (from ticket records)');
  });

  it('10 — includes separately recorded service or other charges in the payable total', () => {
    const output = html(invoice({ totals: { ...invoice().totals, otherChargesPaise: 1_500, totalPaise: 101_500, outstandingPaise: 101_500 } }));
    expect(output).toContain('Other charges');
    expect(output).toContain('₹15.00');
    expect(output).toContain('₹1,015.00');
  });

  it('11 — shows a later partial payment without making the original invoice look settled', () => {
    const output = html(invoice({
      totals: { ...invoice().totals, paidPaise: 40_000, outstandingPaise: 60_000 },
      payments: [{ method: 'cash', amountPaise: 40_000, receivedAt: '08 Nov 2026, 8:10 pm' }],
    }));
    expect(output).toContain('Payment status: Unpaid');
    expect(output).toContain('₹400.00');
    expect(output).toContain('₹600.00');
    expect(output).toContain('cash');
  });

  it('12 — shows a fully paid receipt and its recorded payment method', () => {
    const output = html(invoice({
      totals: { ...invoice().totals, paidPaise: 100_000, outstandingPaise: 0, paymentStatus: 'paid' },
      payments: [{ method: 'upi', amountPaise: 100_000, receivedAt: '08 Nov 2026, 8:10 pm' }],
    }));
    expect(output).toContain('Payment status: Paid');
    expect(output).toContain('UPI');
    expect(output).toContain('₹0.00');
  });

  it('13 — marks voided receipts and preserves the replacement relationship', () => {
    const output = html(invoice({ status: 'voided', voidReason: 'Wrong table', supersedesInvoiceId: 'invoice-previous' }));
    expect(output).toContain('VOID — Wrong table');
    expect(output).toContain('Replacement receipt; previous receipt is voided.');
  });

  it('14 — a counter session without a table label remains printable and identified as a session', () => {
    const output = html(invoice({ tableLabel: null }));
    expect(output).toContain('Session 12345678');
    expect(output).toContain('INV/26-27/000042');
  });

  it('15 — lists later payment acknowledgements outside the immutable invoice print sheet', () => {
    const output = html(invoice({
      paymentReceipts: [{ id: 'payment-1', reference: 'PR/26-27/000042-01', amountPaise: 25_000, receivedAt: '08 Nov 2026, 8:20 pm' }],
    }));
    expect(output).toContain('data-supplemental-payment-receipts');
    expect(output).toContain('PR/26-27/000042-01');
    expect(output).toContain('print:hidden');
    expect(output).toContain('They do not change the printed invoice above.');
  });

  it('keeps the browser print/PDF amount and the share copy on the same immutable snapshot', () => {
    const data = invoice({
      totals: {
        ...invoice().totals,
        ticketDiscountPaise: 1_000,
        billDiscountPaise: 2_500,
        totalPaise: 96_500,
        paidPaise: 40_000,
        outstandingPaise: 56_500,
      },
      payments: [{ method: 'cash', amountPaise: 40_000, receivedAt: '08 Nov 2026, 8:10 pm' }],
    });
    const printed = html(data);
    const shared = buildReceiptMessage(data);

    expect(printed).toContain('Total payable');
    expect(printed).toContain('₹965.00');
    expect(printed).toContain('Outstanding');
    expect(printed).toContain('₹565.00');
    expect(shared).toContain('Total payable: ₹965.00');
    expect(shared).toContain('Outstanding: ₹565.00');
    expect(shared).toContain('Bill discount: −₹25.00');
    expect(shared).toContain('Amount paid: ₹400.00');
    expect(printed).toContain('Print / Save PDF');
  });

  it('retains the consolidated multi-ticket receipt, ticket codes, and snapshot tax', () => {
    const data = invoice({
      totals: {
        ...invoice().totals,
        subtotalPaise: 101_700,
        taxablePaise: 101_700,
        taxPaise: 9_153,
        totalPaise: 110_853,
        paidPaise: 50_000,
        outstandingPaise: 60_853,
      },
      payments: [{ method: 'upi', amountPaise: 50_000, receivedAt: '08 Nov 2026, 8:10 pm' }],
      lines: [
        ...invoice().lines,
        {
          id: 'line-2',
          ticketCode: 'MA-7Q3L1',
          itemName: 'Butter Naan',
          variant: null,
          addons: [],
          quantity: 1,
          unitPricePaise: 1_700,
          amountPaise: 1_700,
          isVeg: true,
        },
      ],
    });
    const printed = html(data);
    const shared = buildReceiptMessage(data);

    expect(printed).toContain('MA-4F2K1');
    expect(printed).toContain('MA-7Q3L1');
    expect(printed).toContain('Butter Naan');
    expect(printed).toContain('₹1,108.53');
    expect(printed).toContain('₹608.53');
    expect(shared).toContain('2 × Butter Chicken · Half · Extra cheese');
    expect(shared).toContain('Tax amount (from ticket records): ₹91.53');
    expect(shared).not.toContain('CGST');
    expect(shared).not.toContain('SGST');
  });

  it('keeps later payment receipt links outside the original printable invoice', () => {
    const output = html(invoice({
      paymentReceipts: [{ id: 'payment-1', reference: 'PR/26-27/000042-01', amountPaise: 25_000, receivedAt: '08 Nov 2026, 8:20 pm' }],
    }));
    const invoiceEnd = output.indexOf('</article>');
    const supplementalStart = output.indexOf('data-supplemental-payment-receipts');
    expect(output).toContain('href="/invoice/payment/payment-1"');
    expect(invoiceEnd).toBeGreaterThan(-1);
    expect(supplementalStart).toBeGreaterThan(invoiceEnd);
    expect(output.slice(supplementalStart, supplementalStart + 180)).toContain('print:hidden');
  });

  it('offers the digital share action alongside printing', () => {
    const output = html();
    expect(output).toContain('Share receipt');
    expect(output).toContain('Print / Save PDF');
  });
});
