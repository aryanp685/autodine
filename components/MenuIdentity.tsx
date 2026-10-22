import Image from 'next/image';

/**
 * The top of the guest menu: who is cooking.
 *
 * TWO STATES, ONE COMPONENT
 *
 * A restaurant that uploaded a banner gets the photographic header. A
 * restaurant that uploaded nothing gets the paper header -- a ringed monogram,
 * the name, one line of place. Both are finished designs. Neither leaves a
 * hole where the other would have been, which is the requirement: a missing
 * logo must not read as a broken image, and an optional banner must not leave
 * an empty rectangle above every dish.
 *
 * WHY THE MONOGRAM IS DRAWN AND NOT AN ICON
 *
 * The initials come from the restaurant's own name, so the header is still
 * specific to them on the very first day, before any photo exists. DishPhoto
 * makes the same choice per dish, so the two fallbacks look related rather
 * than like two different products' placeholders.
 */

export type MenuIdentityProps = {
  name: string;
  /** Tagline and/or area. Either may be absent; the line is omitted if both are. */
  tagline?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  /** A verified table label, only when a live session actually says one. */
  tableLabel?: string | null;
};

/** First letters of up to two words. Never empty: falls back to one letter. */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  const picked = words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return picked || name.trim().slice(0, 1).toUpperCase() || 'A';
}

/**
 * Tagline and area, squeezed onto one short line.
 *
 * The address is a long string ("12 Baner Road, Near the temple, Pune
 * 411045") and the header is not the place for it. Only the last comma-separated
 * segment, which is normally the city or the neighbourhood, is used -- and only
 * when it is short enough to sit under a name without wrapping on a 360px
 * phone.
 */
function placeLine(tagline?: string | null, address?: string | null): string {
  const parts: string[] = [];
  const cleanTagline = tagline?.trim();
  if (cleanTagline) parts.push(cleanTagline);

  const segments = (address ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const area = segments.length > 1 ? segments[segments.length - 1] : '';
  if (area && area.length <= 28) parts.push(area.toUpperCase());

  const line = parts.join(' · ');
  return line.length > 64 ? `${line.slice(0, 63).trimEnd()}…` : line;
}

export function MenuIdentity({
  name,
  tagline,
  address,
  logoUrl,
  bannerUrl,
  tableLabel,
}: MenuIdentityProps) {
  const line = placeLine(tagline, address);
  const monogram = initialsOf(name);

  if (bannerUrl) {
    return (
      <header className="ident ident--banner">
        <div className="ident__banner">
          {/* Sized by CSS, not by the intrinsic image: a portrait phone photo
              used as a banner would otherwise be taller than the menu. */}
          <Image
            src={bannerUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 760px) 100vw, 880px"
            className="ident__bannerImg"
          />
          <div className="ident__scrim" aria-hidden="true" />
        </div>

        <div className="ident__badge">
          {logoUrl ? (
            <Image src={logoUrl} alt="" width={64} height={64} className="ident__logo" />
          ) : (
            <span className="ident__monogram ident__monogram--onBanner" aria-hidden="true">
              {monogram}
            </span>
          )}
        </div>

        <div className="ident__text ident__text--onBanner">
          <h1 className="ident__name">{name}</h1>
          {line && <div className="ident__line">{line}</div>}
        </div>

        {tableLabel && <TableChip label={tableLabel} />}
      </header>
    );
  }

  return (
    <header className="ident ident--paper">
      <div className="ident__paperTop">
        <div className="ident__ring">
          {logoUrl ? (
            <Image src={logoUrl} alt="" width={56} height={56} className="ident__logo ident__logo--onPaper" />
          ) : (
            <span className="ident__monogram" aria-hidden="true">
              {monogram}
            </span>
          )}
        </div>
        <h1 className="ident__name ident__name--paper">{name}</h1>
        {line && <div className="ident__line ident__line--paper">{line}</div>}
      </div>

      {tableLabel && <TableChip label={tableLabel} />}
    </header>
  );
}

/**
 * Which table this browser is at.
 *
 * Only ever rendered from a live, verified session -- never from a guess. See
 * the note on MenuScreenTable: this badge used to say "Table 7" to everyone.
 */
function TableChip({ label }: { label: string }) {
  return (
    <div className="ident__table">
      <span className="ident__tableDot" aria-hidden="true" />
      {label}
    </div>
  );
}
