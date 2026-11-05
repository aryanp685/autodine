/**
 * Two storefront design candidates, generated from the extracted brand.
 *
 * WHAT THESE ARE
 *
 * The guest menu has exactly one design system; a brand theme re-paints it
 * (lib/branding/guest-theme.ts). A "design candidate" is therefore a fully
 * specified BrandTheme: the SAME colours the brand extraction found — copied,
 * never invented — dressed in two different characters. Warm Classic is the
 * printed-menu look: serif type, framed cards, double rules. Fresh Modern is
 * the phone-first look: clean sans, rounded lifted cards, open spacing.
 *
 * WHY NO MODEL CALLS HERE
 *
 * The AI already did its part reading the menu and the brand. Turning that
 * into two looks is deterministic design work: a model asked to "generate a
 * design" would return colours and fonts this schema cannot carry, at a cost
 * the ₹0 budget does not allow. Both candidates pass the same strict
 * parseTheme as anything else that reaches a guest.
 */

import type { BrandTheme } from './theme';

export type DesignId = 'warm-classic' | 'fresh-modern';

export type DesignCandidate = {
  id: DesignId;
  name: string;
  tagline: string;
  theme: BrandTheme;
};

/**
 * The product's own guest accent (palette.ts, maroon-led). Only used when
 * the extraction found no colour at all — the same value resolvePrimary
 * falls back to, so a design never invents a hue.
 */
const DEFAULT_PRIMARY = '#6b2338';

/**
 * The two looks. Colour inputs are byte-copied from the base theme (or the
 * one product default); what differs between the candidates is typography
 * character, header treatment, card geometry, spacing and motif — the fields
 * that say "design" rather than "palette".
 */
/**
 * Which design the live theme is, if it is one of the two.
 *
 * Compared on the fields that SAY design — type character, header, card
 * geometry, spacing, motifs — and never on colour: the colours belong to the
 * restaurant and are byte-copied into both candidates. A theme that matches
 * neither candidate is the owner's own ('null' = custom), which is a real
 * answer, not a failure.
 */
export function currentDesignIdOf(theme: BrandTheme | null | undefined): DesignId | null {
  if (!theme) return null;
  const same = (a: BrandTheme, b: BrandTheme) =>
    a.typography.character === b.typography.character &&
    a.layout.header === b.layout.header &&
    a.layout.card.radius === b.layout.card.radius &&
    a.layout.card.border === b.layout.card.border &&
    a.layout.card.elevation === b.layout.card.elevation &&
    a.layout.spacing === b.layout.spacing &&
    JSON.stringify(a.layout.motifs ?? []) === JSON.stringify(b.layout.motifs ?? []);
  for (const candidate of designCandidates(null)) {
    if (same(theme, candidate.theme)) return candidate.id;
  }
  return null;
}

export function designCandidates(base: BrandTheme | null): DesignCandidate[] {
  const colors: BrandTheme['colors'] = base
    ? {
        primary: base.colors.primary,
        secondary: base.colors.secondary,
        background: base.colors.background,
        surface: base.colors.surface,
      }
    : { primary: DEFAULT_PRIMARY, secondary: null, background: null, surface: null };
  const exactFont = base?.typography.exactFont ?? null;

  return [
    {
      id: 'warm-classic',
      name: 'Warm Classic',
      tagline: 'Elegant serif type, framed cards, a calm double rule.',
      theme: {
        version: 1,
        colors: { ...colors },
        typography: { character: 'serif', exactFont },
        layout: {
          header: 'banner-stack',
          card: { radius: 'soft', border: 'frame', elevation: 'flat' },
          spacing: 'regular',
          motifs: ['rule-double', 'dot-separator'],
        },
      },
    },
    {
      id: 'fresh-modern',
      name: 'Fresh Modern',
      tagline: 'Clean sans type, rounded cards, open airy spacing.',
      theme: {
        version: 1,
        colors: { ...colors },
        typography: { character: 'sans', exactFont },
        layout: {
          header: 'banner-overlay',
          card: { radius: 'round', border: 'none', elevation: 'lifted' },
          spacing: 'airy',
          motifs: ['divider-swirl'],
        },
      },
    },
  ];
}
