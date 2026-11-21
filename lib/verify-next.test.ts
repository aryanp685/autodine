import { describe, expect, it } from 'vitest';
import { safeNextPath } from './verify-next';

/**
 * The post-verification redirect: a path this app knows, or the menu.
 *
 * Every case below is an attempt to make our own domain hand a guest to
 * somebody else's. They all have to come back to something local -- the
 * destination is the one piece of the verification form the caller controls,
 * and a form that redirects where it is told is a phishing link with our
 * address on it.
 */
describe('safeNextPath', () => {
  it('keeps the guest on the screen they came from', () => {
    expect(safeNextPath('/menu/checkout?s=maddi', 'maddi')).toBe('/menu/checkout?s=maddi');
    expect(safeNextPath('/menu/cart?s=maddi', 'maddi')).toBe('/menu/cart?s=maddi');
  });

  it('refuses every shape of off-site redirect', () => {
    const hostile = [
      'https://evil.example/steal',
      '//evil.example/steal',
      '/\\evil.example',
      'javascript:alert(1)',
      'http:/evil.example',
      '/menu/../../admin',
      '/dashboard/settings',
      '/api/health',
    ];

    for (const next of hostile) {
      expect(safeNextPath(next, 'maddi')).toBe('/menu?s=maddi');
    }
  });

  it('drops a slug the caller made up, and keeps the one the database confirmed', () => {
    // The query string's own `s` is not consulted; the verified slug is.
    expect(safeNextPath('/menu/checkout?s=someone-else', 'maddi')).toBe('/menu/checkout?s=maddi');
    expect(safeNextPath('/menu?s=maddi', null)).toBe('/menu');
  });

  it('falls back to the menu when there is nothing to go back to', () => {
    expect(safeNextPath(undefined, 'maddi')).toBe('/menu?s=maddi');
    expect(safeNextPath('', 'maddi')).toBe('/menu?s=maddi');
    expect(safeNextPath(undefined, null)).toBe('/menu');
  });

  it('does not forward unknown query parameters', () => {
    expect(safeNextPath('/menu/checkout?s=maddi&admin=1&next=//evil.example', 'maddi')).toBe(
      '/menu/checkout?s=maddi',
    );
  });

  it('will not accept a slug that is not a slug', () => {
    expect(safeNextPath('/menu', 'Maddi<script>')).toBe('/menu');
  });
});
