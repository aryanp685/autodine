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
      <header className="relative">
        <div className="relative h-[188px] w-full overflow-hidden rounded-b-[22px] bg-gink-12">
          {/* Sized by the frame, not by the intrinsic image: a portrait phone
              photo used as a banner would otherwise be taller than the menu. */}
          <Image
            src={bannerUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 760px) 100vw, 720px"
            className="object-cover"
          />
          {/* The scrim is what makes white type on an unknown photograph
              readable. It is a gradient to transparent rather than a flat veil,
              so the top of the picture keeps its colour and only the text
              corner is darkened. */}
          <div
            className="absolute inset-0 bg-linear-to-t from-[rgb(12_11_9/0.82)] via-[rgb(12_11_9/0.24)] to-transparent"
            aria-hidden="true"
          />
        </div>

        {/* The name sits ON the photograph, over the dark end of the scrim.
            Putting it under the banner instead would have meant white type on
            paper -- the one place in this flow where that is unreadable. */}
        <div className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[720px] items-end gap-3 px-4 pb-4">
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-paper shadow-g1 ring-1 ring-white/50">
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={44} height={44} className="size-11 object-cover" />
            ) : (
              <span aria-hidden="true" className="text-[14px] font-semibold tracking-[0.02em] text-[var(--p-accent)]">
                {monogram}
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] leading-tight font-semibold tracking-[-0.02em] text-white">
              {name}
            </h1>
            {line && <div className="mt-0.5 truncate text-[11px] tracking-[0.05em] text-white/72">{line}</div>}
          </div>

          {tableLabel && <TableChip label={tableLabel} onPhoto />}
        </div>
      </header>
    );
  }

  /* The paper header: a ringed monogram, the name, one line of place. It is a
     finished design, not the absence of one -- the ring is the same geometry as
     the brand mark, so a restaurant with no photograph still gets something
     that looks drawn for it. */
  return (
    /* The restaurant, as a card. It is the first thing on the screen and the
       only place the guest is told where they are -- so it gets the flow's
       panel treatment rather than floating loose on the wash, which made the
       name look like a heading that had lost its page. */
    <header className="px-4 pt-4 pb-1">
      <div data-venue-card="" className="g-card mx-auto w-full max-w-[720px] p-3.5">
        <div className="flex items-center gap-3.5">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-[var(--p-accent)]/25">
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={48} height={48} className="size-12 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="text-[15px] font-semibold tracking-[0.02em] text-[var(--p-accent)]">
                {monogram}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.025em] text-gink">
              {name}
            </h1>
            {line && (
              <div className="mt-1 truncate text-[10.5px] font-medium tracking-[0.11em] text-gink-46 uppercase">
                {line}
              </div>
            )}
          </div>

          {tableLabel && <TableChip label={tableLabel} />}
        </div>
      </div>
    </header>
  );
}

/**
 * Which table this browser is at.
 *
 * Only ever rendered from a live, verified session -- never from a guess. See
 * the note on MenuScreenTable: this badge used to say "Table 7" to everyone.
 */
function TableChip({ label, onPhoto }: { label: string; onPhoto?: boolean }) {
  return (
    <div
      data-table-chip=""
      className={[
        'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold tracking-[0.07em] uppercase',
        /* On a photograph the chip has to survive whatever was uploaded, so it
           is a frosted white pill with dark type rather than a paper-coloured
           one that might be the same value as the banner behind it. */
        onPhoto
          ? 'bg-white/18 text-white backdrop-blur-md ring-1 ring-white/30'
          : 'bg-[var(--p-accent-soft)] text-[var(--p-accent)] ring-1 ring-[var(--p-accent)]/18',
      ].join(' ')}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </div>
  );
}
