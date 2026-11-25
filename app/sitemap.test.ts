import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => {
    throw new Error('cookies() is request-scoped and unavailable at build time');
  },
  headers: () => {
    throw new Error('headers() is request-scoped and unavailable at build time');
  },
}));

const { default: sitemap } = await import('./sitemap');

describe('sitemap', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lists the public pages without touching request-scoped APIs', () => {
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://autodine.example/');
    expect(sitemap().map((entry) => entry.url)).toEqual([
      'https://autodine.example/',
      'https://autodine.example/features',
      'https://autodine.example/how-it-works',
      'https://autodine.example/screens',
      'https://autodine.example/trust',
      'https://autodine.example/pricing',
      'https://autodine.example/terms',
      'https://autodine.example/privacy',
    ]);
  });

  it('falls back to the Vercel production host', () => {
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'autodine.vercel.app');
    expect(sitemap()[5]?.url).toBe('https://autodine.vercel.app/pricing');
  });
});
