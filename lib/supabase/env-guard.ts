/**
 * Runtime guard for missing Supabase public configuration.
 *
 * Kept pure so the production/local/CI policy is testable without relying on
 * `NODE_ENV`, which bundlers and Vitest replace at compile time.
 */
export type SupabaseRuntimeEnvironment = {
  nodeEnv?: string;
  githubActions?: string;
  ci?: string;
  testDemoBuild?: string;
  vercelEnv?: string;
  localDemoMode?: string;
};

const MISSING_CONFIG_MESSAGE =
  'AutoDine requires NEXT_PUBLIC_SUPABASE_URL and a public Supabase key. ' +
  'Demo data is never an automatic fallback: configure Supabase, or set AUTODINE_DEMO_MODE=true for local development only.';

/** Asserts configuration policy and returns whether explicit local demo is active. */
export function assertSupabaseRuntimeConfig(
  isSupabaseConfigured: boolean,
  env: SupabaseRuntimeEnvironment
): boolean {
  const allowHermeticDemoBuild =
    env.githubActions === 'true' &&
    env.ci === 'true' &&
    env.testDemoBuild === 'true' &&
    env.vercelEnv === 'test';
  const allowExplicitLocalDemo = env.nodeEnv === 'development' && env.localDemoMode === 'true';

  if (
    !isSupabaseConfigured &&
    ((env.nodeEnv === 'production' && !allowHermeticDemoBuild) ||
      (env.nodeEnv === 'development' && !allowExplicitLocalDemo))
  ) {
    throw new Error(MISSING_CONFIG_MESSAGE);
  }

  return !isSupabaseConfigured && allowExplicitLocalDemo;
}
