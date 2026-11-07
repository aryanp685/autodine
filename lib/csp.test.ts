import { describe, expect, it } from 'vitest';

import { buildCsp } from './csp';

describe('buildCsp', () => {
  const csp = buildCsp({ nonce: 'test-nonce', supabaseUrl: 'https://abc.supabase.co' });

  it('carries the per-request nonce and never opens script-src wide', () => {
    expect(csp).toContain("script-src 'self' 'nonce-test-nonce'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain('unsafe-eval');
  });

  it('closes the classic holes', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it('allows Supabase and realtime but no unapproved payment provider', () => {
    expect(csp).not.toContain('razorpay');
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain('https://abc.supabase.co');
    expect(csp).toContain('wss://abc.supabase.co');
  });

  it('leaves the supabase origin out in demo mode, and ignores junk values', () => {
    const demo = buildCsp({ nonce: 'n' });
    expect(demo).not.toContain('supabase');
    expect(demo).toContain("default-src 'self'");

    const junk = buildCsp({ nonce: 'n', supabaseUrl: 'http://not-https.example' });
    expect(junk).not.toContain('not-https.example');
    expect(buildCsp({ nonce: 'n', supabaseUrl: 'not a url' })).not.toContain('not a url');
  });

  it('keeps styles practical but scripts strict (style attrs cannot carry a nonce)', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
  });
});
