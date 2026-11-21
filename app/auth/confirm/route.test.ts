import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECOVERY_COOKIE, RECOVERY_STATE_COOKIE } from '@/lib/password';
import { PENDING_SIGNUP_EMAIL_COOKIE } from '@/lib/signup-confirmation';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { GET } from './route';

const RECOVERY_STATE = 'A'.repeat(43);

function request(query: string, recoveryState?: string): NextRequest {
  const headers = recoveryState
    ? { cookie: `${RECOVERY_STATE_COOKIE}=${recoveryState}` }
    : undefined;
  return new NextRequest(`https://autodine.example/auth/confirm${query}`, headers ? { headers } : undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
  });
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
});

describe('GET /auth/confirm', () => {
  it('routes token-hash recovery to the password form and grants only the short-lived recovery permission', async () => {
    const response = await GET(request('?token_hash=one-time-token&type=recovery&next=%2Fdashboard'));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'one-time-token', type: 'recovery' });
    expect(response.headers.get('location')).toBe('https://autodine.example/reset-password');
    const recovery = response.cookies.get(RECOVERY_COOKIE);
    expect(recovery?.value).toBe('1');
    expect(recovery?.httpOnly).toBe(true);
    expect(recovery?.maxAge).toBe(15 * 60);
  });

  it('preserves a same-origin invitation destination for a successful PKCE confirmation', async () => {
    const response = await GET(request('?code=single-use-code&next=%2Fjoin%2FK7QM-3XPD-9RTW-2HNJ'));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('single-use-code');
    expect(response.headers.get('location')).toBe('https://autodine.example/join/K7QM-3XPD-9RTW-2HNJ');
    expect(response.cookies.get(RECOVERY_COOKIE)).toBeUndefined();
  });

  it('does not treat a caller-supplied recovery query as proof of a PKCE recovery flow', async () => {
    const response = await GET(request('?code=single-use-code&flow=recovery'));

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('/forgot-password?error=');
    expect(response.cookies.get(RECOVERY_COOKIE)).toBeUndefined();
  });

  it('does not exchange a PKCE recovery code when the URL state has no matching browser cookie', async () => {
    const response = await GET(
      request(`?code=single-use-code&flow=recovery&state=${RECOVERY_STATE}`),
    );

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('/forgot-password?error=');
    expect(response.cookies.get(RECOVERY_COOKIE)).toBeUndefined();
  });

  it('does not grant recovery permission merely because next points at the reset form', async () => {
    const response = await GET(request('?code=single-use-code&next=%2Freset-password'));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('single-use-code');
    expect(response.headers.get('location')).toBe('https://autodine.example/reset-password');
    expect(response.cookies.get(RECOVERY_COOKIE)).toBeUndefined();
  });

  it('requires the matching same-browser state before completing a PKCE recovery', async () => {
    const response = await GET(
      request(`?code=single-use-code&flow=recovery&state=${RECOVERY_STATE}`, RECOVERY_STATE),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('single-use-code');
    expect(response.headers.get('location')).toBe('https://autodine.example/reset-password');
    expect(response.cookies.get(RECOVERY_COOKIE)?.value).toBe('1');
    expect(response.headers.get('set-cookie')).toContain(RECOVERY_STATE_COOKIE);
  });

  it('routes an expired owner confirmation link to resend recovery without exposing Auth details', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: { status: 400, code: 'otp_expired', message: 'private expired-token detail' },
    });

    const response = await GET(
      request('?code=expired-code&flow=signup&next=%2Fdashboard'),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('expired-code');
    expect(response.headers.get('location')).toBe(
      'https://autodine.example/signup/confirmation-pending?link=problem',
    );
    expect(response.headers.get('location')).not.toContain('private expired-token detail');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private expired-token detail');
    errorLog.mockRestore();
  });

  it('routes a reused owner confirmation code to the same safe recovery screen', async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: { status: 400, code: 'otp_expired', message: 'private replay detail' },
    });

    const response = await GET(
      request('?code=reused-code&flow=signup&next=%2Fdashboard'),
    );

    expect(response.headers.get('location')).toContain('/signup/confirmation-pending?link=problem');
    expect(response.headers.get('location')).not.toContain('private replay detail');
  });

  it('returns a confirmed owner to the fixed dashboard and clears the display-only email cookie', async () => {
    const response = await GET(
      request('?code=confirmed-code&flow=signup&next=%2F%2Fevil.example'),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('confirmed-code');
    expect(response.headers.get('location')).toBe('https://autodine.example/dashboard');
    expect(response.cookies.get(PENDING_SIGNUP_EMAIL_COOKIE)?.value).toBe('');
    expect(response.cookies.get(PENDING_SIGNUP_EMAIL_COOKIE)?.maxAge).toBe(0);
  });

  it('exchanges an owner confirmation with the exact PKCE flow verifier from its callback', async () => {
    const response = await GET(
      request('?code=signup-code&flow=signup&sb_flow_id=SignupFlow123'),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('signup-code', {
      flowId: 'SignupFlow123',
    });
    expect(response.headers.get('location')).toBe('https://autodine.example/dashboard');
  });

  it('verifies typed token-hash signup links', async () => {
    const response = await GET(
      request('?token_hash=signup-token&type=signup&flow=signup&next=%2Fdashboard'),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'signup-token', type: 'signup' });
    expect(response.headers.get('location')).toBe('https://autodine.example/dashboard');
    expect(response.cookies.get(PENDING_SIGNUP_EMAIL_COOKIE)?.maxAge).toBe(0);
  });
});
