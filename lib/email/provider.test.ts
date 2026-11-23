import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmailProvider, isValidRecipient, parseEmailSender, sendEmail } from './provider';

/**
 * The provider boundary is where "the email was sent" must either be true or
 * not claimed at all. These tests pin the decision table: which environment
 * activates Brevo (and only Brevo), what happens on a provider failure, and
 * what the caller is told. No network is touched — `fetch` is stubbed.
 */

const BREVO_ENV = {
  AUTODINE_EMAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'xkeysib-testkey1234567890',
  AUTODINE_EMAIL_FROM: 'AutoDine <hello@example.com>',
};

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

describe('parseEmailSender', () => {
  it('parses bare and named sender identities into Brevo sender shape', () => {
    expect(parseEmailSender('hello@example.com')).toEqual({ email: 'hello@example.com' });
    expect(parseEmailSender('AutoDine <hello@example.com>')).toEqual({
      email: 'hello@example.com',
      name: 'AutoDine',
    });
    expect(parseEmailSender('not an address')).toBeNull();
    expect(parseEmailSender('<hello@example.com>')).toBeNull();
    expect(parseEmailSender(42)).toBeNull();
  });
});

describe('getEmailProvider', () => {
  it('is null when either value is missing or malformed', () => {
    expect(getEmailProvider({})).toBeNull();
    expect(getEmailProvider({ BREVO_API_KEY: 'xkeysib-testkey1234567890' })).toBeNull();
    expect(getEmailProvider({ AUTODINE_EMAIL_FROM: 'AutoDine <hello@example.com>' })).toBeNull();
    expect(getEmailProvider({ ...BREVO_ENV, BREVO_API_KEY: 'not-a-brevo-key' })).toBeNull();
    expect(getEmailProvider({ ...BREVO_ENV, AUTODINE_EMAIL_FROM: 'not an address' })).toBeNull();
  });

  it('ignores another provider’s leftover credentials instead of sending through it', () => {
    expect(
      getEmailProvider({ RESEND_API_KEY: 're_testkey1234567', AUTODINE_EMAIL_FROM: 'AutoDine <hello@example.com>' }),
    ).toBeNull();
    expect(getEmailProvider({ ...BREVO_ENV, AUTODINE_EMAIL_PROVIDER: 'resend' })).toBeNull();
  });

  it('activates Brevo with both values set, named or bare sender', () => {
    const named = getEmailProvider(BREVO_ENV);
    expect(named?.name).toBe('brevo');
    expect(named?.sender).toEqual({ email: 'hello@example.com', name: 'AutoDine' });
    const bare = getEmailProvider({ ...BREVO_ENV, AUTODINE_EMAIL_FROM: 'hello@example.com' });
    expect(bare?.sender).toEqual({ email: 'hello@example.com' });
  });

  it('reply-to is optional, parsed like the sender, and fails closed when malformed', () => {
    expect(getEmailProvider(BREVO_ENV)?.replyTo).toBeNull();
    expect(
      getEmailProvider({ ...BREVO_ENV, AUTODINE_EMAIL_REPLY_TO: 'Support <help@example.com>' })?.replyTo,
    ).toEqual({ email: 'help@example.com', name: 'Support' });
    expect(getEmailProvider({ ...BREVO_ENV, AUTODINE_EMAIL_REPLY_TO: 'not an address' })).toBeNull();
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
    const result = await sendEmail('staff_invitation', { ...message, to: 'nope' }, BREVO_ENV);
    expect(result.outcome).toBe('invalid_recipient');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports delivered only when Brevo accepted the message, with Brevo’s request shape', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201 });
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result).toMatchObject({ outcome: 'delivered', provider: 'brevo', attempts: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.brevo.com/v3/smtp/email');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers).toMatchObject({ 'api-key': 'xkeysib-testkey1234567890', 'content-type': 'application/json' });
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sender).toEqual({ email: 'hello@example.com', name: 'AutoDine' });
    expect(body.to).toEqual([{ email: 'cook@example.com' }]);
    expect(body.subject).toBe('Hi');
    expect(body.textContent).toBe('plain');
    expect(body.htmlContent).toBe('<p>plain</p>');
    expect(body.tags).toEqual(['autodine_staff_invitation']);
    expect(body.headers.idempotencyKey).toBeTruthy();
    expect(body.replyTo).toBeUndefined();
  });

  it('sends the configured reply-to identity when one is set', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201 });
    const result = await sendEmail(
      'staff_invitation',
      message,
      { ...BREVO_ENV, AUTODINE_EMAIL_REPLY_TO: 'Support <help@example.com>' },
    );
    expect(result.outcome).toBe('delivered');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.replyTo).toEqual({ email: 'help@example.com', name: 'Support' });
  });

  it('retries a failing provider and reports failure honestly', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it('does not retry a permanent 4xx (bad key/unverified sender): one call, honest failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15000);

  it('retries 429 rate-limit/quota responses like a transient failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result.outcome).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it('treats a network throw (timeout/connection drop) as failure, not as an exception', async () => {
    fetchMock.mockRejectedValue(new Error('dns'));
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(3);
  }, 15000);

  it('sends one idempotency key per logical send, stable across its retries', async () => {
    // Two transient failures then acceptance: all three attempts are the
    // SAME send, so Brevo must be able to collapse them into one delivery
    // via the key in the request body's headers.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result.outcome).toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const keys = fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).headers.idempotencyKey as string,
    );
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);

    // A separate sendEmail call is a separate logical send: a fresh key, so
    // two intentional invitations to the same person are never collapsed.
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201 });
    const again = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(again.outcome).toBe('delivered');
    const secondKey = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).headers.idempotencyKey;
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(keys[0]);
  }, 15000);

  it('treats Brevo’s duplicate_parameter answer on a retry as the original send accepted', async () => {
    // The first attempt's response was lost after Brevo processed it; the
    // retry with the same key is refused as a duplicate. That is one
    // delivered email, not a failure and never a second send.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: 'duplicate_parameter', message: 'already processed' }),
      });
    const result = await sendEmail('staff_invitation', message, BREVO_ENV);
    expect(result).toMatchObject({ outcome: 'delivered', provider: 'brevo', attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);
});
