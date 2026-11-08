import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  consumeStaffInviteIpBudget: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/server/staff-invite-rate-limit', () => ({
  consumeStaffInviteIpBudget: mocks.consumeStaffInviteIpBudget,
}));

import { acceptInviteAction } from './actions';

const CODE = 'K7QM-3XPD-9RTW-2HNJ';

function form(): FormData {
  const value = new FormData();
  value.set('code', CODE);
  return value;
}

describe('staff invite actions', () => {
  let destinations: string[];
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    destinations = [];
    mocks.redirect.mockImplementation((destination: string) => {
      destinations.push(destination);
      throw new Error(`REDIRECT:${destination}`);
    });
    rpc = vi.fn();
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'member-1', email: 'staff@example.test' } } }) },
      rpc,
    });
    mocks.consumeStaffInviteIpBudget.mockResolvedValue({ allowed: true });
  });

  it('does not expose raw database error details in the redirect', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal table and SQL detail' } });

    await expect(acceptInviteAction(form())).rejects.toThrow(/^REDIRECT:/);

    expect(destinations[0]).toContain('/join/');
    expect(destinations[0]).toContain('error=');
    expect(destinations[0]).not.toContain('internal table and SQL detail');
  });

  it('stops before redemption and returns a safe rate-limit status', async () => {
    mocks.consumeStaffInviteIpBudget.mockResolvedValue({
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 300,
    });

    await expect(acceptInviteAction(form())).rejects.toThrow(/^REDIRECT:/);

    expect(rpc).not.toHaveBeenCalled();
    expect(destinations[0]).toContain('status=rate_limited');
  });
});
