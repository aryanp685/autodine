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
 * The public-facing welcome, carried inside the product.
 *
 * The landing page and the auth screens already speak one language: cream
 * paper (#FBF6EE), forest as the working colour (#1F4D3A), burnt saffron for
 * marks and emphasis (#B4531B), Fraunces for display type. The Overview is the
 * first screen after sign-in, so it should not feel like a different product
 * with a different accent.
 *
 * Two greens still mean different things and stay distinct: `--p-live` is the
 * settled/ready state and keeps its own value; `--p-accent` here is the
 * control/selection colour, exactly as the forest button on the landing page
 * is. Nothing else in this block is a new colour -- they are the landing's
 * values, at the same opacities the kit already uses.
 */
export const WELCOME_SURFACE_STYLE: CSSProperties = {
  /* Surfaces: the landing's cream field, warm sheet above it. */
  '--p-paper': '#fbf6ee',
  '--p-paper-deep': '#f3ebdd',
  '--p-paper-veil': 'rgba(43, 32, 21, 0.022)',
  '--p-glass': 'rgba(253, 250, 244, 0.9)',
  '--p-surface': '#fffdf9',
  '--p-card': '#fffdf9',

  /* Ink: the landing's heading colour, warmed through the ramp. */
  '--p-ink': '#2b2015',
  '--p-ink-80': 'rgba(43, 32, 21, 0.86)',
  '--p-ink-64': 'rgba(43, 32, 21, 0.72)',
  '--p-ink-46': 'rgba(43, 32, 21, 0.62)',
  '--p-ink-28': 'rgba(43, 32, 21, 0.38)',
  '--p-ink-12': 'rgba(43, 32, 21, 0.14)',
  '--p-ink-07': 'rgba(43, 32, 21, 0.07)',

  /* Accent: forest, the landing's action colour. */
  '--p-accent': '#1f4d3a',
  '--p-accent-strong': '#173c2d',
  '--p-accent-soft': '#e6eee7',
  '--p-accent-wash': 'rgba(31, 77, 58, 0.045)',

  /* The landing's burnt saffron, for the one warm mark on the page (the
     revenue curve), never as a fill behind body copy. */
  '--p-ember': '#b4531b',

  /* Rail and lines follow the new ink so the chrome stays one room. */
  '--p-rail': '#fffdf9',
  '--p-rail-raised': '#ffffff',
  '--p-rail-ink': '#2b2015',
  '--p-rail-ink-64': 'rgba(43, 32, 21, 0.72)',
  '--p-rail-ink-40': 'rgba(43, 32, 21, 0.64)',
  '--p-rail-line': 'rgba(43, 32, 21, 0.09)',
  '--p-rail-active': 'rgba(31, 77, 58, 0.1)',
  '--p-line': 'rgba(43, 32, 21, 0.1)',
  '--p-line-soft': 'rgba(43, 32, 21, 0.06)',
  '--p-line-strong': 'rgba(43, 32, 21, 0.18)',

  /* Geometry: the landing's softer cards, a 12px block inside them. */
  '--p-r-card': '18px',
  '--p-r-block': '12px',
  '--p-r-control': '12px',
  '--p-r-chip': '8px',
} as CSSProperties;

/**
 * Cancels the shell `main` padding while restoring it inside, so the ops field
 * reaches the edges of the content area exactly where the default paper does.
 */
const FIELD_CLASS =
  '-mx-5 -mt-7 -mb-24 px-5 pt-7 pb-24 sm:-mx-8 sm:-mt-10 sm:px-8 sm:pt-10 lg:-mt-10 bg-paper text-gink antialiased';

export function OpsSurface({
  children,
  tone = 'ops',
}: {
  children: ReactNode;
  /** `welcome` carries the landing/auth palette; `ops` is the counter kit. */
  tone?: 'ops' | 'welcome';
}) {
  return (
    <div
      data-ops={tone === 'welcome' ? 'swagat-welcome' : 'counter-clarity'}
      style={tone === 'welcome' ? WELCOME_SURFACE_STYLE : OPS_SURFACE_STYLE}
      className={FIELD_CLASS}
    >
      {children}
    </div>
  );
}
