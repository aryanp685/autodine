/**
 * Unit tests for the billing webhook verification/parsing core.
 *
 * The live path is only as strong as these checks: signature, freshness,
 * replay key extraction, catalog validation. Every failure mode here fails
 * closed — an unverifiable event is never parsed into a payment.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { PLAN_PRICES, planPriceForMonths } from './catalog';
import {
  DEFAULT_TOLERANCE_SECONDS,
  MIN_SECRET_LENGTH,
  parseBillingEvent,
  payloadDigest,
  providerEventIdOf,
  signedPayload,
  validateBillingEvent,
  verifyBillingSignature,
  verifyWebhookHeaders,
  type ParsedBillingEvent,
} from './webhook';

const SECRET = 'test-webhook-secret-0123456789abcdef'.slice(0, 40);
const NOW = new Date('2026-11-15T02:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(signedPayload(timestamp, rawBody), 'utf8').digest('hex');
}

const starter = PLAN_PRICES.find((plan) => plan.id === 'starter')!;
const professional = PLAN_PRICES.find((plan) => plan.id === 'professional')!;

describe('verifyBillingSignature', () => {
  const rawBody = JSON.stringify({ event_id: 'evt_1', type: 'payment.succeeded' });

  it('fails closed when no secret is configured', () => {
    const result = verifyBillingSignature({ rawBody, signatureHeader: 'x'.repeat(64), timestampHeader: String(NOW_SECONDS), secret: null, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('fails closed when the secret is shorter than the minimum', () => {
    const short = 'a'.repeat(MIN_SECRET_LENGTH - 1);
    const timestamp = String(NOW_SECONDS);
    const result = verifyBillingSignature({ rawBody, signatureHeader: sign(short, timestamp, rawBody), timestampHeader: timestamp, secret: short, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('rejects a missing signature and a non-numeric timestamp', () => {
    const timestamp = String(NOW_SECONDS);
    expect(verifyBillingSignature({ rawBody, signatureHeader: null, timestampHeader: timestamp, secret: SECRET, now: NOW }))
      .toEqual({ ok: false, reason: 'missing-signature' });
    expect(verifyBillingSignature({ rawBody, signatureHeader: sign(SECRET, timestamp, rawBody), timestampHeader: 'tomorrow', secret: SECRET, now: NOW }))
      .toEqual({ ok: false, reason: 'malformed-signature' });
  });

  it('rejects a stale timestamp even with a valid signature for that timestamp', () => {
    const stale = String(NOW_SECONDS - DEFAULT_TOLERANCE_SECONDS - 60);
    const result = verifyBillingSignature({ rawBody, signatureHeader: sign(SECRET, stale, rawBody), timestampHeader: stale, secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects a signature over a different body (tampered payload)', () => {
    const timestamp = String(NOW_SECONDS);
    const signature = sign(SECRET, timestamp, rawBody);
    const tampered = rawBody.replace('evt_1', 'evt_2');
    const result = verifyBillingSignature({ rawBody: tampered, signatureHeader: signature, timestampHeader: timestamp, secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('accepts a correct sha256-prefixed or bare signature', () => {
    const timestamp = String(NOW_SECONDS);
    const digest = sign(SECRET, timestamp, rawBody);
    for (const header of [digest, `sha256=${digest}`, digest.toUpperCase()]) {
      const result = verifyBillingSignature({ rawBody, signatureHeader: header, timestampHeader: timestamp, secret: SECRET, now: NOW });
      expect(result).toEqual({ ok: true, eventId: digest.slice(0, 32) });
    }
  });

  it('rejects non-hex signatures and wrong-length digests', () => {
    const timestamp = String(NOW_SECONDS);
    expect(verifyBillingSignature({ rawBody, signatureHeader: 'zz' + sign(SECRET, timestamp, rawBody).slice(2), timestampHeader: timestamp, secret: SECRET, now: NOW }))
      .toEqual({ ok: false, reason: 'malformed-signature' });
    expect(verifyBillingSignature({ rawBody, signatureHeader: 'abcd', timestampHeader: timestamp, secret: SECRET, now: NOW }))
      .toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('verifyWebhookHeaders reads headers case-insensitively', () => {
    const timestamp = String(NOW_SECONDS);
    const signature = sign(SECRET, timestamp, rawBody);
    const result = verifyWebhookHeaders({
      rawBody,
      headers: { 'X-Billing-Signature': signature, 'X-BILLING-TIMESTAMP': timestamp },
      secret: SECRET,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe('providerEventIdOf / payloadDigest', () => {
  it('extracts and trims the replay key from known field names', () => {
    expect(providerEventIdOf({ event_id: ' evt_a ' })).toBe('evt_a');
    expect(providerEventIdOf({ eventId: 'evt_b' })).toBe('evt_b');
    expect(providerEventIdOf({ id: 'evt_c' })).toBe('evt_c');
    expect(providerEventIdOf({})).toBeNull();
    expect(providerEventIdOf('nope')).toBeNull();
    expect(providerEventIdOf({ event_id: '   ' })).toBeNull();
  });

  it('produces a stable payload digest', () => {
    expect(payloadDigest('abc')).toBe(payloadDigest('abc'));
    expect(payloadDigest('abc')).not.toBe(payloadDigest('abd'));
  });
});

describe('parseBillingEvent', () => {
  it('parses a full succeeded event with data wrapper', () => {
    const event = parseBillingEvent({
      event_id: 'evt_paid_1',
      type: 'payment.succeeded',
      data: {
        restaurant_name: 'synthetic-kitchen',
        plan: 'starter',
        months: 1,
        amount_paise: starter.paise,
        currency: 'inr',
        occurred_at: '2026-11-15T00:00:00.000Z',
      },
    });
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      id: 'evt_paid_1',
      type: 'payment.succeeded',
      status: 'succeeded',
      plan: 'starter',
      months: 1,
      amountPaise: starter.paise,
      currency: 'INR',
      restaurantName: 'synthetic-kitchen',
    });
  });

  it('infers the status from the event type and defaults months to 1', () => {
    const event = parseBillingEvent({ id: 'evt_2', type: 'payment.failed', data: { failure_reason: 'declined' } });
    expect(event?.status).toBe('failed');
    expect(event?.months).toBe(1);
    expect(parseBillingEvent({ id: 'evt_3', type: 'refund.processed', data: {} })?.status).toBe('refunded');
    expect(parseBillingEvent({ id: 'evt_4', type: 'payout.noted', data: {} })?.status).toBe('unknown');
  });

  it('refuses events without an id or without a type', () => {
    expect(parseBillingEvent({ type: 'payment.succeeded' })).toBeNull();
    expect(parseBillingEvent({ event_id: 'evt_5' })).toBeNull();
    expect(parseBillingEvent(null)).toBeNull();
  });

  it('caps failure reasons and tolerates junk months', () => {
    const event = parseBillingEvent({ id: 'evt_6', type: 'payment.failed', data: { failure_reason: 'x'.repeat(500), months: 999 } });
    expect(event?.failureReason).toHaveLength(300);
    expect(event?.months).toBe(1);
  });
});

describe('validateBillingEvent', () => {
  const base: ParsedBillingEvent = {
    id: 'evt_v',
    type: 'payment.succeeded',
    plan: 'professional',
    months: 1,
    amountPaise: professional.paise,
    currency: 'INR',
    occurredAt: '2026-11-15T00:00:00.000Z',
    failureReason: null,
    status: 'succeeded',
    reference: null,
    restaurantName: 'synthetic-kitchen',
  };

  it('accepts an exactly-correct succeeded event', () => {
    expect(validateBillingEvent(base)).toEqual({ ok: true });
  });

  it('refuses the wrong amount, the wrong currency and unknown plans', () => {
    expect(validateBillingEvent({ ...base, amountPaise: professional.paise - 1 })).toEqual({ ok: false, error: 'amount-mismatch' });
    expect(validateBillingEvent({ ...base, amountPaise: starter.paise })).toEqual({ ok: false, error: 'amount-mismatch' });
    expect(validateBillingEvent({ ...base, currency: 'USD' })).toEqual({ ok: false, error: 'currency-mismatch' });
    expect(validateBillingEvent({ ...base, plan: 'platinum' })).toEqual({ ok: false, error: 'unknown-plan' });
    expect(validateBillingEvent({ ...base, amountPaise: null })).toEqual({ ok: false, error: 'missing-amount' });
    expect(validateBillingEvent({ ...base, restaurantName: null })).toEqual({ ok: false, error: 'missing-reference' });
    expect(validateBillingEvent({ ...base, status: 'unknown' })).toEqual({ ok: false, error: 'unknown-status' });
  });

  it('honours the months multiplier from the approved catalog', () => {
    const threeMonths = planPriceForMonths('starter', 3)!;
    expect(validateBillingEvent({ ...base, plan: 'starter', months: 3, amountPaise: threeMonths })).toEqual({ ok: true });
    expect(validateBillingEvent({ ...base, plan: 'starter', months: 3, amountPaise: starter.paise })).toEqual({ ok: false, error: 'amount-mismatch' });
  });

  it('requires no amount check for non-succeeded statuses but still needs a restaurant', () => {
    expect(validateBillingEvent({ ...base, status: 'failed', amountPaise: null })).toEqual({ ok: true });
    expect(validateBillingEvent({ ...base, status: 'refunded', amountPaise: null, restaurantName: null }))
      .toEqual({ ok: false, error: 'missing-reference' });
  });
});
