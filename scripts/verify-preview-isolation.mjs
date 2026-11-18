#!/usr/bin/env node
/**
 * Independent Preview/Development ↔ production isolation verifier.
 *
 * Runs entirely offline. It checks the same rule the build and the server
 * enforce (scripts/deployment-isolation.mjs — the twin of
 * lib/supabase/deployment-isolation.ts), plus the data it depends on, and
 * prints a verdict the owner can attach to the "unblock new Preview builds"
 * decision. It never prints secret values, never contacts a host, and never
 * changes any configuration.
 *
 *   node scripts/verify-preview-isolation.mjs            # offline matrix self-test
 *   node scripts/verify-preview-isolation.mjs --file f   # vet one candidate env file
 *
 * --file parses KEY=VALUE lines (comments and `export ` prefixes tolerated)
 * and reports, by key NAME only, whether that file's configuration may run
 * as written. It never prints values.
 */
import { readFileSync } from 'node:fs';
import { isolationProblem, productionRefs } from './deployment-isolation.mjs';

const { productionProjectRefs } = JSON.parse(
  readFileSync(new URL('../lib/supabase/production-projects.json', import.meta.url), 'utf8'),
);

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${detail && !pass ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};
const problemStartsCleanly = (msg) => typeof msg === 'string' && msg.startsWith('AutoDine deployment isolation:');

// --- 1. The production ref data itself -----------------------------------
ok('at least one production ref is configured', Array.isArray(productionProjectRefs) && productionProjectRefs.length >= 1);
const refs = productionRefs();
const refPattern = /^([a-z0-9]{20}|[a-z0-9][a-z0-9.-]*[a-z0-9])$/;
for (const ref of refs) {
  ok(`production ref "${ref}" is a project ref or hostname`, refPattern.test(ref));
}
ok('production refs are unique', new Set(refs.map((r) => r.toLowerCase())).size === refs.length);

// --- 2. The verdict matrix -------------------------------------------------
const prodRef = refs[0].replace(/\..*$/, '');
const prodUrl = `https://${prodRef}.supabase.co`;
const stagingUrl = 'https://juwyhslzchjevqkdvwjm.supabase.co';
const legacyJwtFor = (ref) => `header.${Buffer.from(JSON.stringify({ ref })).toString('base64url')}.signature`;
const matrix = [
  { label: 'production deploy may target production', env: { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: null },
  { label: 'preview deploy may not target production by URL', env: { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: 'problem' },
  { label: 'development deploy may not target production by URL', env: { VERCEL_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: 'problem' },
  { label: 'unset environment may not target production', env: { NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: 'problem' },
  { label: 'preview deploy may point at a non-production project', env: { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: stagingUrl }, expect: null },
  { label: 'preview deploy may not hold a production-ref legacy JWT', env: { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: legacyJwtFor(prodRef) }, expect: 'problem' },
  { label: 'preview deploy may not hold a production secret JWT', env: { VERCEL_ENV: 'preview', SUPABASE_SERVICE_ROLE_KEY: legacyJwtFor(prodRef) }, expect: 'problem' },
  { label: 'preview cannot declare itself production over Vercel', env: { VERCEL_ENV: 'preview', AUTODINE_DEPLOY_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: 'problem' },
  { label: 'production wins on Vercel even if a preview declaration is set', env: { VERCEL_ENV: 'production', NEXT_PUBLIC_AUTODINE_DEPLOY_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: null },
  { label: 'preview with only a new-style (refless) key and staging URL is allowed', env: { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: stagingUrl, SUPABASE_SECRET_KEY: 'sb_secret_example' }, expect: null },
  { label: 'an unrelated declared env outside Vercel is not believed for production', env: { AUTODINE_DEPLOY_ENV: 'staging', NEXT_PUBLIC_SUPABASE_URL: prodUrl }, expect: 'problem' },
];
for (const row of matrix) {
  const verdict = isolationProblem(row.env);
  if (row.expect === null) {
    ok(row.label, verdict === null, verdict ?? '');
  } else {
    ok(row.label, problemStartsCleanly(verdict), verdict ?? 'no problem reported');
  }
}

// --- 3. Optional: vet one candidate env file --------------------------------
const fileFlag = process.argv.indexOf('--file');
if (fileFlag !== -1) {
  const path = process.argv[fileFlag + 1];
  if (!path) { console.error('--file needs a path'); process.exit(2); }
  const env = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  const verdict = isolationProblem(env);
  const environment = String(env.VERCEL_ENV ?? env.NEXT_PUBLIC_AUTODINE_DEPLOY_ENV ?? env.AUTODINE_DEPLOY_ENV ?? '(unset)');
  if (verdict === null) {
    console.log(`FILE OK    ${path} — configuration may run as environment "${environment}" (no production target detected). Values not shown.`);
  } else {
    console.log(`FILE REFUSED ${path} — ${verdict}\n  (key names only; values not printed)`);
    failures += 1;
  }
}

if (failures) {
  console.error(`\nISOLATION-SELFTEST FAILED (${failures} check(s)). New Preview builds must stay blocked.`);
  process.exit(1);
}
console.log('\nISOLATION-SELFTEST PASSED. New Preview builds are still gated on the hosted checklist in docs/preview-isolation.md.');
