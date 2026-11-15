import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmailProvider, isValidRecipient, sendEmail } from './provider';

/**
 * The provider boundary is where "the email was sent" must either be true or
 * not claimed at all. These tests pin the decision table: which environment
 * activates the provider, what happens on a provider failure, and what the
 * caller is told. No network is touched — `fetch` is stubbed.
 */

const RESEND_ENV = { RESEND_API_KEY: 're_testkey1234567', AUTODINE_EMAIL_FROM: 'Maddi <hello@example.com>' };

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isValidRecipient', () => {
  it('accepts a plain address and rejects junk', () => {
    expect(isValidRecipient('cook@example.com')).toBe(true);
    expect(isValidRecipient(' cook@example.com ')).toBe(true);
    for (const bad of ['', 'nope', 'a@', '@b.com', 'a b@c.com', 'a@b', '<a@b.com>', 42, null, undefined]) {
      expect(isValidRecipient(bad)).toBe(false);
    }
  });
});

describe('getEmailProvider', () => {
  it('is null when either value is missing or malformed', () => {
    expect(getEmailProvider({})).toBeNull();
    expect(getEmailProvider({ RESEND_API_KEY: 're_testkey1234567' })).toBeNull();
    expect(getEmailProvider({ AUTODINE_EMAIL_FROM: 'Maddi <hello@example.com>' })).toBeNull();
    expect(getEmailProvider({ ...RESEND_ENV, RESEND_API_KEY: 'not-a-resend-key' })).toBeNull();
    expect(getEmailProvider({ ...RESEND_ENV, AUTODINE_EMAIL_FROM: 'not an address' })).toBeNull();
  });

  it('activates with both values set', () => {
    expect(getEmailProvider(RESEND_ENV)?.name).toBe('resend');
  });
});

describe('sendEmail', () => {
  const message = { to: 'cook@example.com', subject: 'Hi', text: 'plain', html: '<p>plain</p>' };

  it('does not touch the network without a provider and says so', async () => {
    const result = await sendEmail('staff_invitation', message, {});
    expect(result.outcome).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an invalid recipient before any call', async () => {
    const result = await sendEmail('staff_invitation', { ...message, to: 'nope' }, RESEND_ENV);
    expect(result.outcome).toBe('invalid_recipient');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports delivered only when the provider accepted the message', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await sendEmail('staff_invitation', message, RESEND_ENV);
    expect(result).toMatchObject({ outcome: 'delivered', provider: 'resend', attempts: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer re_testkey1234567' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(['cook@example.com']);
  });

  it('retries a failing provider and reports failure honestly', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const result = await sendEmail('staff_invitation', message, RESEND_ENV);
    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it('treats a network throw as failure, not as an exception', async () => {
    fetchMock.mockRejectedValue(new Error('dns'));
    const result = await sendEmail('staff_invitation', message, RESEND_ENV);
    expect(result.outcome).toBe('failed');
  }, 15000);
});
