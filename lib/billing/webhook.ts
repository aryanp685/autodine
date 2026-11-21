/**
 * Billing webhook verification: signature, replay, and amount.
 *
 * WHAT THIS IS FOR
 *
 * A webhook is a stranger POSTing JSON that asks us to switch a paid plan on.
 * Everything here exists to make that request prove itself:
 *
 *   1. SIGNATURE. An HMAC over `${timestamp}.${rawBody}` with the shared
 *      secret, compared in constant time. A body that was altered after signing
 *      fails, and so does a signature that was copied from another event.
 *   2. TIMESTAMP WINDOW. A signed request is only accepted for a few minutes,
 *      so a captured request cannot be replayed next week.
 *   3. REPLAY PROTECTION. Each provider event id may be processed once. The
 *      database enforces it (a unique key on provider + event id); this module
 *      surfaces the id so the caller can enforce it too.
 *   4. AMOUNT AND CURRENCY. The amount in the payload must be exactly the
 *      approved price of the plan for the period bought, in INR. A payload that
 *      says "₹1 for Business" is refused here regardless of its signature.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not talk to any provider, and it does not trust a payload's own
 * `verified` field: `signatureVerified` is set by us or not at all.
 *
 * The signature scheme is the common HMAC-over-timestamp-and-body one. A
 * provider that signs differently is accommodated in the adapter, not by
 * weakening this check.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { amountMatchesPlan, BILLING_CURRENCY, planPriceForMonths } from './catalog';

/** How far a signed request may be from our clock. Five minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Minimum secret length we will work with. Shorter is a configuration error. */
export const MIN_SECRET_LENGTH = 16;

export type WebhookHeaders = Record<string, string | null | undefined>;

export type VerificationResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'not-configured' | 'missing-signature' | 'bad-signature' | 'stale-timestamp' | 'malformed-signature' };

/** Read a header without caring about the case the sender used. */
function header(headers: WebhookHeaders, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === 'string') return value;
  }
  return null;
}

/** Constant-time compare of two hex digests of equal length. */
function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * The string that gets signed: `<timestamp>.<raw body>`.
 *
 * The timestamp is inside the signed material, so a replay with a fresher
 * timestamp needs a new signature.
 */
export function signedPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

/**
 * Verify an HMAC signature over the raw body.
 *
 * `rawBody` must be the exact bytes received. Parsing and re-serialising JSON
 * before verifying is the classic way to accept a payload you did not mean to.
 */
export function verifyBillingSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string | null;
  now?: Date;
  toleranceSeconds?: number;
}): VerificationResult {
  const { rawBody, signatureHeader, timestampHeader, secret } = input;

  // No secret, no belief. An unconfigured deployment accepts nothing, which is
  // the whole point: an unverified webhook is a free subscription.
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'not-configured' };
  if (!signatureHeader) return { ok: false, reason: 'missing-signature' };
  if (!timestampHeader) return { ok: false, reason: 'malformed-signature' };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed-signature' };

  const now = input.now ?? new Date();
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (!Number.isFinite(skew) || skew > tolerance) return { ok: false, reason: 'stale-timestamp' };

  const expected = createHmac('sha256', secret)
    .update(signedPayload(String(timestamp), rawBody), 'utf8')
    .digest('hex');

  // Accept a bare digest or a `sha256=<digest>` form, without accepting a
  // different algorithm claim: the digest is the whole of the proof.
  const provided = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]+$/i.test(provided)) return { ok: false, reason: 'malformed-signature' };
  if (!digestsEqual(provided.toLowerCase(), expected)) return { ok: false, reason: 'bad-signature' };

  return { ok: true, eventId: expected.slice(0, 32) };
}

/** Verify straight from the headers a provider actually sends. */
export function verifyWebhookHeaders(input: {
  rawBody: string;
  headers: WebhookHeaders;
  secret: string | null;
  now?: Date;
  toleranceSeconds?: number;
}): VerificationResult {
  return verifyBillingSignature({
    rawBody: input.rawBody,
    signatureHeader: header(input.headers, 'x-billing-signature'),
    timestampHeader: header(input.headers, 'x-billing-timestamp'),
    secret: input.secret,
    now: input.now,
    toleranceSeconds: input.toleranceSeconds,
  });
}

/**
 * The event id a provider uses, from the payload.
 *
 * It is the replay key: the same id twice must mean the same payment once.
 */
export function providerEventIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['event_id', 'eventId', 'id']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** A stable digest of the payload, so two deliveries can be compared. */
export function payloadDigest(rawBody: string): string {
  return createHmac('sha256', 'autodine-billing-digest')
    .update(rawBody, 'utf8')
    .digest('hex');
}

export type ParsedBillingEvent = {
  id: string;
  type: string;
  plan: string | null;
  months: number;
  amountPaise: number | null;
  currency: string | null;
  occurredAt: string | null;
  failureReason: string | null;
  status: 'succeeded' | 'failed' | 'refunded' | 'unknown';
  /** The provider's reference for the ORIGINAL payment, on a refund. */
  reference: string | null;
  /** The restaurant name the customer is known to us by. */
  restaurantName: string | null;
};

function integerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Parse a webhook body into the fields we act on.
 *
 * Parsing is not trusting: every value is typed here and validated against the
 * catalog by `validateBillingEvent` before anything is written. A payload that
 * cannot be parsed is refused, and an unknown event type is ignored rather than
 * guessed at.
 */
export function parseBillingEvent(payload: unknown): ParsedBillingEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const data = (record.data ?? {}) as Record<string, unknown>;

  const id = providerEventIdOf(payload);
  if (!id) return null;

  const type = typeof record.type === 'string' ? record.type : '';
  if (!type) return null;

  const status = (() => {
    const raw = typeof data.status === 'string' ? data.status : typeof record.status === 'string' ? record.status : '';
    if (raw === 'succeeded' || raw === 'failed' || raw === 'refunded') return raw;
    if (/succeeded|paid|success/i.test(type)) return 'succeeded' as const;
    if (/failed|declined/i.test(type)) return 'failed' as const;
    if (/refund/i.test(type)) return 'refunded' as const;
    return 'unknown' as const;
  })();

  const monthsRaw = integerOrNull(data.months ?? record.months);
  const occurredRaw = typeof (data.occurred_at ?? record.occurred_at) === 'string'
    ? String(data.occurred_at ?? record.occurred_at)
    : null;

  return {
    id,
    type,
    plan: typeof (data.plan ?? record.plan) === 'string' ? String(data.plan ?? record.plan) : null,
    months: monthsRaw && monthsRaw > 0 && monthsRaw <= 36 ? monthsRaw : 1,
    amountPaise: integerOrNull(data.amount_paise ?? record.amount_paise),
    currency: typeof (data.currency ?? record.currency) === 'string'
      ? String(data.currency ?? record.currency).toUpperCase()
      : null,
    occurredAt: occurredRaw && !Number.isNaN(Date.parse(occurredRaw)) ? occurredRaw : null,
    failureReason: typeof (data.failure_reason ?? record.failure_reason) === 'string'
      ? String(data.failure_reason ?? record.failure_reason).slice(0, 300)
      : null,
    status,
    reference: typeof (data.reference ?? data.payment_reference ?? record.reference) === 'string'
      ? String(data.reference ?? data.payment_reference ?? record.reference).slice(0, 200)
      : null,
    restaurantName: typeof (data.restaurant_name ?? record.restaurant_name) === 'string'
      ? String(data.restaurant_name ?? record.restaurant_name).slice(0, 200)
      : null,
  };
}

export type ValidationError =
  | 'unknown-plan'
  | 'amount-mismatch'
  | 'currency-mismatch'
  | 'missing-amount'
  | 'missing-reference'
  | 'unknown-status';

/**
 * The last gate before money is recorded.
 *
 * A payload can be perfectly signed and still be wrong — the wrong price, the
 * wrong currency, a plan that is not for sale. Signed is not the same as true,
 * so the amount is checked against the approved catalog here, in the
 * application, and again in `public.record_subscription_payment()` in the
 * database. Neither check trusts the other.
 */
export function validateBillingEvent(event: ParsedBillingEvent): { ok: true } | { ok: false; error: ValidationError } {
  if (!event.restaurantName) return { ok: false, error: 'missing-reference' };
  if (event.status === 'unknown') return { ok: false, error: 'unknown-status' };
  if (event.status === 'succeeded') {
    if (event.amountPaise === null) return { ok: false, error: 'missing-amount' };
    if ((event.currency ?? BILLING_CURRENCY) !== BILLING_CURRENCY) return { ok: false, error: 'currency-mismatch' };
    if (planPriceForMonths(event.plan, event.months) === null) return { ok: false, error: 'unknown-plan' };
    if (!amountMatchesPlan(event.plan, event.amountPaise, event.months)) return { ok: false, error: 'amount-mismatch' };
  }
  return { ok: true };
}
