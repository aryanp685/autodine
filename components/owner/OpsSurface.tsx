import type { CSSProperties, ReactNode } from 'react';

/**
 * The "Counter Clarity" ops surface, applied as token overrides.
 *
 * WHY OVERRIDES AND NOT NEW MARKUP
 *
 * The staff kit expresses no colour, radius or shadow of its own: every
 * component reads a `--p-*` token from `[data-surface='owner']`, which is what
 * lets a whole surface be retuned from one block. Menu and Tables are the two
 * screens restaurant staff keep open all day during service, so they carry the
 * Signature direction too: warm paper, espresso ink, burnt-orange actions, and
 * the same tighter 8px control radius. Every component inside keeps its
 * contract untouched -- only the values move.
 *
 * SCOPE
 *
 * The wrapper repaints the full page field by cancelling the shell's `main`
 * padding (px-5 pt-7 pb-24 / sm:px-8 sm:pt-10), so there is no two-tone seam
 * against the neighbouring screens' paper. The rail and DashboardBar are
 * outside this wrapper by design: they are shared chrome, not part of these
 * two screens.
 *
 * Contrast: burnt orange `#B24A15` on white is over 5:1; accent fills use
 * white text and muted labels use `--p-accent-soft`. Espresso `#3A2E23` on
 * warm paper is comfortably above 10:1.
 */
export const OPS_SURFACE_STYLE: CSSProperties = {
  /* Surfaces: warm porcelain, shared with the Signature owner workspace. */
  '--p-paper': '#faf6f0',
  '--p-paper-deep': '#f4ecdf',
  '--p-paper-veil': 'rgba(58, 46, 35, 0.022)',
  '--p-glass': 'rgba(255, 253, 248, 0.9)',

  /* Ink: espresso with the same ramp shape at the same opacities. */
  '--p-ink': '#3a2e23',
  '--p-ink-80': 'rgba(58, 46, 35, 0.86)',
  '--p-ink-64': 'rgba(58, 46, 35, 0.72)',
  '--p-ink-46': 'rgba(58, 46, 35, 0.62)',
  '--p-ink-28': 'rgba(58, 46, 35, 0.38)',
  '--p-ink-12': 'rgba(58, 46, 35, 0.14)',
  '--p-ink-07': 'rgba(58, 46, 35, 0.07)',

  /* Accent: burnt orange, with a darker pressed state and a quiet wash. */
  '--p-accent': '#b24a15',
  '--p-accent-strong': '#8f3910',
  '--p-accent-soft': '#fbe7da',
  '--p-accent-wash': 'rgba(234, 106, 42, 0.08)',

  /* Rail and lines follow the evergreen-and-espresso Signature palette. */
  '--p-rail': '#183d32',
  '--p-rail-raised': '#214b40',
  '--p-rail-ink': '#fffaf2',
  '--p-rail-ink-64': 'rgba(255, 250, 242, 0.78)',
  '--p-rail-ink-40': 'rgba(255, 250, 242, 0.64)',
  '--p-rail-line': 'rgba(255, 250, 242, 0.14)',
  '--p-rail-active': 'rgba(234, 106, 42, 0.2)',
  '--p-line': 'rgba(58, 46, 35, 0.1)',
  '--p-line-soft': 'rgba(58, 46, 35, 0.06)',
  '--p-line-strong': 'rgba(58, 46, 35, 0.18)',

  /* Geometry: the 8px control radius from the direction, with the card one
     step larger so the hierarchy between a card and a control survives. */
  '--p-r-card': '12px',
  '--p-r-block': '8px',
  '--p-r-control': '8px',
  '--p-r-chip': '8px',
} as CSSProperties;

/**
 * Cancels the shell `main` padding while restoring it inside, so the ops field
 * reaches the edges of the content area exactly where the default paper does.
 */
const FIELD_CLASS =
  '-mx-5 -mt-7 -mb-24 px-5 pt-7 pb-24 sm:-mx-8 sm:-mt-10 sm:px-8 sm:pt-10 lg:-mt-10 bg-paper text-gink antialiased';

export function OpsSurface({ children }: { children: ReactNode }) {
  return (
    <div data-ops="counter-clarity" style={OPS_SURFACE_STYLE} className={FIELD_CLASS}>
      {children}
    </div>
  );
}
