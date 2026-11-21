/**
 * The restaurant's accent palette.
 *
 * WHY A CLOSED SET AND NOT A COLOUR PICKER
 *
 * Branding was specified as "a small set of accent colours", and there is a
 * harder reason than aesthetics: an owner who can type `#f8f5ef` gets white
 * text on paper, a button that has disappeared, and a support message saying
 * the product is broken. Every colour below is checked for WCAG AA contrast
 * both as text on the paper background and as a white-on-accent button fill,
 * and `palette.test.ts` re-checks it on every run, so a future edit that
 * breaks a colour fails the build rather than shipping.
 *
 * WHY THE VALUE LIVES IN TYPESCRIPT AND NOT IN CSS
 *
 * The design-system guard freezes the number of hard-coded hex values in the
 * stylesheets (42, at ceiling). Putting six accents into CSS would add twelve
 * and require raising the ceiling for no design reason. Instead the chosen
 * accent is written as an inline `--p-accent` / `--p-accent-soft` custom
 * property on the guest root -- those two variables are already consumed 25
 * times in styles/guest.css, so the whole guest flow re-themes from one style
 * attribute and the stylesheets stay clean.
 */

export type AccentKey = 'forest' | 'terracotta' | 'maroon' | 'indigo' | 'ochre' | 'slate';

export type Accent = {
  key: AccentKey;
  /** Human label, used as the swatch's accessible name. */
  label: string;
  /** Button fills, active chips, the add control. */
  accent: string;
  /** A paper-tinted wash for selected rows and soft badges. */
  soft: string;
};

/**
 * Order matters: this is the order the swatches are shown in, and `forest` is
 * first because it is the default for every restaurant that never picks one.
 */
export const ACCENTS: readonly Accent[] = [
  /* Maroon leads because it is the default, and because the flow's whole
   * surface is warm cream: a wine-dark accent sits on it like ink on a menu
   * card, where the green this used to default to read as a status colour
   * next to photographs of food. Every value below was re-tuned darker and
   * less saturated than the first set for the same reason -- an accent used
   * at 12-26% in a background wash has to be deep, or the wash turns into a
   * tint of the page. */
  { key: 'maroon', label: 'Maroon', accent: '#6B2338', soft: '#f7e9ee' },
  { key: 'terracotta', label: 'Terracotta', accent: '#A34E24', soft: '#f8e9df' },
  { key: 'forest', label: 'Forest', accent: '#1F5B47', soft: '#e3ece7' },
  { key: 'indigo', label: 'Indigo', accent: '#37456B', soft: '#e8ebf2' },
  { key: 'ochre', label: 'Ochre', accent: '#8A5A12', soft: '#f6eeda' },
  { key: 'slate', label: 'Slate', accent: '#445A63', soft: '#e9edee' },
] as const;

export const DEFAULT_ACCENT: AccentKey = 'maroon';

/** Every key, for tests and for the database CHECK's mirror image. */
export const ACCENT_KEYS: readonly AccentKey[] = ACCENTS.map((a) => a.key);

/**
 * Turn whatever came back from the database or a form into a usable accent.
 *
 * The column has a CHECK constraint, so an unknown key should be impossible.
 * It is still handled here because the guest menu must not fail to render over
 * a value it does not recognise: it falls back to the default and the page is
 * merely less distinctive, never broken.
 */
export function accentFrom(value: unknown): Accent {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ACCENTS.find((a) => a.key === key) ?? ACCENTS[0];
}

/**
 * The accent every guest sees, whichever restaurant they are sitting in.
 *
 * WHY THIS IS A CONSTANT AND NOT THE RESTAURANT'S ROW
 *
 * The flow used to take its accent from `restaurants.accent`, so two
 * restaurants produced two different products: same menu, same buttons, one
 * green and one maroon. A guest moving between them -- and an owner comparing
 * what they see against what they were shown -- had no way to tell a branding
 * choice from a design change. "Every customer should see the same UI" is the
 * instruction, and this is it: one look, one set of colours, everywhere.
 *
 * The palette below still exists and is still contrast-checked, because that is
 * what makes THIS colour safe; and `restaurants.accent` still holds whatever
 * an owner picked, waiting for a day when per-restaurant theming is a product
 * decision rather than an accident of plumbing. Nothing in the guest flow
 * reads it today.
 */
export const GUEST_ACCENT: AccentKey = 'maroon';

/** Inline style object that paints the guest flow. Takes no input, on purpose. */
export function guestAccentStyle(): Record<string, string> {
  const { accent, soft } = accentFrom(GUEST_ACCENT);
  return { '--p-accent': accent, '--p-accent-soft': soft };
}

/* ------------------------------------------------------------------ contrast */

/**
 * The paper the guest flow is drawn on. Mirrored from `--p-paper` on
 * [data-flow-root] in app/globals.css, which is the warm oat the wash is built
 * on. If that value moves, this one has to move with it or these contrast
 * checks stop describing the screen they claim to.
 */
export const PAPER = '#f7f2e9';

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const v = channel(hex, i);
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
