/**
 * The small, testable pieces of staff invitations.
 *
 * WHY A MODULE AND NOT SIX INLINE STRINGS
 *
 * The same few facts are needed in three places -- the Settings card that
 * mints a link, the page that opens it, and the action that redeems it -- and
 * each of them has to agree about what a code looks like, what a link is, and
 * what "this invitation has already been used" means in words. Keeping them
 * here means the screen and the server cannot drift, and it means the copy can
 * be tested without a browser or a database.
 *
 * NOTHING HERE IS A SECRET. The code is a secret; this file only formats it.
 */

import type { MemberRole } from './db/database';

/**
 * Where a freshly minted code is carried from the action to the screen.
 *
 * NOT the query string. A code in a URL is written to the proxy's access log,
 * to the browser's history, and to the Referer of every third-party request
 * the page makes -- three copies of a working invitation to a restaurant's
 * staff area. A short-lived httpOnly cookie is read once, by the page that
 * draws it, and expires in minutes.
 */
export const INVITE_FLASH_COOKIE = 'ad_team_invite';

/** Ten minutes: long enough to copy, short enough not to linger on a shared tablet. */
export const INVITE_FLASH_SECONDS = 600;

/** Invitations are 16 alphanumerics, shown in groups of four. */
const CODE_LENGTH = 16;

export type InviteFlash = {
  code: string;
  role: Exclude<MemberRole, 'owner'>;
  expiresAt: string;
};

/** `abcd-efgh` and `ABCDEFGH` are the same code; a paste or a re-type is not an error. */
export function normaliseInviteCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isWellFormedInviteCode(raw: string | null | undefined): boolean {
  return new RegExp(`^[A-HJ-NP-Z2-9]{${CODE_LENGTH}}$`).test(normaliseInviteCode(raw));
}

/** Groups of four, for reading aloud. Never used as the stored form. */
export function formatInviteCode(raw: string | null | undefined): string {
  const code = normaliseInviteCode(raw);
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** `/join/ABCD-EFGH-...`: the code is normalised, so a code pasted in any case works. */
export function joinPath(raw: string): string {
  return `/join/${encodeURIComponent(formatInviteCode(raw))}`;
}

export function encodeInviteFlash(flash: InviteFlash): string {
  return JSON.stringify(flash);
}

/**
 * Parse the cookie. Anything unexpected is null rather than a partial object:
 * a half-read flash would render a broken link, and a broken invite link that
 * looks real is worse than no card at all.
 */
export function parseInviteFlash(raw: string | null | undefined): InviteFlash | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const role = candidate.role;
  const expiresAt = typeof candidate.expiresAt === 'string' ? candidate.expiresAt : '';
  if (!isWellFormedInviteCode(code)) return null;
  if (role !== 'manager' && role !== 'cashier' && role !== 'kitchen') return null;
  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) return null;
  return { code: normaliseInviteCode(code), role, expiresAt };
}

/** What an invitation status means, in the words the person holding it needs. */
export type InviteStatus = 'ok' | 'already_member' | 'used' | 'expired' | 'revoked' | 'closed' | 'not_found';

export function inviteStatusCopy(status: InviteStatus): {
  tone: 'accent' | 'due' | 'plain';
  title: string;
  body: string;
  /** True when the person should look for a new link rather than try again. */
  askForNewLink: boolean;
} {
  switch (status) {
    case 'used':
      return {
        tone: 'due',
        title: 'This invitation has already been used',
        body: 'Each link works once. If you should have access, ask the owner to send a new one.',
        askForNewLink: true,
      };
    case 'expired':
      return {
        tone: 'due',
        title: 'This invitation has expired',
        body: 'Invitations are time-limited. Ask the owner for a fresh link — they take a moment to create.',
        askForNewLink: true,
      };
    case 'revoked':
      return {
        tone: 'due',
        title: 'This invitation was cancelled',
        body: 'The owner withdrew this link. Ask them to send a new one if you should still join.',
        askForNewLink: true,
      };
    case 'closed':
      return {
        tone: 'due',
        title: 'This restaurant is not taking staff right now',
        body: 'The restaurant is paused. Try the link again later, or ask the owner.',
        askForNewLink: false,
      };
    case 'not_found':
      return {
        tone: 'plain',
        title: 'That invitation does not exist',
        body: 'The link may have been copied incompletely. Ask the owner to send it again.',
        askForNewLink: true,
      };
    case 'already_member':
      return {
        tone: 'accent',
        title: 'You are already on this team',
        body: 'Nothing changed, and the invitation is still unused — it can go to a colleague.',
        askForNewLink: false,
      };
    case 'ok':
    default:
      return {
        tone: 'accent',
        title: 'You are in',
        body: 'Your access starts now. Open your screen from the navigation.',
        askForNewLink: false,
      };
  }
}

/** "7 days", "1 day", "3 hours" — for the Settings card, never a raw timestamp. */
export function expiresInWords(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return 'soon';
  if (ms <= 0) return 'expired';
  // Under the hour the answer is "under an hour", not "in 1 hour": rounding a
  // 30-minute link up would tell somebody it has longer than it does.
  if (ms < 3_600_000) return 'in under an hour';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}
