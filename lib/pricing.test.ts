import { describe, expect, it } from 'vitest';
import { SAMPLE_TAX_RATE_BPS, computeOrderTotals, computeSubtotal, type PriceableLine } from './pricing';

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

describe('discount precedence', () => {
  it('applies the discount BEFORE tax, so GST follows the reduced value', () => {
    const t = computeOrderTotals({ lines: SEED_LINES, discountPaise: 10000 }); // ₹100 off
    expect(t.subtotalPaise).toBe(77600);
    expect(t.discountPaise).toBe(10000);
    expect(t.taxablePaise).toBe(67600);
    expect(t.taxPaise).toBe(3380); // 5% of ₹676.00, NOT 5% of ₹776.00
    expect(t.totalPaise).toBe(70980);
  });

  it('charges less tax with a discount than without', () => {
    const withDiscount = computeOrderTotals({ lines: SEED_LINES, discountPaise: 10000 });
    const without = computeOrderTotals({ lines: SEED_LINES });
    expect(withDiscount.taxPaise).toBeLessThan(without.taxPaise);
  });

  it('clamps the taxable base at zero instead of producing a negative bill', () => {
    const t = computeOrderTotals({ lines: SEED_LINES, discountPaise: 999999 });
    expect(t.taxablePaise).toBe(0);
    expect(t.taxPaise).toBe(0);
    expect(t.totalPaise).toBe(0);
    // The discount is still reported unclamped so the anomaly is visible.
    expect(t.discountPaise).toBe(999999);
  });

  it('handles a discount equal to the subtotal', () => {
    const t = computeOrderTotals({ lines: SEED_LINES, discountPaise: 77600 });
    expect(t.taxablePaise).toBe(0);
    expect(t.totalPaise).toBe(0);
  });

  it('rejects a negative discount', () => {
    expect(() => computeOrderTotals({ lines: SEED_LINES, discountPaise: -100 })).toThrow(RangeError);
  });

  it('rejects a fractional discount', () => {
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
      const discount = rand() < 0.3 ? Math.floor(rand() * 50000) : 0;
      const t = computeOrderTotals({ lines, discountPaise: discount });
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
      const t = computeOrderTotals({ lines, discountPaise: Math.floor(rand() * 400000) });
      expect(t.totalPaise).toBeGreaterThanOrEqual(0);
    }
  });
});
