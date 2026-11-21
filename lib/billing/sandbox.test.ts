/**
 * Sandbox billing adapter tests — no network, no provider, no money.
 *
 * What is proved here: the sandbox is a faithful rehearsal of the real
 * contract (fail-closed activation, catalog-checked checkout, deterministic
 * verification, HMAC webhook round trip), and it is IMPOSSIBLE to activate
 * on a production-declared deployment.
 */

import { describe, expect, it } from 'vitest';

import { planPriceForMonths } from './catalog';
import {
  createSandboxBillingProvider,
  isBillingSandboxActive,
  isSandboxBillingAllowed,
  SandboxBillingProvider,
  SANDBOX_PROVIDER_ID,
  signSandboxWebhookPayload,
} from './sandbox';
import { getBillingProvider } from './provider';

const SANDBOX_ENV = {
  BILLING_PROVIDER: SANDBOX_PROVIDER_ID,
  AUTODINE_BILLING_SANDBOX: '1',
  BILLING_WEBHOOK_SECRET: 'sandbox-webhook-secret-0123456789abcdef',
  VERCEL_ENV: 'preview',
};

const NOW = Date.parse('2026-11-15T02:00:00.000Z');
const secret = SANDBOX_ENV.BILLING_WEBHOOK_SECRET;

describe('sandbox activation rules', () => {
  it('is off by default everywhere', () => {
    expect(isSandboxBillingAllowed({})).toBe(false);
    expect(getBillingProvider({})).toBeNull();
  });

  it('requires BOTH the provider name and the explicit opt-in', () => {
    expect(isSandboxBillingAllowed({ BILLING_PROVIDER: SANDBOX_PROVIDER_ID })).toBe(false);
    expect(isSandboxBillingAllowed({ AUTODINE_BILLING_SANDBOX: '1' })).toBe(true); // opt-in alone grants nothing
    expect(createSandboxBillingProvider({ AUTODINE_BILLING_SANDBOX: '1' })).toBeNull(); // name still required
    expect(createSandboxBillingProvider({ BILLING_PROVIDER: SANDBOX_PROVIDER_ID })).toBeNull(); // opt-in still required
    expect(isBillingSandboxActive({ BILLING_PROVIDER: SANDBOX_PROVIDER_ID })).toBe(false);
    expect(isBillingSandboxActive({ AUTODINE_BILLING_SANDBOX: '1' })).toBe(false);
  });

  it('refuses activation on a production-declared deployment', () => {
    for (const prod of [{ VERCEL_ENV: 'production' }, { AUTODINE_DEPLOY_ENV: 'production' }]) {
      expect(isSandboxBillingAllowed({ ...SANDBOX_ENV, ...prod })).toBe(false);
      expect(createSandboxBillingProvider({ ...SANDBOX_ENV, ...prod })).toBeNull();
      expect(getBillingProvider({ ...SANDBOX_ENV, ...prod })).toBeNull();
    }
  });

  it('activates with name + opt-in off production and ignores the API key', () => {
    const provider = createSandboxBillingProvider(SANDBOX_ENV);
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe(SANDBOX_PROVIDER_ID);
    expect(getBillingProvider(SANDBOX_ENV)).not.toBeNull();
  });

  it('still returns null for unknown live providers even fully configured', () => {
    expect(getBillingProvider({
      BILLING_PROVIDER: 'razorpay',
      BILLING_API_KEY: 'rzp_test_123456',
      BILLING_WEBHOOK_SECRET: 'whatever-secret-0123456789',
    })).toBeNull();
    expect(getBillingProvider({ BILLING_PROVIDER: 'none' })).toBeNull();
  });
});

describe('SandboxBillingProvider', () => {
  const provider = () => new SandboxBillingProvider({ now: () => NOW, webhookSecret: secret });
  const starterAmount = planPriceForMonths('starter', 1)!;

  it('creates a checkout session for the exact catalog price only', async () => {
    const sandbox = provider();
    const session = await sandbox.createCheckoutSession({
      accountId: 'acct_synthetic',
      plan: 'starter',
      months: 1,
      amountPaise: starterAmount,
      currency: 'INR',
      returnPath: '/dashboard/subscription',
    });
    expect(session.url.startsWith('sandbox://checkout/')).toBe(true);
    expect(session.reference).toMatch(/^sbx_starter_1_\d+_[a-z0-9]+$/);
    expect(session.expiresAt).not.toBeNull();

    await expect(sandbox.createCheckoutSession({
      accountId: 'acct_synthetic', plan: 'starter', months: 1,
      amountPaise: starterAmount - 1, currency: 'INR', returnPath: '/dashboard/subscription',
    })).rejects.toThrow(/does not match/);
    await expect(sandbox.createCheckoutSession({
      accountId: 'acct_synthetic', plan: 'platinum', months: 1,
      amountPaise: starterAmount, currency: 'INR', returnPath: '/dashboard/subscription',
    })).rejects.toThrow(/not for sale/);
    await expect(sandbox.createCheckoutSession({
      accountId: 'acct_synthetic', plan: 'starter', months: 1,
      amountPaise: starterAmount, currency: 'USD', returnPath: '/dashboard/subscription',
    })).rejects.toThrow(/INR/);
  });

  it('verifies its own references and refuses foreign or tampered ones', async () => {
    const sandbox = provider();
    const session = await sandbox.createCheckoutSession({
      accountId: 'acct_synthetic', plan: 'professional', months: 2,
      amountPaise: planPriceForMonths('professional', 2)!, currency: 'INR', returnPath: '/dashboard/subscription',
    });
    const payment = await sandbox.verifyPayment(session.reference);
    expect(payment?.status).toBe('succeeded');
    expect(payment?.amountPaise).toBe(planPriceForMonths('professional', 2));
    expect(payment?.currency).toBe('INR');

    expect(await sandbox.verifyPayment('pay_live_razorpay_123')).toBeNull();
    expect(await sandbox.verifyPayment(session.reference.replace('professional', 'starter'))).toBeNull();
    expect(await sandbox.verifyPayment('')).toBeNull();
  });

  it('injects deterministic failure modes for rehearsals', async () => {
    const sandbox = provider();
    const failed = await sandbox.verifyPayment(`sbx_starter_1_${starterAmount}_zzzz_fail`);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toMatch(/sandbox/i);
    const pending = await sandbox.verifyPayment(`sbx_starter_1_${starterAmount}_zzzz_pending`);
    expect(pending?.status).toBe('pending');
    expect(await sandbox.refundStatus(`sbx_starter_1_${starterAmount}_zzzz_refund`)).toBe('refunded');
    expect(await sandbox.refundStatus(session_safe('professional'))).toBe('not-refunded');
    expect(await sandbox.refundStatus('pay_live_123')).toBe('unknown');
  });

  it('renews only catalog plans and cancels only with an account id', async () => {
    const sandbox = provider();
    const renewed = await sandbox.renew('acct_synthetic', 'business');
    expect(renewed?.amountPaise).toBe(planPriceForMonths('business', 1));
    expect(await sandbox.renew('acct_synthetic', 'platinum')).toBeNull();
    expect(await sandbox.cancel('acct_synthetic')).toBe(true);
    expect(await sandbox.cancel('  ')).toBe(false);
  });

  it('reconcile reports zero matches rather than inventing them', async () => {
    const sandbox = provider();
    expect(await sandbox.reconcile(new Date(NOW).toISOString())).toEqual({ matched: 0, missing: [] });
  });

  it('round-trips a signed webhook through verification, parse and catalog validation', async () => {
    const sandbox = provider();
    const body = JSON.stringify({
      event_id: 'evt_rehearsal_1',
      type: 'payment.succeeded',
      account_id: 'acct_synthetic',
      data: {
        restaurant_name: 'synthetic-kitchen',
        plan: 'starter',
        months: 1,
        amount_paise: starterAmount,
        currency: 'INR',
        occurred_at: '2026-11-15T00:00:00.000Z',
      },
    });
    const { signature, timestamp } = signSandboxWebhookPayload(body, secret, Math.floor(Date.now() / 1000));
    const event = await sandbox.verifyAndParseWebhook({
      rawBody: body,
      headers: { 'X-Billing-Signature': signature, 'X-Billing-Timestamp': timestamp },
    });
    expect(event).not.toBeNull();
    expect(event!.signatureVerified).toBe(true);
    expect(event!.id).toBe('evt_rehearsal_1');
    expect(event!.accountId).toBe('acct_synthetic');
    expect(event!.status).toBe('succeeded');
    expect(event!.amountPaise).toBe(starterAmount);

    // Tampered body or wrong signature fails closed to null.
    expect(await sandbox.verifyAndParseWebhook({
      rawBody: body.replace(String(starterAmount), String(starterAmount - 1)),
      headers: { 'x-billing-signature': signature, 'x-billing-timestamp': timestamp },
    })).toBeNull();
    const wrong = signSandboxWebhookPayload(body, 'another-secret-0123456789abcdef', Math.floor(Date.now() / 1000));
    expect(await sandbox.verifyAndParseWebhook({
      rawBody: body,
      headers: { 'x-billing-signature': wrong.signature, 'x-billing-timestamp': wrong.timestamp },
    })).toBeNull();
    // A valid signature with an unsigned-looking body cannot be forged into JSON either.
    expect(await sandbox.verifyAndParseWebhook({
      rawBody: 'not json',
      headers: (() => { const s = signSandboxWebhookPayload('not json', secret, Math.floor(Date.now() / 1000)); return { 'x-billing-signature': s.signature, 'x-billing-timestamp': s.timestamp }; })(),
    })).toBeNull();
  });

  it('refuses webhook verification with no secret configured', async () => {
    const sandbox = new SandboxBillingProvider({ now: () => NOW, webhookSecret: null });
    const body = JSON.stringify({ event_id: 'evt_x', type: 'payment.succeeded' });
    const { signature, timestamp } = signSandboxWebhookPayload(body, secret, Math.floor(Date.now() / 1000));
    expect(await sandbox.verifyAndParseWebhook({
      rawBody: body,
      headers: { 'x-billing-signature': signature, 'x-billing-timestamp': timestamp },
    })).toBeNull();
  });
});

function session_safe(plan: string): string {
  const amount = planPriceForMonths(plan, 1)!;
  return `sbx_${plan}_1_${amount}_aaaa`;
}
