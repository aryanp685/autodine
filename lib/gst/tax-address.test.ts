import { describe, expect, it } from 'vitest';
import { parseTaxAddress } from './tax-address';

describe('parseTaxAddress', () => {
  it('splits line, city and pincode from a conventional Indian address', () => {
    const result = parseTaxAddress('Buyer House, MIDC, Pune – 411001');
    expect(result).toEqual({ ok: true, address: { address1: 'Buyer House, MIDC, Pune – 411001', location: 'Pune', pincode: '411001' } });
  });

  it('a single-line address without a city comma yields the last segment verbatim (never splits inside it)', () => {
    const result = parseTaxAddress('14, MG Road Nagpur 440001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.address.pincode).toBe('440001');
      // Deterministic structural split only: the last comma segment is the
      // location, street words included. Record comma-separated addresses.
      expect(result.address.location).toBe('MG Road Nagpur');
    }
  });

  it('a two-word city survives in the last segment', () => {
    const result = parseTaxAddress('Plot 5, Connaught Place, New Delhi 110001');
    expect(result.ok && result.address.location).toBe('New Delhi');
    expect(result.ok && result.address.pincode).toBe('110001');
  });

  it('uses the LAST pincode-like run as the PIN', () => {
    const result = parseTaxAddress('Plot 440001, Industrial Area, Nagpur 440015');
    expect(result.ok && result.address.pincode).toBe('440015');
  });

  it('refuses an address without a pincode — fail closed, never invented', () => {
    const result = parseTaxAddress('Buyer House, MIDC, Pune');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/PIN/i);
  });

  it('refuses an address whose segment before the pincode has no letters', () => {
    const result = parseTaxAddress('14, 88, 411001');
    expect(result.ok).toBe(false);
  });

  it('refuses an address longer than 100 characters rather than truncating a legal address', () => {
    const result = parseTaxAddress(`Building ${'A'.repeat(120)}, Nagpur 440001`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/100 characters/i);
  });

  it('refuses a pincode starting with 0 (never valid in India)', () => {
    const result = parseTaxAddress('Buyer House, Pune 011001');
    expect(result.ok).toBe(false);
  });

  it('refuses empty input', () => {
    expect(parseTaxAddress(null).ok).toBe(false);
    expect(parseTaxAddress('   ').ok).toBe(false);
  });
});
