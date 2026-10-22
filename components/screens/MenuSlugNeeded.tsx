import Link from 'next/link';
import { GuestNote } from '@/components/GuestNote';

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
    <GuestNote
      eyebrow="Table access"
      title="Open this menu from your table"
      foot={
        <>
          Behind the counter? Your own menu lives in the{' '}
          <Link href="/dashboard/menus">dashboard</Link>.
        </>
      }
    >
      <p className="gnote__text">
        Scan the QR code on your table and it will bring you straight to this restaurant&rsquo;s
        menu. The code tells us which kitchen you are sitting in, so the link works only from
        there.
      </p>

      <div className="gnote__actions">
        <Link href="/dashboard/menus" className="gnote__cta">
          Go to my menu
        </Link>
      </div>
    </GuestNote>
  );
}
