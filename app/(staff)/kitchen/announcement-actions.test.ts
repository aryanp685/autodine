import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: null as unknown,
  rpc: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/staff', () => ({
  getStaffContext: () => Promise.resolve(mocks.staff),
  KITCHEN_ROLES: ['owner', 'manager', 'kitchen'],
}));

import { claimKitchenOrderAnnouncementAction } from './actions';

const orderId = 'a10f6ca2-6eaa-48b6-92f5-819f8437f122';

describe('claimKitchenOrderAnnouncementAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.staff = {
      role: 'kitchen',
      supabase: { rpc: mocks.rpc },
    };
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it('requires a well-formed order id before reaching the database', async () => {
    await expect(claimKitchenOrderAnnouncementAction('not-an-id')).resolves.toEqual({
      ok: false,
      error: 'That order is no longer on the board.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('lets only a kitchen-capable staff role request a claim', async () => {
    mocks.staff = { role: 'cashier', supabase: { rpc: mocks.rpc } };

    await expect(claimKitchenOrderAnnouncementAction(orderId)).resolves.toEqual({
      ok: false,
      error: 'Only kitchen staff can claim an order announcement.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends only the order id to the database and returns its election result', async () => {
    await expect(claimKitchenOrderAnnouncementAction(orderId)).resolves.toEqual({ ok: true, claimed: true });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_kitchen_order_announcement', { p_order_id: orderId });
  });

  it('treats a competing device as a normal, non-error loss', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(claimKitchenOrderAnnouncementAction(orderId)).resolves.toEqual({ ok: true, claimed: false });
  });

  it('fails closed if the database claim cannot be obtained', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'RPC unavailable' } });

    await expect(claimKitchenOrderAnnouncementAction(orderId)).resolves.toEqual({ ok: false, error: 'RPC unavailable' });
  });
});
