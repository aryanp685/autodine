import { describe, expect, it } from 'vitest';
import {
  MAX_OUTLETS_PER_OWNER,
  outletInitials,
  outletNameProblem,
  pickOutlet,
  safeReturnPath,
  sameOrigin,
} from './outlets';

/**
 * The cookie decides what an owner SEES, never what they may touch. These
 * tests pin the two halves of that: a known outlet wins, an unknown one falls
 * back instead of erroring, and nothing from a form can leave the site.
 */

const a = { id: '11111111-1111-1111-1111-111111111111', name: 'Maddi', role: 'owner' };
const b = { id: '22222222-2222-2222-2222-222222222222', name: 'Maddi Baner', role: 'cashier' };

describe('pickOutlet', () => {
  it('honours the preferred outlet when the caller belongs to it', () => {
    expect(pickOutlet([a, b], b.id)).toEqual(b);
  });

  it('falls back to the lowest id, not to whichever row came first', () => {
    expect(pickOutlet([b, a], null)).toEqual(a);
    // A cookie naming a restaurant the caller does not belong to is ignored.
    expect(pickOutlet([b, a], '99999999-9999-9999-9999-999999999999')).toEqual(a);
  });

  it('returns null when there is nothing to show', () => {
    expect(pickOutlet([], a.id)).toBeNull();
  });
});

describe('outletInitials', () => {
  it('takes two letters from two words', () => {
    expect(outletInitials('Maddi Kitchen')).toBe('MK');
    expect(outletInitials('Kings of Kings')).toBe('KO');
  });

  it('takes two letters from one word, and never renders nothing', () => {
    expect(outletInitials('Maddi')).toBe('MA');
    expect(outletInitials('  ')).toBe('AD');
    expect(outletInitials('२४')).toBe('२४');
  });
});

describe('outletNameProblem', () => {
  it('needs a real name', () => {
    expect(outletNameProblem('M')).toMatch(/at least two characters/);
    expect(outletNameProblem('Maddi')).toBeNull();
    expect(outletNameProblem('x'.repeat(81))).toMatch(/under 80/);
  });
});

describe('safeReturnPath', () => {
  it('accepts a same-site path', () => {
    expect(safeReturnPath('/dashboard/reports?range=week')).toBe('/dashboard/reports?range=week');
  });

  it('refuses anything that could leave the site', () => {
    expect(safeReturnPath('//evil.example')).toBe('/dashboard');
    expect(safeReturnPath('https://evil.example')).toBe('/dashboard');
    expect(safeReturnPath('/a\\b')).toBe('/dashboard');
    expect(safeReturnPath(null)).toBe('/dashboard');
  });
});

describe('MAX_OUTLETS_PER_OWNER', () => {
  it('is a small number and matches the check inside create_outlet', () => {
    expect(MAX_OUTLETS_PER_OWNER).toBe(5);
  });
});

describe('sameOrigin', () => {
  it('accepts the site posting to itself', () => {
    expect(sameOrigin('https://new-alpha-five-43.vercel.app', 'new-alpha-five-43.vercel.app')).toBe(true);
    // Scheme is compared loosely on purpose: a proxy may report either.
    expect(sameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
  });

  it('refuses another site, a missing header, and nonsense', () => {
    expect(sameOrigin('https://evil.example', 'new-alpha-five-43.vercel.app')).toBe(false);
    expect(sameOrigin(null, 'new-alpha-five-43.vercel.app')).toBe(false);
    expect(sameOrigin('https://new-alpha-five-43.vercel.app', null)).toBe(false);
    expect(sameOrigin('not a url', 'new-alpha-five-43.vercel.app')).toBe(false);
  });
});
