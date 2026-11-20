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
    gstMode: 'off',
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
  it('prints the storefront details without putting a live GSTIN on the ticket', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Maddi');
    expect(html).toContain('12 Baner Road, Pune 411045');
    expect(html).not.toContain('GSTIN');
    expect(html).toContain('Not a tax invoice or Bill of Supply');
    expect(html).toContain('9876543210');
  });

  it('preserves a legacy charge without labeling it CGST or SGST', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Legacy tax (18%)');
    expect(html).toContain('₹1,108.53');
    expect(html).not.toContain('CGST');
  });

  it('uses inclusive ticket amounts for Regular without pretending to be a tax invoice', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill({
      order: { ...bill().order, gstMode: 'regular', subtotalPaise: 10500, totalPaise: 10500, taxPaise: 500, taxRateBps: 500 },
    })} />);
    expect(html).toContain('Menu subtotal (GST included)');
    expect(html).toContain('GST included in this ticket (5%)');
    expect(html).toContain('₹105.00');
    expect(html).not.toContain('CGST');
  });

  it('does not add tax to a Composition ticket', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill({
      order: { ...bill().order, gstMode: 'composition', subtotalPaise: 10500, totalPaise: 10500, taxPaise: 0, taxRateBps: 0 },
    })} />);
    expect(html).toContain('GST collected');
    expect(html).toContain('₹0.00');
    expect(html).not.toContain('SGST');
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
    expect(html).toContain('Legacy tax');
    expect(html).not.toContain('Legacy tax (');
  });

  it('offers WhatsApp, and says plainly that nothing is sent for you', () => {
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('Send this ticket summary on WhatsApp');
    // The sentence explains the hand-off, and the button it belongs to does
    // not pretend to be live before a number is typed.
    expect(html).toContain('you still press send');
    expect(html).toContain('Type the guest’s 10-digit mobile number to enable this.');
    expect(html).toMatch(/<button[^>]*data-bill-wa-button[^>]*disabled=""/);
  });

  it('warns when the bill is missing the details it should carry', () => {
    const html = renderToStaticMarkup(
      <BillScreen
        bill={bill({
          restaurant: { name: 'Maddi', address: null, phone: null },
        })}
      />
    );
    expect(html).toContain('The address is empty');
    expect(html).toContain('/dashboard/settings');
  });

  it('marks the toolbar and the WhatsApp panel as print chrome', () => {
    // These two nodes carry `print:hidden`; if a refactor drops it the printed
    // page silently gains a toolbar and a text box.
    const html = renderToStaticMarkup(<BillScreen bill={bill()} />);
    expect(html).toContain('data-print-chrome="toolbar"');
    expect(html).toContain('data-print-chrome="whatsapp"');
    expect(html).toContain('Print ticket summary');

    // Both are actually hidden on paper, not merely labelled.
    const chrome = [...html.matchAll(/data-print-chrome="[a-z]+"[^>]*class="([^"]*)"/g)];
    expect(chrome).toHaveLength(2);
    for (const [, classes] of chrome) expect(classes).toContain('print:hidden');
  });
});
