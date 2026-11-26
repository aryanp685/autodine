/**
 * The AutoDine logo, in the three forms the owner supplied.
 *
 * WHERE THIS COMES FROM
 *
 * The owner's own artwork: an A whose right leg is a leaf, in forest green and
 * orange on cream. The deliverables arrived as flat images rather than SVG, so
 * the files in `public/brand/` are the artwork with the cream background
 * knocked out and the empty margin trimmed. Nothing is redrawn here, so the
 * mark is exactly what was signed off; when vector originals arrive, drop them
 * in at the same paths and nothing else has to change.
 *
 * THE THREE FORMS
 *
 *  - `horizontal` (mark + wordmark side by side): the desktop header, where the
 *    bar is wide and short.
 *  - `stacked` (mark above the wordmark): the footer, where the column is
 *    narrow and tall.
 *  - `icon` (the mark alone): the browser favicon and the phone header, where
 *    anything wider than the mark steals room from the actions.
 *
 * RATIO
 *
 * Every image is sized by height and given the width its own aspect ratio calls
 * for, so it scales without stretching and reserves its space before it loads.
 */

export type LockupVariant = 'horizontal' | 'stacked' | 'icon';

const LOGOS: Record<LockupVariant, { src: string; width: number; height: number }> = {
  horizontal: { src: '/brand/autodine-horizontal.png', width: 480, height: 109 },
  stacked: { src: '/brand/autodine-stacked.png', width: 260, height: 197 },
  icon: { src: '/brand/autodine-icon.png', width: 320, height: 259 },
};

/** The mark alone, for tight spots and loading moments. */
export function BrandMark({
  size = 28,
  className,
  priority = false,
}: {
  /** Height in px; the width follows the artwork's own ratio. */
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  const logo = LOGOS.icon;

  return (
    <img
      src={logo.src}
      alt="AutoDine"
      width={Math.round((size * logo.width) / logo.height)}
      height={size}
      className={className}
      style={{ height: size, width: 'auto' }}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

/** Mark plus wordmark, for places with room for both. */
export function BrandLockup({
  variant = 'horizontal',
  height = 30,
  className,
  priority = false,
}: {
  variant?: LockupVariant;
  /** Height in px; the width follows the artwork's own ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const logo = LOGOS[variant];

  return (
    <img
      src={logo.src}
      alt="AutoDine"
      width={Math.round((height * logo.width) / logo.height)}
      height={height}
      className={className}
      style={{ height, width: 'auto' }}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}
