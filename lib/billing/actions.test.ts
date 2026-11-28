import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffResult: null as unknown,
  getBillingProvider: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/site-origin', () => ({ siteOrigin: async () => 'https://new-alpha-five-43.vercel.app' }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed: () => Promise.resolve(mocks.staffResult) }));
vi.mock('./provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./provider')>();
  return { ...actual, getBillingProvider: mocks.getBillingProvider };
});

import {
  choosePlanAction,
  requestCancellationAction,
  retryPaymentAction,
  withdrawCancellationAction,
} from './actions';

function signedIn(role: 'owner' | 'manager' | 'cashier' | 'kitchen') {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return {
    value: { ok: true, context: { role, restaurantId: 'restaurant-1', supabase: { rpc } } },
    rpc,
  };
}

beforeEach(() => {
  mocks.staffResult = null;
  mocks.getBillingProvider.mockReset().mockReturnValue(null);
  mocks.rpc.mockReset();
});

describe('subscription Server Action authorization', () => {
  it.each(['manager', 'cashier', 'kitchen'] as const)('%s cannot call owner-only subscription actions', async (role) => {
    const staff = signedIn(role);
    mocks.staffResult = staff.value;

    const [choose, retry, request, withdraw] = await Promise.all([
      choosePlanAction('professional'),
      retryPaymentAction(),
      requestCancellationAction(),
      withdrawCancellationAction(),
    ]);

    expect(choose).toEqual({ ok: false, message: 'Only an owner of this account can change the plan.' });
    for (const result of [retry, request, withdraw]) {
      expect(result).toEqual({ ok: false, message: 'Only an owner of this account can manage the subscription.' });
    }
    expect(staff.rpc).not.toHaveBeenCalled();
    expect(mocks.getBillingProvider).not.toHaveBeenCalled();
  });

  it('keeps owner actions on the existing fail-closed provider path', async () => {
    const staff = signedIn('owner');
    mocks.staffResult = staff.value;

    const result = await choosePlanAction('professional');

    expect(result.ok).toBe(false);
    expect(result.providerUnavailable).toBe(true);
    expect(mocks.getBillingProvider).toHaveBeenCalledOnce();
    expect(staff.rpc).not.toHaveBeenCalled();
  });

  it('returns the buyer to the welcome screen for the plan they bought', async () => {
    const staff = signedIn('owner');
    mocks.staffResult = staff.value;
    const createCheckoutSession = vi
      .fn()
      .mockResolvedValue({ url: 'https://payments.cashfree.com/order/#session_1', reference: 'ad_1' });
    mocks.getBillingProvider.mockReturnValue({ name: 'cashfree', createCheckoutSession });

    const result = await choosePlanAction('professional');

    expect(result).toMatchObject({ ok: true, checkoutUrl: 'https://payments.cashfree.com/order/#session_1' });
    // Cashfree appends its own query params to return_url, so the plan travels
    // in the path.
    expect(createCheckoutSession.mock.calls[0][0].returnPath).toBe(
      '/dashboard/subscription/welcome/professional'
    );
  });
});

describe('requesting a cancellation', () => {
  it('turns each database refusal into a sentence the owner can act on', async () => {
    const staff = signedIn('owner');
    mocks.staffResult = staff.value;

    staff.rpc.mockResolvedValueOnce({ data: null, error: { message: 'nothing_to_cancel' } });
    expect(await requestCancellationAction()).toEqual({
      ok: false,
      message:
        'This subscription has already ended, so there is nothing left to cancel. Choose a plan to start again.',
    });

    staff.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_found' } });
    expect(await requestCancellationAction()).toEqual({
      ok: false,
      message: 'Only an owner of this account can cancel the subscription.',
    });
  });

  it('answers a repeated request with the date already recorded instead of a second one', async () => {
    const staff = signedIn('owner');
    mocks.staffResult = staff.value;

    staff.rpc
      .mockResolvedValueOnce({ data: { status: 'requested', effective_at: '2026-12-01T12:00:00Z' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'already_requested', effective_at: '2026-12-01T12:00:00Z' }, error: null });

    const first = await requestCancellationAction();
    const second = await requestCancellationAction();

    expect(first).toMatchObject({ ok: true, message: 'Cancellation requested. Every outlet and every row of data stays readable until 1 December 2026.' });
    expect(second).toMatchObject({
      ok: true,
      message: 'This subscription is already set to end on 1 December 2026. Nothing else to do.',
    });
  });
});
