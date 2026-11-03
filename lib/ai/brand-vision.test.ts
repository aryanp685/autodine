import { describe, expect, it } from 'vitest';
import { buildBrandExtraction } from './brand-vision';

const ANSWER = {
  name: 'Punjabi Rasoi',
  nameConfidence: 'high',
  logoBox: { page: 1, x: 100, y: 20, w: 80, h: 80 },
  logoConfidence: 'high',
  bannerBox: { page: 1, x: 0, y: 0, w: 800, h: 120 },
  colors: {
    primary: '#7A1F2B',
    primaryConfidence: 'high',
    secondary: ['#d9a441', 'gold-ish'],
    background: '#faf3e6',
    surface: '#ffffff',
  },
  typography: { character: 'Serif', exactFont: 'Didot' },
  layout: {
    header: 'banner-overlay',
    card: { radius: 'soft', border: 'hairline', elevation: 'flat' },
    spacing: 'regular',
    motifs: ['rule-double', 'nonsense-motif', 'dot-separator'],
  },
  notes: ['the page was rotated'],
};

describe('buildBrandExtraction', () => {
  it('reads a well-formed answer, normalising case and dropping junk', () => {
    const e = buildBrandExtraction(ANSWER, 'gemini-2.5-flash');
    expect(e.model).toBe('gemini-2.5-flash');
    expect(e.name).toBe('Punjabi Rasoi');
    expect(e.colors.primary).toBe('#7a1f2b'); // normalised
    expect(e.colors.secondary).toEqual(['#d9a441']); // 'gold-ish' refused
    expect(e.typography.character).toBe('serif');
    expect(e.layout.motifs).toEqual(['rule-double', 'dot-separator']);
    expect(e.logoBox).not.toBeNull();
    expect(e.bannerBox).not.toBeNull();
    expect(e.notes).toEqual(['the page was rotated']);
  });

  it('never invents a logo: an unconfident box is dropped', () => {
    const e = buildBrandExtraction({ ...ANSWER, logoConfidence: null }, 'm');
    expect(e.logoBox).toBeNull();
    expect(e.logoConfidence).toBeNull();

    const low = buildBrandExtraction({ ...ANSWER, logoConfidence: 'low' }, 'm');
    expect(low.logoBox).not.toBeNull(); // the box is kept as a candidate…
    expect(low.logoConfidence).toBe('low'); // …but the review is told it is unsure
  });

  it('refuses colours it cannot parse rather than approximating them', () => {
    const e = buildBrandExtraction(
      {
        ...ANSWER,
        colors: { primary: 'wine red', primaryConfidence: 'high', secondary: [], background: 'cream', surface: null },
      },
      'm',
    );
    expect(e.colors.primary).toBeNull();
    expect(e.colors.background).toBeNull();
    expect(e.colors.primaryConfidence).toBe('high'); // the claim is preserved for review
  });

  it('caps arrays and text', () => {
    const e = buildBrandExtraction(
      {
        ...ANSWER,
        name: 'x'.repeat(500),
        colors: { ...ANSWER.colors, secondary: ['#111111', '#222222', '#333333', '#444444', '#555555'] },
        notes: Array.from({ length: 20 }, () => 'n'),
      },
      'm',
    );
    expect(e.name!.length).toBeLessThanOrEqual(80);
    expect(e.colors.secondary.length).toBeLessThanOrEqual(4);
    expect(e.notes.length).toBeLessThanOrEqual(6);
  });

  it('returns an empty extraction for non-object answers', () => {
    for (const junk of [null, 'text', 42, []]) {
      const e = buildBrandExtraction(junk, 'm');
      expect(e.name).toBeNull();
      expect(e.colors.primary).toBeNull();
      expect(e.logoBox).toBeNull();
    }
  });

  it('accepts the spec unreadable shape without pretending', () => {
    const e = buildBrandExtraction(
      { name: null, nameConfidence: null, logoBox: null, logoConfidence: null, bannerBox: null, colors: { primary: null, primaryConfidence: null, secondary: [], background: null, surface: null }, typography: { character: null, exactFont: null }, layout: null, notes: ['unreadable'] },
      'm',
    );
    expect(e.colors.primary).toBeNull();
    expect(e.layout.header).toBeNull();
    expect(e.notes).toEqual(['unreadable']);
  });
});
