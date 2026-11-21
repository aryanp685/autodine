import Link from 'next/link';
import { GuestNote, GuestNoteActions, GuestNoteGhost, GuestNoteText } from '@/components/GuestNote';

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
      <GuestNoteText>
        Scan the QR code on your table and it will bring you straight to this restaurant&rsquo;s
        menu. The QR code is what names the restaurant, so a bare link has nothing to open.
      </GuestNoteText>

      {/* One quiet action. There is nothing else a guest can do from here --
          the menu opens from a card and from nowhere else -- and a primary
          button pointing at a staff dashboard was the wrong thing to offer
          the person holding the phone. */}
      <GuestNoteActions>
        <GuestNoteGhost href="/demo/menu">See what a menu looks like</GuestNoteGhost>
      </GuestNoteActions>
    </GuestNote>
  );
}
