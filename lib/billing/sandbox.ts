/**
 * The billing SANDBOX — an offline, deterministic provider for rehearsals.
 *
 * WHAT THIS IS
 *
 * A `BillingProvider` that answers everything in-process: checkout sessions,
 * payment verification, webhook signing and parsing, cancellation, refunds.
 * It makes NO network calls, holds NO credentials, and can never move money.
 * It exists so the complete subscription-billing path — checkout → webhook →
 * catalog validation → `record_subscription_payment()` — can be exercised
 * locally, in CI, and on a preview deployment without a provider contract.
 *
 * WHAT IT IS NOT
 *
 * - Not a payment provider. No money moves, no mandate is charged, no card is
 *   touched. It is theatre of the exact right kind: every rule that the real
 *   provider path enforces is enforced here too, so a green rehearsal proves
 *   the code paths, never the provider.
 * - Not enabled by accident. It activates only when BOTH are set:
 *     BILLING_PROVIDER=sandbox
 *     AUTODINE_BILLING_SANDBOX=1
 *   and it REFUSES to activate when the deployment environment says
 *   production (VERCEL_ENV=production or AUTODINE_DEPLOY_ENV=production),
 *   where a synthetic checkout could be mistaken for a real subscription.
 * - Not a bypass of the webhook rules. The webhook route verifies the HMAC
 *   signature, freshness, replay key and catalog amount exactly as it would
 *   for a live provider; the sandbox merely gives the route a deterministic
 *   signature to verify.
 *
 * DETERMINISTIC FAILURE INJECTION (for rehearsals and tests)
 *
 * References produced by this adapter encode plan/months/amount and carry an
 * optional outcome suffix:
 *   sbx_<plan>_<months>_<amountPaise>_<base36 time>[_fail|_pending|_refund]
 * A reference ending in `_fail` verifies as `failed`, `_pending` as `pending`,
 * and `refundStatus()` answers 'refunded'. Unknown references verify as null —
 * the sandbox never invents a payment it did not see.
 */

import { createHmac } from 'node:crypto';

import { BILLING_CURRENCY, planPriceForMonths } from './catalog';
import type {
  BillingEvent,
  BillingProvider,
  CheckoutRequest,
  CheckoutSession,
  ProviderPayment,
} from './provider';
import { parseBillingEvent, verifyBillingSignature } from './webhook';

export const SANDBOX_PROVIDER_ID = 'sandbox';
export const SANDBOX_OPT_IN_ENV = 'AUTODINE_BILLING_SANDBOX';

const REFERENCE_RE = /^sbx_([a-z]+)_(\d{1,2})_(\d{1,10})_([a-z0-9]+)(_fail|_pending|_refund)?$/;
const WEBHOOK_SECRET_MIN = 16;

/**
 * True only when the sandbox is explicitly opted in AND the deployment is not
 * production. Any ambiguity means no sandbox — the failure mode of this
 * decision must never be "synthetic checkout on the live deployment".
 */
export function isSandboxBillingAllowed(env: Record<string, string | undefined>): boolean {
  if ((env[SANDBOX_OPT_IN_ENV] ?? '').trim() !== '1') return false;
  if ((env['VERCEL_ENV'] ?? '').trim() === 'production') return false;
  if ((env['AUTODINE_DEPLOY_ENV'] ?? '').trim() === 'production') return false;
  return true;
}

export function isBillingSandboxActive(env: Record<string, string | undefined>): boolean {
  return (env['BILLING_PROVIDER'] ?? '').trim() === SANDBOX_PROVIDER_ID && isSandboxBillingAllowed(env);
}

function base36Now(now: number): string {
  return Math.floor(now / 1000).toString(36);
}

export type SandboxBillingProviderOptions = {
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Webhook secret used by verifyAndParseWebhook. Read from env if absent. */
  webhookSecret?: string | null;
};

export class SandboxBillingProvider implements BillingProvider {
  readonly name = SANDBOX_PROVIDER_ID;
  private readonly now: () => number;
  private readonly webhookSecret: string | null;

  constructor(options: SandboxBillingProviderOptions = {}) {
    this.now = options.now ?? Date.now;
    const secret = options.webhookSecret !== undefined
      ? options.webhookSecret
      : (process.env['BILLING_WEBHOOK_SECRET'] ?? '').trim() || null;
    this.webhookSecret = secret && secret.length >= WEBHOOK_SECRET_MIN ? secret : null;
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    // Fail closed on anything that does not match the approved catalog,
    // exactly like the live path must. The browser never names the price.
    const expected = planPriceForMonths(request.plan, request.months);
    if (expected === null) {
      throw new Error(`Sandbox refuses the checkout: plan '${request.plan}' is not for sale.`);
    }
    if (!Number.isSafeInteger(request.amountPaise) || request.amountPaise !== expected) {
      throw new Error(`Sandbox refuses the checkout: amount does not match the approved price of ${expected} paise.`);
    }
    if (request.currency !== BILLING_CURRENCY) {
      throw new Error(`Sandbox refuses the checkout: currency must be ${BILLING_CURRENCY}.`);
    }
    const reference = `sbx_${request.plan}_${request.months}_${request.amountPaise}_${base36Now(this.now())}`;
    return {
      // A sandbox: URL can never resolve in a browser — clicking it is a
      // visible rehearsal, not an accidental payment page.
      url: `sandbox://checkout/${reference}?return=${encodeURIComponent(request.returnPath)}`,
      reference,
      expiresAt: new Date(this.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  async verifyPayment(reference: string): Promise<ProviderPayment | null> {
    const match = REFERENCE_RE.exec((reference ?? '').trim());
    if (!match) return null;
    const [, plan, monthsRaw, amountRaw, timeRaw, suffix] = match;
    const months = Number(monthsRaw);
    const expected = planPriceForMonths(plan, months);
    const amountPaise = Number(amountRaw);
    // A reference whose amount no longer matches the catalog is not trusted.
    if (expected === null || amountPaise !== expected) return null;
    const seconds = Number.parseInt(timeRaw, 36);
    const occurredAt = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date(this.now()).toISOString();
    if (suffix === '_fail') {
      return { reference, status: 'failed', amountPaise, currency: BILLING_CURRENCY, occurredAt, failureReason: 'sandbox: card declined (rehearsal failure)' };
    }
    if (suffix === '_pending') {
      return { reference, status: 'pending', amountPaise, currency: BILLING_CURRENCY, occurredAt };
    }
    if (suffix === '_refund') {
      return { reference, status: 'refunded', amountPaise, currency: BILLING_CURRENCY, occurredAt };
    }
    return { reference, status: 'succeeded', amountPaise, currency: BILLING_CURRENCY, occurredAt };
  }

  async verifyAndParseWebhook(input: {
    rawBody: string;
    headers: Record<string, string | null>;
  }): Promise<BillingEvent | null> {
    const signatureHeader = caseInsensitiveHeader(input.headers, 'x-billing-signature');
    const timestampHeader = caseInsensitiveHeader(input.headers, 'x-billing-timestamp');
    const verification = verifyBillingSignature({
      rawBody: input.rawBody,
      signatureHeader,
      timestampHeader,
      secret: this.webhookSecret,
    });
    if (!verification.ok) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      return null;
    }
    const event = parseBillingEvent(payload);
    if (!event) return null;
    const record = payload as Record<string, unknown>;
    const accountId = typeof record.account_id === 'string' && record.account_id.trim()
      ? record.account_id.trim()
      : null;
    return {
      id: event.id,
      type: event.type,
      accountId,
      plan: event.plan,
      amountPaise: event.amountPaise,
      currency: event.currency,
      months: event.months,
      status: event.status,
      occurredAt: event.occurredAt,
      failureReason: event.failureReason,
      signatureVerified: true,
    };
  }

  /**
   * The sandbox holds no ledger to reconcile against; it reports nothing
   * matched rather than inventing matches. A real adapter compares the
   * provider's settlement report against billing_webhook_events.
   */
  async reconcile(_since: string): Promise<{ matched: number; missing: string[] }> {
    return { matched: 0, missing: [] };
  }

  async renew(accountId: string, plan: string): Promise<ProviderPayment | null> {
    void accountId; // the sandbox has no mandate to charge; shape must still hold
    const amountPaise = planPriceForMonths(plan, 1);
    if (amountPaise === null) return null;
    return {
      reference: `sbx_renew_${plan}_${base36Now(this.now())}`,
      status: 'succeeded',
      amountPaise,
      currency: BILLING_CURRENCY,
      occurredAt: new Date(this.now()).toISOString(),
    };
  }

  async cancel(accountId: string): Promise<boolean> {
    // Nothing external exists to cancel; the call records intent only.
    return typeof accountId === 'string' && accountId.trim().length > 0;
  }

  async refundStatus(reference: string): Promise<'refunded' | 'not-refunded' | 'unknown'> {
    const value = (reference ?? '').trim();
    if (!value.startsWith('sbx_')) return 'unknown';
    return value.endsWith('_refund') ? 'refunded' : 'not-refunded';
  }
}

function caseInsensitiveHeader(headers: Record<string, string | null>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/**
 * Build the adapter for a given environment, or null when the sandbox is not
 * explicitly allowed. See isSandboxBillingAllowed for the activation rules.
 */
export function createSandboxBillingProvider(
  env: Record<string, string | undefined> = process.env,
): BillingProvider | null {
  // Both the provider name and the opt-in are required; naming a provider is
  // the deployment declaring intent, and the opt-in is the human doing it.
  if ((env['BILLING_PROVIDER'] ?? '').trim() !== SANDBOX_PROVIDER_ID) return null;
  if (!isSandboxBillingAllowed(env)) return null;
  const secret = (env['BILLING_WEBHOOK_SECRET'] ?? '').trim() || null;
  return new SandboxBillingProvider({ webhookSecret: secret });
}

/**
 * Sign a raw body exactly the way verifyBillingSignature expects. Test and
 * rehearsal helper; the deployed app never signs anything.
 */
export function signSandboxWebhookPayload(rawBody: string, secret: string, timestampSeconds?: number): {
  signature: string;
  timestamp: string;
} {
  const timestamp = String(timestampSeconds ?? Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return { signature: `sha256=${signature}`, timestamp };
}
