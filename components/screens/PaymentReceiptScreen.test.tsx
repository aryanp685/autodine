import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PaymentReceiptScreen } from './PaymentReceiptScreen';
import type { PaymentReceiptData } from '@/lib/db/payment-receipt';

const receipt: PaymentReceiptData = {
  id: 'payment-receipt-1',
  restaurantId: 'restaurant-1',
  invoiceId: 'invoice-1',
  reference: 'PR/26-27/000001-01',
  invoiceNumber: 'INV/26-27/000001',
  issuedAt: '08 Nov 2026, 8:00 pm',
  seller: {
    name: 'Maddi',
    address: '12 Baner Road, Pune 411045',
    phone: '9876543210',
    logoUrl: null,
  },
  tableLabel: 'T3',
  method: 'upi',
  amountPaise: 50000,
  receivedAt: '08 Nov 2026, 8:05 pm',
  totalPaidPaise: 50000,
  outstandingPaise: 60853,
  paymentStatus: 'partially_paid',
};

describe('PaymentReceiptScreen', () => {
  it('shows the later payment as a separate receipt without changing the invoice', () => {
    const html = renderToStaticMarkup(<PaymentReceiptScreen receipt={receipt} />);
    expect(html).toContain('PR/26-27/000001-01');
    expect(html).toContain('INV/26-27/000001');
    expect(html).toContain('Payment receipt');
    expect(html).toContain('UPI');
    expect(html).toContain('₹500.00');
    expect(html).toContain('₹608.53');
    expect(html).toContain('This acknowledges payment only. It does not replace or change the issued invoice.');
    expect(html).toContain('/invoice/invoice-1');
  });

  it('offers A4 and thermal browser print layouts', () => {
    const html = renderToStaticMarkup(<PaymentReceiptScreen receipt={receipt} />);
    expect(html).toContain('58 mm');
    expect(html).toContain('80 mm');
    expect(html).toContain('Print / Save PDF');
    expect(html).toContain('Share receipt');
  });
});
