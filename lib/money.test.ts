import { describe, expect, it } from 'vitest';
import {
  applyRate,
  assertValidMoney,
  lineTotal,
  paiseToRupees,
  roundPaise,
  rupeesToPaise,
  splitEvenly,
  splitInHalf,
} from './money';

describe('roundPaise', () => {
  it('rounds half away from zero, for both signs', () => {
    expect(roundPaise(0.5)).toBe(1);
    expect(roundPaise(1.5)).toBe(2);
    expect(roundPaise(2.4)).toBe(2);
    expect(roundPaise(-0.5)).toBe(-1);
    expect(roundPaise(-1.5)).toBe(-2);
  });

  it('differs from Math.round for negative halves, which is the point', () => {
    // Math.round(-0.5) is -0, not -1. Refunds are negative, so this matters.
    expect(Math.round(-0.5)).toBe(-0);
    expect(roundPaise(-0.5)).toBe(-1);
  });

  it('rejects non-finite input rather than silently producing NaN money', () => {
    expect(() => roundPaise(NaN)).toThrow(RangeError);
    expect(() => roundPaise(Infinity)).toThrow(RangeError);
  });
});

describe('rupee <-> paise conversion', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise(776)).toBe(77600);
    expect(rupeesToPaise(0)).toBe(0);
  });

  it('converts fractional rupees', () => {
    expect(rupeesToPaise(12.34)).toBe(1234);
    expect(rupeesToPaise(0.1)).toBe(10);
  });

  it('does not drift on the classic float failure', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in paise it is exactly 30.
    expect(rupeesToPaise(0.1) + rupeesToPaise(0.2)).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('round-trips without loss', () => {
    expect(paiseToRupees(rupeesToPaise(1234.56))).toBe(1234.56);
  });

  it('rejects non-integer paise', () => {
    expect(() => paiseToRupees(10.5)).toThrow(TypeError);
    expect(() => assertValidMoney(NaN)).toThrow(TypeError);
  });
});

describe('applyRate', () => {
  it('applies a rate given in basis points', () => {
    expect(applyRate(77600, 500)).toBe(3880); // 5% of ₹776.00 = ₹38.80
    expect(applyRate(100000, 1800)).toBe(18000); // 18% of ₹1,000.00
    expect(applyRate(100000, 0)).toBe(0);
  });

  it('rounds to the nearest paisa, half up', () => {
    expect(applyRate(1001, 500)).toBe(50); // 50.05 -> 50
    expect(applyRate(333, 500)).toBe(17); // 16.65 -> 17
  });

  it('stays exact on large amounts where floats would drift', () => {
    // 99999999999 * 0.05 in floats is 4999999999.95 with visible error.
    expect(applyRate(99999999999, 500)).toBe(5000000000);
  });

  it('rejects a non-integer amount', () => {
    expect(() => applyRate(100.5, 500)).toThrow(TypeError);
  });
});

describe('lineTotal', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotal(7900, 2)).toBe(15800);
    expect(lineTotal(46900, 1)).toBe(46900);
  });

  it('treats a zero quantity as zero', () => {
    expect(lineTotal(46900, 0)).toBe(0);
  });

  it('rejects fractional or negative quantities', () => {
    expect(() => lineTotal(100, 1.5)).toThrow(RangeError);
    expect(() => lineTotal(100, -1)).toThrow(RangeError);
  });
});

describe('splitInHalf', () => {
  it('splits evenly', () => {
    expect(splitInHalf(3880)).toEqual([1940, 1940]);
  });

  it('gives the odd paisa to the first half and never loses it', () => {
    const [cgst, sgst] = splitInHalf(17);
    expect(cgst).toBe(9);
    expect(sgst).toBe(8);
    expect(cgst + sgst).toBe(17);
  });

  it('handles zero and one paisa', () => {
    expect(splitInHalf(0)).toEqual([0, 0]);
    expect(splitInHalf(1)).toEqual([1, 0]);
  });

  it('never loses a paisa across many amounts', () => {
    for (let p = 0; p < 2000; p += 1) {
      const [a, b] = splitInHalf(p);
      expect(a + b).toBe(p);
    }
  });
});

describe('splitEvenly', () => {
  it('splits exactly when divisible', () => {
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
  });

  it('distributes the remainder to the earliest parts and sums back exactly', () => {
    const parts = splitEvenly(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles a remainder larger than one part spread', () => {
    const parts = splitEvenly(10, 4);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('splits negative amounts (discounts) without losing a paisa', () => {
    const parts = splitEvenly(-1000, 3);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-1000);
  });

  it('never loses or invents a paisa, for many combinations', () => {
    for (let amount = 0; amount < 250; amount += 7) {
      for (let parts = 1; parts <= 9; parts += 1) {
        const split = splitEvenly(amount, parts);
        expect(split).toHaveLength(parts);
        expect(split.reduce((a, b) => a + b, 0)).toBe(amount);
      }
    }
  });

  it('rejects non-positive part counts', () => {
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(100, -2)).toThrow(RangeError);
    expect(() => splitEvenly(100, 1.5)).toThrow(RangeError);
  });
});
