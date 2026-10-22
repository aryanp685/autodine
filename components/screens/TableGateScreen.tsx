import Link from 'next/link';
import { GuestNote } from '@/components/GuestNote';

/**
 * Shown instead of a menu when the guest has not proved they are at a table.
 *
 * WHY A SCREEN AND NOT A 404
 *
 * This used to be no screen at all: /menu rendered the real menu for anyone
 * who opened the link, and only the table badge depended on the session. A
 * forwarded link worked, so the menu was a public web page with an ordering
 * form attached and nothing saying otherwise.
 *
 * The menu now needs a verified table, which means the ordinary case -- a
 * guest pasting a link, or opening one from a message -- has to be told
 * something true and useful. "Not found" would be a lie: the restaurant is
 * right there. It is the table that is missing.
 *
 * Three states, three sentences:
 *
 *   none         never scanned. The fix is the QR code on the table.
 *   stale        had a session, it has ended or was never for this table.
 *                Offer the code form again when we still know which card.
 *   unavailable  the database could not be asked. Not the guest's fault, and
 *                re-scanning would fail the same way, so say "try again".
 */
export type TableGateReason = 'none' | 'stale' | 'unavailable';

const COPY: Record<TableGateReason, { title: string; detail: string }> = {
  none: {
    title: 'Open this menu from your table',
    detail:
      'Scan the QR code on your table and enter the code showing inside the restaurant. That is what tells us which table the order belongs to — and it is the only way this menu opens.',
  },
  stale: {
    title: 'Your table session has ended',
    detail:
      'Sessions last about an hour so that a table cannot be ordered from after the guests have left. Scan the QR code on your table again and enter the current code to carry on.',
  },
  unavailable: {
    title: 'We could not check your table',
    detail:
      'Something on our side did not answer. Please try again in a moment, or order with staff — the kitchen is still open.',
  },
};

export function TableGateScreen({
  reason,
  verifyHref,
}: {
  reason: TableGateReason;
  /** Back to /t/<card token>, when the session still remembers which card it was. */
  verifyHref?: string | null;
}) {
  const copy = COPY[reason];

  return (
    <GuestNote
      eyebrow="Table access"
      title={copy.title}
      foot={
        <>
          Behind the counter? Your own menu lives in the{' '}
          <Link href="/dashboard/menus">dashboard</Link>.
        </>
      }
    >
      <p className="gnote__text">{copy.detail}</p>

      <div className="gnote__actions">
        {verifyHref ? (
          <Link href={verifyHref} className="gnote__cta">
            Enter the code again
          </Link>
        ) : (
          <Link href="/dashboard/menus" className="gnote__cta">
            Go to my menu
          </Link>
        )}
      </div>
    </GuestNote>
  );
}
