import { describe, expect, it } from 'vitest';
import { escapeHtml, staffInvitationEmail } from './templates';

/**
 * The invitation email is the one letter the product sends a stranger. It must
 * carry the link, say what the link does, and never leak markup — the
 * restaurant name is user input.
 */

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<script>"x"&'y'`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });
});

describe('staffInvitationEmail', () => {
  const input = {
    restaurantName: 'Maddi <b>Central</b>',
    roleLabel: 'Kitchen',
    joinUrl: 'https://app.test/join/K7QM-3XPD-9RTW-2HNJ',
    expiresAt: '2026-11-21T10:00:00.000Z',
  };

  it('carries the link and the role in both bodies', () => {
    const mail = staffInvitationEmail(input);
    expect(mail.text).toContain(input.joinUrl);
    expect(mail.html).toContain(input.joinUrl);
    expect(mail.subject).toContain('Kitchen');
    expect(mail.text.toLowerCase()).toContain('kitchen');
  });

  it('escapes the restaurant name in HTML and strips control characters everywhere', () => {
    const mail = staffInvitationEmail(input);
    expect(mail.html).not.toContain('<b>Central</b>');
    expect(mail.html).toContain('&lt;b&gt;');
    const dirty = staffInvitationEmail({ ...input, restaurantName: 'Maddi\x00\x07  Kitchen\nDeluxe' });
    expect(dirty.text).not.toMatch(/[\x00\x07]/);
    expect(dirty.text).toContain('Maddi Kitchen Deluxe');
  });

  it('says what happens if the reader ignores the mail', () => {
    const mail = staffInvitationEmail(input);
    expect(mail.text).toMatch(/ignore/i);
    expect(mail.html).toMatch(/ignore/i);
  });

  it('degrades honestly on a bad expiry date', () => {
    const mail = staffInvitationEmail({ ...input, expiresAt: 'not-a-date' });
    expect(mail.text).toContain('soon');
  });
});
