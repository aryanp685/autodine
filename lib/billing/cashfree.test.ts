import { describe, expect, it } from 'vitest';
import {
  CASHFREE_PROVIDER_ID,
  createCashfreeBillingProvider,
  parseCashfreeWebhookPayload,
  signCashfreeWebhookPayload,
  verifyCashfreeWebhookSignature,
} from './cashfree';
import { getBillingProvider } from './provider';
import { PLAN_PRICES } from './catalog';
import { validateBillingEvent } from './webhook';

const SECRET = 'cf-test-secret-0123456789abcdef';
const starter = PLAN_PRICES.find((p) => p.id === 'starter')!;

describe('Cashfree SaaS billing adapter (Rail B)', () => {
  it('fails closed when BILLING_PROVIDER=cashfree is missing credentials', () => {
    expect(getBillingProvider({ BILLING_PROVIDER: CASHFREE_PROVIDER_ID })).toBeNull();
    expect(
      getBillingProvider({
        BILLING_PROVIDER: CASHFREE_PROVIDER_ID,
        BILLING_API_KEY: 'cf_app_123',
      }),
    ).toBeNull();
    expect(
      createCashfreeBillingProvider({
        BILLING_PROVIDER: CASHFREE_PROVIDER_ID,
        BILLING_API_KEY: 'cf_app_123',
        BILLING_WEBHOOK_SECRET: 'too-short',
      }),
    ).toBeNull();
  });

  it('activates only when BILLING_PROVIDER=cashfree and valid credentials are configured', () => {
    const provider = getBillingProvider({
      BILLING_PROVIDER: CASHFREE_PROVIDER_ID,
      BILLING_API_KEY: 'cf_app_123',
      BILLING_WEBHOOK_SECRET: SECRET,
    });
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe('cashfree');
  });

  it('verifies Cashfree Base64 HMAC-SHA256 webhook signatures and rejects stale or tampered payloads', () => {
    const now = new Date('2026-11-20T12:00:00.000Z');
    const rawBody = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      event_time: '2026-11-20T12:00:00Z',
      data: {
        order: {
          order_id: 'ad_maddi_1',
          order_amount: starter.rupees,
          order_currency: 'INR',
          order_tags: { restaurant_name: 'maddi', plan: 'starter', months: '1' },
        },
        payment: {
          cf_payment_id: 987654321,
          payment_amount: starter.rupees,
          payment_currency: 'INR',
          payment_time: '2026-11-20T12:00:00Z',
        },
      },
    });

    const { signature, timestamp } = signCashfreeWebhookPayload(rawBody, SECRET, now);

    expect(
      verifyCashfreeWebhookSignature({
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: true });

    // Tampered body is refused
    expect(
      verifyCashfreeWebhookSignature({
        rawBody: rawBody.replace(String(starter.rupees), '1'),
        headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
        secret: SECRET,
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });

    // Stale (>5 min) webhook is refused
    expect(
      verifyCashfreeWebhookSignature({
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
        secret: SECRET,
        now: new Date(now.getTime() + 10 * 60_000),
      }),
    ).toEqual({ ok: false, reason: 'stale-timestamp' });

    const parsed = parseCashfreeWebhookPayload(JSON.parse(rawBody), rawBody);
    expect(parsed).toMatchObject({
      id: 'cf_pay_987654321',
      restaurantName: 'maddi',
      plan: 'starter',
      amountPaise: starter.paise,
      currency: 'INR',
      status: 'succeeded',
    });
    expect(validateBillingEvent(parsed!)).toEqual({ ok: true });
  });
});
