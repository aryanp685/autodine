import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ headers: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => state.headers.get(name) ?? null }),
}));

import { requestOrigin, siteOrigin } from './site-origin';

/**
 * Two different questions, and confusing them breaks password reset.
 *
 * siteOrigin() answers "where should a printed QR card live?" -- always the
 * production domain, because that is what survives a deployment.
 * requestOrigin() answers "who is serving this request?" -- because an emailed
 * auth link has to come back to the host that holds its PKCE cookie.
 */

beforeEach(() => {
  state.headers.clear();
  delete process.env.SITE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

describe('requestOrigin', () => {
  it('uses the host of the request even when a production domain is configured', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'new-alpha-five-43.vercel.app';
    state.headers.set('x-forwarded-host', 'new-git-branch-team.vercel.app');
    state.headers.set('x-forwarded-proto', 'https');

    expect(await requestOrigin()).toBe('https://new-git-branch-team.vercel.app');
    // The QR helper must keep pointing at production.
    expect(await siteOrigin()).toBe('https://new-alpha-five-43.vercel.app');
  });

  it('reads the protocol from x-forwarded-proto, not a guess', async () => {
    state.headers.set('x-forwarded-host', 'localhost:3000');
    state.headers.set('x-forwarded-proto', 'http');
    expect(await requestOrigin()).toBe('http://localhost:3000');
  });

  it('falls back to the host header and then to the configured origin', async () => {
    state.headers.set('host', 'new-alpha-five-43.vercel.app');
    expect(await requestOrigin()).toBe('https://new-alpha-five-43.vercel.app');

    state.headers.clear();
    process.env.SITE_URL = 'https://autodine.example/';
    expect(await requestOrigin()).toBe('https://autodine.example');
  });
});

describe('siteOrigin', () => {
  it('prefers an explicit SITE_URL over the request, for QR cards', async () => {
    process.env.SITE_URL = 'https://autodine.example';
    state.headers.set('x-forwarded-host', 'preview.vercel.app');
    expect(await siteOrigin()).toBe('https://autodine.example');
  });

  it('returns an empty string rather than a broken relative origin', async () => {
    expect(await siteOrigin()).toBe('');
    expect(await requestOrigin()).toBe('');
  });
});
