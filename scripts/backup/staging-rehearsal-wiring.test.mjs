#!/usr/bin/env node
/**
 * Wiring guard for the STAGING B2 rehearsal workflow
 * (`.github/workflows/staging-b2-rehearsal.yml`).
 *
 * The staging rehearsal is the only workflow in this repository that can read
 * staging backup data and write to a B2 bucket. It must fail closed at every
 * boundary; this suite proves the boundaries are wired, offline and without
 * credentials:
 *
 *   - only `workflow_dispatch` (manual) can trigger it — no schedule, no push;
 *   - the exact-code gate job carries NO secret, variable or environment and
 *     runs before any credential-consuming job;
 *   - the rehearsal job requires the gate, and references exactly one
 *     environment: `backup-staging`;
 *   - exactly the six designated environment secret names appear, exactly the
 *     three designated variable names appear, and nothing else;
 *   - no repository-secret fallback name, no `secrets: inherit`, no B2
 *     endpoint override, no pruning flag, no production secret names;
 *   - every PostgreSQL connection string in the workflow is loopback-only;
 *   - the exact-code gate's pinned manifest is byte-identical to this
 *     working tree's implementation (scripts/backup, the postgres-client
 *     composite action, package.json, package-lock.json) — drift here fails
 *     the build, it does not silently re-pin.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows', 'staging-b2-rehearsal.yml');
const PINNED_PATHS = ['scripts/backup', '.github/actions/postgres-client', 'package.json', 'package-lock.json'];
const SIX_SECRETS = [
  'STAGING_AUTODINE_BACKUP_PASSPHRASE',
  'STAGING_AUTODINE_BACKUP_SOURCE_URL',
  'STAGING_B2_ACCESS_KEY_ID',
  'STAGING_B2_REGION',
  'STAGING_B2_SECRET_ACCESS_KEY',
  'STAGING_B2_BUCKET',
];
const THREE_VARS = [
  'AUTODINE_PRODUCTION_B2_BUCKETS',
  'AUTODINE_STAGING_B2_BUCKET',
  'AUTODINE_STAGING_PROJECT_REF',
];

const raw = readFileSync(WF, 'utf8');
const doc = parseYaml(raw);
const jobs = doc?.jobs ?? {};

function stepNames(job) {
  return (job?.steps ?? []).map((s) => String(s.name ?? s.run ?? '')).join('\n');
}
function allStepSecretRefs(job) {
  const refs = [];
  for (const step of job?.steps ?? []) {
    for (const value of Object.values(step.env ?? {})) refs.push(String(value));
    if (step.with) for (const value of Object.values(step.with)) refs.push(String(value));
    refs.push(String(step.run ?? ''));
    refs.push(String(step.uses ?? ''));
  }
  return refs.join('\n');
}

test('the workflow triggers on workflow_dispatch only — never on schedule or push', () => {
  assert.deepEqual(Object.keys(doc.on ?? {}).sort(), ['workflow_dispatch']);
  assert.ok(doc.on.workflow_dispatch !== undefined, 'workflow_dispatch must be declared');
  // The ref input is optional and constrained to a full commit SHA by the gate.
  const ref = doc.on.workflow_dispatch.inputs?.ref;
  assert.ok(ref, 'the dispatch must expose the exact-implementation ref input');
  assert.equal(ref.type, 'string');
  assert.notEqual(ref.required, true, 'ref defaults to the commit the workflow runs at');
  assert.doesNotMatch(raw, /^\s*schedule\s*:/m);
});

test('permissions are exactly contents:read and concurrency never cancels in flight', () => {
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.equal(doc.concurrency?.group, 'staging-b2-rehearsal');
  assert.equal(doc.concurrency?.['cancel-in-progress'], false);
});

test('workflow-level structure is exactly the gate job and the rehearsal job', () => {
  assert.deepEqual(Object.keys(jobs).sort(), ['exact-code-gate', 'staging-rehearsal']);
  for (const job of Object.values(jobs)) {
    assert.equal(job.runs_on, undefined, 'JS keys in YAML keep underscores only where written');
    assert.ok(job['timeout-minutes'] > 0, 'every job must have a timeout');
  }
});

test('the gate job carries no environment, secret or variable reference', () => {
  const gate = jobs['exact-code-gate'];
  assert.ok(gate, 'the exact-code gate job must exist');
  assert.equal(gate.environment, undefined, 'the gate must not bind the protected environment');
  const gateText = allStepSecretRefs(gate) + JSON.stringify(gate.env ?? {});
  assert.doesNotMatch(gateText, /secrets\./, 'the gate must not read any secret');
  assert.doesNotMatch(gateText, /vars\./, 'the gate must not read any variable');
});

test('the rehearsal job needs the gate and binds exactly the backup-staging environment', () => {
  const rehearsal = jobs['staging-rehearsal'];
  assert.ok(rehearsal, 'the rehearsal job must exist');
  assert.equal(rehearsal.needs, 'exact-code-gate');
  assert.equal(rehearsal.environment, 'backup-staging');
  assert.equal(rehearsal.services?.drilldb?.image, 'postgres:17');
  const occurrences = (raw.match(/environment:\s*backup-staging/g) ?? []).length;
  assert.equal(occurrences, 1, 'backup-staging must be declared exactly once');
});

test('exactly the six designated staging secrets appear, and nothing else', () => {
  const refs = [...raw.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(refs)].sort(), [...SIX_SECRETS].sort());
  assert.doesNotMatch(raw, /^\s*secrets:\s*inherit(\s|$)/m, 'blanket secret inheritance is forbidden');
  assert.doesNotMatch(raw, /secrets\.(AUTODINE_BACKUP|AUTODINE_RESTORE|B2_|BACKUP_ALERT)/, 'no production or unprefixed secret name may appear');
  assert.doesNotMatch(raw, /permissions:[\s\S]*id-token/, 'no OIDC token permission');
});

test('exactly the three designated staging variables appear, and nothing else', () => {
  const refs = [...raw.matchAll(/vars\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(refs)].sort(), [...THREE_VARS].sort());
});

test('no endpoint override, no pruning flag, no artifact of raw backup material', () => {
  assert.doesNotMatch(raw, /B2_ENDPOINT/, 'the endpoint override must never be wired');
  assert.doesNotMatch(raw, /--prune-b2/, 'the rehearsal must never prune');
  for (const step of jobs['staging-rehearsal']?.steps ?? []) {
    const p = String(step.with?.path ?? '');
    if (p) assert.doesNotMatch(p, /\.enc|backup-logical/, 'only reports may be uploaded as artifacts');
  }
});

test('every PostgreSQL connection string in the workflow is loopback-only', () => {
  const urls = [...raw.matchAll(/postgresql:\/\/[^\n]*?@([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 1, 'the restore target must be spelled out');
  for (const host of urls) assert.equal(host, '127.0.0.1', `non-loopback restore target host: ${host}`);
});

test('the checkout, validation and consuming steps run in fail-closed order', () => {
  const steps = jobs['staging-rehearsal']?.steps ?? [];
  const order = steps.map((s) => String(s.name ?? s.uses ?? s.run ?? ''));
  const idx = (pattern) => order.findIndex((name) => pattern.test(name));
  const seq = [
    idx(/checkout/i),
    idx(/PostgreSQL 17 client/),
    idx(/Install dependencies/),
    idx(/preflight/i),
    idx(/Refuse undesignated source/),
    idx(/Back up staging/),
    idx(/Download newest B2 artifact/),
    idx(/Restore and verify/),
    idx(/Evidence summary/),
    idx(/Preserve reports only/),
    idx(/Remove backup material/),
  ];
  for (const [i, value] of seq.entries()) assert.ok(value >= 0, `step ${i} must exist`);
  for (let i = 1; i < seq.length; i += 1) {
    assert.ok(seq[i] > seq[i - 1], `step order broken at position ${i}: ${order.join(' -> ')}`);
  }
});

test('the preflight step checks presence of all six secrets and three variables without reading values', () => {
  const steps = jobs['staging-rehearsal']?.steps ?? [];
  const preflight = steps.find((s) => /preflight/i.test(String(s.name ?? '')));
  assert.ok(preflight, 'a preflight step must exist');
  const env = preflight.env ?? {};
  for (const name of SIX_SECRETS) {
    assert.equal(env[`STAGING_SECRET_${name}_SET`], `\${{ secrets.${name} != '' }}`, `preflight must check ${name} presence as a boolean`);
  }
  for (const name of THREE_VARS) {
    assert.equal(env[`STAGING_VAR_${name}_SET`], `\${{ vars.${name} != '' }}`, `preflight must check ${name} presence as a boolean`);
  }
  assert.doesNotMatch(String(preflight.run ?? ''), /secrets\.|vars\./, 'the preflight body consumes only precomputed booleans — values never materialize here');
  assert.doesNotMatch(String(preflight.run ?? ''), /env\b.*echo.*\$/, 'the preflight must not echo environment contents');
});

test('the source/bucket validation step runs the staging validator before any credential is consumed', () => {
  const steps = jobs['staging-rehearsal']?.steps ?? [];
  const validate = steps.find((s) => /Refuse undesignated source/.test(String(s.name ?? '')));
  assert.ok(validate, 'the staging source validator step must exist');
  assert.match(String(validate.run ?? ''), /validate-staging-source\.mjs/);
  const backup = steps.find((s) => /Back up staging/.test(String(s.name ?? '')));
  assert.ok(backup, 'the backup step must exist');
  assert.match(String(backup.run ?? ''), /run-scheduled\.mjs.*--b2/);
  assert.doesNotMatch(String(backup.run ?? ''), /--prune-b2/);
});

test('the exact-code gate pins a 40-hex SHA and the checkout uses the same ref', () => {
  const gate = jobs['exact-code-gate'];
  const gateRun = (gate.steps ?? []).map((s) => String(s.run ?? '')).join('\n');
  assert.match(gateRun, /\^\[0-9a-f\]\{40\}\$/, 'the gate must demand a full lowercase commit SHA');
  assert.match(gateRun, /rev-parse FETCH_HEAD/, 'the gate must prove the fetched commit equals the request');
  const rehearsal = jobs['staging-rehearsal'];
  const checkout = (rehearsal.steps ?? []).find((s) => String(s.uses ?? '').startsWith('actions/checkout'));
  assert.equal(checkout?.with?.ref, '${{ inputs.ref || github.sha }}', 'the checkout must use the exact gated ref');
});

test('the gate heredoc manifest is byte-identical to this working tree', () => {
  const gate = jobs['exact-code-gate'];
  const verify = (gate.steps ?? []).find((s) => /byte for byte/i.test(String(s.name ?? '')));
  assert.ok(verify, 'the manifest verification step must exist');
  const body = String(verify.run ?? '');
  const match = body.match(/<<'V3_MANIFEST'\n([\s\S]*?)\nV3_MANIFEST/);
  assert.ok(match, 'the gate must embed the pinned manifest as a heredoc');
  const embedded = match[1].split('\n').filter(Boolean);
  // Recompute the manifest from the working tree: same enumeration and modes
  // git ls-tree would report for a commit of this tree.
  const files = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const relPath = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.isFile()) files.push(relPath);
      else throw new Error(`unexpected entry in pinned set: ${relPath}`);
    }
  };
  for (const rel of PINNED_PATHS) {
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
    else files.push(rel);
  }
  const actual = files
    .map((rel) => {
      const abs = path.join(ROOT, rel);
      const oid = execFileSync('git', ['hash-object', abs], { encoding: 'utf8' }).trim();
      const mode = (statSync(abs).mode & 0o111) !== 0 ? '100755' : '100644';
      return `${mode} blob ${oid}\t${rel}`;
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.split('\t')[1]), Buffer.from(b.split('\t')[1])));
  const embeddedSorted = [...embedded].sort((a, b) => Buffer.compare(Buffer.from(a.split('\t')[1]), Buffer.from(b.split('\t')[1])));
  assert.deepEqual(embeddedSorted, actual,
    'the embedded manifest drifted from the implementation — regenerate it in the same change, never by hand');
  assert.deepEqual(embedded, actual, 'the embedded manifest must be in git ls-tree order (path, byte sort)');
});

test('the backup implementation never loads a .env file or dotenv', () => {
  for (const file of readdirSync(path.join(ROOT, 'scripts', 'backup'))) {
    if (!file.endsWith('.mjs')) continue;
    const body = readFileSync(path.join(ROOT, 'scripts', 'backup', file), 'utf8');
    assert.doesNotMatch(body, /from\s+['"]dotenv['"]|import\s*\(\s*['"]dotenv['"]|require\(\s*['"]dotenv['"]/, `${file} must not import dotenv`);
    assert.doesNotMatch(body, /['"`][^'"`]*\.env['"`]/, `${file} must not read a .env file`);
  }
});

test('the gate fetches by exact commit and refuses anything else', () => {
  const gate = jobs['exact-code-gate'];
  const fetchStep = (gate.steps ?? []).find((s) => /Fetch the requested commit/i.test(String(s.name ?? '')));
  assert.ok(fetchStep, 'the fetch step must exist');
  assert.match(String(fetchStep.run ?? ''), /git fetch --no-tags --depth=1 origin/);
  assert.match(String(fetchStep.run ?? ''), /git init/, 'the gate must work from an empty directory');
  assert.doesNotMatch(stepNames(gate), /checkout/i, 'the gate must not depend on a checked-out tree');
});

test('hosted rehearsal has a non-overridable stop before checkout and all secret handling', () => {
  const steps = jobs['staging-rehearsal']?.steps ?? [];
  const stop = steps.findIndex((s) => /Stop until hosted isolation/.test(String(s.name ?? '')));
  const checkout = steps.findIndex((s) => String(s.uses ?? '').startsWith('actions/checkout'));
  assert.equal(stop, 0);
  assert.ok(checkout > stop);
  assert.equal(steps[stop].if, undefined, 'the stop must not depend on an opt-in');
  assert.match(String(steps[stop].run), /(?:^|\n)exit 1(?:\n|$)/);
  assert.deepEqual(steps[stop].env ?? {}, {});
});

test('the hosted backup failure diagnostic never relays child output or credential lengths', () => {
  const step = jobs['staging-rehearsal'].steps.find((s) => /Back up staging/.test(String(s.name ?? '')));
  assert.ok(step);
  const run = String(step.run);
  assert.match(run, /> \/dev\/null 2>&1/);
  assert.doesNotMatch(run, /\$\{#(?:AUTODINE|B2_)/);
  assert.doesNotMatch(run, /\b(?:tee|grep|sed|cat)\b/);
  assert.doesNotMatch(run, /STAGING_FAILURE_REASON/);
});

test('source authentication uses the private service after source validation', () => {
  const steps = jobs['staging-rehearsal'].steps;
  const validate = steps.findIndex((s) => /Refuse undesignated source/.test(String(s.name ?? '')));
  const auth = steps.findIndex((s) => /Authentication check/.test(String(s.name ?? '')));
  assert.ok(validate >= 0 && auth > validate);
  const run = String(steps[auth].run);
  assert.match(run, /withPgService/);
  assert.match(run, /stdio: 'ignore'/);
  assert.doesNotMatch(run, /PGPASSWORD|r\.stderr|r\.error\.message|console\.log\(.*(?:projectRef|password|user|database)/);
});
