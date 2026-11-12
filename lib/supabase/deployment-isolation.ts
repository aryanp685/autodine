/**
 * Deployment isolation: only the production deployment may talk to the
 * production Supabase project.
 *
 * A Preview deployment, a development deployment and a laptop all run
 * unreviewed code. Pointed at production they read and write real restaurants'
 * data. This guard makes that configuration impossible to run: it throws while
 * the Supabase environment is being read, which fails the build on Vercel and
 * stops a local server from starting.
 *
 * Pure and dependency-free so the same rule runs in the server bundle, in the
 * browser bundle and under test. scripts/deployment-isolation.mjs applies the
 * identical rule to the build (next.config.mjs) and to `npm run env:check`;
 * lib/supabase/deployment-isolation.test.ts keeps the two in step.
 */

/** Keep in step with lib/supabase/production-projects.json (asserted by a test). */
export const PRODUCTION_SUPABASE_PROJECT_REFS: readonly string[] = ['bdbaqpevwmgdvghszjno'];

export type DeploymentIsolationInput = {
  supabaseUrl?: string;
  /** Publishable and secret keys. Legacy JWT keys name their project in the `ref` claim. */
  keys?: Array<string | undefined>;
  /** VERCEL_ENV as the running process sees it. */
  vercelEnv?: string;
  /** VERCEL_ENV captured at build time and inlined by next.config.mjs (the browser has no VERCEL_ENV). */
  buildEnv?: string;
  /** AUTODINE_DEPLOY_ENV: an explicit declaration, honoured only where Vercel says nothing. */
  declaredEnv?: string;
  /** Additional production project refs or hosts, comma separated. */
  extraProductionRefs?: string;
};

const clean = (value: string | undefined): string => (value ?? '').trim();

export function productionRefs(extra?: string): string[] {
  const added = clean(extra)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...PRODUCTION_SUPABASE_PROJECT_REFS.map((ref) => ref.toLowerCase()), ...added])];
}

/**
 * Vercel's own value always wins: a Preview cannot declare itself production.
 * The declaration exists only for production hosted somewhere that does not
 * set VERCEL_ENV. Returns '' when nothing identifies the deployment.
 */
export function resolveDeployEnvironment(input: DeploymentIsolationInput): string {
  return clean(input.vercelEnv) || clean(input.buildEnv) || clean(input.declaredEnv);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function jwtProjectRef(key: string): string {
  const payload = key.split('.')[1];
  if (!payload) return '';
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const ref = JSON.parse(atob(base64)).ref;
    return typeof ref === 'string' ? ref.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Names what points at production -- 'url' or 'key' -- or null when nothing does. */
export function productionTarget(input: DeploymentIsolationInput): 'url' | 'key' | null {
  const refs = productionRefs(input.extraProductionRefs);
  const host = hostOf(clean(input.supabaseUrl));
  if (host && refs.some((ref) => host === ref || host.split('.').includes(ref))) return 'url';
  for (const key of input.keys ?? []) {
    const ref = jwtProjectRef(clean(key));
    if (ref && refs.includes(ref)) return 'key';
  }
  return null;
}

export function deploymentIsolationProblem(input: DeploymentIsolationInput): string | null {
  const target = productionTarget(input);
  if (!target) return null;
  const environment = resolveDeployEnvironment(input);
  if (environment === 'production') return null;
  const where = environment ? `the "${environment}" environment` : 'an environment that is not the production deployment';
  const what = target === 'url' ? 'NEXT_PUBLIC_SUPABASE_URL points' : 'a Supabase key belongs';
  return (
    `AutoDine deployment isolation: ${what} to the PRODUCTION Supabase project, but this is ${where}. ` +
    'Only the production deployment may use production data. Point Preview, Development and local ' +
    'environments at a non-production Supabase project. See docs/preview-isolation.md.'
  );
}

export function assertDeploymentIsolation(input: DeploymentIsolationInput): void {
  const problem = deploymentIsolationProblem(input);
  if (problem) throw new Error(problem);
}
