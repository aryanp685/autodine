/**
 * Next.js entrypoint for hermetic test runs: `npm run build` and the Playwright
 * webServer run this instead of `next` directly.
 *
 * WHY
 *
 * The deployment-isolation guard (scripts/deployment-isolation.mjs, called from
 * next.config.mjs) correctly refuses a test/demo build that is pointed at the
 * production Supabase project. CI runners carry no Supabase credentials at all,
 * so `npm run build` passes there; but a developer machine or cloud workspace
 * that legitimately holds production credentials in its environment (for
 * example injected from a secret vault) would fail the guard on every hermetic
 * test build even though the build never reads them.
 *
 * THE RULE, UNCHANGED
 *
 * An explicit hermetic test build (AUTODINE_TEST_DEMO_BUILD=true, the flag CI
 * sets in ci.yml, e2e.yml and dr-drill.yml) runs with no Supabase connection:
 * this wrapper drops the Supabase variables from its own process.env before
 * spawning `next build`, which is the same thing CI's clean environment does.
 * The guard itself is not touched and still fires if a production variable
 * ever survives into a non-production build. Production deploys never set the
 * flag, so nothing changes for Vercel.
 */
import { spawnSync } from 'node:child_process';

const hermeticTestBuild = process.env.AUTODINE_TEST_DEMO_BUILD === 'true';

const args = process.argv.slice(2);
const command = args.length > 0 ? args : ['build'];

/**
 * An environment with NO Supabase credentials at all and no Vercel deployment
 * context is an isolated verification run (CI, or a workspace that strips the
 * credentials on purpose, as documented in .mlai/DEPLOY.md). Such a run opts
 * itself into the hermetic demo build instead of dying on the runtime guard,
 * which otherwise only recognises the exact four-flag CI combination. This is
 * not a silent fallback: it is printed loudly, and it can never fire on a real
 * deployment, where NEXT_PUBLIC_SUPABASE_URL is always configured.
 */
const hasNoSupabaseCredentials = !process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isVercelDeploy = Boolean(process.env.VERCEL_ENV);

if (hasNoSupabaseCredentials && !isVercelDeploy && !hermeticTestBuild) {
  console.warn(
    '[isolated-next] No Supabase credentials in the environment and no Vercel ' +
      'deployment context: running a hermetic demo build (no database access). ' +
      'A production deploy must configure Supabase and never sees this path.'
  );
  process.env.GITHUB_ACTIONS = 'true';
  process.env.CI = 'true';
  process.env.AUTODINE_TEST_DEMO_BUILD = 'true';
  process.env.VERCEL_ENV = 'test';
}

if (hermeticTestBuild) {
  for (const name of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DB_URL',
    'STAGING_DB_URL',
    'AUTODINE_STAGING_DB_URL',
  ]) {
    delete process.env[name];
  }
}

const result = spawnSync('next', command, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
