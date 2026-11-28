/**
 * /api/billing/webhook route tests — the whole gate, with the database mocked.
 *
 * The route is the ONLY path that may switch a paid plan on, so the tests
 * cover the security order: 503 unconfigured → 400 unsigned/stale → duplicate
 * replay short-circuit → catalog refusal → RPC dispatch → outcome recorded.
 * The sandbox provider signs what a rehearsal would send; nothing here calls
 * a network or a real database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  rpc: vi.fn(),
  adminConfigured: { value: true },
  adminClient: { value: null as unknown },
}));

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => mocks.adminClient.value,
}));
vi.mock('@/lib/supabase/env', () => ({
  get isSupabaseAdminConfigured() {
    return mocks.adminConfigured.value;
  },
}));

import { POST, GET } from './route';
import { PLAN_PRICES } from '@/lib/billing/catalog';
import { signSandboxWebhookPayload } from '@/lib/billing/sandbox';
import { signCashfreeWebhookPayload } from '@/lib/billing/cashfree';

const SECRET = 'route-test-webhook-secret-0123456789abcdef';
const starter = PLAN_PRICES.find((plan) => plan.id === 'starter')!;

function chainable() {
  const chain: { update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> } = {
    update: vi.fn(),
    eq: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  // The route never reads the outcome of the update; the final .eq is awaited,
  // so it only has to be thenable-or-value. Returning the chain satisfies both.
  chain.eq.mockReturnValue(chain);
  return chain;
}

function makeAdmin(slugs: Record<string, string> = {}) {
  const chain = chainable();
  mocks.update.mockReturnValue(chain);
  // The route resolves a checkout's slug tag to the restaurant name the payment
  // RPCs key on. An unknown slug reads as no row, so the tag passes through.
  const restaurants = {
    select: vi.fn(() => ({
      eq: vi.fn((_column: string, value: string) => ({
        limit: vi.fn(async () => ({
          data: slugs[value] ? [{ name: slugs[value] }] : [],
          error: null,
        })),
      })),
    })),
  };
  return {
    from: vi.fn((table: string) =>
      table === 'restaurants'
        ? { select: restaurants.select }
        : { insert: mocks.insert, update: mocks.update },
    ),
    rpc: mocks.rpc,
  };
}

function signedRequest(payload: Record<string, unknown>): Request {
  const rawBody = JSON.stringify(payload);
  const { signature, timestamp } = signSandboxWebhookPayload(rawBody, SECRET);
  return new Request('http://localhost/api/billing/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-billing-signature': signature,
      'x-billing-timestamp': timestamp,
    },
    body: rawBody,
  });
}

const succeededPayload = {
  event_id: 'evt_route_1',
  type: 'payment.succeeded',
  data: {
    restaurant_name: 'synthetic-kitchen',
    plan: 'starter',
    months: 1,
    amount_paise: starter.paise,
    currency: 'INR',
    occurred_at: '2026-11-15T00:00:00.000Z',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BILLING_PROVIDER;
  delete process.env.AUTODINE_BILLING_SANDBOX;
  delete process.env.BILLING_WEBHOOK_SECRET;
  mocks.adminConfigured.value = true;
  mocks.insert.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: { applied: true }, error: null });
  mocks.adminClient.value = makeAdmin();
});

describe('POST /api/billing/webhook', () => {
  it('503s and records nothing when the provider is not configured', async () => {
    const response = await POST(signedRequest(succeededPayload));
    expect(response.status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('503s when only the sandbox name is set without the opt-in', async () => {
    process.env.BILLING_PROVIDER = 'sandbox';
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    const response = await POST(signedRequest(succeededPayload));
    expect(response.status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('400s on a bad signature before touching the database', async () => {
    process.env.BILLING_PROVIDER = 'sandbox';
    process.env.AUTODINE_BILLING_SANDBOX = '1';
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    const rawBody = JSON.stringify(succeededPayload);
    const response = await POST(new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-billing-signature': 'sha256=deadbeef', 'x-billing-timestamp': String(Math.floor(Date.now() / 1000)) },
      body: rawBody,
    }));
    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('records the event then applies a valid succeeded payment via RPC', async () => {
    process.env.BILLING_PROVIDER = 'sandbox';
    process.env.AUTODINE_BILLING_SANDBOX = '1';
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    const response = await POST(signedRequest(succeededPayload));
    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledOnce();
    const insertArg = mocks.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg).toMatchObject({ provider: 'sandbox', provider_event_id: 'evt_route_1', signature_ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('record_subscription_payment', expect.objectContaining({
      p_restaurant_name: 'synthetic-kitchen',
      p_provider: 'sandbox',
      p_provider_event_id: 'evt_route_1',
      p_plan: 'starter',
      p_amount_paise: starter.paise,
      p_currency: 'INR',
      p_months: 1,
    }));
  });

  it('resolves a checkout slug tag to the restaurant name the RPCs key on', async () => {
    process.env.BILLING_PROVIDER = 'sandbox';
    process.env.AUTODINE_BILLING_SANDBOX = '1';
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    mocks.adminClient.value = makeAdmin({ 'synthetic-kitchen': 'Synthetic Kitchen' });
    const response = await POST(signedRequest({
      ...succeededPayload,
      event_id: 'evt_route_slug',
      data: { ...succeededPayload.data, restaurant_name: 'synthetic-kitchen' },
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('record_subscription_payment', expect.objectContaining({
      p_restaurant_name: 'Synthetic Kitchen',
    }));
  });

  it('a duplicate event id is a 200 no-op: no RPC, no second payment', async () => {
    process.env.BILLING_PROVIDER = 'sandbox';
    process.env.AUTODINE_BILLING_SANDBOX = '1';
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    mocks.insert.mockResolvedValueOnce({ error: { message: 'duplicate key value violates unique constraint' } });
    const response = await POST(signedRequest(succeededPayload));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'duplicate' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a signed-but-wrong-amount payload and never calls the RPC', async () => {
    process.env.BILLING_PROVIDER = 'sandbox';
    process.env.AUTODINE_BILLING_SANDBOX = '1';
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    const response = await POST(signedRequest({
      ...succeededPayload,
      event_id: 'evt_route_2',
      data: { ...succeededPayload.data, amount_paise: starter.paise - 1 },
    }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('answers Cashfree’s dashboard test ping 200 and grants nothing', async () => {
    process.env.BILLING_PROVIDER = 'cashfree';
    process.env.CASHFREE_CLIENT_ID = 'cfapp123';
    process.env.CASHFREE_CLIENT_SECRET = SECRET;
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    const rawBody = JSON.stringify({ type: 'WEBHOOK', data: { order: {}, payment: {} } });
    const { signature, timestamp } = signCashfreeWebhookPayload(rawBody, SECRET);
    try {
      const response = await POST(
        new Request('http://localhost/api/billing/webhook', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': signature,
            'x-webhook-timestamp': timestamp,
          },
          body: rawBody,
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ignored' });
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      delete process.env.CASHFREE_CLIENT_ID;
      delete process.env.CASHFREE_CLIENT_SECRET;
    }
  });

  it('GET is refused with 405', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
  });
});
