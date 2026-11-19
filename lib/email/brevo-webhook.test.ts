import { describe, expect, it } from 'vitest';
import { parseBrevoWebhookEvent, verifyBrevoWebhookCredential } from './brevo-webhook';

/**
 * Brevo signs nothing, so the two things standing between the internet and
 * this receiver are the shared-secret check and a parser that refuses to let
 * payload data (recipient, subject, links) survive into our systems.
 */

describe('parseBrevoWebhookEvent', () => {
  it('classifies delivered and terminal failure events', () => {
    expect(parseBrevoWebhookEvent({ event: 'delivered', email: 'a@b.test' })).toMatchObject({
      event: 'delivered',
      action: 'delivered',
    });
    expect(parseBrevoWebhookEvent({ event: 'hard_bounce' })).toMatchObject({
      event: 'hard_bounce',
      action: 'failed',
      incidentKind: 'email_delivery_failed',
      severity: 'warning',
    });
    expect(parseBrevoWebhookEvent({ event: 'spam' })).toMatchObject({
      action: 'failed',
      incidentKind: 'email_spam_complaint',
      severity: 'critical',
    });
  });

  it('normalizes Brevo’s camelCase subscription spellings', () => {
    expect(parseBrevoWebhookEvent({ event: 'hardBounce' })?.event).toBe('hard_bounce');
    expect(parseBrevoWebhookEvent({ event: 'uniqueOpened' })?.event).toBe('unique_opened');
    expect(parseBrevoWebhookEvent({ event: 'invalidEmail' })).toMatchObject({
      event: 'invalid_email',
      action: 'failed',
    });
  });

  it('treats engagement and transient events as observe-only', () => {
    for (const event of ['request', 'opened', 'click', 'deferred', 'soft_bounce', 'unsubscribed']) {
      expect(parseBrevoWebhookEvent({ event })).toMatchObject({ event, action: 'observe' });
    }
  });

  it('rejects unknown or malformed payloads', () => {
    expect(parseBrevoWebhookEvent(null)).toBeNull();
    expect(parseBrevoWebhookEvent('delivered')).toBeNull();
    expect(parseBrevoWebhookEvent([{ event: 'delivered' }])).toBeNull();
    expect(parseBrevoWebhookEvent({ event: 'invoice_paid' })).toBeNull();
    expect(parseBrevoWebhookEvent({})).toBeNull();
  });
});

describe('verifyBrevoWebhookCredential', () => {
  const secret = 'test-webhook-secret-value';

  it('accepts the bearer token Brevo’s webhook auth sends', () => {
    expect(verifyBrevoWebhookCredential({ authorization: `Bearer ${secret}` }, secret)).toBe(true);
    expect(verifyBrevoWebhookCredential({ authorization: `bearer ${secret}` }, secret)).toBe(true);
  });

  it('accepts the documented custom header alternative', () => {
    expect(verifyBrevoWebhookCredential({ customSecret: secret }, secret)).toBe(true);
  });

  it('refuses wrong, missing or unconfigured credentials', () => {
    expect(verifyBrevoWebhookCredential({ authorization: 'Bearer wrong-value' }, secret)).toBe(false);
    expect(verifyBrevoWebhookCredential({ authorization: secret }, secret)).toBe(false);
    expect(verifyBrevoWebhookCredential({}, secret)).toBe(false);
    expect(verifyBrevoWebhookCredential({ authorization: `Bearer ${secret}` }, '')).toBe(false);
    expect(verifyBrevoWebhookCredential({ authorization: 'Bearer x' }, secret)).toBe(false);
  });
});
