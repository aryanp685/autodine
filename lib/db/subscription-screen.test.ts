import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ staff: vi.fn() }));
vi.mock('./staff', () => ({ getStaffContextDetailed: mocks.staff }));
vi.mock('@/lib/billing/provider', () => ({ isBillingProviderConfigured: () => false }));

import { getSubscriptionScreenData } from './subscription-screen';

beforeEach(() => vi.clearAllMocks());

describe('subscription screen reads', () => {
  it.each(['account_subscription_state', 'account_subscription_history', 'account_payment_history'])(
    'does not turn a failed %s read into an empty account',
    async (failedRpc) => {
      const rpc = vi.fn(async (name: string) => ({
        data: name === failedRpc ? null : [],
        error: name === failedRpc ? { message: 'database unavailable' } : null,
      }));
      mocks.staff.mockResolvedValue({ ok: true, context: { supabase: { rpc }, restaurantId: 'restaurant-1', role: 'owner' } });
      await expect(getSubscriptionScreenData()).rejects.toThrow(/database unavailable/);
      expect(rpc).toHaveBeenCalledWith('account_subscription_state', { p_restaurant_id: 'restaurant-1' });
    },
  );

  it('preserves a successful empty history', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    mocks.staff.mockResolvedValue({ ok: true, context: { supabase: { rpc }, restaurantId: 'restaurant-1', role: 'owner' } });
    await expect(getSubscriptionScreenData()).resolves.toMatchObject({ ok: true, data: { history: [], payments: [] } });
  });

  it('does not read billing without a staff session', async () => {
    mocks.staff.mockResolvedValue({ ok: false, reason: 'signed-out' });
    await expect(getSubscriptionScreenData()).resolves.toEqual({ ok: false, reason: 'signed-out' });
  });
});
