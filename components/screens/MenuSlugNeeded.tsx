import Link from 'next/link';

/**
 * Shown when /menu is opened without ?s=<slug>.
 *
 * A diner reaches a menu from the QR code on their table, and that code names
 * the restaurant. Opened bare there is no restaurant to show -- not one that
 * failed to load, just none that was asked for.
 *
 * A bare 404 reads as a broken site. This says what is actually true: the link
 * needs to come from a table. It is deliberately not the sample menu either --
 * showing fictional dishes here would look like the restaurant's real menu.
 */
export function MenuSlugNeeded() {
  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
      </div>

      <div className="pg__slugNeeded">
        <h1>Open this menu from your table</h1>
        <p>
          Scan the QR code on your table and it will bring you straight to this
          restaurant&rsquo;s menu. The code tells us which kitchen you are sitting in,
          so the link works only from there.
        </p>
        <p className="pg__slugNeededHint">
          Behind the counter? Your own menu lives in the dashboard.
        </p>
        <Link href="/dashboard/menus" className="pg__btn pg__btn--solid">
          Go to my menu
        </Link>
      </div>
    </div>
  );
}
