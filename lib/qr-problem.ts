/**
 * Reason codes for anything a guest can hit between scanning a card and
 * ordering a dish.
 *
 * WHY A FIXED LIST
 *
 * The moment a string reaches a URL or a page by reflection, caller-influenced
 * text is on a page -- which is how a reflected error becomes something worse.
 * The verification RPC therefore returns a status WORD rather than a message
 * (it used to raise, which also rolled back its own rate-limit write), and
 * every sentence a guest reads is written here.
 *
 * A status this file does not recognise becomes 'failed'. A new status added
 * by a later migration degrades to one fixed sentence instead of putting a
 * word like "nosuchthing" on a guest's screen.
 */

/** Where a scan dead-ends: /t/problem?r=<code>. */
export type QrProblemReason =
  | 'unreadable' // not a table's card at all
  | 'revoked' // the card, table or session was taken out of service
  | 'limited' // rate limited
  | 'notserving' // restaurant or table switched off
  | 'nomenu' // nothing published
  | 'nosetup' // the restaurant has no verification code yet
  | 'offline' // Supabase env missing
  | 'failed'; // ours

/** Failures shown inline on the verification screen: /t/<token>?e=<code>. */
export type VerifyErrorReason = 'wrong' | 'rotated' | 'limited' | 'failed';

const VERIFY_ERRORS: Record<VerifyErrorReason, string> = {
  wrong: 'That code is not correct. Check the screen inside the restaurant and try again.',
  rotated:
    'That code is not correct — and there have been too many wrong attempts, so a new code is showing inside the restaurant now. Please read the screen again.',
  limited: 'Too many attempts. Please wait a couple of minutes and try again.',
  failed: 'We could not check that code. Please try again.',
};

/**
 * The status words verify_table_qr_with_code returns, mapped to a page.
 *
 * This is the only place those words are interpreted. A word this file has not
 * heard of becomes 'failed' rather than being rendered, so adding a status in
 * a later migration degrades to a fixed sentence instead of leaking a token
 * like "nosuchthing" onto a guest's screen.
 */
export function qrProblemReasonForStatus(status: string): QrProblemReason {
  switch (status) {
    case 'unreadable':
      return 'unreadable';
    case 'revoked':
      return 'revoked';
    case 'notserving':
      return 'notserving';
    case 'nomenu':
      return 'nomenu';
    case 'nosetup':
      return 'nosetup';
    case 'limited':
      return 'limited';
    default:
      return 'failed';
  }
}

export function isVerifyErrorReason(value: string | undefined): value is VerifyErrorReason {
  return (
    value === 'wrong' || value === 'rotated' || value === 'limited' || value === 'failed'
  );
}

export function verifyErrorText(reason: VerifyErrorReason): string {
  return VERIFY_ERRORS[reason];
}
