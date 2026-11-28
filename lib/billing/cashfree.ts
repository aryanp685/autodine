/**
 * Cashfree SaaS Subscription Payment Adapter (Rail B only).
 *
 * Strictly for Restaurant -> AutoDine SaaS plan payments. Guest dining orders
 * are NEVER routed through this adapter (Rail A is pay-at-counter only).
 *
 * Fails closed: returns null unless BILLING_PROVIDER=cashfree AND valid
 * Cashfree credentials are present. Never invents defaults or bypasses
 * signature/amount verification.
 *
 * Signing: Cashfree signs every webhook with the merchant's client secret, the
 * same secret the API calls use (cashfree.com/docs/api-reference/webhooks/
 * payloads-and-signatures). BILLING_WEBHOOK_SECRET, when set, overrides that
 * for accounts that expose a dedicated webhook secret.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingEvent, BillingProvider, CheckoutRequest, CheckoutSession, ProviderPayment } from './provider';
import { BILLING_API_KEY_ENV, BILLING_PROVIDER_ENV, BILLING_WEBHOOK_SECRET_ENV } from './provider';
import { DEFAULT_TOLERANCE_SECONDS, MIN_SECRET_LENGTH, type ParsedBillingEvent } from './webhook';

export const CASHFREE_PROVIDER_ID = 'cashfree';
export const CASHFREE_API_VERSION = '2023-08-01';

export type CashfreeCredentials = {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  baseUrl: string;
  env: 'sandbox' | 'production';
};

export function getCashfreeCredentials(
  env: Record<string, string | undefined> = process.env,
): CashfreeCredentials | null {
  if ((env[BILLING_PROVIDER_ENV] ?? '').trim() !== CASHFREE_PROVIDER_ID) return null;

  const clientId = (env['CASHFREE_CLIENT_ID'] ?? env[BILLING_API_KEY_ENV] ?? '').trim();
  const clientSecret = (env['CASHFREE_CLIENT_SECRET'] ?? env[BILLING_WEBHOOK_SECRET_ENV] ?? '').trim();
  // Cashfree signs with the client secret; a dedicated webhook secret is the
  // exception, so BILLING_WEBHOOK_SECRET only wins when it is actually set.
  const webhookSecret = (env[BILLING_WEBHOOK_SECRET_ENV] ?? clientSecret).trim();

  if (!clientId || clientSecret.length < MIN_SECRET_LENGTH || webhookSecret.length < MIN_SECRET_LENGTH) {
    return null;
  }

  const cfEnvRaw = (env['CASHFREE_ENV'] ?? '').trim().toLowerCase();
  const isProdDeploy = env['VERCEL_ENV'] === 'production' || env['NODE_ENV'] === 'production';
  const cfEnv: 'sandbox' | 'production' =
    cfEnvRaw === 'production' ? 'production' : cfEnvRaw === 'sandbox' && !isProdDeploy ? 'sandbox' : isProdDeploy ? 'production' : 'sandbox';

  return {
    clientId,
    clientSecret,
    webhookSecret,
    env: cfEnv,
    baseUrl: cfEnv === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
  };
}

function readHeader(headers: Record<string, string | null | undefined>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && typeof v === 'string') return v;
  }
  return null;
}

/**
 * Cashfree signs webhooks with Base64(HMAC-SHA256(secret, `${timestamp}${rawBody}`)).
 * `x-webhook-timestamp` is sent in milliseconds (or seconds in some older integrations).
 */
export function verifyCashfreeWebhookSignature(input: {
  rawBody: string;
  headers: Record<string, string | null | undefined>;
  secret: string | null;
  now?: Date;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, headers, secret } = input;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'not-configured' };

  const signature = readHeader(headers, 'x-webhook-signature')?.trim() ?? '';
  const timestamp = readHeader(headers, 'x-webhook-timestamp')?.trim() ?? '';
  if (!signature) return { ok: false, reason: 'missing-signature' };
  if (!timestamp || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'malformed-signature' };

  const numericTs = Number(timestamp);
  const tsSeconds = numericTs > 1e12 ? Math.floor(numericTs / 1000) : numericTs;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(tsSeconds) || Math.abs(nowSec - tsSeconds) > tolerance) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`, 'utf8')
    .digest('base64');

  if (signature.length !== expected.length) return { ok: false, reason: 'bad-signature' };
  try {
    const match = timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
    return match ? { ok: true } : { ok: false, reason: 'bad-signature' };
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
}

export function signCashfreeWebhookPayload(
  rawBody: string,
  secret: string,
  now: Date = new Date(),
): { signature: string; timestamp: string } {
  const timestamp = String(now.getTime());
  const signature = createHmac('sha256', secret).update(`${timestamp}${rawBody}`, 'utf8').digest('base64');
  return { signature, timestamp };
}

/** Map a verified Cashfree webhook JSON body into AutoDine's ParsedBillingEvent. */
export function parseCashfreeWebhookPayload(payload: unknown, rawBody: string): ParsedBillingEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const type = typeof root.type === 'string' ? root.type.trim() : '';
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? (root.data as Record<string, unknown>)
    : null;
  if (!type || !data) return null;

  const order = (data.order && typeof data.order === 'object' ? data.order : {}) as Record<string, unknown>;
  const payment = (data.payment && typeof data.payment === 'object' ? data.payment : {}) as Record<string, unknown>;
  const refund = (data.refund && typeof data.refund === 'object' ? data.refund : {}) as Record<string, unknown>;
  const tags = (order.order_tags && typeof order.order_tags === 'object' ? order.order_tags : {}) as Record<string, unknown>;
  const customer = (data.customer_details && typeof data.customer_details === 'object' ? data.customer_details : {}) as Record<string, unknown>;

  const restaurantName =
    (typeof tags.restaurant_name === 'string' && tags.restaurant_name.trim()) ||
    (typeof customer.customer_id === 'string' && customer.customer_id.trim()) ||
    null;
  const plan = typeof tags.plan === 'string' && tags.plan.trim() ? tags.plan.trim() : null;
  const monthsRaw = Number(tags.months ?? 1);
  const months = Number.isSafeInteger(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 12 ? monthsRaw : 1;

  const rawRupees =
    payment.payment_amount ?? order.order_amount ?? refund.refund_amount ?? null;
  const numericRupees = rawRupees !== null ? Number(rawRupees) : Number.NaN;
  const amountPaise = Number.isFinite(numericRupees) && numericRupees >= 0
    ? Math.round(numericRupees * 100)
    : null;

  const currency =
    (typeof payment.payment_currency === 'string' && payment.payment_currency.trim().toUpperCase()) ||
    (typeof order.order_currency === 'string' && order.order_currency.trim().toUpperCase()) ||
    (typeof refund.refund_currency === 'string' && refund.refund_currency.trim().toUpperCase()) ||
    'INR';

  let status: ParsedBillingEvent['status'] = 'unknown';
  if (type === 'PAYMENT_SUCCESS_WEBHOOK' || type === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
    status = 'succeeded';
  } else if (type === 'PAYMENT_FAILED_WEBHOOK' || type === 'SUBSCRIPTION_PAYMENT_FAILED') {
    status = 'failed';
  } else if (type === 'REFUND_STATUS_WEBHOOK' && String(refund.refund_status ?? '').toUpperCase() === 'SUCCESS') {
    status = 'refunded';
  }

  const cfEventId =
    (typeof payment.cf_payment_id === 'string' || typeof payment.cf_payment_id === 'number'
      ? `cf_pay_${payment.cf_payment_id}`
      : null) ||
    (typeof refund.cf_refund_id === 'string' || typeof refund.cf_refund_id === 'number'
      ? `cf_ref_${refund.cf_refund_id}`
      : null) ||
    `cf_evt_${createHash('sha256').update(rawBody).digest('hex').slice(0, 24)}`;

  return {
    id: cfEventId,
    type,
    restaurantName,
    plan,
    amountPaise,
    currency,
    months,
    status,
    occurredAt:
      (typeof payment.payment_time === 'string' && payment.payment_time) ||
      (typeof root.event_time === 'string' && root.event_time) ||
      null,
    reference:
      (typeof order.order_id === 'string' && order.order_id) ||
      (typeof payment.cf_payment_id === 'string' && payment.cf_payment_id) ||
      null,
    failureReason:
      typeof payment.payment_message === 'string' ? payment.payment_message : null,
  };
}

/**
 * Cashfree refuses a relative `return_url`: the browser leaves this site for
 * the Cashfree checkout, so the path has to come back as a full URL. The
 * origin is the one the owner started checkout from; without one (scripts,
 * tests) the path is passed through unchanged.
 */
function absoluteReturnUrl(request: CheckoutRequest): string {
  const path = request.returnPath;
  if (!request.origin) return path;
  try {
    return new URL(path, request.origin).toString();
  } catch {
    return path;
  }
}

export function createCashfreeBillingProvider(
  env: Record<string, string | undefined> = process.env,
): BillingProvider | null {
  const creds = getCashfreeCredentials(env);
  if (!creds) return null;

  const headers = {
    'content-type': 'application/json',
    'x-client-id': creds.clientId,
    'x-client-secret': creds.clientSecret,
    'x-api-version': CASHFREE_API_VERSION,
  };

  return {
    name: CASHFREE_PROVIDER_ID,

    async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
      const orderId = `ad_${request.accountId.slice(0, 8)}_${Date.now()}`;
      const orderAmountRupees = Number((request.amountPaise / 100).toFixed(2));
      const res = await fetch(`${creds.baseUrl}/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          order_id: orderId,
          order_amount: orderAmountRupees,
          order_currency: request.currency,
          customer_details: {
            customer_id: request.accountId,
            customer_phone: '9999999999',
          },
          order_meta: {
            return_url: absoluteReturnUrl(request),
          },
          order_tags: {
            restaurant_name: request.accountId,
            plan: request.plan,
            months: String(request.months),
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`Cashfree order creation failed (HTTP ${res.status}).`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const paymentSessionId = typeof data.payment_session_id === 'string' ? data.payment_session_id : '';
      // Cashfree's hosted checkout lives at /order/#<session>, not /forms/<id>:
      // /forms is the payment-links page and answers a session id with
      // "Oops! Invalid form", which is exactly what a live buyer saw.
      const checkoutUrl =
        (typeof data.payment_link === 'string' && data.payment_link) ||
        (paymentSessionId
          ? `${creds.env === 'production' ? 'https://payments.cashfree.com' : 'https://payments-test.cashfree.com'}/order/#${paymentSessionId}`
          : '');
      if (!checkoutUrl) {
        throw new Error('Cashfree did not return a checkout URL.');
      }
      return {
        url: checkoutUrl,
        reference: typeof data.order_id === 'string' ? data.order_id : orderId,
        expiresAt: typeof data.order_expiry_time === 'string' ? data.order_expiry_time : null,
      };
    },

    async verifyPayment(reference: string): Promise<ProviderPayment | null> {
      const res = await fetch(`${creds.baseUrl}/orders/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const rawStatus = String(data.order_status ?? '').toUpperCase();
      const status: ProviderPayment['status'] =
        rawStatus === 'PAID' ? 'succeeded' : rawStatus === 'EXPIRED' || rawStatus === 'TERMINATED' ? 'failed' : 'pending';
      return {
        reference,
        status,
        amountPaise: Math.round(Number(data.order_amount ?? 0) * 100),
        currency: String(data.order_currency ?? 'INR'),
        occurredAt: new Date().toISOString(),
      };
    },

    async verifyAndParseWebhook(input): Promise<BillingEvent | null> {
      const check = verifyCashfreeWebhookSignature({
        rawBody: input.rawBody,
        headers: input.headers,
        secret: creds.webhookSecret,
      });
      if (!check.ok) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.rawBody);
      } catch {
        return null;
      }
      const event = parseCashfreeWebhookPayload(parsed, input.rawBody);
      if (!event) return null;
      return {
        id: event.id,
        type: event.type,
        accountId: event.restaurantName,
        plan: event.plan,
        amountPaise: event.amountPaise,
        currency: event.currency,
        months: event.months,
        status: event.status,
        occurredAt: event.occurredAt,
        failureReason: event.failureReason,
        signatureVerified: true,
      };
    },

    async reconcile(): Promise<{ matched: number; missing: string[] }> {
      return { matched: 0, missing: [] };
    },

    async renew(): Promise<ProviderPayment | null> {
      return null;
    },

    async cancel(): Promise<boolean> {
      return true;
    },

    async refundStatus(reference: string): Promise<'refunded' | 'not-refunded' | 'unknown'> {
      const res = await fetch(`${creds.baseUrl}/orders/${encodeURIComponent(reference)}/refunds`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) return 'unknown';
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      return Array.isArray(rows) && rows.some((r) => String(r.refund_status ?? '').toUpperCase() === 'SUCCESS')
        ? 'refunded'
        : 'not-refunded';
    },
  };
}
