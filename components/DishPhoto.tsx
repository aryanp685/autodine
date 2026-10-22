import Image from 'next/image';

/**
 * A dish photograph, or a tile that says there is not one.
 *
 * WHY THERE IS A FALLBACK AT ALL
 *
 * A menu without a photo for a dish is normal -- a small kitchen photographs
 * the new special when it can. What is not normal is the hole the layout used
 * to leave: a blank grey box the height of a thumbnail, which reads as a
 * broken image rather than as a dish that has not been photographed yet.
 *
 * So the fallback is drawn, not empty: the dish's initials on the same warm
 * paper tone, inside the same rounded square. It reads as a deliberate tile,
 * it keeps the row's rhythm, and it tells the guest nothing false.
 *
 * WHY `unoptimized` IS NOT SET
 *
 * next/image optimises and serves WebP at the rendered size, which is the
 * difference between 300 KB and 20 KB for a thumbnail on a phone. The remote
 * pattern in next.config allows the restaurant's own Supabase storage origin
 * as well as local files.
 */

export function DishPhoto({
  src,
  name,
  size,
  className,
  priority = false,
  sizes,
}: {
  src?: string | null;
  /** Used for the alt text and for the initials on the fallback tile. */
  name: string;
  /** The rendered edge, in px. The image is square. */
  size: number;
  className?: string;
  priority?: boolean;
  /** Passed to next/image; defaults to an exact box. */
  sizes?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  if (!src) {
    return (
      <span
        className={`dishPhoto dishPhoto--none ${className ?? ''}`.trim()}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${name} — no photograph yet`}
      >
        <span aria-hidden="true">{initials}</span>
      </span>
    );
  }

  return (
    <Image
      className={`dishPhoto ${className ?? ''}`.trim()}
      src={src}
      alt={name}
      width={size}
      height={size}
      sizes={sizes ?? `${size}px`}
      priority={priority}
    />
  );
}
