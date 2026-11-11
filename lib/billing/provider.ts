/**
 * The payment-provider boundary.
 *
 * NO PROVIDER IS APPROVED OR CONFIGURED.
 *
 * Everything on this side of the line is provider-independent: the catalog,
 * the payment records, the receipts, the entitlement checks, the cancellation
 * flow, the expiry rules. Everything on the other side — a checkout session, a
 * charge, a webhook — goes through this interface, and today it is
 * unconfigured, so every call fails closed.
 *
 * `getBillingProvider()` returns null until the deployment declares a provider
 * AND supplies its credentials. It never guesses a name, never defaults to a
 * sandbox, and never invents a key. A caller that ignores the null gets a
 * thrown error from `requireBillingProvider()`, not a silent no-op that looks
 * like success.
 *
 * The interface is deliberately the shape a real provider has to fill: creating
 * a checkout session, verifying a payment, verifying and parsing a webhook,
 * reconciling, renewing, cancelling and reading refund status. Filling it in is
 * the whole of the provider-dependent work; nothing else in the codebase has to
 * change when that happens.
 */

import { BILLING_CURRENCY } from './catalog';

/** How the deployment names the provider it has approved. */
export const BILLING_PROVIDER_ENV = 'BILLING_PROVIDER';
/** The shared secret used to sign webhooks. Without it, no webhook is believed. */
export const BILLING_WEBHOOK_SECRET_ENV = 'BILLING_WEBHOOK_SECRET';
/** Provider API key. Absent means "cannot call the provider", not "may skip it". */
export const BILLING_API_KEY_ENV = 'BILLING_API_KEY';

export type CheckoutSession = {
  /** Where the browser goes to pay. */
  url: string;
  /** The provider's id for this attempt, stored against the payment. */
  reference: string;
  expiresAt: string | null;
};

export type CheckoutRequest = {
  /** Our account id. The provider is told the plan, never our internals. */
  accountId: string;
  plan: string;
  months: number;
  amountPaise: number;
  currency: string;
  /** Where to return the browser. Relative to this site. */
  returnPath: string;
};

export type ProviderPayment = {
  reference: string;
  status: 'succeeded' | 'failed' | 'pending' | 'refunded';
  amountPaise: number;
  currency: string;
  occurredAt: string;
  failureReason?: string | null;
};

/**
 * A parsed, UNTRUSTED-then-validated billing event.
 *
 * Nothing in here is believed because the payload said so. `signatureVerified`
 * is set by the verifier, and a caller must check it before acting.
 */
export type BillingEvent = {
  /** The provider's own id for the event. The replay-protection key. */
  id: string;
  type: string;
  /** Our account id, as the provider knew it. */
  accountId: string | null;
  plan: string | null;
  amountPaise: number | null;
  currency: string | null;
  months: number;
  status: 'succeeded' | 'failed' | 'refunded' | 'unknown';
  occurredAt: string | null;
  failureReason?: string | null;
  /** True only when the signature check passed. Never trust the payload itself. */
  signatureVerified: boolean;
};

export type BillingProvider = {
  /** Which provider this is, as configured. */
  readonly name: string;
  /**
   * Create a checkout session. Must not be called unless a provider is
   * configured: nothing in this deployment may take money yet.
   */
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Ask the provider what became of one attempt. */
  verifyPayment(reference: string): Promise<ProviderPayment | null>;
  /** Verify the signature on a raw webhook body and parse it. */
  verifyAndParseWebhook(input: {
    rawBody: string;
    headers: Record<string, string | null>;
  }): Promise<BillingEvent | null>;
  /** Reconcile our records against the provider's for a period. */
  reconcile(since: string): Promise<{ matched: number; missing: string[] }>;
  /** Charge a saved mandate for the next period. */
  renew(accountId: string, plan: string): Promise<ProviderPayment | null>;
  /** Cancel a subscription at the end of its period. */
  cancel(accountId: string): Promise<boolean>;
  /** Refund or chargeback status, where the provider supports it. */
  refundStatus(reference: string): Promise<'refunded' | 'not-refunded' | 'unknown'>;
};

/**
 * The provider, or null when none is configured.
 *
 * Returns null rather than a stub that silently succeeds: an unconfigured
 * deployment must not be able to take an order for money it cannot collect,
 * and a caller that forgets to check gets a thrown error rather than a fake
 * checkout URL.
 */
export function getBillingProvider(
  env: Record<string, string | undefined> = process.env,
): BillingProvider | null {
  const name = (env[BILLING_PROVIDER_ENV] ?? '').trim();
  const apiKey = (env[BILLING_API_KEY_ENV] ?? '').trim();
  const webhookSecret = (env[BILLING_WEBHOOK_SECRET_ENV] ?? '').trim();

  // All three, or nothing. A provider named without credentials is a
  // deployment mistake, and the safe reading of a mistake is "not configured".
  if (!name || name === 'none' || !apiKey || !webhookSecret) return null;

  // Even fully configured, there is still nothing to return: no adapter is
  // approved or written. This is not an oversight to be filled in by returning
  // something — it is the whole of the "no provider" guarantee, and it stays
  // null until a real adapter is written for a real approved provider.
  return null;
}

/** True when a provider is approved and fully configured. */
export function isBillingProviderConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getBillingProvider(env) !== null;
}

/** The webhook secret, or null. Without it no webhook is believed. */
export function billingWebhookSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!isBillingProviderConfigured(env)) return null;
  const secret = (env[BILLING_WEBHOOK_SECRET_ENV] ?? '').trim();
  return secret.length >= 16 ? secret : null;
}

/**
 * The provider, or a thrown error.
 *
 * Every money path calls this, so "no provider" is one sentence in one place
 * rather than a different shrug on every screen.
 */
export function requireBillingProvider(
  env: Record<string, string | undefined> = process.env,
): BillingProvider {
  const provider = getBillingProvider(env);
  if (!provider) throw new Error('No payment provider is configured.');
  return provider;
}

/**
 * What an owner is told when they press a Buy button today.
 *
 * It says what is true: the plans and prices are approved, the billing system
 * is built, and no provider has been switched on. It does not say "coming
 * soon", because that is a promise, and it does not offer a workaround.
 */
export const PROVIDER_UNAVAILABLE_MESSAGE =
  'Online payment is not switched on yet. Your trial keeps running, and nothing is charged. Write to us and we will set your plan up directly.';

/** The currency every amount is checked against before it is recorded. */
export const EXPECTED_CURRENCY = BILLING_CURRENCY;
