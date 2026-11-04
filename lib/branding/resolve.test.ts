import { describe, expect, it } from 'vitest';
import type { BrandExtraction } from '../ai/brand-vision';
import {
  assetConflicts,
  buildTheme,
  resolveBanner,
  resolveLogo,
  resolveName,
  resolvePrimary,
} from './resolve';

const extraction = (overrides: Partial<BrandExtraction> = {}): BrandExtraction => ({
  model: 'test',
  name: 'Punjabi Rasoi',
  nameConfidence: 'high',
  logoBox: { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  logoConfidence: 'high',
  bannerBox: null,
  colors: { primary: '#7a1f2b', primaryConfidence: 'high', secondary: [], background: null, surface: null },
  typography: { character: 'serif', exactFont: null },
  layout: {
    header: 'plain',
    card: { radius: 'soft', border: 'hairline', elevation: 'flat' },
    spacing: 'regular',
    motifs: [],
  },
  notes: [],
  ...overrides,
});

describe('resolveName — priority 1 is always the owner', () => {
  it('owner confirmation beats the printed name and flags the difference', () => {
    const { resolved, conflicts } = resolveName({
      existingName: 'Old Name',
      ownerConfirmedName: 'My Real Name',
      extraction: extraction(),
    });
    expect(resolved.value).toBe('My Real Name');
    expect(resolved.source).toBe('owner-confirmed');
    expect(resolved.needsConfirmation).toBe(false);
    expect(conflicts[0]?.field).toBe('name');
  });

  it('a high-confidence printed name surfaces as a conflict against the current name', () => {
    const { resolved, conflicts } = resolveName({
      existingName: 'Old Name',
      ownerConfirmedName: null,
      extraction: extraction(),
    });
    expect(resolved.value).toBe('Punjabi Rasoi');
    expect(resolved.needsConfirmation).toBe(true);
    expect(conflicts[0]?.options.map((o) => o.value)).toEqual(['Old Name', 'Punjabi Rasoi']);
  });

  it('an uncertain extraction never displaces the existing name', () => {
    const { resolved, conflicts } = resolveName({
      existingName: 'Old Name',
      ownerConfirmedName: null,
      extraction: extraction({ nameConfidence: 'low' }),
    });
    expect(resolved.value).toBe('Old Name');
    expect(resolved.source).toBe('existing');
    expect(conflicts).toEqual([]);
  });
});

describe('resolvePrimary — owner pick > printed > default', () => {
  it('the owner colour wins and a differing print becomes a visible conflict', () => {
    const { resolved, conflicts } = resolvePrimary({
      extraction: extraction(),
      ownerPrimary: '#112233',
    });
    expect(resolved.value).toBe('#112233');
    expect(resolved.source).toBe('owner-confirmed');
    expect(conflicts[0]?.field).toBe('primary');
  });

  it('a high-confidence printed colour is used but still needs confirmation', () => {
    const { resolved } = resolvePrimary({ extraction: extraction(), ownerPrimary: null });
    expect(resolved.value).toBe('#7a1f2b');
    expect(resolved.source).toBe('printed-menu');
    expect(resolved.needsConfirmation).toBe(true);
  });

  it('an uncertain colour falls back to the guest default and asks', () => {
    const { resolved } = resolvePrimary({
      extraction: extraction({ colors: { primary: '#7a1f2b', primaryConfidence: 'low', secondary: [], background: null, surface: null } }),
      ownerPrimary: null,
    });
    expect(resolved.value).toBe('#6B2338');
    expect(resolved.needsConfirmation).toBe(true);
  });
});

describe('resolveLogo / resolveBanner — uploads win, extracts ask', () => {
  it('an uploaded logo is applied without confirmation', () => {
    expect(resolveLogo({ uploadedLogoAssetId: 'asset-1', extraction: extraction() })).toEqual({
      value: 'asset-1',
      source: 'owner-upload',
      needsConfirmation: false,
    });
  });

  it('a printed logo candidate is never auto-applied', () => {
    const resolved = resolveLogo({ uploadedLogoAssetId: null, extraction: extraction() });
    expect(resolved.value).toBeNull();
    expect(resolved.needsConfirmation).toBe(true);
  });

  it('a decorative-looking mark with low confidence is not even a candidate', () => {
    const resolved = resolveLogo({
      uploadedLogoAssetId: null,
      extraction: extraction({ logoConfidence: 'low' }),
    });
    expect(resolved.needsConfirmation).toBe(false);
    expect(resolved.value).toBeNull();
  });

  it('uploaded + printed logo together produce a question, not a silent win', () => {
    const conflicts = assetConflicts({ uploadedLogoAssetId: 'asset-1', extraction: extraction() });
    expect(conflicts[0]?.field).toBe('logo');
    expect(resolveBanner({ uploadedBannerAssetId: null, extraction: extraction() }).value).toBeNull();
  });
});

describe('buildTheme — extraction under owner edits, still validated', () => {
  it('assembles a theme from extraction with the decided primary', () => {
    const theme = buildTheme({ extraction: extraction(), ownerPrimary: null, ownerTheme: null });
    expect(theme!.colors.primary).toBe('#7a1f2b');
    expect(theme!.typography.character).toBe('serif');
  });

  it('owner theme edits layer on top but cannot override the primary decision', () => {
    const theme = buildTheme({
      extraction: extraction(),
      ownerPrimary: '#112233',
      ownerTheme: {
        colors: { primary: '#ff0000', secondary: '#00ff00', background: null, surface: null },
        typography: { character: 'mono', exactFont: null },
        layout: {
          header: 'banner-stack',
          card: { radius: 'round', border: 'frame', elevation: 'lifted' },
          spacing: 'airy',
          motifs: ['dot-separator'],
        },
      },
    });
    expect(theme!.colors.primary).toBe('#112233');
    expect(theme!.colors.secondary).toBe('#00ff00');
    expect(theme!.layout.header).toBe('banner-stack');
    expect(theme!.layout.motifs).toEqual(['dot-separator']);
  });

  it('junk owner edits cannot smuggle anything past the parser', () => {
    const theme = buildTheme({
      extraction: extraction(),
      ownerPrimary: '#112233',
      ownerTheme: {
        colors: { background: 'url(javascript:alert(1))', surface: null, secondary: null, primary: '#112233' },
        typography: { character: 'sans', exactFont: null },
        layout: {
          header: 'plain',
          card: { radius: 'soft', border: 'hairline', elevation: 'flat' },
          spacing: 'regular',
          motifs: [],
        },
      },
    });
    expect(theme!.colors.background).toBeNull();
  });

  it('returns null when there is no primary colour from anywhere', () => {
    expect(
      buildTheme({
        extraction: extraction({ colors: { primary: null, primaryConfidence: null, secondary: [], background: null, surface: null } }),
        ownerPrimary: null,
        ownerTheme: null,
      }),
    ).toBeNull();
  });
});
