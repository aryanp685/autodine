import { describe, expect, it } from 'vitest';
import {
  IGNORED_EVENTS,
  SETTLING_EVENTS,
  MIN_ONLINE_PAISE,
  ONLINE_PROVIDER,
  createRazorpayOrder,
  hmacSha256Hex,
  onlinePaymentsConfigured,
  readWebhookPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  webhookConfigured,
  webhookEventName,
} from './razorpay';

/**
 * The two signatures are the only thing standing between a stranger and a
 * "paid" order. The expected values below were computed once, outside this
 * file, with `printf ... | openssl dgst -sha256 -hmac` — hard-coded on purpose
 * so a change to the implementation has to disagree with a value the
 * implementation did not produce.
 */

const SECRET = 'test_secret_key';
const WEBHOOK_SECRET = 'whsec_test_key';

const CHECKOUT_VECTOR =
  '72c9623af2f6e48431d8ea9e8def333302776510a283061c77986c69b1052cdd';
const WEBHOOK_VECTOR =
  '0eaa1d0f94f0d5ceabe4cda0438f1ad70347e67780094caf3978673eadd2bdca';

describe('hmacSha256Hex', () => {
  it('matches a fixed, externally computed vector', () => {
    expect(hmacSha256Hex('order_TEST123|pay_TEST456', SECRET)).toBe(CHECKOUT_VECTOR);
  });
});

describe('verifyCheckoutSignature', () => {
  const good = {
    orderId: 'order_TEST123',
    paymentId: 'pay_TEST456',
    signature: CHECKOUT_VECTOR,
    secret: SECRET,
  };

  it('accepts the provider’s signature', () => {
    expect(verifyCheckoutSignature(good)).toBe(true);
  });

  it('rejects a changed signature', () => {
    expect(verifyCheckoutSignature({ ...good, signature: CHECKOUT_VECTOR.replace(/.$/, '0') })).toBe(false);
  });

  it('rejects a different payment id signed with the same secret', () => {
    expect(verifyCheckoutSignature({ ...good, paymentId: 'pay_OTHER' })).toBe(false);
  });

  it('rejects an empty or missing secret instead of signing with nothing', () => {
    expect(verifyCheckoutSignature({ ...good, secret: '' })).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(verifyCheckoutSignature({ ...good, signature: 'abc' })).toBe(false);
  });

  it('rejects when any part is missing', () => {
    expect(verifyCheckoutSignature({ ...good, orderId: '' })).toBe(false);
    expect(verifyCheckoutSignature({ ...good, paymentId: '' })).toBe(false);
    expect(verifyCheckoutSignature({ ...good, signature: '' })).toBe(false);
  });
});

describe('verifyWebhookSignature', () => {
  it('matches a fixed vector over the raw body', () => {
    expect(
      verifyWebhookSignature({
        rawBody: '{"event":"payment.captured"}',
        signature: WEBHOOK_VECTOR,
        secret: WEBHOOK_SECRET,
      }),
    ).toBe(true);
  });

  it('rejects a body that was re-serialised after signing', () => {
    // Same JSON, different bytes. This is the mistake the route avoids by
    // reading request.text() rather than request.json().
    expect(
      verifyWebhookSignature({
        rawBody: '{"event": "payment.captured"}',
        signature: WEBHOOK_VECTOR,
        secret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyWebhookSignature({ rawBody: '{}', signature: null, secret: WEBHOOK_SECRET })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: '{}', signature: undefined, secret: WEBHOOK_SECRET })).toBe(false);
  });

  it('rejects when no webhook secret is configured', () => {
    expect(verifyWebhookSignature({ rawBody: '{}', signature: 'anything', secret: '' })).toBe(false);
  });
});

describe('configuration', () => {
  it('is off unless both halves of the key pair exist', () => {
    const saved = { ...process.env };
    try {
      delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      expect(onlinePaymentsConfigured()).toBe(false);
      expect(webhookConfigured()).toBe(false);

      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = 'rzp_test_abc';
      expect(onlinePaymentsConfigured()).toBe(false);

      process.env.RAZORPAY_KEY_SECRET = 'secret';
      expect(onlinePaymentsConfigured()).toBe(true);
      expect(webhookConfigured()).toBe(false);

      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
      expect(webhookConfigured()).toBe(true);
    } finally {
      process.env = saved;
    }
  });

  it('refuses to create an order when nothing is configured', async () => {
    const saved = { ...process.env };
    try {
      delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      const result = await createRazorpayOrder({ amountPaise: 32000, receipt: 'MA-ABCDE' });
      expect(result.ok).toBe(false);
    } finally {
      process.env = saved;
    }
  });

  it('refuses an amount below the provider minimum before calling anything', async () => {
    const saved = { ...process.env };
    try {
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = 'rzp_test_abc';
      process.env.RAZORPAY_KEY_SECRET = 'secret';

      const result = await createRazorpayOrder({ amountPaise: MIN_ONLINE_PAISE - 1, receipt: 'X' });
      expect(result.ok).toBe(false);

      const zero = await createRazorpayOrder({ amountPaise: 0, receipt: 'X' });
      expect(zero.ok).toBe(false);
    } finally {
      process.env = saved;
    }
  });
});

describe('webhook bodies', () => {
  const captured = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: { id: 'pay_TEST456', order_id: 'order_TEST123', amount: 330282, status: 'captured', captured: true },
      },
    },
  };

  it('reads the payment out of a captured event', () => {
    expect(readWebhookPayment(captured)).toEqual({
      paymentId: 'pay_TEST456',
      providerOrderId: 'order_TEST123',
      amountPaise: 330282,
      captured: true,
    });
    expect(webhookEventName(captured)).toBe('payment.captured');
  });

  it('marks a failed payment as not captured', () => {
    const failed = {
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_X', order_id: 'order_Y', amount: 100, status: 'failed' } } },
    };
    expect(readWebhookPayment(failed)?.captured).toBe(false);
  });

  it('returns null for a body it does not recognise rather than guessing', () => {
    expect(readWebhookPayment(null)).toBeNull();
    expect(readWebhookPayment({})).toBeNull();
    expect(readWebhookPayment({ payload: {} })).toBeNull();
    expect(readWebhookPayment({ payload: { payment: { entity: { id: 'pay_X' } } } })).toBeNull();
    expect(
      readWebhookPayment({ payload: { payment: { entity: { id: 'pay_X', order_id: 'order_Y', amount: 0 } } } }),
    ).toBeNull();
  });

  it('keeps the event lists honest: only capture settles', () => {
    expect([...SETTLING_EVENTS]).toEqual(['payment.captured']);
    for (const ignored of IGNORED_EVENTS) expect(SETTLING_EVENTS).not.toContain(ignored);
  });
});

describe('the provider name', () => {
  it('is the string written on payment rows', () => {
    expect(ONLINE_PROVIDER).toBe('razorpay');
  });
});
