import { describe, expect, it } from 'vitest';
import { parseCardPass } from './table-card';
import { isQrToken } from './table-session';

/**
 * The browse pass carries one value -- the token printed on the card.
 *
 * Why it is worth a test: this cookie is the only thing between "somebody
 * scanned a card" and "this browser may read the menu". Everything else about
 * the guest (which restaurant, which table, whether the card is still live) is
 * re-read from the database on each request, so a malformed value must be
 * treated as no value at all rather than passed along.
 */
describe('parseCardPass', () => {
  it('accepts a card token', () => {
    expect(parseCardPass('qr_abcdefghijklmnop')).toBe('qr_abcdefghijklmnop');
  });

  it('trims what a browser added', () => {
    expect(parseCardPass('  qr_abcdefghijklmnop\n')).toBe('qr_abcdefghijklmnop');
  });

  it('refuses anything that is not a card token', () => {
    expect(parseCardPass(undefined)).toBeNull();
    expect(parseCardPass(null)).toBeNull();
    expect(parseCardPass('')).toBeNull();
    expect(parseCardPass('short')).toBeNull();
    expect(parseCardPass('qr_abc def ghi jkl')).toBeNull();
    expect(parseCardPass('{"restaurant":"someone-else"}')).toBeNull();
    expect(parseCardPass('<script>alert(1)</script>')).toBeNull();
  });

  it('agrees with the token shape the database enforces', () => {
    // public_qr_intro checks ^[A-Za-z0-9_-]{8,128}$; if this drifts, a token
    // the app accepts would be refused by the database and vice versa.
    for (const value of ['qr_abcdefghijklmnop', 'ABCdef123_-XYZ']) {
      expect(isQrToken(value)).toBe(true);
      expect(parseCardPass(value)).toBe(value);
    }
  });
});
