/**
 * The landing's botanical line work.
 *
 * The reference sheet frames its cards with olive sprigs: a slim stem, paired
 * leaves, one small sun. These are drawn rather than exported so they inherit
 * `currentColor` (the palette's forest token at low opacity), cost no request
 * and stay crisp at any size. Every piece is decoration: `aria-hidden` and
 * never the only way a section communicates something.
 */

type ArtProps = {
  className?: string;
  /** Stroke weight in viewBox units. Thin reads as a watermark, thick as an illustration. */
  weight?: number;
};

/** A tall sprig with paired leaves. Designed to sit in a section corner. */
export function Sprig({ className, weight = 1.5 }: ArtProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 120 170"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
    >
      <path d="M61 168C61 128 59 82 63 6" />
      {[
        [58, 142, -34],
        [64, 126, 30],
        [57, 112, -40],
        [65, 94, 26],
        [58, 78, -44],
        [65, 60, 22],
        [60, 46, -40],
        [65, 30, 18],
      ].map(([x, y, angle]) => (
        <ellipse
          key={`${x}-${y}`}
          cx={x + 15}
          cy={y}
          rx="16"
          ry="7"
          transform={`rotate(${angle} ${x + 15} ${y})`}
        />
      ))}
      <circle cx="76" cy="20" r="6" />
    </svg>
  );
}

/** A broad leaf, for the inside edge of a panel. */
export function LeafFrond({ className, weight = 1.4 }: ArtProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 220"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
    >
      <path d="M80 218C80 150 78 86 92 12" />
      <path d="M84 190c-34-4-58-26-62-58 32 2 56 26 62 58Z" />
      <path d="M88 150c30-8 48-30 50-58-28 6-46 28-50 58Z" />
      <path d="M84 112c-28-6-46-26-48-52 26 4 44 24 48 52Z" />
      <path d="M90 78c24-10 38-28 40-50-22 6-36 24-40 50Z" />
      <path d="M93 44c-16-6-26-20-28-38 16 4 26 18 28 38Z" />
    </svg>
  );
}

/** The sheet's small sun: an arc with rays, used as a section flourish. */
export function SunGlyph({ className, weight = 1.4 }: ArtProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
    >
      <circle cx="32" cy="32" r="11" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="32"
          y1="9"
          x2="32"
          y2="3"
          transform={`rotate(${angle} 32 32)`}
        />
      ))}
    </svg>
  );
}

/** A corner arrangement: sprig + frond + sun, positioned by the caller. */
export function CornerGarden({
  className,
  flip = false,
  tone = 'text-forest',
}: {
  className?: string;
  flip?: boolean;
  tone?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute ${className ?? ''}`}
      style={flip ? { scale: '-1 1' } : undefined}
    >
      <Sprig className={`botanical-sway absolute h-40 w-auto ${tone} opacity-[0.22]`} />
      <LeafFrond className={`botanical-sway-slow absolute top-24 left-16 h-48 w-auto ${tone} opacity-[0.14]`} />
      <SunGlyph className={`absolute -top-4 left-24 size-8 ${tone} opacity-30`} />
    </div>
  );
}
