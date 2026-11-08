import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: null as unknown,
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/db/staff', () => ({
  getStaffContext: () => Promise.resolve(mocks.staff),
  KITCHEN_ROLES: ['owner', 'manager', 'kitchen'],
}));

import {
  claimKitchenOrderAnnouncementAction,
  claimTableWaiterCallAnnouncementAction,
  recordKitchenAnnouncementResultAction,
  recordTableWaiterCallAnnouncementAction,
  resolveTableWaiterCallAction,
} from './actions';

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

describe('durable kitchen announcement results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.staff = { role: 'kitchen', supabase: { rpc: mocks.rpc } };
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it('records a bounded failure result only for kitchen-capable staff', async () => {
    mocks.staff = { role: 'cashier', supabase: { rpc: mocks.rpc } };
    await expect(recordKitchenAnnouncementResultAction({ orderId, status: 'failed', failureReason: 'x' })).resolves.toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.staff = { role: 'kitchen', supabase: { rpc: mocks.rpc } };
    const failureReason = 'x'.repeat(300);
    await expect(recordKitchenAnnouncementResultAction({ orderId, status: 'failed', failureReason })).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('record_kitchen_announcement_result', {
      p_order_id: orderId,
      p_status: 'failed',
      p_failure_reason: 'x'.repeat(200),
    });
  });
});

describe('table waiter call staff actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.staff = { role: 'kitchen', supabase: { rpc: mocks.rpc } };
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it('lets an authorized cashier claim and report a waiter-call announcement', async () => {
    mocks.staff = { role: 'cashier', supabase: { rpc: mocks.rpc } };
    await expect(claimTableWaiterCallAnnouncementAction(orderId)).resolves.toEqual({ ok: true, claimed: true });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_table_waiter_call_announcement', { p_call_id: orderId });

    await expect(recordTableWaiterCallAnnouncementAction({ callId: orderId, status: 'announced' })).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('record_table_waiter_call_announcement', {
      p_call_id: orderId,
      p_status: 'announced',
      p_failure_reason: null,
    });
  });

  it('resolves a call and refreshes the kitchen route only when the RPC succeeds', async () => {
    await expect(resolveTableWaiterCallAction(orderId)).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_table_waiter_call', { p_call_id: orderId });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/kitchen');

    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(resolveTableWaiterCallAction(orderId)).resolves.toMatchObject({ ok: false });
  });
});
