/**
 * The AutoDine mark: an A that is a hand holding a fork.
 *
 * WHERE THIS COMES FROM
 *
 * The owner's own artwork. It was exported at 331px and is not a vector, so
 * this is a redrawn approximation rather than the source file -- close enough
 * to be indistinguishable at the sizes it is used (16px in a tab, 28px in the
 * nav, 40px on a phone), and honestly not pixel-exact at poster size. If the
 * original .ai or .svg ever turns up, replace the paths below and nothing else
 * has to change.
 *
 * HOW IT IS BUILT
 *
 * A mask, not a stack of shapes: everything is punched out of one solid form,
 * so the fork is a true hole through the letterform rather than a white shape
 * sitting on top of it. That matters the moment the mark sits on anything
 * other than white -- a dark nav, a coloured tile, a photograph. A white-on-
 * white fake would show as a pale ghost.
 *
 * The mask id is derived from `tone`, so two marks with different colours can
 * be on the same page without one stealing the other's mask.
 *
 * NO ".in"
 *
 * The wordmark is "autodine". A domain in a logo dates the day the domain
 * changes, and the mark carries the meaning anyway.
 */

export function BrandMark({
  size = 28,
  ink = 'currentColor',
  dot = '#2f7d4f',
  className,
  /** Distinguishes the mask when two marks with different colours share a page. */
  tone = 'a',
}: {
  size?: number;
  ink?: string;
  dot?: string;
  className?: string;
  tone?: string;
}) {
  const id = `ad-mark-${tone}`;

  return (
    <svg
      viewBox="0 0 128 120"
      width={size}
      height={(size * 120) / 128}
      className={className}
      role="img"
      aria-label="AutoDine"
    >
      <defs>
        <mask id={id}>
          <rect width="128" height="120" fill="#000" />
          {/* left leg */}
          <path d="M56 30 L32 85" stroke="#fff" strokeWidth="25" strokeLinecap="round" fill="none" />
          {/* the round apex, then the right leg */}
          <circle cx="57" cy="28.5" r="12.4" fill="#fff" />
          <path d="M57 17 C65.5 16.6 72 20.4 75 27.4 L97 68 L61 68 Z" fill="#fff" />
          {/* the fork, knocked out */}
          <g stroke="#000" strokeLinecap="round" fill="none">
            <path d="M45.6 43.4 L52.4 31.2" strokeWidth="4.6" />
            <path d="M52.8 45.8 L59.6 33.4" strokeWidth="4.6" />
            <path d="M60 48.2 L66.8 35.8" strokeWidth="4.6" />
            <path
              d="M45.6 43.4 C42.9 48.4 42.7 52.2 45.2 55.2 C47.9 57.6 52 57.4 54.6 54.8"
              strokeWidth="5.6"
            />
          </g>
        </mask>
      </defs>

      <rect width="128" height="120" fill={ink} mask={`url(#${id})`} />
      <circle cx="89.5" cy="86" r="13.6" fill={dot} />
    </svg>
  );
}

/**
 * Mark plus wordmark, for places with room for both.
 *
 * The word is set in the page's own typeface at the page's own ink, so it
 * belongs to the surface it sits on instead of carrying a second palette.
 */
export function BrandLockup({
  size = 26,
  ink = 'currentColor',
  dot = '#2f7d4f',
  className,
}: {
  size?: number;
  ink?: string;
  dot?: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.34, color: ink }}
    >
      <BrandMark size={size * 1.36} ink={ink} dot={dot} tone="lockup" />
      <span
        style={{
          fontSize: size * 0.82,
          fontWeight: 500,
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}
      >
        autodine
      </span>
    </span>
  );
}
