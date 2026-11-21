import { describe, expect, it } from 'vitest';
import { shouldUseSecureCookies } from './cookie-security';

describe('shouldUseSecureCookies', () => {
  it('keeps production cookies Secure by default', () => {
    expect(shouldUseSecureCookies({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('does not require Secure cookies in development', () => {
    expect(shouldUseSecureCookies({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('allows HTTP cookies only for the explicit local Supabase E2E stack in CI', () => {
    expect(shouldUseSecureCookies({
      NODE_ENV: 'production',
      CI: 'true',
      SUPABASE_E2E_ALLOW_HTTP_COOKIES: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('keeps cookies Secure when the override is used outside CI', () => {
    expect(shouldUseSecureCookies({
      NODE_ENV: 'production',
      SUPABASE_E2E_ALLOW_HTTP_COOKIES: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('keeps cookies Secure for a remote Supabase project, even in CI', () => {
    expect(shouldUseSecureCookies({
      NODE_ENV: 'production',
      CI: 'true',
      SUPABASE_E2E_ALLOW_HTTP_COOKIES: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('fails closed for malformed or non-local HTTP targets', () => {
    for (const url of ['', 'not a URL', 'http://192.0.2.10:54321', 'http://localhost:8000']) {
      expect(shouldUseSecureCookies({
        NODE_ENV: 'production',
        CI: 'true',
        SUPABASE_E2E_ALLOW_HTTP_COOKIES: 'true',
        NEXT_PUBLIC_SUPABASE_URL: url,
      } as NodeJS.ProcessEnv)).toBe(true);
    }
  });
});
