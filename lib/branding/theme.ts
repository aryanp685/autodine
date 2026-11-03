/**
 * The brand theme: a typed, constrained schema — never model CSS.
 *
 * WHAT THIS IS
 *
 * The guest menu's existing design system (app/globals.css, [data-flow-root])
 * consumes custom properties. A brand theme is a small set of VALIDATED values
 * that map onto those properties, and nothing else. There is no field here
 * that accepts CSS, HTML or arbitrary text: a model cannot inject a style, a
 * URL or a script through a theme, because everything is either a closed-enum
 * key or a #rrggbb that this module parsed itself.
 *
 * WHY FONTS ARE STACKS AND NOT FILES
 *
 * "Closest supported font" (Part 1) against "avoid unnecessary dependencies"
 * (Part 5): bundling webfonts would add downloads, a build-time network
 * dependency and a licensing surface, to imitate print typography at phone
 * sizes. The supported set is therefore five character families rendered with
 * robust system stacks. When the printed font cannot be matched, the review
 * says so plainly (themeFontLimitation) — the limitation is visible, not
 * silently absorbed.
 *
 * CONTRAST IS A CONTRACT
 *
 * Every colour that reaches a guest passes `contrast()` (WCAG 2.1, from
 * lib/branding/palette.ts). The label colour on the primary fill is DERIVED
 * here — white or near-black, whichever passes — so an owner cannot create
 * an unreadable button. Colours that cannot produce a passing pair at all are
 * reported by `themeContrastWarnings` and refused by the review UI.
 */

import { contrast } from './palette';

/* ------------------------------------------------------------------ enums */

export type FontCharacter = 'serif' | 'sans' | 'condensed' | 'script' | 'mono';
export type Motif = 'none' | 'rule-double' | 'divider-swirl' | 'corner-ornament' | 'dot-separator';
export type HeaderStyle = 'banner-overlay' | 'banner-stack' | 'plain';
export type CardRadius = 'none' | 'soft' | 'round';
export type CardBorder = 'none' | 'hairline' | 'frame';
export type CardElevation = 'flat' | 'lifted';
export type Spacing = 'compact' | 'regular' | 'airy';

const FONT_CHARACTERS: readonly FontCharacter[] = ['serif', 'sans', 'condensed', 'script', 'mono'];
const MOTIFS: readonly Motif[] = ['none', 'rule-double', 'divider-swirl', 'corner-ornament', 'dot-separator'];
const HEADERS: readonly HeaderStyle[] = ['banner-overlay', 'banner-stack', 'plain'];
const RADII: readonly CardRadius[] = ['none', 'soft', 'round'];
const BORDERS: readonly CardBorder[] = ['none', 'hairline', 'frame'];
const ELEVATIONS: readonly CardElevation[] = ['flat', 'lifted'];
const SPACINGS: readonly Spacing[] = ['compact', 'regular', 'airy'];

/**
 * The supported font set. System stacks: zero bytes, every language the
 * device has, and no licence question. `label` is what the owner is shown.
 */
export const FONT_MATCHES: Record<FontCharacter, { label: string; stack: string }> = {
  serif: {
    label: 'Elegant serif',
    stack: "Georgia, 'Times New Roman', 'Noto Serif', serif",
  },
  sans: {
    label: 'Clean sans',
    stack: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  },
  condensed: {
    label: 'Condensed',
    stack: "'Arial Narrow', 'Roboto Condensed', 'Noto Sans', sans-serif",
  },
  script: {
    label: 'Script',
    stack: "'Segoe Script', 'Bradley Hand', 'Snell Roundhand', cursive",
  },
  mono: {
    label: 'Monospace',
    stack: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
  },
};

/* ------------------------------------------------------------------ theme */

export type BrandTheme = {
  version: 1;
  colors: {
    /** Required. The one colour the basic owner control changes. */
    primary: string;
    secondary: string | null;
    background: string | null;
    surface: string | null;
  };
  typography: {
    character: FontCharacter;
    /** The printed font name, when the model could identify one. */
    exactFont: string | null;
  };
  layout: {
    header: HeaderStyle;
    card: { radius: CardRadius; border: CardBorder; elevation: CardElevation };
    spacing: Spacing;
    motifs: Motif[];
  };
};

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Parse and clamp a colour. Returns null for anything not #rrggbb. */
export function parseHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return HEX_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function oneOf<T>(list: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as T)
    : null;
}

/**
 * Strict parse. A theme with no valid primary colour is not a theme.
 * Everything else degrades to a default — a missing motif is not a reason to
 * refuse the whole profile — but nothing unknown ever survives.
 */
export function parseTheme(value: unknown): BrandTheme | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const colors = (raw.colors ?? {}) as Record<string, unknown>;
  const typography = (raw.typography ?? {}) as Record<string, unknown>;
  const layout = (raw.layout ?? {}) as Record<string, unknown>;
  const card = (layout.card ?? {}) as Record<string, unknown>;

  const primary = parseHex(colors.primary);
  if (!primary) return null;

  const motifsRaw = Array.isArray(layout.motifs) ? layout.motifs : [];
  const motifs = motifsRaw
    .map((m) => oneOf(MOTIFS, m))
    .filter((m): m is Motif => m !== null && m !== 'none')
    .slice(0, 4);

  return {
    version: 1,
    colors: {
      primary,
      secondary: parseHex(colors.secondary),
      background: parseHex(colors.background),
      surface: parseHex(colors.surface),
    },
    typography: {
      character: oneOf(FONT_CHARACTERS, typography.character) ?? 'sans',
      exactFont:
        typeof typography.exactFont === 'string' && typography.exactFont.trim().length > 0
          ? typography.exactFont.trim().slice(0, 60)
          : null,
    },
    layout: {
      header: oneOf(HEADERS, layout.header) ?? 'plain',
      card: {
        radius: oneOf(RADII, card.radius) ?? 'soft',
        border: oneOf(BORDERS, card.border) ?? 'hairline',
        elevation: oneOf(ELEVATIONS, card.elevation) ?? 'flat',
      },
      spacing: oneOf(SPACINGS, layout.spacing) ?? 'regular',
      motifs,
    },
  };
}

/* --------------------------------------------------------------- contrast */

/** Near-black label, never pure #000 — matches the product's ink. */
const INK_LABEL = '#211a15';
const PAPER_LABEL = '#f7f2e9';

/**
 * The label colour for text on `fill`: paper or ink, whichever passes AA
 * (4.5:1) at body size. If neither passes, the darker-or-lighter winner is
 * still returned so the UI renders, and `themeContrastWarnings` names the
 * problem for the review screen.
 */
export function labelOn(fill: string): string {
  const onPaper = contrast(PAPER_LABEL, fill);
  const onInk = contrast(INK_LABEL, fill);
  if (onPaper >= 4.5) return PAPER_LABEL;
  if (onInk >= 4.5) return INK_LABEL;
  return onPaper >= onInk ? PAPER_LABEL : INK_LABEL;
}

/**
 * Every contrast problem in a theme, in words an owner can act on.
 * The review screen shows these before Create; publish refuses with them.
 */
export function themeContrastWarnings(theme: BrandTheme): string[] {
  const warnings: string[] = [];
  const paper = theme.colors.background ?? '#f7f2e9';
  const surface = theme.colors.surface ?? paper;

  if (contrast(labelOn(theme.colors.primary), theme.colors.primary) < 4.5) {
    warnings.push(
      `Buttons in ${theme.colors.primary} cannot carry readable text. Pick a darker or lighter primary colour.`,
    );
  }
  if (theme.colors.secondary && contrast(labelOn(theme.colors.secondary), theme.colors.secondary) < 4.5) {
    warnings.push(`The secondary colour ${theme.colors.secondary} cannot carry readable text.`);
  }
  if (contrast(INK_LABEL, surface) < 4.5) {
    warnings.push(`Dish text would not be readable on the surface colour ${surface}.`);
  }
  if (contrast(INK_LABEL, paper) < 4.5) {
    warnings.push(`Menu text would not be readable on the background colour ${paper}.`);
  }
  return warnings;
}

/**
 * The visible limitation note for fonts, per Part 1 ("If the exact font is
 * unavailable, use the closest supported font and make the limitation visible").
 */
export function themeFontLimitation(theme: BrandTheme): string | null {
  const match = FONT_MATCHES[theme.typography.character];
  if (!theme.typography.exactFont) return null;
  return `“${theme.typography.exactFont}” is not a licensed webfont here. The menu uses ${match.label} — the closest supported style.`;
}

/* ------------------------------------------------------------ css mapping */

const RADIUS_PX: Record<CardRadius, string> = { none: '0px', soft: '10px', round: '22px' };
const BORDER_CSS: Record<CardBorder, string> = {
  none: '0px',
  hairline: '1px',
  frame: '2px',
};
const SPACING_EM: Record<Spacing, string> = { compact: '0.75rem', regular: '1rem', airy: '1.35rem' };
const ELEVATION_CSS: Record<CardElevation, string> = {
  flat: 'none',
  lifted: '0 10px 26px rgba(40, 24, 12, 0.14)',
};

/**
 * Theme → custom properties. ONLY custom properties: the components consume
 * them through var() with fallbacks, so a restaurant without a theme renders
 * exactly as it does today and a restaurant with one re-themes the same
 * components (no parallel design system).
 */
export function themeStyle(theme: BrandTheme): Record<string, string> {
  return {
    '--brand-primary': theme.colors.primary,
    '--brand-primary-ink': labelOn(theme.colors.primary),
    '--brand-secondary': theme.colors.secondary ?? theme.colors.primary,
    '--brand-paper': theme.colors.background ?? '#f7f2e9',
    '--brand-surface': theme.colors.surface ?? theme.colors.background ?? '#ffffff',
    '--brand-font': FONT_MATCHES[theme.typography.character].stack,
    '--brand-radius': RADIUS_PX[theme.layout.card.radius],
    '--brand-border': BORDER_CSS[theme.layout.card.border],
    '--brand-elevation': ELEVATION_CSS[theme.layout.card.elevation],
    '--brand-space': SPACING_EM[theme.layout.spacing],
    '--brand-motif': theme.layout.motifs[0] ?? 'none',
    '--brand-header': theme.layout.header,
  };
}

/**
 * The accent pair the existing guest custom properties expect
 * (--p-accent / --p-accent-soft). Themed restaurants override these two so
 * every existing `var(--p-accent)` usage re-colours without a component
 * change. The soft wash is derived, not authored: the owner controls one
 * colour and the system tints from it.
 */
export function themeAccentOverrides(theme: BrandTheme): Record<string, string> {
  return {
    '--p-accent': theme.colors.primary,
    '--p-accent-soft': softWash(theme.colors.primary),
    '--p-accent-strong': shade(theme.colors.primary, -0.16),
    '--p-accent-wash': hexToRgba(theme.colors.primary, 0.05),
  };
}

/** A paper-tinted wash of an accent: mixed 12% into white. */
export function softWash(hex: string): string {
  return mix(hex, '#ffffff', 0.12);
}

/** Mix `a` into `b` by `weight` of a (0..1). */
export function mix(a: string, b: string, weight: number): string {
  const pa = rgb(a);
  const pb = rgb(b);
  if (!pa || !pb) return b;
  const w = Math.min(1, Math.max(0, weight));
  const out = [0, 1, 2].map((i) => Math.round(pa[i] * w + pb[i] * (1 - w)));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Darken (negative) or lighten (positive) toward black / white. ±1 is total. */
export function shade(hex: string, amount: number): string {
  const t = 1 - Math.min(1, Math.max(0, Math.abs(amount)));
  return amount >= 0 ? mix(hex, '#ffffff', t) : mix(hex, '#000000', t);
}

function rgb(hex: string): [number, number, number] | null {
  const parsed = parseHex(hex);
  if (!parsed) return null;
  return [
    parseInt(parsed.slice(1, 3), 16),
    parseInt(parsed.slice(3, 5), 16),
    parseInt(parsed.slice(5, 7), 16),
  ];
}

function hexToRgba(hex: string, alpha: number): string {
  const parts = rgb(hex);
  if (!parts) return `rgba(0,0,0,${alpha})`;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}
