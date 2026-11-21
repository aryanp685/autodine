import { describe, expect, it } from 'vitest';
import {
  canEditSettings,
  formatTaxPercent,
  parseTaxPercent,
  publicMenuPath,
  taxExamplePaise,
  validateDetails,
} from './settings-input';

/**
 * Settings is the only screen that writes the restaurant row itself, so the
 * rules here decide what a bill, an invoice and a public URL end up saying.
 * Each case below is a way that goes wrong in production, not a hypothetical.
 */

const good = {
  name: 'Maddi',
  tagline: 'Bombay street food',
  address: '12 Baner Road, Pune',
  phone: '+91 98765 43210',
  gstin: '22AAAAA0000A1Z5',
  slug: 'maddi',
};

describe('validateDetails', () => {
  it('accepts a complete set and trims what it is given', () => {
    const result = validateDetails({
      ...good,
      name: '  Maddi   Kitchen ',
      tagline: '  ',
      phone: '   ',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Maddi Kitchen');
    // Blank is stored as null, not as an empty string: the guest screen tests
    // for falsy, and "" and null otherwise both render an empty line.
    expect(result.value.tagline).toBeNull();
    expect(result.value.phone).toBeNull();
  });

  it('refuses an empty name', () => {
    const result = validateDetails({ ...good, name: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('name');
  });

  it('refuses a name long enough to break the bill header', () => {
    const result = validateDetails({ ...good, name: 'a'.repeat(81) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('name');
  });

  it('upper-cases a lower-case GSTIN rather than rejecting it', () => {
    const result = validateDetails({ ...good, gstin: '22aaaaa0000a1z5' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gstin).toBe('22AAAAA0000A1Z5');
  });

  it('rejects a GSTIN with the wrong shape', () => {
    for (const gstin of ['22AAAAA0000A1Z', '22AAAAA0000A1ZZZ', 'AAAAA0000A1Z5', '22AAAAA0000A1Y5', '12345']) {
      const result = validateDetails({ ...good, gstin });
      expect(result.ok, gstin).toBe(false);
      if (result.ok) return;
      expect(result.field).toBe('gstin');
    }
  });

  it('accepts a blank GSTIN, because most small restaurants are not registered', () => {
    const result = validateDetails({ ...good, gstin: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gstin).toBeNull();
  });

  it('refuses a phone number too short to dial', () => {
    const result = validateDetails({ ...good, phone: '98765' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('phone');
  });

  it('accepts the ways an Indian number is actually written', () => {
    for (const phone of ['9876543210', '+91 98765 43210', '098765-43210', '020 2445 1234']) {
      expect(validateDetails({ ...good, phone }).ok, phone).toBe(true);
    }
  });

  it('normalises the slug instead of refusing punctuation', () => {
    const result = validateDetails({ ...good, slug: 'My Cafe!' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe('my-cafe');
  });

  it('refuses a slug that normalises to nothing', () => {
    const result = validateDetails({ ...good, slug: '!!!' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('slug');
  });
});

describe('parseTaxPercent', () => {
  it('reads the rates owners actually type', () => {
    expect(parseTaxPercent('5')).toEqual({ ok: true, bps: 500 });
    expect(parseTaxPercent('18')).toEqual({ ok: true, bps: 1800 });
    expect(parseTaxPercent('18.5')).toEqual({ ok: true, bps: 1850 });
    expect(parseTaxPercent(' 0 ')).toEqual({ ok: true, bps: 0 });
    expect(parseTaxPercent('5%')).toEqual({ ok: true, bps: 500 });
  });

  it('refuses more precision than a basis point, rather than rounding it silently', () => {
    // 18.505% is 1850.5 bps. Rounding it would charge a rate nobody typed.
    expect(parseTaxPercent('18.505').ok).toBe(false);
  });

  it('refuses a rate outside the column CHECK instead of failing at the database', () => {
    expect(parseTaxPercent('31').ok).toBe(false);
    expect(parseTaxPercent('-1').ok).toBe(false);
    expect(parseTaxPercent('abc').ok).toBe(false);
    expect(parseTaxPercent('').ok).toBe(false);
  });

  it('accepts the top of the range, which is a legal rate for some states', () => {
    expect(parseTaxPercent('30')).toEqual({ ok: true, bps: 3000 });
  });
});

describe('formatTaxPercent', () => {
  it('round-trips without trailing zeros', () => {
    expect(formatTaxPercent(500)).toBe('5');
    expect(formatTaxPercent(1850)).toBe('18.5');
    expect(formatTaxPercent(1855)).toBe('18.55');
    expect(formatTaxPercent(0)).toBe('0');
  });
});

describe('taxExamplePaise', () => {
  it('adds tax the same way the order does', () => {
    expect(taxExamplePaise(500)).toEqual({ basePaise: 10000, taxPaise: 500, totalPaise: 10500 });
    expect(taxExamplePaise(1800)).toEqual({ basePaise: 10000, taxPaise: 1800, totalPaise: 11800 });
    expect(taxExamplePaise(0)).toEqual({ basePaise: 10000, taxPaise: 0, totalPaise: 10000 });
  });
});

describe('canEditSettings', () => {
  it('lets the owner and manager write, and nobody else', () => {
    expect(canEditSettings('owner')).toBe(true);
    expect(canEditSettings('manager')).toBe(true);
    expect(canEditSettings('cashier')).toBe(false);
    expect(canEditSettings('kitchen')).toBe(false);
    expect(canEditSettings(null)).toBe(false);
    expect(canEditSettings('')).toBe(false);
  });
});

describe('publicMenuPath', () => {
  it('escapes the slug so the link cannot carry a second query parameter', () => {
    expect(publicMenuPath('maddi')).toBe('/menu?s=maddi');
    expect(publicMenuPath('a&b=c')).toBe('/menu?s=a%26b%3Dc');
  });
});
