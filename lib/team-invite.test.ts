import { describe, expect, it } from 'vitest';
import {
  encodeInviteFlash,
  expiresInWords,
  formatInviteCode,
  inviteStatusCopy,
  isWellFormedInviteCode,
  joinPath,
  normaliseInviteCode,
  parseInviteFlash,
  type InviteStatus,
} from './team-invite';

/**
 * Invitation links are copied, pasted, read aloud and typed. Every one of
 * those is an opportunity for a code to arrive in a different shape than the
 * one it was minted in -- and for the product to say "that link is invalid"
 * about a link that is perfectly good.
 */

const CODE = 'K7QM3XPD9RTW2HNJ'; // what the database mints, without dashes

describe('reading a code the way a person sends it', () => {
  it('accepts the dashes, the case and the spaces a chat app adds', () => {
    expect(normaliseInviteCode('k7qm-3xpd-9rtw-2hnj')).toBe(CODE);
    expect(normaliseInviteCode(' K7QM 3XPD 9RTW 2HNJ ')).toBe(CODE);
    expect(isWellFormedInviteCode('K7QM-3XPD-9RTW-2HNJ')).toBe(true);
    expect(isWellFormedInviteCode('k7qm 3xpd 9rtw 2hnj')).toBe(true);
  });

  it('rejects the shapes that cannot be a code, rather than guessing', () => {
    expect(isWellFormedInviteCode('K7QM-3XPD')).toBe(false);
    expect(isWellFormedInviteCode('')).toBe(false);
    expect(isWellFormedInviteCode(null)).toBe(false);
    // I, O, 0 and 1 are not in the alphabet because they are misread aloud.
    expect(isWellFormedInviteCode('I7QM3XPD9RTW2HNJ')).toBe(false);
    expect(isWellFormedInviteCode('07QM3XPD9RTW2HNJ')).toBe(false);
  });

  it('groups the code in fours for reading down a phone', () => {
    expect(formatInviteCode(CODE)).toBe('K7QM-3XPD-9RTW-2HNJ');
    expect(formatInviteCode('K7QM-')).toBe('K7QM');
  });

  it('builds one canonical link whatever the code arrived as', () => {
    expect(joinPath('k7qm3xpd9rtw2hnj')).toBe('/join/K7QM-3XPD-9RTW-2HNJ');
    expect(joinPath('K7QM-3XPD-9RTW-2HNJ')).toBe('/join/K7QM-3XPD-9RTW-2HNJ');
  });
});

describe('the flash cookie that carries a new link', () => {
  const flash = {
    code: CODE,
    role: 'kitchen' as const,
    expiresAt: '2026-11-02T10:00:00.000Z',
  };

  it('round-trips', () => {
    expect(parseInviteFlash(encodeInviteFlash(flash))).toEqual(flash);
  });

  it('refuses anything it cannot draw honestly', () => {
    expect(parseInviteFlash(null)).toBeNull();
    expect(parseInviteFlash('not json')).toBeNull();
    expect(parseInviteFlash('{}')).toBeNull();
    // An owner invitation does not exist, so a cookie claiming one is a lie.
    expect(parseInviteFlash(JSON.stringify({ ...flash, role: 'owner' }))).toBeNull();
    expect(parseInviteFlash(JSON.stringify({ ...flash, code: 'SHORT' }))).toBeNull();
    expect(parseInviteFlash(JSON.stringify({ ...flash, expiresAt: 'soon' }))).toBeNull();
  });

  it('normalises the code it was given', () => {
    const parsed = parseInviteFlash(JSON.stringify({ ...flash, code: 'k7qm-3xpd-9rtw-2hnj' }));
    expect(parsed?.code).toBe(CODE);
  });
});

describe('what an invitation status means', () => {
  const statuses: InviteStatus[] = [
    'ok',
    'already_member',
    'used',
    'expired',
    'revoked',
    'closed',
    'not_found',
  ];

  it('has a sentence for every status the database can return', () => {
    for (const status of statuses) {
      const copy = inviteStatusCopy(status);
      expect(copy.title.length, status).toBeGreaterThan(8);
      expect(copy.body.length, status).toBeGreaterThan(20);
    }
  });

  it('asks for a new link exactly when a new link is the answer', () => {
    expect(inviteStatusCopy('used').askForNewLink).toBe(true);
    expect(inviteStatusCopy('expired').askForNewLink).toBe(true);
    expect(inviteStatusCopy('revoked').askForNewLink).toBe(true);
    // Retrying the same link cannot fix "you are already in" or a closed venue.
    expect(inviteStatusCopy('already_member').askForNewLink).toBe(false);
    expect(inviteStatusCopy('ok').askForNewLink).toBe(false);
  });

  it('never says a used link still works', () => {
    expect(inviteStatusCopy('used').title).toMatch(/already been used/i);
    expect(inviteStatusCopy('used').body).toMatch(/once/i);
  });
});

describe('how long a link has left, in words', () => {
  const now = new Date('2026-10-26T10:00:00.000Z').getTime();

  it('counts up from a timestamp', () => {
    expect(expiresInWords('2026-10-26T10:30:00.000Z', now)).toBe('in under an hour');
    expect(expiresInWords('2026-10-26T13:00:00.000Z', now)).toBe('in 3 hours');
    expect(expiresInWords('2026-11-02T10:00:00.000Z', now)).toBe('in 7 days');
  });

  it('says "expired" rather than a negative number', () => {
    expect(expiresInWords('2026-10-25T10:00:00.000Z', now)).toBe('expired');
  });

  it('does not invent a duration for a value it cannot read', () => {
    expect(expiresInWords('not a date', now)).toBe('soon');
  });
});
