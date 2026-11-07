import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { InvoiceScreen } from './InvoiceScreen';
import type { ReceiptData } from '@/lib/db/invoice';
import { buildReceiptMessage } from '@/lib/invoice';

const receipt = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  id: 'invoice-1',
  restaurantId: 'restaurant-1',
  number: 'INV/26-27/000001',
  financialYear: '26-27',
  documentType: 'receipt',
  status: 'issued',
  issuedAt: '07 Nov 2026, 8:42 pm',
  issuedBy: 'staff-1',
  supersedesInvoiceId: null,
  voidReason: null,
  tableLabel: 'T3',
  sessionReference: '12345678-abcd-efab-1234-123456789abc',
  sessionOpenedAt: '07 Nov 2026, 8:00 pm',
  sessionClosedAt: '07 Nov 2026, 8:40 pm',
  seller: {
    name: 'Maddi',
    address: '12 Baner Road, Pune 411045',
    phone: '9876543210',
    logoUrl: null,
  },
  totals: {
    subtotalPaise: 101700,
    ticketDiscountPaise: 0,
    billDiscountPaise: 0,
    taxablePaise: 101700,
    taxPaise: 9153,
    otherChargesPaise: 0,
    totalPaise: 110853,
    paidPaise: 50000,
    outstandingPaise: 60853,
    paymentStatus: 'unpaid',
  },
  payments: [{ method: 'upi', amountPaise: 50000, receivedAt: '07 Nov 2026, 8:41 pm' }],
  paymentReceipts: [],
  lines: [
    {
      id: 'line-1',
      ticketCode: 'MA-4F2K1',
      itemName: 'Butter Chicken',
      variant: 'Half',
      addons: ['Extra cheese'],
      quantity: 2,
      unitPricePaise: 46900,
      amountPaise: 93800,
      isVeg: false,
    },
    {
      id: 'line-2',
      ticketCode: 'MA-7Q3L1',
      itemName: 'Butter Naan',
      variant: null,
      addons: [],
      quantity: 1,
      unitPricePaise: 7900,
      amountPaise: 7900,
      isVeg: true,
    },
  ],
  ...over,
});

describe('InvoiceScreen', () => {
  it('renders the immutable non-GST receipt with consolidated tickets and session identity', () => {
    const html = renderToStaticMarkup(<InvoiceScreen invoice={receipt()} />);
    expect(html).toContain('INV/26-27/000001');
    expect(html).toContain('Receipt · Not a GST tax invoice');
    expect(html).toContain('Butter Chicken');
    expect(html).toContain('MA-4F2K1');
    expect(html).toContain('MA-7Q3L1');
    expect(html).toContain('Session 12345678');
    expect(html).toContain('₹1,108.53');
    expect(html).toContain('₹608.53');
    expect(html).toContain('Payment status: Unpaid');
    expect(html).not.toContain('CGST');
    expect(html).not.toContain('SGST');
    expect(html).not.toContain('GSTIN');
  });

  it('lists later payment acknowledgements separately from the frozen invoice print', () => {
    const html = renderToStaticMarkup(<InvoiceScreen invoice={receipt({
      paymentReceipts: [{
        id: 'payment-1',
        reference: 'PR/26-27/000001-01',
        amountPaise: 50000,
        receivedAt: '08 Nov 2026, 8:05 pm',
      }],
    })} />);
    expect(html).toContain('PR/26-27/000001-01');
    expect(html).toContain('/invoice/payment/payment-1');
    expect(html).toContain('They do not change the printed invoice above.');
    const invoiceEnd = html.indexOf('</article>');
    const supplementalStart = html.indexOf('data-supplemental-payment-receipts');
    expect(invoiceEnd).toBeGreaterThan(-1);
    expect(supplementalStart).toBeGreaterThan(invoiceEnd);
    expect(html.slice(supplementalStart, supplementalStart + 180)).toContain('print:hidden');
  });

  it('offers A4 and both supported thermal layouts plus print/PDF and digital sharing', () => {
    const html = renderToStaticMarkup(<InvoiceScreen invoice={receipt()} />);
    expect(html).toContain('A4');
    expect(html).toContain('58 mm');
    expect(html).toContain('80 mm');
    expect(html).toContain('Print / Save PDF');
    expect(html).toContain('Share receipt');
  });

  it('marks voided receipts and keeps their recorded reason visible', () => {
    const html = renderToStaticMarkup(
      <InvoiceScreen invoice={receipt({ status: 'voided', voidReason: 'Duplicate session receipt' })} />,
    );
    expect(html).toContain('VOID');
    expect(html).toContain('Duplicate session receipt');
  });
});

describe('buildReceiptMessage', () => {
  it('shares the stored values and explicitly avoids representing a GST breakdown', () => {
    const message = buildReceiptMessage(receipt());
    expect(message).toContain('Receipt INV/26-27/000001');
    expect(message).toContain('2 × Butter Chicken · Half · Extra cheese');
    expect(message).toContain('Tax amount (from ticket records): ₹91.53');
    expect(message).toContain('Total payable: ₹1,108.53');
    expect(message).toContain('Outstanding: ₹608.53 (unpaid)');
    expect(message).toContain('not a GST tax invoice');
    expect(message).not.toContain('CGST');
  });
});
