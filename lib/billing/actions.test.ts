import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffResult: null as unknown,
  getBillingProvider: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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
});
