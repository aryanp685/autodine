/**
 * Build-time twin of lib/supabase/deployment-isolation.ts, for code that runs
 * before TypeScript does: next.config.mjs and scripts/check-env.mjs.
 *
 * Rule: only the production deployment may use the production Supabase
 * project. lib/supabase/deployment-isolation.test.ts runs both implementations
 * over the same cases so they cannot drift apart.
 */
import { readFileSync } from 'node:fs';

const { productionProjectRefs } = JSON.parse(
  readFileSync(new URL('../lib/supabase/production-projects.json', import.meta.url), 'utf8'),
);

const clean = (value) => String(value ?? '').trim();

export function productionRefs(extra) {
  const added = clean(extra).split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...productionProjectRefs.map((ref) => ref.toLowerCase()), ...added])];
}

/** Vercel's value wins; AUTODINE_DEPLOY_ENV is honoured only where Vercel says nothing. */
export function deployEnvironment(env) {
  return clean(env.VERCEL_ENV) || clean(env.NEXT_PUBLIC_AUTODINE_DEPLOY_ENV) || clean(env.AUTODINE_DEPLOY_ENV);
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function jwtProjectRef(key) {
  const payload = key.split('.')[1];
  if (!payload) return '';
  try {
    const ref = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).ref;
    return typeof ref === 'string' ? ref.toLowerCase() : '';
  } catch { return ''; }
}

export const ISOLATION_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_AUTODINE_PRODUCTION_SUPABASE_REFS',
  'VERCEL_ENV',
  'NEXT_PUBLIC_AUTODINE_DEPLOY_ENV',
  'AUTODINE_DEPLOY_ENV',
];

/** Returns the reason this environment must not run, or null when it may. */
export function isolationProblem(env) {
  const refs = productionRefs(env.NEXT_PUBLIC_AUTODINE_PRODUCTION_SUPABASE_REFS);
  const host = hostOf(clean(env.NEXT_PUBLIC_SUPABASE_URL));
  let target = host && refs.some((ref) => host === ref || host.split('.').includes(ref)) ? 'url' : null;
  if (!target) {
    for (const name of ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      const ref = jwtProjectRef(clean(env[name]));
      if (ref && refs.includes(ref)) { target = 'key'; break; }
    }
  }
  if (!target) return null;
  const environment = deployEnvironment(env);
  if (environment === 'production') return null;
  const where = environment ? `the "${environment}" environment` : 'an environment that is not the production deployment';
  const what = target === 'url' ? 'NEXT_PUBLIC_SUPABASE_URL points' : 'a Supabase key belongs';
  return (
    `AutoDine deployment isolation: ${what} to the PRODUCTION Supabase project, but this is ${where}. ` +
    'Only the production deployment may use production data. Point Preview, Development and local ' +
    'environments at a non-production Supabase project. See docs/preview-isolation.md.'
  );
}

export function assertBuildIsolation(env) {
  const problem = isolationProblem(env);
  if (problem) throw new Error(problem);
}
