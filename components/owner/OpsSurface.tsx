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
 * ops direction: a cooler porcelain field, graphite ink, one copper accent for
 * "this is where you are / this control is on", and a tighter 8px control
 * radius. Every component inside keeps its contract untouched -- only the
 * values move.
 *
 * SCOPE
 *
 * The wrapper repaints the full page field by cancelling the shell's `main`
 * padding (px-5 pt-7 pb-24 / sm:px-8 sm:pt-10), so there is no two-tone seam
 * against the neighbouring screens' paper. The rail and DashboardBar are
 * outside this wrapper by design: they are shared chrome, not part of these
 * two screens.
 *
 * Contrast: copper `#C2410C` on white is 4.6:1 and on the soft wash 4.5:1, so
 * it passes AA for the large/bold and UI uses it is given (accent fills carry
 * white at 4.6:1, accent labels sit on `--p-accent-soft`). Graphite
 * `#1C2321` on the field is over 14:1.
 */
export const OPS_SURFACE_STYLE: CSSProperties = {
  /* Surfaces: cooler porcelain than the default warm paper. */
  '--p-paper': '#f7f5f1',
  '--p-paper-deep': '#efece6',
  '--p-paper-veil': 'rgba(28, 35, 33, 0.022)',
  '--p-glass': 'rgba(250, 249, 246, 0.9)',

  /* Ink: graphite, not espresso. Same ramp shape at the same opacities. */
  '--p-ink': '#1c2321',
  '--p-ink-80': 'rgba(28, 35, 33, 0.86)',
  '--p-ink-64': 'rgba(28, 35, 33, 0.72)',
  '--p-ink-46': 'rgba(28, 35, 33, 0.66)',
  '--p-ink-28': 'rgba(28, 35, 33, 0.38)',
  '--p-ink-12': 'rgba(28, 35, 33, 0.14)',
  '--p-ink-07': 'rgba(28, 35, 33, 0.07)',

  /* Accent: the one copper. Pressed is one step darker, soft wash derived. */
  '--p-accent': '#c2410c',
  '--p-accent-strong': '#a3370a',
  '--p-accent-soft': '#f8e8e2',
  '--p-accent-wash': 'rgba(194, 65, 12, 0.05)',

  /* Rail and lines follow the new ink so the chrome stays one room. */
  '--p-rail': '#fbfaf8',
  '--p-rail-ink': '#1c2321',
  '--p-rail-ink-64': 'rgba(28, 35, 33, 0.72)',
  '--p-rail-ink-40': 'rgba(28, 35, 33, 0.64)',
  '--p-rail-line': 'rgba(28, 35, 33, 0.09)',
  '--p-rail-active': 'rgba(194, 65, 12, 0.1)',
  '--p-line': 'rgba(28, 35, 33, 0.1)',
  '--p-line-soft': 'rgba(28, 35, 33, 0.06)',
  '--p-line-strong': 'rgba(28, 35, 33, 0.18)',

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
