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

/**
 * What each dead end says, in the order a guest reads it.
 *
 * Lives here rather than beside the page so the page's <title> can read from
 * the same map as its body. The title used to be a fixed "This code did not
 * work", so a restaurant that had simply not switched ordering on still had a
 * browser tab telling the guest their code was wrong.
 */
export const QR_PROBLEM_COPY: Record<
  QrProblemReason,
  { title: string; detail: string; staffHint?: string }
> = {
  unreadable: {
    title: 'This code did not work',
    detail: 'Please ask staff for the current code for your table.',
    staffHint:
      'If this code is printed and still failing, the table may have been taken out of service or its code replaced.',
  },
  revoked: {
    title: 'This code is no longer in use',
    detail: 'Your table has a newer code. Please ask staff for the current one.',
    staffHint: 'Codes stop working when a table is reset or its QR is replaced.',
  },
  limited: {
    title: 'Too many attempts',
    detail: 'Please wait a few minutes and scan again.',
    staffHint: 'Too many wrong codes were tried from this connection.',
  },
  notserving: {
    title: 'Not taking orders right now',
    detail: 'Please order with staff.',
    staffHint: 'The restaurant or this table may be switched off for the moment.',
  },
  nomenu: {
    title: 'No menu published yet',
    detail: 'This restaurant has not published a menu. Please order with staff.',
    staffHint: 'Publish the menu from the dashboard to start taking QR orders.',
  },
  nosetup: {
    title: 'This restaurant has not switched on table codes yet',
    detail: 'Please order with staff — they can take the order at the counter.',
    staffHint:
      'Open Dashboard → Tables & QR once to create this restaurant’s verification code, then guests can scan and enter it.',
  },
  offline: {
    title: 'Ordering is not switched on',
    detail: 'This restaurant has not connected its ordering system. Please order with staff.',
  },
  failed: {
    title: 'This code did not work',
    detail: 'Please try scanning again, or order with staff.',
  },
};

export function isQrProblemReason(value: string | undefined): value is QrProblemReason {
  return typeof value === 'string' && value in QR_PROBLEM_COPY;
}
