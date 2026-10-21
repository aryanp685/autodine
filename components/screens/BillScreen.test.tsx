import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { BillScreen } from './BillScreen';
import type { BillData } from '@/lib/db/bill';

/**
 * The bill, rendered the way the server renders it.
 *
 * What matters on a bill is not the layout but the arithmetic and the honesty:
 * the tax is shown split without losing a paisa, a cancelled order never looks
 * chargeable, and an unpaid bill says so instead of looking settled.
 */

const bill = (over: Partial<BillData> = {}): BillData => ({
  restaurant: {
    name: 'Maddi',
    address: '12 Baner Road, Pune 411045',
    phone: '9876543210',
    gstin: '27ABCDE1234F1Z5',
  },
  order: {
    id: 'o-1',
    code: 'MA-4F2K1',
    placedAt: '21 Oct 2026, 8:42 pm',
    tableLabel: 'T3',
    prepStatus: 'served',
    paymentStatus: 'paid',
    cancelled: false,
    customerNote: null,
    subtotalPaise: 101700,
    discountPaise: 0,
    taxPaise: 9153,
    totalPaise: 110853,
    taxRateBps: 1800,
  },
  lines: [
    {
      id: 'l-1',
      label: 'Butter Chicken · Half · Extra cheese',
      qty: 2,
      ratePaise: 46900,
      amountPaise: 93800,
      isVeg: false,
    },
    { id: 'l-2', label: 'Butter Naan', qty: 1, ratePaise: 7900, amountPaise: 7900, isVeg: true },
  ],
  payments: [{ method: 'upi', amountPaise: 110853, at: '21 Oct 2026, 8:55 pm' }],
  outstandingPaise: 0,
  ...over,
});

describe('BillScreen', () => {
  it('prints the restaurant details a bill is legally expected to carry', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Maddi');
    expect(html).toContain('12 Baner Road, Pune 411045');
    expect(html).toContain('GSTIN 27ABCDE1234F1Z5');
    expect(html).toContain('9876543210');
  });

  it('shows the tax split, not one unexplained figure', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('CGST 9%');
    expect(html).toContain('SGST 9%');
    expect(html).toContain('₹45.77');
    expect(html).toContain('₹45.76');
  });

  it('adds up: the two tax halves make the stored tax', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    // 4577 + 4576 = 9153, and the total is subtotal + that tax.
    expect(html).toContain('₹1,108.53');
  });

  it('keeps portion and add-ons with the dish they were charged for', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Butter Chicken · Half · Extra cheese');
  });

  it('says how it was paid', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Paid by UPI');
    expect(html).not.toContain('please pay at the counter');
  });

  it('never lets an unpaid bill look settled', () => {
    const html = renderToStaticMarkup(
      <BillScreen
        bill={bill({
          payments: [],
          outstandingPaise: 110853,
          order: { ...bill().order, paymentStatus: 'pending' },
        })}
      />
    );
    expect(html).toContain('please pay at the counter');
    expect(html).toContain('₹1,108.53');
  });

  it('marks a cancelled order as chargeable for nothing', () => {
    const html = renderToStaticMarkup(
      <BillScreen
        bill={bill({
          payments: [],
          outstandingPaise: 0,
          order: { ...bill().order, cancelled: true, prepStatus: 'cancelled' },
        })}
      />
    );
    expect(html).toContain('CANCELLED');
    expect(html).toContain('Nothing is payable');
  });

  it('shows no tax lines when no tax was charged', () => {
    const html = renderToStaticMarkup(
      <BillScreen
        bill={bill({
          order: { ...bill().order, taxPaise: 0, taxRateBps: 0, totalPaise: 101700 },
          payments: [{ method: 'cash', amountPaise: 101700, at: '21 Oct 2026, 8:55 pm' }],
        })}
      />
    );
    expect(html).not.toContain('CGST');
    expect(html).toContain('₹1,017.00');
  });

  it('does not print a rate on an order that has no snapshot', () => {
    const html = renderToStaticMarkup(
      <BillScreen bill={bill({ order: { ...bill().order, taxRateBps: null } })} />
    );
    expect(html).toContain('CGST');
    expect(html).not.toContain('CGST 0%');
  });

  it('offers WhatsApp, and says plainly that nothing is sent for you', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Send this bill on WhatsApp');
    expect(html).toContain('you still press send yourself');
  });

  it('warns when the bill is missing the details it should carry', () => {
    const html = renderToStaticMarkup(
      <BillScreen
        bill={bill({
          restaurant: { name: 'Maddi', address: null, phone: null, gstin: null },
        })}
      />
    );
    expect(html).toContain('Address or GSTIN is empty');
    expect(html).toContain('/dashboard/settings');
  });

  it('marks the toolbar and the WhatsApp panel as print chrome', () => {
    // The @media print block hides these two classes; if a refactor renames
    // one of them the printed page silently gains a toolbar and a text box.
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('bill__bar');
    expect(html).toContain('bill__wa');
    expect(html).toContain('Print bill');
  });
});
