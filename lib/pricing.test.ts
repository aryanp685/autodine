import { describe, expect, it } from 'vitest';
import {
  SAMPLE_TAX_RATE_BPS,
  computeOrderTotals,
  computeSubtotal,
  gstLabel,
  requireTaxRateBps,
  type PriceableLine,
} from './pricing';

/**
 * The seeded cart in the prototype: Butter Chicken x1, Butter Naan x2,
 * Mango Lassi x1. These are the numbers the locked screens were signed off
 * against, so they are asserted here as a regression guard.
 */
const SEED_LINES: PriceableLine[] = [
  { unitPricePaise: 46900, qty: 1 },
  { unitPricePaise: 7900, qty: 2 },
  { unitPricePaise: 14900, qty: 1 },
];

describe('requireTaxRateBps', () => {
  it('preserves the configured zero rate instead of substituting the demo rate', () => {
    expect(requireTaxRateBps(0)).toBe(0);
  });

  it('fails closed for a missing, invalid, or fractional live rate', () => {
    for (const value of [null, undefined, '500', -1, 12.5, Number.NaN]) {
      expect(() => requireTaxRateBps(value)).toThrow(TypeError);
    }
  });
});

describe('computeSubtotal', () => {
  it('matches the numbers the locked design was signed off against', () => {
    expect(computeSubtotal(SEED_LINES)).toBe(77600); // ₹776.00
  });

  it('is zero for an empty cart', () => {
    expect(computeSubtotal([])).toBe(0);
  });

  it('rounds each line before summing', () => {
    expect(computeSubtotal([{ unitPricePaise: 3333, qty: 3 }])).toBe(9999);
  });

  it('rejects junk', () => {
    expect(() => computeSubtotal('nope' as never)).toThrow(TypeError);
    expect(() => computeSubtotal([{ unitPricePaise: 100.5, qty: 1 }])).toThrow(TypeError);
  });
});

describe('computeOrderTotals', () => {
  it('produces the signed-off cart totals', () => {
    const t = computeOrderTotals({ lines: SEED_LINES });
    expect(t.subtotalPaise).toBe(77600); // ₹776.00
    expect(t.taxPaise).toBe(3880); // ₹38.80
    expect(t.cgstPaise).toBe(1940);
    expect(t.sgstPaise).toBe(1940);
    expect(t.totalPaise).toBe(81480); // ₹814.80
    expect(t.discountPaise).toBe(0);
    expect(t.taxablePaise).toBe(77600);
  });

  it('renders exactly as the locked screens do (₹776 / ₹39 / ₹815)', () => {
    // Display rounds to whole rupees; the arithmetic underneath does not.
    const t = computeOrderTotals({ lines: SEED_LINES });
    const shown = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    expect(shown(t.subtotalPaise)).toBe('₹776');
    expect(shown(t.taxPaise)).toBe('₹39');
    expect(shown(t.totalPaise)).toBe('₹815');
  });

  it('is all zeroes for an empty order', () => {
    const t = computeOrderTotals({ lines: [] });
    expect(t).toEqual({
      subtotalPaise: 0,
      discountPaise: 0,
      taxablePaise: 0,
      taxPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 0,
    });
  });

  it('defaults to the sample rate but accepts an override', () => {
    expect(computeOrderTotals({ lines: SEED_LINES }).taxPaise).toBe(
      computeOrderTotals({ lines: SEED_LINES, taxRateBps: SAMPLE_TAX_RATE_BPS }).taxPaise,
    );
    expect(computeOrderTotals({ lines: SEED_LINES, taxRateBps: 1800 }).taxPaise).toBe(13968);
  });
});

describe('discount policy gate', () => {
  it('fails closed for any positive discount until policy approval', () => {
    for (const discountPaise of [1, 10000, 77600, 999999]) {
      expect(() => computeOrderTotals({ lines: SEED_LINES, discountPaise }))
        .toThrow('Discounts are disabled until written financial policy approval.');
    }
  });

  it('rejects a negative or fractional discount before any totals are returned', () => {
    expect(() => computeOrderTotals({ lines: SEED_LINES, discountPaise: -100 })).toThrow(RangeError);
    expect(() => computeOrderTotals({ lines: SEED_LINES, discountPaise: 10.5 })).toThrow(TypeError);
  });
});

describe('invariants that must hold for every order', () => {
  const rand = (() => {
    let seed = 42;
    return () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
  })();

  it('total always equals taxable + tax', () => {
    for (let i = 0; i < 500; i += 1) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({
        unitPricePaise: Math.floor(rand() * 200000),
        qty: Math.floor(rand() * 5),
      }));
      const t = computeOrderTotals({ lines, discountPaise: 0 });
      expect(t.totalPaise).toBe(t.taxablePaise + t.taxPaise);
    }
  });

  it('the tax split always sums back to the tax', () => {
    for (let i = 0; i < 500; i += 1) {
      const lines = [{ unitPricePaise: Math.floor(rand() * 500000), qty: 1 + Math.floor(rand() * 4) }];
      const t = computeOrderTotals({ lines });
      expect(t.cgstPaise + t.sgstPaise).toBe(t.taxPaise);
    }
  });

  it('subtotal, taxable and total are always whole paise (never floats)', () => {
    for (let i = 0; i < 500; i += 1) {
      const lines = [{ unitPricePaise: Math.floor(rand() * 999999), qty: 1 + Math.floor(rand() * 7) }];
      const t = computeOrderTotals({ lines, taxRateBps: Math.floor(rand() * 2800) });
      for (const v of [t.subtotalPaise, t.taxablePaise, t.taxPaise, t.totalPaise]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('total is never negative, whatever the inputs', () => {
    for (let i = 0; i < 300; i += 1) {
      const lines = [{ unitPricePaise: Math.floor(rand() * 100000), qty: Math.floor(rand() * 3) }];
      const t = computeOrderTotals({ lines, discountPaise: 0 });
      expect(t.totalPaise).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('gstLabel', () => {
  it('does not expose a sample percentage as a restaurant tax label', () => {
    expect(gstLabel()).toBe('Taxes');
    expect(gstLabel(undefined)).toBe('Taxes');
  });

  it('prints the restaurant’s rate when it has one', () => {
    // The label used to be hard-coded to 5%, so a restaurant on 12% showed a
    // bill that named one rate and charged another.
    expect(gstLabel(1200)).toBe('GST 12%');
    expect(gstLabel(500)).toBe('GST 5%');
    expect(gstLabel(250)).toBe('GST 2.50%');
  });
});
