import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/supabase/env', () => ({
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_test',
  SUPABASE_URL: 'https://project-ref.supabase.co',
  isSupabaseConfigured: true,
}));

import { createSupabaseServerClient } from './server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieJar.clear();
  mocks.cookieSet.mockImplementation((name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0) mocks.cookieJar.delete(name);
    else mocks.cookieJar.set(name, value);
  });
  mocks.cookies.mockResolvedValue({
    getAll: () => [...mocks.cookieJar].map(([name, value]) => ({ name, value })),
    set: mocks.cookieSet,
  });
  mocks.fetch.mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('server Supabase PKCE cookie persistence', () => {
  it('persists the verifier created by Auth resend and binds its flow id to the email callback', async () => {
    const supabase = await createSupabaseServerClient();
    expect(supabase).not.toBeNull();

    const { error } = await supabase!.auth.resend({
      type: 'signup',
      email: 'owner@example.test',
      options: {
        emailRedirectTo: 'https://autodine.example/auth/confirm?flow=signup&next=%2Fdashboard',
      },
    });

    expect(error).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/auth/v1/resend');

    const body = JSON.parse(String(init.body)) as {
      email: string;
      type: string;
      code_challenge: string;
      code_challenge_method: string;
    };
    expect(body.email).toBe('owner@example.test');
    expect(body.type).toBe('signup');
    expect(body.code_challenge).toBeTruthy();
    expect(body.code_challenge_method).toBe('s256');

    const request = new URL(requestUrl);
    const redirectTo = request.searchParams.get('redirect_to');
    expect(redirectTo).toBeTruthy();
    const callback = new URL(redirectTo!);
    expect(callback.origin).toBe('https://autodine.example');
    expect(callback.pathname).toBe('/auth/confirm');
    expect(callback.searchParams.get('flow')).toBe('signup');
    expect(callback.searchParams.get('next')).toBe('/dashboard');

    const verifierCookieName = [...mocks.cookieJar.keys()].find((name) =>
      /-flow-[A-Za-z0-9_-]{8,64}-code-verifier$/.test(name),
    );
    expect(verifierCookieName).toBeDefined();
    const flowId = verifierCookieName?.match(/-flow-([A-Za-z0-9_-]{8,64})-code-verifier$/)?.[1];
    expect(flowId).toBeTruthy();
    expect(callback.searchParams.get('sb_flow_id')).toBe(flowId);
    expect(mocks.cookieSet).toHaveBeenCalled();
  });

  it('cleans up the verifier when a normal Auth flow is rejected', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: 'rate limited', error_code: 'over_email_send_rate_limit' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase!.auth.resend({
      type: 'signup',
      email: 'owner@example.test',
      options: { emailRedirectTo: 'https://autodine.example/auth/confirm?flow=signup&next=%2Fdashboard' },
    });

    expect(error?.status).toBe(429);
    expect([...mocks.cookieJar.keys()].some((name) => /-flow-[A-Za-z0-9_-]{8,64}-code-verifier$/.test(name))).toBe(false);
    expect([...mocks.cookieJar.keys()].some((name) => /-flows-code-verifier$/.test(name))).toBe(false);
  });

  it('keeps resend PKCE cookie shape independent of an Auth rate-limit response', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: 'rate limited', error_code: 'over_email_send_rate_limit' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const supabase = await createSupabaseServerClient({
      preservePkceVerifierCookiesOnAuthError: true,
    });

    const { error } = await supabase!.auth.resend({
      type: 'signup',
      email: 'owner@example.test',
      options: { emailRedirectTo: 'https://autodine.example/auth/confirm?flow=signup&next=%2Fdashboard' },
    });

    expect(error?.status).toBe(429);
    const verifierCookieName = [...mocks.cookieJar.keys()].find((name) =>
      /-flow-[A-Za-z0-9_-]{8,64}-code-verifier$/.test(name),
    );
    expect(verifierCookieName).toBeDefined();
    expect([...mocks.cookieJar.keys()].some((name) => /-flows-code-verifier$/.test(name))).toBe(true);

    const [requestUrl] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const callback = new URL(new URL(requestUrl).searchParams.get('redirect_to')!);
    const flowId = verifierCookieName?.match(/-flow-([A-Za-z0-9_-]{8,64})-code-verifier$/)?.[1];
    expect(callback.searchParams.get('sb_flow_id')).toBe(flowId);
  });
});
