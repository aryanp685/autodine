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
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getStaffContextDetailed: vi.fn(),
  homeForRole: vi.fn(),
  consumeSignInAttemptBudgetForCaller: vi.fn(),
  releaseSignInAttemptBudgetForCaller: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/site-origin', () => ({ requestOrigin: mocks.requestOrigin }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed: mocks.getStaffContextDetailed }));
vi.mock('@/lib/db/team', () => ({ homeForRole: mocks.homeForRole }));
vi.mock('@/lib/server/sign-in-rate-limit', () => ({
  consumeSignInAttemptBudgetForCaller: mocks.consumeSignInAttemptBudgetForCaller,
  releaseSignInAttemptBudgetForCaller: mocks.releaseSignInAttemptBudgetForCaller,
}));
vi.mock('@/lib/slug', () => ({ slugify: mocks.slugify, uniqueSlug: mocks.uniqueSlug }));

import {
  requestPasswordResetAction,
  resendSignupConfirmationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from './actions';
import { PENDING_SIGNUP_EMAIL_COOKIE } from '@/lib/signup-confirmation';
import { RECOVERY_COOKIE } from '@/lib/password';
import { operationalIncidents } from '@/lib/incident-registry';

function incidentCount(kind: string): number {
  return operationalIncidents.list().find((record) => record.kind === kind)?.count ?? 0;
}

function incidentSummary(kind: string): string {
  return operationalIncidents.list().find((record) => record.kind === kind)?.summary ?? '';
}

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
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.consumeSignInAttemptBudgetForCaller.mockResolvedValue({ allowed: true });
  mocks.releaseSignInAttemptBudgetForCaller.mockResolvedValue(undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@example.test' } } });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.getStaffContextDetailed.mockResolvedValue({ ok: true, context: { role: 'owner' } });
  mocks.homeForRole.mockReturnValue('/dashboard');
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: {
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      resend: mocks.resend,
      signInWithPassword: mocks.signInWithPassword,
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
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

describe('verified account login', () => {
  function loginForm(email = ' Owner@Example.test ', password = 'correct horse', next?: string): FormData {
    const value = form(email);
    value.set('password', password);
    if (next !== undefined) value.set('next', next);
    return value;
  }

  it('signs a verified account in and lands on the role home', async () => {
    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.test',
      password: 'correct horse',
    });
    expect(mocks.getStaffContextDetailed).toHaveBeenCalledTimes(1);
    expect(mocks.homeForRole).toHaveBeenCalledWith('owner');
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('honours a safe same-origin next and refuses an off-site one', async () => {
    await expect(signInAction(loginForm('owner@example.test', 'pw', '/join/K7QM-3XPD'))).rejects.toThrow(/^REDIRECT:/);
    expect(mocks.redirect).toHaveBeenCalledWith('/join/K7QM-3XPD');
    expect(mocks.getStaffContextDetailed).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: true, context: { role: 'owner' } });
    mocks.homeForRole.mockReturnValue('/dashboard');
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { signInWithPassword: mocks.signInWithPassword },
    });
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });

    await expect(signInAction(loginForm('owner@example.test', 'pw', 'https://evil.example/phish'))).rejects.toThrow(
      /^REDIRECT:/,
    );
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
    expect(mocks.redirect).not.toHaveBeenCalledWith(expect.stringContaining('evil.example'));
  });

  it('answers bad credentials with one vague sentence and no account oracle', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials: user not found detail' },
    });

    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    const destination = mocks.redirect.mock.calls[0][0] as string;
    expect(destination).toContain('/login?error=');
    expect(decodeURIComponent(destination)).toContain('Email or password is incorrect.');
    expect(destination).not.toContain('user not found');
    expect(mocks.getStaffContextDetailed).not.toHaveBeenCalled();
  });

  it('counts the attempt against the normalised email before the password is checked', async () => {
    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.consumeSignInAttemptBudgetForCaller).toHaveBeenCalledWith('owner@example.test');
    expect(mocks.consumeSignInAttemptBudgetForCaller.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInWithPassword.mock.invocationCallOrder[0],
    );
  });

  it('hands the attempt back when the password was right, so logins never spend the allowance', async () => {
    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.releaseSignInAttemptBudgetForCaller).toHaveBeenCalledTimes(1);
    expect(mocks.releaseSignInAttemptBudgetForCaller).toHaveBeenCalledWith('owner@example.test');
    expect(mocks.releaseSignInAttemptBudgetForCaller.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.signInWithPassword.mock.invocationCallOrder[0],
    );
  });

  it('keeps the attempt charged when the password was wrong', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });

    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.releaseSignInAttemptBudgetForCaller).not.toHaveBeenCalled();
  });

  it('refuses further guesses once a budget is spent and says only how long to wait', async () => {
    mocks.consumeSignInAttemptBudgetForCaller.mockResolvedValueOnce({
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 240,
    });

    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    const destination = decodeURIComponent(mocks.redirect.mock.calls[0][0] as string);
    expect(destination).toContain('/login?error=');
    expect(destination).toContain('Too many sign-in attempts');
    expect(destination).toContain('4 minutes');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('does not turn a limiter outage into a sign-in outage', async () => {
    mocks.consumeSignInAttemptBudgetForCaller.mockResolvedValueOnce({
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: null,
    });

    await expect(signInAction(loginForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
  });
});

describe('password reset completion', () => {
  function resetForm(password = 'New-Strong-Password9!', confirmation = password): FormData {
    const value = new FormData();
    value.set('password', password);
    value.set('confirmation', confirmation);
    return value;
  }

  function grantRecoveryCookie() {
    cookieStore.get.mockImplementation((name: string) =>
      name === RECOVERY_COOKIE ? { value: '1' } : undefined,
    );
  }

  it('refuses without the recovery permission, before any Auth call', async () => {
    await expect(updatePasswordAction(resetForm())).rejects.toThrow(/^REDIRECT:/);

    const destination = mocks.redirect.mock.calls[0][0] as string;
    expect(decodeURIComponent(destination)).toContain('Open the link from the reset email');
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('treats a spent/expired session as an expired link and changes nothing', async () => {
    grantRecoveryCookie();
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });

    await expect(updatePasswordAction(resetForm())).rejects.toThrow(/^REDIRECT:/);

    const destination = mocks.redirect.mock.calls[0][0] as string;
    expect(decodeURIComponent(destination)).toContain('This reset link has expired');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('requires the confirmation to match before asking Auth', async () => {
    grantRecoveryCookie();

    await expect(updatePasswordAction(resetForm('New-Strong-Password9!', 'Different-Password9!'))).rejects.toThrow(
      /^REDIRECT:/,
    );

    expect(decodeURIComponent(mocks.redirect.mock.calls[0][0] as string)).toContain('do not match');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('sets the password once, spends the permission and signs out everywhere', async () => {
    grantRecoveryCookie();

    await expect(updatePasswordAction(resetForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'New-Strong-Password9!' });
    expect(cookieStore.delete).toHaveBeenCalledWith(RECOVERY_COOKIE);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    const destination = mocks.redirect.mock.calls[0][0] as string;
    expect(destination).toContain('/login?notice=');
    expect(decodeURIComponent(destination)).toContain('Your password was changed');
  });
});

describe('operator visibility for silent Auth failures', () => {
  const idle = { status: 'idle' } as const;

  function silenceLogs() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return { warn, error, restore: () => { warn.mockRestore(); error.mockRestore(); } };
  }

  it('reports a signup mail/provider rejection as an incident while the visitor sees the same pending page', async () => {
    const logs = silenceLogs();
    const before = incidentCount('signup_confirmation_email_failed');
    mocks.getSupabaseAdmin.mockReturnValue(signupAdmin());
    mocks.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { status: 500, code: 'smtp_unavailable', message: 'private provider detail for owner@example.test' },
    });

    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    expect(mocks.redirect).toHaveBeenCalledWith('/signup/confirmation-pending');
    expect(incidentCount('signup_confirmation_email_failed')).toBe(before + 1);
    expect(incidentSummary('signup_confirmation_email_failed')).not.toContain('private provider detail');
    expect(incidentSummary('signup_confirmation_email_failed')).not.toContain('owner@example.test');
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain('private provider detail');
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain('owner@example.test');
    logs.restore();
  });

  it('does not report the enumeration-protected existing-email response or a 429 as a mail failure', async () => {
    const logs = silenceLogs();
    const before = incidentCount('signup_confirmation_email_failed');
    mocks.getSupabaseAdmin.mockReturnValue(signupAdmin());
    mocks.signUp.mockResolvedValueOnce({
      data: { user: { id: 'existing-user', identities: [] }, session: null },
      error: null,
    });
    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    mocks.getSupabaseAdmin.mockReturnValue(signupAdmin());
    mocks.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'private throttling detail' },
    });
    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    expect(incidentCount('signup_confirmation_email_failed')).toBe(before);
    logs.restore();
  });

  it('reports send-again provider and transport failures, but not success or throttling', async () => {
    const logs = silenceLogs();
    const before = incidentCount('signup_confirmation_resend_failed');

    await expect(resendSignupConfirmationAction(idle, form())).resolves.toEqual({ status: 'requested' });
    expect(incidentCount('signup_confirmation_resend_failed')).toBe(before);

    mocks.resend.mockResolvedValueOnce({
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'private throttling detail' },
    });
    await expect(resendSignupConfirmationAction(idle, form())).resolves.toEqual({ status: 'requested' });
    expect(incidentCount('signup_confirmation_resend_failed')).toBe(before);

    mocks.resend.mockResolvedValueOnce({
      error: { status: 500, code: 'smtp_unavailable', message: 'private provider response' },
    });
    await expect(resendSignupConfirmationAction(idle, form())).resolves.toEqual({ status: 'requested' });
    expect(incidentCount('signup_confirmation_resend_failed')).toBe(before + 1);

    mocks.resend.mockRejectedValueOnce(new Error('private transport response'));
    await expect(resendSignupConfirmationAction(idle, form())).resolves.toEqual({ status: 'requested' });
    expect(incidentCount('signup_confirmation_resend_failed')).toBe(before + 2);
    expect(incidentSummary('signup_confirmation_resend_failed')).not.toContain('private');
    logs.restore();
  });

  it('reports a password-reset provider failure, but not throttling', async () => {
    const logs = silenceLogs();
    const before = incidentCount('password_reset_email_failed');

    mocks.resetPasswordForEmail.mockResolvedValueOnce({
      error: { status: 429, message: 'rate limit exceeded' },
    });
    await expect(requestPasswordResetAction(form())).rejects.toThrow(/^REDIRECT:/);
    expect(incidentCount('password_reset_email_failed')).toBe(before);

    mocks.resetPasswordForEmail.mockResolvedValueOnce({
      error: { status: 500, code: 'smtp_unavailable', message: 'private provider response' },
    });
    await expect(requestPasswordResetAction(form())).rejects.toThrow(/^REDIRECT:/);
    expect(incidentCount('password_reset_email_failed')).toBe(before + 1);
    expect(incidentSummary('password_reset_email_failed')).not.toContain('private');
    logs.restore();
  });

  it('reports a password-update failure after a valid recovery session', async () => {
    const logs = silenceLogs();
    const before = incidentCount('password_update_failed');
    cookieStore.get.mockImplementation((name: string) =>
      name === RECOVERY_COOKIE ? { value: '1' } : undefined,
    );
    mocks.updateUser.mockResolvedValueOnce({
      error: { status: 500, code: 'unexpected_failure', message: 'private provider response' },
    });

    const value = new FormData();
    value.set('password', 'New-Strong-Password9!');
    value.set('confirmation', 'New-Strong-Password9!');
    await expect(updatePasswordAction(value)).rejects.toThrow(/^REDIRECT:/);

    expect(incidentCount('password_update_failed')).toBe(before + 1);
    expect(incidentSummary('password_update_failed')).not.toContain('private');
    logs.restore();
  });

  it('reports workspace creation failure (with successful rollback) as an incident', async () => {
    const logs = silenceLogs();
    const workspaceBefore = incidentCount('signup_workspace_creation_failed');
    const rollbackBefore = incidentCount('signup_rollback_failed');
    mocks.getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        upsert: async () => ({ error: { status: 500, code: 'db_failure', message: 'private db detail' } }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
      rpc: mocks.createAccountWithRestaurant,
      auth: { admin: { deleteUser: async () => ({ error: null }) } },
    });
    mocks.signUp.mockResolvedValueOnce({
      data: { user: { id: 'new-owner', identities: [{ identity_id: 'identity-1' }] }, session: null },
      error: null,
    });

    await expect(signUpAction(signupForm())).rejects.toThrow(/^REDIRECT:/);

    expect(incidentCount('signup_workspace_creation_failed')).toBe(workspaceBefore + 1);
    expect(incidentCount('signup_rollback_failed')).toBe(rollbackBefore);
    expect(incidentSummary('signup_workspace_creation_failed')).not.toContain('private');
    logs.restore();
  });
});
