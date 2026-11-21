import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('Saffron & Smoke')).toBe('saffron-smoke');
    expect(slugify('Hotel Sunrise   Palace')).toBe('hotel-sunrise-palace');
  });

  it('strips accents', () => {
    expect(slugify('Café Bombay')).toBe('cafe-bombay');
  });

  it('removes punctuation and trims edge hyphens', () => {
    expect(slugify("O'Brien's Diner!!")).toBe('o-brien-s-diner');
    expect(slugify('---hello---')).toBe('hello');
  });

  it('caps length so a slug cannot blow past a URL budget', () => {
    expect(slugify('a'.repeat(300)).length).toBeLessThanOrEqual(48);
  });

  it('handles empty and non-latin input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
});

describe('uniqueSlug', () => {
  const taken = async (s: string) => ['saffron-smoke', 'saffron-smoke-2'].includes(s);

  it('returns the base when free', async () => {
    await expect(uniqueSlug('curry-house', taken)).resolves.toBe('curry-house');
  });

  it('skips taken names', async () => {
    await expect(uniqueSlug('saffron-smoke', taken)).resolves.toBe('saffron-smoke-3');
  });

  it('falls back to something unique rather than looping forever', async () => {
    const slug = await uniqueSlug('x', async () => true);
    expect(slug.startsWith('x-')).toBe(true);
    expect(slug).not.toBe('x-201');
  });

  it('uses a readable fallback for empty input', async () => {
    await expect(uniqueSlug('', async () => false)).resolves.toBe('restaurant');
  });
});
