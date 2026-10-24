import Link from 'next/link';
import { GuestNote, GuestNoteAlert, GuestNoteText } from '@/components/GuestNote';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';
import { WhereToFindCode } from '@/components/WhereToFindCode';

/**
 * The step that turns a scanned card into an order.
 *
 * The menu itself no longer waits on this screen: a scan puts the guest in
 * front of the food straight away, and the six digits are asked for once, when
 * they place the order (the card page still offers this form for a guest who
 * wants to unlock their table before they start).
 *
 * WHY THIS SCREEN EXISTS
 *
 * A QR code on a table can be photographed, forwarded on WhatsApp, or printed
 * onto a card at some other table. Until now a scan was the whole check, so
 * the photograph ordered from anywhere. The card proves somebody has SEEN the
 * table. What it cannot prove is that they are at it.
 *
 * So the guest types the six digits showing on a screen inside the
 * restaurant. That is the one thing a person outside the room cannot get
 * without asking somebody inside to read it out -- and the digits change every
 * ten minutes, so a code passed along a phone is usually dead on arrival.
 *
 * WHY IT IS NOT A DEAD END
 *
 * Every failure that the guest can fix lands back on this form with one
 * sentence saying what went wrong: a mistyped digit, or too many tries. Only
 * the failures they cannot fix -- a card taken out of service, a kitchen not
 * taking orders -- go to /t/problem, which tells them to ask staff. Sending
 * somebody back to a form they cannot complete is worse than saying stop.
 *
 * The token travels as a hidden field rather than in the form's action URL,
 * so it is posted in the body rather than handed to logs and history twice.
 */
export type TableVerifyScreenProps = {
  /** The card's public token, from /t/<token>. Not a secret: it is printed. */
  token: string;
  restaurantName: string;
  tableLabel: string;
  /** How often the code rolls, for the "changes every N minutes" sentence. */
  windowMinutes: number;
  /** One sentence, already mapped from a closed set. Never a database message. */
  error?: string;
  /** Where to go once the code is accepted: a path this app knows. */
  next?: string;
  /**
   * What the form is FOR. The card page opens the menu; the checkout places
   * the order. The button says which, because a guest who taps "Open the menu"
   * at a payment step is being told the wrong thing about what just happened.
   */
  cta?: string;
};

export function TableVerifyScreen({
  token,
  restaurantName,
  tableLabel,
  windowMinutes,
  error,
  next,
  cta,
}: TableVerifyScreenProps) {
  return (
    <GuestNote
      eyebrow={`Table ${tableLabel} · ${restaurantName}`}
      title="Enter the code in the restaurant"
      steps="code"
      foot={
        <>
          Not at table {tableLabel}? Scan the QR code on your own table.{' '}
          <Link href="/">What is AutoDine?</Link>
        </>
      }
    >
      <GuestNoteText>
        Type the six-digit code showing inside {restaurantName} to order at table {tableLabel}. It
        is not printed on the table and nobody will ask you for it — it is on a screen in the
        restaurant, so it can change every few minutes.
      </GuestNoteText>

      {error ? <GuestNoteAlert title="That did not work.">{error}</GuestNoteAlert> : null}

      <WhereToFindCode windowMinutes={windowMinutes} variant="panel" />

      {/* A client component, because the sixth digit submits the form.
          See components/VerifyCodeForm.tsx for the reasons. */}
      <VerifyCodeForm token={token} windowMinutes={windowMinutes} next={next} cta={cta} />
    </GuestNote>
  );
}
