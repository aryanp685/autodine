import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  consumeStaffInviteIpBudget: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  requestOrigin: vi.fn(),
  signUp: vi.fn(),
  profileUpsert: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock('@/lib/site-origin', () => ({ requestOrigin: mocks.requestOrigin }));
vi.mock('@/lib/server/staff-invite-rate-limit', () => ({
  consumeStaffInviteIpBudget: mocks.consumeStaffInviteIpBudget,
}));

import { acceptInviteAction, joinSignUpAction } from './actions';

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
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'member-1', email: 'staff@example.test' } } }),
        signUp: mocks.signUp,
      },
      rpc,
    });
    mocks.getSupabaseAdmin.mockReturnValue({ from: () => ({ upsert: mocks.profileUpsert }) });
    mocks.requestOrigin.mockResolvedValue('https://autodine.example');
    mocks.profileUpsert.mockResolvedValue({ error: null });
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'new-staff', identities: [{ identity_id: 'identity-1' }] }, session: null },
      error: null,
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

  describe('signing up through an invitation', () => {
    function joinForm(): FormData {
      const value = form();
      value.set('fullName', 'Kiran Cook');
      value.set('email', ' Cook@Example.test ');
      value.set('password', 'Strong-Staff-Password9!');
      return value;
    }

    it('asks for email confirmation back to this invitation and does not redeem early', async () => {
      await expect(joinSignUpAction(joinForm())).rejects.toThrow(/^REDIRECT:/);

      expect(mocks.signUp).toHaveBeenCalledWith({
        email: 'cook@example.test',
        password: 'Strong-Staff-Password9!',
        options: {
          data: { full_name: 'Kiran Cook' },
          emailRedirectTo: `https://autodine.example/auth/confirm?next=${encodeURIComponent(`/join/${CODE}`)}`,
        },
      });
      expect(mocks.profileUpsert).toHaveBeenCalledWith(
        { id: 'new-staff', full_name: 'Kiran Cook' },
        { onConflict: 'id' },
      );
      // No session yet: redemption waits for the confirmed sign-in.
      expect(rpc).not.toHaveBeenCalled();
      expect(destinations[0]).toContain('/login?next=');
      expect(decodeURIComponent(destinations[0])).toContain('Check your email to confirm your address');
    });

    it('sends an enumeration-protected existing address to sign-in instead of duplicating it', async () => {
      mocks.signUp.mockResolvedValueOnce({
        data: { user: { id: 'existing-staff', identities: [] }, session: null },
        error: null,
      });

      await expect(joinSignUpAction(joinForm())).rejects.toThrow(/^REDIRECT:/);

      expect(mocks.profileUpsert).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(decodeURIComponent(destinations[0])).toContain('An account already uses that email');
    });

    it('redeems immediately when signup returns a session (confirmation off)', async () => {
      mocks.signUp.mockResolvedValueOnce({
        data: {
          user: { id: 'new-staff', identities: [{ identity_id: 'identity-1' }] },
          session: { access_token: 'session-token' },
        },
        error: null,
      });
      rpc.mockResolvedValue({ data: [{ status: 'ok', role: 'kitchen' }], error: null });

      await expect(joinSignUpAction(joinForm())).rejects.toThrow(/^REDIRECT:/);

      expect(rpc).toHaveBeenCalledWith('redeem_staff_invite', { p_code: 'K7QM3XPD9RTW2HNJ' });
      expect(destinations[0]).toBe('/kitchen');
    });
  });
});
