/**
 * e-Invoice source loading — the pure pieces.
 *
 * loadEinvoiceSources() itself needs a database (exercised by the disposable
 * PG integration suites); localDateInTimeZone is the pure function the whole
 * issuance flow depends on for the IRP payload's calendar date, and it must
 * never throw on junk input.
 */

import { describe, expect, it } from 'vitest';

import { localDateInTimeZone } from './einvoice-server';

describe('localDateInTimeZone', () => {
  it('formats an instant as the outlet-local calendar date', () => {
    // 2026-11-15T18:30:00Z is already 2026-11-16 00:00 in Kolkata.
    expect(localDateInTimeZone('2026-11-15T18:30:00.000Z', 'Asia/Kolkata')).toBe('2026-11-16');
    expect(localDateInTimeZone('2026-11-15T18:30:00.000Z', 'UTC')).toBe('2026-11-15');
    expect(localDateInTimeZone('2026-11-15T05:00:00.000Z', 'Asia/Kolkata')).toBe('2026-11-15');
  });

  it('en-CA output is YYYY-MM-DD for the target zone', () => {
    expect(localDateInTimeZone('2026-01-05T00:30:00.000Z', 'Asia/Kolkata')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to Kolkata then UTC for an invalid zone instead of throwing', () => {
    expect(localDateInTimeZone('2026-11-15T18:30:00.000Z', 'Not/AZone')).toBe('2026-11-16'); // Kolkata fallback
    expect(localDateInTimeZone('2026-11-15T18:30:00.000Z', '')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns null for an unparseable timestamp', () => {
    expect(localDateInTimeZone('not a date', 'Asia/Kolkata')).toBeNull();
    expect(localDateInTimeZone('', 'Asia/Kolkata')).toBeNull();
  });
});
