import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: true }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { getStaffContextDetailed } from './staff';

const accessPayload = {
  plan: 'business',
  status: 'active',
  trial_ends_at: '2026-11-20T00:00:00.000Z',
  days_remaining: 0,
  account_id: 'account-1',
  outlets: { used: 2, limit: null, unlimited: true, remaining: null },
  can_write: true,
  read_only: false,
  features: ['menus', 'kitchen', 'outlets'],
};

function configure(role: 'owner' | 'manager' | 'cashier' | 'kitchen') {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);
  membershipQuery.order.mockResolvedValue({
    data: [{
      restaurant_id: 'restaurant-1',
      role,
      restaurants: {
        name: 'Sample outlet',
        slug: 'sample-outlet',
        timezone: 'Asia/Kolkata',
        tagline: null,
      },
    }],
    error: null,
  });

  const supabase = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'staff-1' } } })) },
    from: vi.fn(() => membershipQuery),
    rpc: vi.fn(async () => ({ data: accessPayload, error: null })),
  };
  mocks.createSupabaseServerClient.mockResolvedValue(supabase);
  mocks.cookies.mockResolvedValue({ get: () => undefined });
}

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.cookies.mockReset();
});

describe('staff context subscription projection', () => {
  it.each(['cashier', 'kitchen'] as const)(
    'keeps %s operational data and strips billing fields even if the RPC returns them',
    async (role) => {
      configure(role);

      const result = await getStaffContextDetailed();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`unexpected blocked staff context: ${result.reason}`);

      expect(result.context.entitlement).toEqual({
        canWrite: true,
        readOnly: false,
        features: ['menus', 'kitchen', 'outlets'],
      });
      expect(result.context.entitlement).not.toHaveProperty('outlets');
      expect(result.context.access).toBeNull();
    },
  );

  it('retains the detailed account projection for Owner and Manager', async () => {
    for (const role of ['owner', 'manager'] as const) {
      configure(role);
      const result = await getStaffContextDetailed();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`unexpected blocked staff context: ${result.reason}`);

      expect(result.context.access).toMatchObject({
        plan: 'business',
        status: 'active',
        accountId: 'account-1',
        canWrite: true,
        outlets: { used: 2, unlimited: true },
      });
      expect(result.context.entitlement).toMatchObject({ outlets: { used: 2, unlimited: true } });
    }
  });
});
