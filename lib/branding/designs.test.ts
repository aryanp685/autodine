import { describe, expect, it } from 'vitest';
import { designCandidates } from './designs';
import { parseTheme, type BrandTheme } from './theme';

const baseTheme: BrandTheme = {
  version: 1,
  colors: {
    primary: '#1f5b47',
    secondary: '#a34e24',
    background: '#f8f5ef',
    surface: '#ffffff',
  },
  typography: { character: 'script', exactFont: 'Lobster' },
  layout: {
    header: 'plain',
    card: { radius: 'none', border: 'hairline', elevation: 'flat' },
    spacing: 'compact',
    motifs: ['none'],
  },
};

function hexesOf(theme: BrandTheme): string[] {
  return Object.values(theme.colors).filter((c): c is string => c !== null);
}

describe('designCandidates', () => {
  it('offers exactly two distinct looks', () => {
    const designs = designCandidates(baseTheme);

    expect(designs).toHaveLength(2);
    expect(designs.map((d) => d.id)).toEqual(['warm-classic', 'fresh-modern']);
    expect(designs[0].name).not.toBe(designs[1].name);
  });

  it('copies the extracted colours byte for byte — never invents a hue', () => {
    const designs = designCandidates(baseTheme);

    for (const design of designs) {
      expect(design.theme.colors).toEqual(baseTheme.colors);
      expect(hexesOf(design.theme).sort()).toEqual(hexesOf(baseTheme).sort());
    }
  });

  it('falls back to the product guest accent when nothing was extracted', () => {
    const designs = designCandidates(null);

    for (const design of designs) {
      expect(design.theme.colors.primary).toBe('#6b2338');
      expect(design.theme.colors.secondary).toBeNull();
    }
  });

  it('carries the printed font name through, so the honest limitation note survives', () => {
    const designs = designCandidates(baseTheme);

    for (const design of designs) {
      expect(design.theme.typography.exactFont).toBe('Lobster');
    }
  });

  it('differs on character and layout, not on palette', () => {
    const [warm, fresh] = designCandidates(baseTheme);

    expect(warm.theme.typography.character).toBe('serif');
    expect(fresh.theme.typography.character).toBe('sans');
    expect(warm.theme.layout.header).toBe('banner-stack');
    expect(fresh.theme.layout.header).toBe('banner-overlay');
    expect(warm.theme.layout.motifs).toContain('rule-double');
    expect(fresh.theme.layout.motifs).toContain('divider-swirl');
  });

  it('every candidate survives the strict theme parse unchanged', () => {
    for (const design of designCandidates(baseTheme)) {
      const parsed = parseTheme(design.theme);
      expect(parsed).toEqual(design.theme);
    }
    for (const design of designCandidates(null)) {
      const parsed = parseTheme(design.theme);
      expect(parsed).toEqual(design.theme);
    }
  });
});
