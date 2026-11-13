import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECOVERY_STATE_COOKIE,
  RECOVERY_STATE_TTL_SECONDS,
  isValidRecoveryState,
} from '@/lib/password';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn(),
  requestOrigin: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  signUp: vi.fn(),
  profileUpsert: vi.fn(),
  createAccountWithRestaurant: vi.fn(),
  slugify: vi.fn(),
  uniqueSlug: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/site-origin', () => ({ requestOrigin: mocks.requestOrigin }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed: vi.fn() }));
vi.mock('@/lib/db/team', () => ({ homeForRole: vi.fn() }));
vi.mock('@/lib/slug', () => ({ slugify: mocks.slugify, uniqueSlug: mocks.uniqueSlug }));

import { requestPasswordResetAction, resendSignupConfirmationAction, signUpAction } from './actions';
import { PENDING_SIGNUP_EMAIL_COOKIE } from '@/lib/signup-confirmation';

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

function form(email = ' Owner@Example.test '): FormData {
  const value = new FormData();
  value.set('email', email);
  return value;
}

function signupForm(email = ' Owner@Example.test '): FormData {
  const value = form(email);
  value.set('fullName', 'Asha Owner');
  value.set('restaurantName', 'Saffron Room');
  value.set('phone', '');
  value.set('password', 'Strong-Owner-Password9!');
  value.set('agree', 'on');
  return value;
}

function signupAdmin() {
  return {
    from: (table: string) =>
      table === 'restaurants'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
        : { upsert: mocks.profileUpsert },
    rpc: mocks.createAccountWithRestaurant,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  mocks.cookies.mockResolvedValue(cookieStore);
  mocks.requestOrigin.mockResolvedValue('https://autodine.example');
  mocks.getSupabaseAdmin.mockReturnValue(null);
  mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  mocks.profileUpsert.mockResolvedValue({ error: null });
  mocks.createAccountWithRestaurant.mockResolvedValue({ data: 'restaurant-id', error: null });
  mocks.slugify.mockReturnValue('saffron-room');
  mocks.uniqueSlug.mockImplementation(async (slug: string) => slug);
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.resend.mockResolvedValue({ error: null });
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: {
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      resend: mocks.resend,
    },
  });
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  });
});

describe('requestPasswordResetAction', () => {
  it('correlates the PKCE recovery redirect with a short-lived HTTP-only browser cookie', async () => {
    await expect(requestPasswordResetAction(form())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'owner@example.test',
      expect.objectContaining({ redirectTo: expect.any(String) }),
    );
    const redirectTo = new URL(mocks.resetPasswordForEmail.mock.calls[0][1].redirectTo);
    const state = redirectTo.searchParams.get('state');

    expect(redirectTo.origin).toBe('https://autodine.example');
    expect(redirectTo.pathname).toBe('/auth/confirm');
    expect(redirectTo.searchParams.get('flow')).toBe('recovery');
    expect(isValidRecoveryState(state)).toBe(true);
    expect(cookieStore.set).toHaveBeenCalledWith(
      RECOVERY_STATE_COOKIE,
      state,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: RECOVERY_STATE_TTL_SECONDS,
        secure: true,
      }),
    );
  });

  it('reuses a valid pending state so requesting another email does not invalidate the prior callback state', async () => {
    const pendingState = 'B'.repeat(43);
    cookieStore.get.mockReturnValue({ value: pendingState });

    await expect(requestPasswordResetAction(form())).rejects.toThrow(/^REDIRECT:/);

    const redirectTo = new URL(mocks.resetPasswordForEmail.mock.calls[0][1].redirectTo);
    expect(redirectTo.searchParams.get('state')).toBe(pendingState);
    expect(cookieStore.set).toHaveBeenCalledWith(
      RECOVERY_STATE_COOKIE,
      pendingState,
      expect.any(Object),
    );
  });

  it('returns a safe rate-limit message without persisting recovery state', async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({
      error: { status: 429, message: 'rate limit exceeded' },
    });

    await expect(requestPasswordResetAction(form())).rejects.toThrow(/^REDIRECT:/);

    const destination = mocks.redirect.mock.calls[0][0] as string;
    expect(new URL(destination, 'https://autodine.example').searchParams.get('error')).toMatch(/too many reset emails/i);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe('resendSignupConfirmationAction', () => {
  const idle = { status: 'idle' } as const;

  it('normalizes the address and uses the owner PKCE confirmation callback', async () => {
    const result = await resendSignupConfirmationAction(idle, form(' Owner@Example.Test '));

    expect(result).toEqual({ status: 'requested' });
    expect(mocks.createSupabaseServerClient).toHaveBeenCalledWith({
      preservePkceVerifierCookiesOnAuthError: true,
    });
    expect(mocks.resend).toHaveBeenCalledTimes(1);
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'owner@example.test',
      options: {
        emailRedirectTo: 'https://autodine.example/auth/confirm?flow=signup&next=%2Fdashboard',
      },
    });
  });

  it('rejects invalid email before constructing an Auth client', async () => {
    const result = await resendSignupConfirmationAction(idle, form('not-an-email'));

    expect(result).toEqual({ status: 'invalid' });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('keeps the result identical for Supabase Auth 429 without exposing a per-address cooldown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.resend.mockResolvedValueOnce({
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'private Auth response' },
    });

    const result = await resendSignupConfirmationAction(idle, form());

    expect(result).toEqual({ status: 'requested' });
    expect(JSON.stringify(result)).not.toContain('private Auth response');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private Auth response');
    warn.mockRestore();
  });

  it('keeps the result identical for provider failures without claiming delivery', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.resend.mockResolvedValueOnce({
      error: { status: 500, code: 'smtp_unavailable', message: 'private provider response' },
    });

    const result = await resendSignupConfirmationAction(idle, form());

    expect(result).toEqual({ status: 'requested' });
    expect(JSON.stringify(result)).not.toContain('private provider response');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private provider response');
    warn.mockRestore();
  });

  it('keeps the result identical for transport failures and does not return account details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.resend.mockRejectedValueOnce(new Error('private transport response'));

    const result = await resendSignupConfirmationAction(idle, form());

    expect(result).toEqual({ status: 'requested' });
    expect(JSON.stringify(result)).not.toContain('private transport response');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private transport response');
    warn.mockRestore();
  });
});

describe('owner signup confirmation recovery', () => {
  it('routes an enumeration-protected same-email retry to the generic pending page without another workspace', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(signupAdmin());
    mocks.signUp.mockResolvedValueOnce({
      data: { user: { id: 'existing-user', identities: [] }, session: null },
      error: null,
    });

    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'owner@example.test',
      password: 'Strong-Owner-Password9!',
      options: {
        data: { full_name: 'Asha Owner', phone: '' },
        emailRedirectTo: 'https://autodine.example/auth/confirm?flow=signup&next=%2Fdashboard',
      },
    });
    expect(mocks.redirect).toHaveBeenCalledWith('/signup/confirmation-pending');
    expect(cookieStore.set).toHaveBeenCalledWith(
      PENDING_SIGNUP_EMAIL_COOKIE,
      'owner@example.test',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/signup', secure: true }),
    );
    expect(mocks.profileUpsert).not.toHaveBeenCalled();
    expect(mocks.createAccountWithRestaurant).not.toHaveBeenCalled();
  });

  it('uses the same pending response for Auth/provider rejection and creates no workspace', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(signupAdmin());
    mocks.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { status: 500, code: 'smtp_unavailable', message: 'private provider detail' },
    });

    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.redirect).toHaveBeenCalledWith('/signup/confirmation-pending');
    expect(cookieStore.set).toHaveBeenCalledWith(
      PENDING_SIGNUP_EMAIL_COOKIE,
      'owner@example.test',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/signup' }),
    );
    expect(mocks.profileUpsert).not.toHaveBeenCalled();
    expect(mocks.createAccountWithRestaurant).not.toHaveBeenCalled();
  });

  it('creates the workspace before showing confirmation pending for a new unconfirmed owner', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(signupAdmin());
    mocks.signUp.mockResolvedValueOnce({
      data: {
        user: { id: 'new-owner', identities: [{ identity_id: 'identity-1' }] },
        session: null,
      },
      error: null,
    });

    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.profileUpsert).toHaveBeenCalledWith(
      { id: 'new-owner', full_name: 'Asha Owner', phone: '' },
      { onConflict: 'id' },
    );
    expect(mocks.createAccountWithRestaurant).toHaveBeenCalledWith(
      'create_account_with_restaurant',
      {
        p_name: 'Saffron Room',
        p_slug: 'saffron-room',
        p_timezone: 'Asia/Kolkata',
        p_owner: 'new-owner',
      },
    );
    expect(mocks.redirect).toHaveBeenCalledWith('/signup/confirmation-pending');
  });
});
