/** Current application does not resolve a network adapter from environment
 * variables, even if someone sets a provider name or a credential. */
/** The hermetic CI rehearsal builds the app in production mode (a development
 * server cannot run under the strict CSP) but is explicitly not a deployment:
 * same flags as the demo build, a loopback data origin and an opt-in
 * simulation switch. No real project URL can qualify. */
export function isHermeticIrpRehearsal(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!(env.GITHUB_ACTIONS === 'true' && env.CI === 'true' && env.AUTODINE_TEST_DEMO_BUILD === 'true'
    && env.VERCEL_ENV === 'test')) return false;
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname);
  } catch { return false; }
}

export function getIrpPreflightGate(env: NodeJS.ProcessEnv = process.env): { ok: true } | { ok: false; error: string } {
  if (env.AUTODINE_IRP_PROVIDER !== 'sandbox'
    || ['production', 'preview'].includes(env.VERCEL_ENV ?? '')) {
    return { ok: false, error: 'Offline IRP preflight is disabled for this deployment. No provider was contacted.' };
  }
  const localOnly = ['development', 'test'].includes(env.NODE_ENV ?? '')
    || (env.NODE_ENV === 'production' && env.AUTODINE_IRP_SIMULATION === 'true' && isHermeticIrpRehearsal(env));
  if (!localOnly) {
    return { ok: false, error: 'Offline IRP preflight is disabled for this deployment. No provider was contacted.' };
  }
  return { ok: true };
}

/** Synthetic queue controls are not enabled merely by selecting the old
 * preflight flag. A local database and explicit simulation opt-in are needed. */
export function isLocalIrpSimulation(env: NodeJS.ProcessEnv=process.env): boolean {
  if (!getIrpPreflightGate(env).ok || env.AUTODINE_IRP_SIMULATION!=='true') return false;
  try {
    const base=new URL(env.NEXT_PUBLIC_SUPABASE_URL??'');
    return ['127.0.0.1','localhost','[::1]'].includes(base.hostname) && ['http:','https:'].includes(base.protocol);
  } catch { return false; }
}
