import { describe, expect, it } from 'vitest';

import {
  billLineLabel,
  billTaxRateBps,
  billTaxSplit,
  buildBillMessage,
  deriveTaxRateBps,
  formatBillMoney,
  formatTaxRate,
  toWhatsAppNumber,
  whatsAppLink,
} from './bill';

describe('formatBillMoney', () => {
  it('always shows two decimals, because a bill does', () => {
    expect(formatBillMoney(118050)).toBe('₹1,180.50');
    expect(formatBillMoney(100)).toBe('₹1.00');
    expect(formatBillMoney(0)).toBe('₹0.00');
  });

  it('groups the Indian way, not the American way', () => {
    // 1,00,000 not 100,000: a cashier reading a bill reads it in lakhs.
    expect(formatBillMoney(100_000_00)).toBe('₹1,00,000.00');
  });

  it('marks a negative amount instead of printing a bare minus', () => {
    expect(formatBillMoney(-5000)).toBe('−₹50.00');
  });
});

describe('formatTaxRate', () => {
  it('drops the pointless decimals', () => {
    expect(formatTaxRate(1800)).toBe('18%');
    expect(formatTaxRate(500)).toBe('5%');
    expect(formatTaxRate(0)).toBe('0%');
  });

  it('keeps the ones that mean something', () => {
    expect(formatTaxRate(1250)).toBe('12.5%');
    expect(formatTaxRate(1255)).toBe('12.55%');
  });
});

describe('billTaxSplit', () => {
  it('shows nothing when no tax was charged', () => {
    expect(billTaxSplit(0, 500)).toBeNull();
  });

  it('splits one tax figure into CGST and SGST that add back exactly', () => {
    const split = billTaxSplit(9001, 1800);
    expect(split?.cgstPaise).toBe(4501);
    expect(split?.sgstPaise).toBe(4500);
    expect((split?.cgstPaise ?? 0) + (split?.sgstPaise ?? 0)).toBe(9001);
  });

  it('labels the halves with half the rate', () => {
    // A bill taxed at 18% prints CGST 9% and SGST 9%, never 18% twice.
    expect(billTaxSplit(9000, 1800)?.rateLabel).toBe('9%');
  });

  it('does not invent a rate on an order that has no snapshot', () => {
    expect(billTaxSplit(5000, null)?.rateLabel).toBe('0%');
  });
});

describe('billLineLabel', () => {
  it('keeps portion and add-ons with the dish they belong to', () => {
    expect(
      billLineLabel({ name: 'Butter Chicken', variant: 'Half', addons: ['Extra cheese', 'Extra gravy'] })
    ).toBe('Butter Chicken · Half · Extra cheese, Extra gravy');
  });

  it('says just the dish when there is nothing else to say', () => {
    expect(billLineLabel({ name: 'Masala Chai' })).toBe('Masala Chai');
  });

  it('does not leave a dangling separator for a blank portion', () => {
    expect(billLineLabel({ name: 'Masala Chai', variant: '  ' })).toBe('Masala Chai');
  });
});

describe('toWhatsAppNumber', () => {
  it('accepts the three ways an Indian number is written', () => {
    expect(toWhatsAppNumber('9876543210')).toBe('919876543210');
    expect(toWhatsAppNumber('09876543210')).toBe('919876543210');
    expect(toWhatsAppNumber('+91 98765 43210')).toBe('919876543210');
  });

  it('refuses anything it would have to guess at', () => {
    // A bill sent to a stranger's phone is a real harm, not a cosmetic bug.
    expect(toWhatsAppNumber('12345')).toBeNull();
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber('9999999999999')).toBeNull();
  });
});

describe('whatsAppLink', () => {
  it('url-encodes the message so newlines survive', () => {
    const link = whatsAppLink('919876543210', 'Bill 1\nTotal: ₹10.00');
    expect(link.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(link).toContain('%0A');
    expect(decodeURIComponent(link.split('text=')[1])).toBe('Bill 1\nTotal: ₹10.00');
  });
});

describe('buildBillMessage', () => {
  const base = {
    restaurantName: 'Maddi',
    code: 'MA-4F2K1',
    placedAt: '21 Oct, 8:42 pm',
    tableLabel: 'T3',
    lines: [
      { label: 'Butter Chicken', qty: 2, amountPaise: 93800 },
      { label: 'Butter Naan', qty: 1, amountPaise: 7900 },
    ],
    subtotalPaise: 101700,
    taxPaise: 9153,
    taxRateBps: 1800,
    totalPaise: 110853,
    paymentLine: 'Paid by UPI at the counter.',
  };

  it('starts with the restaurant and the reference, not a code block', () => {
    const message = buildBillMessage(base);
    expect(message.split('\n')[0]).toBe('*Maddi*');
    expect(message).toContain('Bill MA-4F2K1');
    expect(message).toContain('· T3');
  });

  it('writes each line as quantity, dish and money', () => {
    expect(buildBillMessage(base)).toContain('2 × Butter Chicken — ₹938.00');
  });

  it('shows the tax split and the total last', () => {
    const message = buildBillMessage(base);
    expect(message).toContain('CGST 9%: ₹45.77');
    expect(message).toContain('SGST 9%: ₹45.76');
    expect(message).toContain('*Total: ₹1,108.53*');
  });

  it('prints no tax lines when no tax was charged', () => {
    const message = buildBillMessage({ ...base, taxPaise: 0, taxRateBps: 0, totalPaise: 101700 });
    expect(message).not.toContain('CGST');
    expect(message).toContain('*Total: ₹1,017.00*');
  });

  it('says out loud when a bill is not paid', () => {
    const message = buildBillMessage({ ...base, paymentLine: 'Not paid yet — please pay at the counter.' });
    expect(message).toContain('Not paid yet');
  });
});

describe('deriveTaxRateBps', () => {
  it('works the rate out from the money that was charged', () => {
    // The three real orders in production: 2799.00 + 18% = 503.82.
    expect(deriveTaxRateBps(50382, 279900)).toBe(1800);
    expect(deriveTaxRateBps(1000, 20000)).toBe(500);
  });

  it('rounds to the quarter point GST is actually set in', () => {
    // 12% and 5% come back exactly; a tax figure that is a paisa or two off
    // still lands on the rate a bill can print instead of 11.93%.
    expect(deriveTaxRateBps(33588, 279900)).toBe(1200);
    expect(deriveTaxRateBps(13995, 279900)).toBe(500);
    expect(deriveTaxRateBps(33400, 279900)).toBe(1200);
  });

  it('says nothing when there is no tax or nothing to tax', () => {
    expect(deriveTaxRateBps(0, 50000)).toBeNull();
    expect(deriveTaxRateBps(500, 0)).toBeNull();
  });
});

describe('billTaxRateBps', () => {
  it('prefers the rate the order was actually taxed at', () => {
    expect(billTaxRateBps(1800, 0, 0)).toBe(1800);
  });

  it('derives the rate for an order placed before the snapshot existed', () => {
    expect(billTaxRateBps(null, 50382, 279900)).toBe(1800);
    expect(billTaxRateBps(undefined, 0, 0)).toBeNull();
  });
});
