import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SUPABASE_PROJECT_REFS,
  assertDeploymentIsolation,
  deploymentIsolationProblem,
  productionTarget,
  resolveDeployEnvironment,
} from './deployment-isolation';
// The build-time twin used by next.config.mjs and scripts/check-env.mjs.
import { deployEnvironment, isolationProblem } from '../../scripts/deployment-isolation.mjs';

const PROD = `https://${PRODUCTION_SUPABASE_PROJECT_REFS[0]}.supabase.co`;
const STAGING = 'https://juwyhslzchjevqkdvwjm.supabase.co';
const LOCAL = 'http://127.0.0.1:54321';

const jwt = (claims: Record<string, unknown>) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');
const PROD_ANON_JWT = jwt({ iss: 'supabase', ref: PRODUCTION_SUPABASE_PROJECT_REFS[0], role: 'anon' });
const STAGING_ANON_JWT = jwt({ iss: 'supabase', ref: 'juwyhslzchjevqkdvwjm', role: 'anon' });

type Case = {
  name: string;
  url?: string;
  key?: string;
  vercelEnv?: string;
  buildEnv?: string;
  declaredEnv?: string;
  extra?: string;
  allowed: boolean;
};

const CASES: Case[] = [
  { name: 'production deployment on the production project', url: PROD, vercelEnv: 'production', allowed: true },
  { name: 'Preview deployment on the production project', url: PROD, vercelEnv: 'preview', allowed: false },
  { name: 'Development deployment on the production project', url: PROD, vercelEnv: 'development', allowed: false },
  { name: 'local machine on the production project', url: PROD, allowed: false },
  { name: 'hermetic CI build marked test on the production project', url: PROD, vercelEnv: 'test', allowed: false },
  { name: 'Preview on staging', url: STAGING, key: STAGING_ANON_JWT, vercelEnv: 'preview', allowed: true },
  { name: 'Preview on a local stack', url: LOCAL, vercelEnv: 'preview', allowed: true },
  { name: 'Preview with no database configured', url: '', vercelEnv: 'preview', allowed: true },
  { name: 'local machine on staging', url: STAGING, allowed: true },
  { name: 'Preview on a staging URL but holding a production key', url: STAGING, key: PROD_ANON_JWT, vercelEnv: 'preview', allowed: false },
  { name: 'production holding its own key', url: PROD, key: PROD_ANON_JWT, vercelEnv: 'production', allowed: true },
  { name: 'Preview that declares itself production', url: PROD, vercelEnv: 'preview', declaredEnv: 'production', allowed: false },
  { name: 'browser bundle built for production', url: PROD, buildEnv: 'production', allowed: true },
  { name: 'browser bundle built for Preview', url: PROD, buildEnv: 'preview', allowed: false },
  { name: 'production hosted outside Vercel, declared', url: PROD, declaredEnv: 'production', allowed: true },
  { name: 'declared staging on the production project', url: PROD, declaredEnv: 'staging', allowed: false },
  { name: 'an additional production project in Preview', url: 'https://newprodref.supabase.co', vercelEnv: 'preview', extra: 'newprodref', allowed: false },
  { name: 'an additional production host in production', url: 'https://db.autodine.example', vercelEnv: 'production', extra: 'db.autodine.example', allowed: true },
  { name: 'a custom production host in Preview', url: 'https://db.autodine.example', vercelEnv: 'preview', extra: 'db.autodine.example', allowed: false },
  { name: 'upper-case production host in Preview', url: PROD.toUpperCase().replace('HTTPS', 'https'), vercelEnv: 'preview', allowed: false },
  { name: 'a look-alike host that only contains the ref', url: `https://not${PRODUCTION_SUPABASE_PROJECT_REFS[0]}.supabase.co`, vercelEnv: 'preview', allowed: true },
  { name: 'an unparseable URL', url: 'not a url', vercelEnv: 'preview', allowed: true },
];

describe('deployment isolation', () => {
  it.each(CASES)('$name → allowed: $allowed', (c) => {
    const input = {
      supabaseUrl: c.url,
      keys: [c.key, undefined],
      vercelEnv: c.vercelEnv,
      buildEnv: c.buildEnv,
      declaredEnv: c.declaredEnv,
      extraProductionRefs: c.extra,
    };
    expect(deploymentIsolationProblem(input) === null).toBe(c.allowed);
    if (c.allowed) expect(() => assertDeploymentIsolation(input)).not.toThrow();
    else expect(() => assertDeploymentIsolation(input)).toThrow(/deployment isolation/);
  });

  it.each(CASES)('build-time guard agrees: $name', (c) => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: c.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: c.key,
      VERCEL_ENV: c.vercelEnv,
      NEXT_PUBLIC_AUTODINE_DEPLOY_ENV: c.buildEnv,
      AUTODINE_DEPLOY_ENV: c.declaredEnv,
      NEXT_PUBLIC_AUTODINE_PRODUCTION_SUPABASE_REFS: c.extra,
    };
    expect(isolationProblem(env) === null).toBe(c.allowed);
    expect(deployEnvironment(env)).toBe(
      resolveDeployEnvironment({ vercelEnv: c.vercelEnv, buildEnv: c.buildEnv, declaredEnv: c.declaredEnv }),
    );
  });

  it('gives both guards the same message', () => {
    const typed = deploymentIsolationProblem({ supabaseUrl: PROD, vercelEnv: 'preview' });
    expect(isolationProblem({ NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: 'preview' })).toBe(typed);
    expect(typed).toContain('"preview"');
    expect(typed).toContain('docs/preview-isolation.md');
  });

  it('never puts key material in the message', () => {
    const secret = jwt({ ref: PRODUCTION_SUPABASE_PROJECT_REFS[0], role: 'service_role' });
    const message = deploymentIsolationProblem({ supabaseUrl: STAGING, keys: [undefined, secret], vercelEnv: 'preview' });
    expect(message).toMatch(/a Supabase key belongs/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain(secret.split('.')[1]);
  });

  it('names what points at production', () => {
    expect(productionTarget({ supabaseUrl: PROD })).toBe('url');
    expect(productionTarget({ supabaseUrl: STAGING, keys: [PROD_ANON_JWT] })).toBe('key');
    expect(productionTarget({ supabaseUrl: STAGING, keys: ['sb_publishable_abc', STAGING_ANON_JWT] })).toBeNull();
  });

  it('keeps one list of production projects', () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), 'lib/supabase/production-projects.json'), 'utf8'));
    expect(file.productionProjectRefs).toEqual([...PRODUCTION_SUPABASE_PROJECT_REFS]);
  });

  it('is wired into the build, the environment module and env:check', () => {
    const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
    expect(read('next.config.mjs')).toContain('assertBuildIsolation(process.env)');
    expect(read('next.config.mjs')).toContain('NEXT_PUBLIC_AUTODINE_DEPLOY_ENV: deployEnvironment(process.env)');
    expect(read('lib/supabase/env.ts')).toContain('assertDeploymentIsolation({');
    expect(read('scripts/check-env.mjs')).toContain('isolationProblem(');
  });
});
