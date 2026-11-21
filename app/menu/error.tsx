'use client';

import { GuestNote, GuestNoteActions, GuestNoteCta, GuestNoteGhost, GuestNoteText } from '@/components/GuestNote';

/**
 * What a break in the ordering flow looks like to a guest.
 *
 * WHY THIS EXISTS SEPARATELY FROM app/error.tsx
 *
 * The root boundary is written for staff: it offers "Back to the dashboard",
 * which for a diner holding a phone is a link to a login page. A guest whose
 * menu failed to load has exactly two useful moves -- try the page again, or
 * open the menu they were on -- and neither of those is a dashboard.
 *
 * It also cannot promise that the guest's table session survived. It does not
 * have to: the session lives in a cookie and the menu re-checks it, so saying
 * "your cart is safe, nothing was charged" is true without knowing anything
 * else, and those are the two questions somebody mid-order actually has.
 *
 * The read that failed is almost always the database, not the page: a menu
 * screen is one query, and a dropped connection or a blink at Supabase throws
 * out of the data layer. That is why retrying is the primary action rather
 * than a page reload -- `reset()` re-renders the segment and re-runs the query.
 */
export default function MenuError({ reset }: { error: Error; reset: () => void }) {
  return (
    <GuestNote
      eyebrow="Menu unavailable"
      title="We could not open the menu"
      foot={
        <>
          Your cart is kept on this phone, so nothing you added is lost.{' '}
          <GuestNoteGhost href="/menu">Open the menu again</GuestNoteGhost>
        </>
      }
    >
      <GuestNoteText>
        The kitchen&rsquo;s system did not answer just now. Nothing has been ordered and nothing has
        been charged. Trying again usually works — if it does not, staff can take your order at the
        counter.
      </GuestNoteText>

      <GuestNoteActions>
        <GuestNoteCta onClick={() => reset()}>Try again</GuestNoteCta>
        <GuestNoteGhost href="/menu/cart">Check my order</GuestNoteGhost>
      </GuestNoteActions>
    </GuestNote>
  );
}
