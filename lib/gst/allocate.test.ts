import { describe, expect, it } from 'vitest';
import { allocateIntegerPaise } from './allocate';

describe('allocateIntegerPaise', () => {
  it('allocates exactly when weights divide evenly', () => {
    expect(allocateIntegerPaise([7000, 3000], 10000)).toEqual([7000, 3000]);
  });

  it('largest remainder takes the leftover paise, sums always exact', () => {
    expect(allocateIntegerPaise([7000, 3000], 10001)).toEqual([7001, 3000]);
    expect(allocateIntegerPaise([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(allocateIntegerPaise([1, 1, 1], 2)).toEqual([1, 1, 0]);
  });

  it('ties on the fractional part go to the earlier line', () => {
    expect(allocateIntegerPaise([1, 1], 1)).toEqual([1, 0]);
  });

  it('zero-weight lines receive nothing while others do', () => {
    expect(allocateIntegerPaise([0, 5000, 0, 5000], 10000)).toEqual([0, 5000, 0, 5000]);
  });

  it('all-zero weights spread equally with the remainder to the first lines', () => {
    expect(allocateIntegerPaise([0, 0, 0], 100)).toEqual([34, 33, 33]);
    expect(allocateIntegerPaise([0, 0], 101)).toEqual([51, 50]);
  });

  it('handles a zero total', () => {
    expect(allocateIntegerPaise([5, 5], 0)).toEqual([0, 0]);
  });

  it('doc-scale allocation across 24 lines sums exactly', () => {
    const weights = Array.from({ length: 24 }, (_, i) => (i + 3) * 137);
    const total = 123456789;
    const parts = allocateIntegerPaise(weights, total);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(parts.every((p) => Number.isSafeInteger(p) && p >= 0)).toBe(true);
  });

  it('rejects a negative or fractional total', () => {
    expect(() => allocateIntegerPaise([1], -1)).toThrow(RangeError);
    expect(() => allocateIntegerPaise([1], 1.5)).toThrow(RangeError);
  });

  it('rejects a non-zero total with no buckets', () => {
    expect(() => allocateIntegerPaise([], 1)).toThrow(RangeError);
    expect(allocateIntegerPaise([], 0)).toEqual([]);
  });
});
