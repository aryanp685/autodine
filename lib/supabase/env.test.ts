/**
 * Tests for the Supabase env layer.
 *
 * These exist because the failure modes here are silent and expensive:
 *
 *  - reading only the legacy key names leaves a new Supabase project
 *    permanently unconfigured, and because empty values are tolerated that
 *    shows up as demo data rather than an error;
 *  - a secret key behind a NEXT_PUBLIC_ prefix ships a full RLS bypass to
 *    every visitor's browser.
 *
 * Both must fail loudly, so both are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Re-imports the module so it re-reads process.env.
 * env.ts captures values at import time, so stubbing after the first import
 * would have no effect.
 */
async function loadEnv() {
  vi.resetModules();
  return import('./env');
}

describe('supabase env', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('publishable key', () => {
    it('reads the new sb_publishable_ key', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_abc123');
      const env = await loadEnv();

      expect(env.SUPABASE_PUBLISHABLE_KEY).toBe('sb_publishable_abc123');
      expect(env.isSupabaseConfigured).toBe(true);
    });

    it('falls back to the legacy anon key', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJlegacy-anon-key');
      const env = await loadEnv();

      expect(env.SUPABASE_PUBLISHABLE_KEY).toBe('eyJlegacy-anon-key');
      expect(env.isSupabaseConfigured).toBe(true);
    });

    it('prefers the new key when both are present', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_new');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJlegacy-anon-key');
      const env = await loadEnv();

      expect(env.SUPABASE_PUBLISHABLE_KEY).toBe('sb_publishable_new');
    });

    it('falls through a key that is set but empty', async () => {
      // A leftover `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` line in .env.local
      // is '', not undefined. `??` would stop there and never reach the legacy
      // name, silently leaving the app half-configured.
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJlegacy-anon-key');
      const env = await loadEnv();

      expect(env.SUPABASE_PUBLISHABLE_KEY).toBe('eyJlegacy-anon-key');
    });

    it('reports unconfigured when no key is supplied at all', async () => {
      const env = await loadEnv();

      expect(env.SUPABASE_PUBLISHABLE_KEY).toBe('');
      expect(env.isSupabaseConfigured).toBe(false);
    });
  });

  describe('secret key', () => {
    it('reads the new sb_secret_ key', async () => {
      vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_xyz789');
      const env = await loadEnv();

      expect(env.SUPABASE_SECRET_KEY).toBe('sb_secret_xyz789');
      expect(env.isSupabaseAdminConfigured).toBe(true);
    });

    it('falls back to the legacy service_role key', async () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJlegacy-service-role');
      const env = await loadEnv();

      expect(env.SUPABASE_SECRET_KEY).toBe('eyJlegacy-service-role');
      expect(env.isSupabaseAdminConfigured).toBe(true);
    });

    it('falls through a key that is set but empty', async () => {
      vi.stubEnv('SUPABASE_SECRET_KEY', '');
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJlegacy-service-role');
      const env = await loadEnv();

      expect(env.SUPABASE_SECRET_KEY).toBe('eyJlegacy-service-role');
    });
  });

  describe('secret key must never reach the browser', () => {
    it('throws when a sb_secret_ key is passed as the publishable key', async () => {
      // This is NEXT_PUBLIC_SUPABASE_SECRET_KEY by another route: the value
      // that reaches the browser bundle must not be a secret key.
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_leaked');

      await expect(loadEnv()).rejects.toThrow(/secret key/i);
    });

    it('explains how to fix it, not just that it broke', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_leaked');

      await expect(loadEnv()).rejects.toThrow(/SUPABASE_SECRET_KEY/);
      await expect(loadEnv()).rejects.toThrow(/NEXT_PUBLIC_/);
    });

    it('does not throw for a legitimate publishable key', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fine');

      await expect(loadEnv()).resolves.toBeTruthy();
    });

    it('does not throw for a legacy anon key', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJlegacy-anon-key');

      await expect(loadEnv()).resolves.toBeTruthy();
    });
  });
});
