import { describe, expect, it } from 'vitest';

import { assertSupabaseRuntimeConfig } from './env-guard';

describe('Supabase runtime demo guard', () => {
  it('fails closed in production when public Supabase configuration is missing', () => {
    expect(() => assertSupabaseRuntimeConfig(false, { nodeEnv: 'production' })).toThrow(
      /Demo data is never an automatic fallback/
    );
  });

  it('does not let the local-demo flag enable fictional data in production', () => {
    expect(() =>
      assertSupabaseRuntimeConfig(false, {
        nodeEnv: 'production',
        localDemoMode: 'true',
      })
    ).toThrow(/Demo data is never an automatic fallback/);
  });

  it('requires the explicit local-development opt-in', () => {
    expect(() => assertSupabaseRuntimeConfig(false, { nodeEnv: 'development' })).toThrow(
      /Demo data is never an automatic fallback/
    );
    expect(
      assertSupabaseRuntimeConfig(false, {
        nodeEnv: 'development',
        localDemoMode: 'true',
      })
    ).toBe(true);
  });

  it('allows production when public Supabase configuration is present', () => {
    expect(assertSupabaseRuntimeConfig(true, { nodeEnv: 'production' })).toBe(false);
  });

  it('allows the hermetic GitHub Actions build only in the dedicated test environment', () => {
    expect(
      assertSupabaseRuntimeConfig(false, {
        nodeEnv: 'production',
        githubActions: 'true',
        ci: 'true',
        testDemoBuild: 'true',
        vercelEnv: 'test',
      })
    ).toBe(false);

    for (const env of [
      { githubActions: 'true', ci: 'true', testDemoBuild: 'true', vercelEnv: 'preview' },
      { githubActions: 'true', ci: 'true', testDemoBuild: 'true', vercelEnv: 'production' },
      { githubActions: 'true', ci: 'false', testDemoBuild: 'true', vercelEnv: 'test' },
      { githubActions: 'false', ci: 'true', testDemoBuild: 'true', vercelEnv: 'test' },
      { githubActions: 'true', ci: 'true', testDemoBuild: 'false', vercelEnv: 'test' },
    ]) {
      expect(() =>
        assertSupabaseRuntimeConfig(false, { nodeEnv: 'production', ...env })
      ).toThrow(/Demo data is never an automatic fallback/);
    }
  });
});
