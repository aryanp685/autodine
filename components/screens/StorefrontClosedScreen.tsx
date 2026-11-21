import Link from 'next/link';
import { GuestNote, GuestNoteActions, GuestNoteGhost, GuestNoteText } from '@/components/GuestNote';

/**
 * The storefront is closed.
 *
 * `restaurants.is_active` off has always meant "not taking orders" — the order
 * gate refuses it and the table scan says so — but a guest on the storefront
 * itself was shown a 404 or a "scan the table" gate, which reads as a broken
 * link rather than a closed shop. This is the honest answer, in the same words
 * the scan problem screen already uses ("Not taking orders right now"): the
 * place is closed, staff can still take the order, and the announcement —
 * "closed for Diwali" — can say why.
 *
 * Orders already placed are looked after: the kitchen and the counter never
 * read this flag, and a guest who wants their bill or their order status is
 * not locked out by it.
 */
export function StorefrontClosedScreen({
  name,
  announcement,
}: {
  name: string;
  /** The owner's announcement, when one is on — often the reason. */
  announcement?: string | null;
}) {
  return (
    <GuestNote
      eyebrow={name || 'This restaurant'}
      title="Not taking orders right now"
      foot={
        <>
          Behind the counter? Reopen the storefront in{' '}
          <Link href="/dashboard/branding">Branding</Link>.
        </>
      }
    >
      {announcement ? <GuestNoteText>{announcement}</GuestNoteText> : null}
      <GuestNoteText>
        {name || 'This restaurant'} has closed the storefront for now, so no new orders can be
        placed. Please order with staff — they can take the order at the counter. An order you
        already placed is still being looked after.
      </GuestNoteText>

      <GuestNoteActions>
        <GuestNoteGhost href="/demo/menu">See what a menu looks like</GuestNoteGhost>
      </GuestNoteActions>
    </GuestNote>
  );
}
