/**
 * Talking to the payment gateway — the parts that can be checked without one.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *
 * It is the boundary: creating an order with the provider, and proving that a
 * "payment succeeded" message really came from the provider. It is not a
 * payment system. Nothing here decides what an order costs, and nothing here
 * marks an order paid — that happens in the database, in
 * public.settle_online_payment(), and only after a signature below has been
 * checked.
 *
 * WHY SIGNATURE CHECKS LIVE HERE AND NOT IN THE ROUTE
 *
 * There are two ways money is confirmed: the browser coming back from the
 * checkout window, and the provider's webhook. Both must be verified, and a
 * route that re-implements HMAC is a route that can get it subtly wrong (hex
 * vs base64, the separator, the secret). One implementation, tested against
 * known vectors, used twice.
 *
 * THE TWO SIGNATURES ARE DIFFERENT
 *
 *   checkout   HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)
 *   webhook    HMAC-SHA256(raw request body, webhook_secret)
 *
 * The webhook signs the BYTES. Reading the body as JSON and re-serialising it
 * would change the bytes — key order, spacing, unicode escaping — and the
 * signature would stop matching for reasons nobody could see. The route reads
 * the raw text and passes it here untouched.
 *
 * NOTHING IS THROWN AT THE CALLER
 *
 * A payment provider being down is not a crash; it is a payment that did not
 * start. createRazorpayOrder returns {ok:false, reason} and the screen says so.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { MIN_ONLINE_PAISE } from './online-availability';

/** The provider name written on every payment row and audit event. */
export const ONLINE_PROVIDER = 'razorpay';

/**
 * The provider's minimum, in paise. Defined next to the availability rule so
 * the two cannot disagree about when a button may appear.
 */
export { MIN_ONLINE_PAISE };

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * The publishable half of the key pair. Safe in the browser by design: the
 * checkout script needs it to know which merchant account to charge, and it is
 * useless without the secret.
 */
export function razorpayKeyId(): string {
  return env('NEXT_PUBLIC_RAZORPAY_KEY_ID', 'RAZORPAY_KEY_ID');
}

export function razorpayKeySecret(): string {
  return env('RAZORPAY_KEY_SECRET');
}

export function razorpayWebhookSecret(): string {
  return env('RAZORPAY_WEBHOOK_SECRET');
}

/**
 * Can this deployment take money online at all?
 *
 * Both halves are required. A key id with no secret can open the checkout
 * window but can never verify the result, which would leave guests paying with
 * no way for us to believe it happened.
 */
export function onlinePaymentsConfigured(): boolean {
  return razorpayKeyId() !== '' && razorpayKeySecret() !== '';
}

/** Without this, a webhook cannot be trusted and must not be. */
export function webhookConfigured(): boolean {
  return razorpayWebhookSecret() !== '';
}

function baseUrl(): string {
  return env('RAZORPAY_BASE_URL') || 'https://api.razorpay.com/v1';
}

/** Hex HMAC-SHA256, the encoding both signatures use. */
export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Constant-time comparison.
 *
 * A plain `===` on a signature leaks, through response timing, roughly how
 * many leading characters were right — which is enough to forge one byte at a
 * time. The length check is done separately because timingSafeEqual throws on
 * different lengths.
 */
function safeEqual(expected: string, given: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** What the checkout window sends back, verified with the key secret. */
export function verifyCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = input.secret ?? razorpayKeySecret();
  if (!secret) return false;
  if (!input.orderId || !input.paymentId || !input.signature) return false;

  const expected = hmacSha256Hex(`${input.orderId}|${input.paymentId}`, secret);
  return safeEqual(expected, input.signature);
}

/** What the provider posts to our webhook, verified against the raw body. */
export function verifyWebhookSignature(input: {
  rawBody: string;
  signature: string | null | undefined;
  secret?: string;
}): boolean {
  const secret = input.secret ?? razorpayWebhookSecret();
  if (!secret) return false;
  if (typeof input.signature !== 'string' || input.signature === '') return false;

  const expected = hmacSha256Hex(input.rawBody, secret);
  return safeEqual(expected, input.signature);
}

export type ProviderOrderResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

/**
 * Create an order with the provider.
 *
 * The amount is sent in paise, exactly as the database computed it. The
 * `receipt` is our own order code — it is what a human reads on the provider's
 * dashboard, so it is the code from the screen, not a UUID.
 *
 * `payment_capture: 1` asks the provider to capture automatically. Without it
 * the money is only authorised and the owner would have to capture each
 * payment by hand, which is not a thing a restaurant does.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<ProviderOrderResult> {
  if (!onlinePaymentsConfigured()) {
    return { ok: false, reason: 'Card payment is not connected on this deployment.' };
  }

  const amount = Math.round(input.amountPaise);
  if (!Number.isSafeInteger(amount) || amount < MIN_ONLINE_PAISE) {
    return { ok: false, reason: 'That amount is too small for a card payment.' };
  }

  const controller = new AbortController();
  // A guest standing at a table should not watch a spinner for a minute. If
  // the provider has not answered in fifteen seconds, they pay at the counter.
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const auth = Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString('base64');

    const response = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: input.receipt.slice(0, 40),
        notes: input.notes ?? {},
        payment_capture: 1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[autodine] razorpay order failed:', response.status, detail.slice(0, 300));
      return { ok: false, reason: 'The card payment service refused that request. Please pay at the counter.' };
    }

    const payload = (await response.json()) as { id?: unknown };
    if (typeof payload.id !== 'string' || payload.id === '') {
      console.error('[autodine] razorpay order returned no id');
      return { ok: false, reason: 'The card payment service did not return an order. Please pay at the counter.' };
    }

    return { ok: true, id: payload.id };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error('[autodine] razorpay order threw:', error);
    return {
      ok: false,
      reason: aborted
        ? 'The card payment service did not answer in time. Please pay at the counter.'
        : 'The card payment service could not be reached. Please pay at the counter.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The provider's events we act on, and the ones we ignore.
 *
 * 'payment.captured' is the one that means money moved. 'order.paid' is the
 * same fact stated per order and arrives for the same payment; settling twice
 * is harmless (the database is idempotent) but there is no reason to call it
 * twice. 'payment.failed' is not money, and neither is 'payment.authorized' —
 * an authorised payment can still fail to capture.
 */
export const SETTLING_EVENTS = ['payment.captured'] as const;
export const IGNORED_EVENTS = ['order.paid', 'payment.authorized', 'payment.failed'] as const;

export type WebhookPayment = {
  /** e.g. pay_... */
  paymentId: string;
  /** e.g. order_... — the id we stored when the attempt began. */
  providerOrderId: string;
  /** Paise, as the provider counted them. */
  amountPaise: number;
  captured: boolean;
};

type WebhookBody = {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
        amount?: unknown;
        status?: unknown;
        captured?: unknown;
      };
    };
  };
};

/**
 * Pull the payment out of a webhook body, or null.
 *
 * Deliberately narrow: a body shaped in a way this build does not recognise
 * causes the route to acknowledge and log, not to guess. Guessing at money is
 * how an order gets marked paid for a payment that did not happen.
 */
export function readWebhookPayment(body: unknown): WebhookPayment | null {
  if (!body || typeof body !== 'object') return null;
  const shape = body as WebhookBody;
  const entity = shape.payload?.payment?.entity;
  if (!entity || typeof entity !== 'object') return null;

  const paymentId = typeof entity.id === 'string' ? entity.id : '';
  const providerOrderId = typeof entity.order_id === 'string' ? entity.order_id : '';
  const amountPaise = typeof entity.amount === 'number' ? Math.round(entity.amount) : 0;

  if (!paymentId || !providerOrderId || amountPaise <= 0) return null;

  const captured = entity.captured === true || entity.status === 'captured';

  return { paymentId, providerOrderId, amountPaise, captured };
}

/** The event name, as a string, for logging and routing. */
export function webhookEventName(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const event = (body as { event?: unknown }).event;
  return typeof event === 'string' ? event : '';
}
