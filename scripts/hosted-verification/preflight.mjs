#!/usr/bin/env node
/**
 * Hosted verification preflight — READ-ONLY.
 *
 *   node scripts/hosted-verification/preflight.mjs          # text report
 *   node scripts/hosted-verification/preflight.mjs --json   # machine-readable
 *
 * One entry point for "what is actually configured right now, and what is
 * still the owner's to do?". It answers three questions and nothing else:
 *
 *   1. PRESENCE  — is each required configuration NAME set? Only SET / UNSET
 *      is ever printed. A value is never read, logged, or echoed.
 *   2. STATE     — what is the live GitHub state (open PRs, registered
 *      workflows, recent runs)? Read through the `gh` CLI; when `gh` is
 *      absent or not permitted, the answer is UNKNOWN — never a guess.
 *   3. VERDICT   — per package, one of READY-TO-AUTHORIZE / OWNER-ACTION-
 *      REQUIRED / UNKNOWN, with the names still missing.
 *
 * The honesty rules matter more than the convenience:
 *
 *   - Presence is not validity, and validity is not delivery. A verdict of
 *     READY-TO-AUTHORIZE means "the inputs are in place, a human must now
 *     authorize the hosted run" — never "this has been verified".
 *   - UNKNOWN is never rendered as UNSET. When GitHub refuses to list the
 *     repository's secret names, the script says the names could not be
 *     read. Reporting "absent" because a read failed would be a lie.
 *   - Nothing here contacts a database, dispatches a workflow, changes a
 *     setting, or sends a request that mutates anything. The only network
 *     calls are the read-only `gh` queries below.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.AUTODINE_PREFLIGHT_REPO || 'aryanp685/autodine';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The branch whose deployments the preflight reports. */
const HEAD_REF = process.env.AUTODINE_PREFLIGHT_HEAD || 'arena/88c342c2-autodine';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

/* ------------------------------------------------------------------ *
 * Configuration names. Names only — never values.
 * ------------------------------------------------------------------ */

/**
 * The names each package needs. `secrets` are repository/hosted secret
 * names (GitHub Actions); `env` are names a hosted deployment reads from
 * its environment.
 */
const REQUIRED_NAMES = {
  backup: [
    'AUTODINE_BACKUP_SOURCE_URL',
    'AUTODINE_BACKUP_PASSPHRASE',
    'B2_REGION',
    'B2_BUCKET',
    'B2_ACCESS_KEY_ID',
    'B2_SECRET_ACCESS_KEY',
  ],
  email: ['AUTODINE_EMAIL_PROVIDER', 'BREVO_API_KEY', 'AUTODINE_EMAIL_FROM', 'BREVO_WEBHOOK_SECRET'],
  monitoring: ['AUTODINE_ALERT_WEBHOOK', 'AUTODINE_CRON_SECRET'],
};

/** Files whose presence proves a package's local half is in place. */
const REQUIRED_FILES = {
  backup: [
    'scripts/backup/backup-logical.mjs',
    'scripts/backup/upload-b2.mjs',
    'scripts/backup/download-b2.mjs',
    'scripts/backup/restore-logical.mjs',
    'scripts/verify-external-services-config.mjs',
  ],
  pitr: ['scripts/verify-pitr-checklist.mjs', 'docs/pitr-verification-procedure-2026-11-14.md'],
  email: ['app/api/email/brevo/webhook/route.ts', 'lib/email/provider.ts'],
  isolation: ['scripts/verify-preview-isolation.mjs', 'lib/supabase/deployment-isolation.ts'],
  browser: ['.github/workflows/supabase-e2e-load.yml'],
};

/** Workflows that must be registered BY NAME (not merely present as a file). */
const REQUIRED_WORKFLOWS = {
  backup: 'Hosted backup (B2)',
  drill: 'Hosted restore rehearsal (disposable)',
};

/* ------------------------------------------------------------------ *
 * Read-only helpers.
 * ------------------------------------------------------------------ */

/** Runs `gh` and returns stdout, or null when it cannot be used. */
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) return null;
  return result.stdout ?? '';
}

/** Secret names configured on the repository. null when they cannot be read. */
function repoSecretNames() {
  const out = gh(['secret', 'list', '--repo', REPO]);
  if (out === null) return null;
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

/** Registered workflows: name -> state. null when they cannot be read. */
function repoWorkflows() {
  const out = gh(['workflow', 'list', '--repo', REPO, '--all']);
  if (out === null) return null;
  const map = new Map();
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\t|\s{2,}/).filter(Boolean);
    if (parts.length >= 2) map.set(parts[0], parts[1]);
  }
  return map;
}

/** Open pull requests: number -> { title, head, state }. */
function repoPullRequests() {
  const out = gh(['pr', 'list', '--repo', REPO, '--limit', '30', '--state', 'open']);
  if (out === null) return null;
  const map = new Map();
  for (const line of out.split('\n')) {
    const parts = line.trim().split('\t').filter(Boolean);
    if (parts.length >= 3) {
      map.set(Number(parts[0]), { title: parts[1], head: parts[2], state: parts[3] ?? 'OPEN' });
    }
  }
  return map;
}

/** Recent workflow runs: a short summary, newest first. */
function repoRecentRuns(limit = 5) {
  const out = gh(['run', 'list', '--repo', REPO, '--limit', String(limit)]);
  if (out === null) return null;
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const parts = line.split(/\t/);
      return {
        name: parts[0] ?? '',
        status: parts[1] ?? '',
        conclusion: parts[2] ?? '',
        event: parts[3] ?? '',
        ref: parts[4] ?? '',
      };
    });
}

/**
 * The most recent Vercel commit statuses: the deployment that the push
 * produced.
 *
 * Read-only: the commit-status API for the branch head. This is what makes
 * "a deployment happened" a reported fact instead of an assumption, and it
 * distinguishes a Preview (the deployment is reported for a branch head
 * that is not on the production branch) from a Production deployment.
 *
 * null when the read is refused.
 */
function repoHeadDeployments() {
  const out = gh(['api', `repos/${REPO}/commits/${HEAD_REF}/status`]);
  if (out === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    return null;
  }
  return (parsed.statuses ?? [])
    .filter((status) => /vercel/i.test(String(status.context ?? '')))
    .map((status) => ({
      context: status.context ?? '',
      state: status.state ?? '',
      description: status.description ?? '',
      target: status.target_url ?? '',
    }));
}

/**
 * The presence of one configuration name.
 *
 * `local`  — is it set in this process's environment?
 * `repo`   — is it a repository secret name? null when GitHub refused.
 */
function presenceOf(name, repoSecrets) {
  const local = typeof process.env[name] === 'string' && process.env[name].trim() !== '';
  let repo = null;
  if (repoSecrets) repo = repoSecrets.includes(name);
  return {
    name,
    local: local ? 'SET' : 'UNSET',
    repo: repo === null ? 'UNKNOWN' : repo ? 'SET' : 'UNSET',
  };
}

/** The files a package needs, and which of them are present. */
function filePresence(paths) {
  return paths.map((relative) => ({
    path: relative,
    present: existsSync(path.join(ROOT, relative)),
  }));
}

/* ------------------------------------------------------------------ *
 * Package verdicts.
 * ------------------------------------------------------------------ */

const READY = 'READY-TO-AUTHORIZE';
const OWNER = 'OWNER-ACTION-REQUIRED';
const UNKNOWN = 'UNKNOWN';

/**
 * Every package, in the runbook's order. Each returns a verdict plus the
 * facts behind it. A package never claims more than it checked.
 */
function buildPackages(context) {
  const { workflows, prs, names } = context;
  const packages = [];

  /* Package 1 — B2 backup + artifact verification */
  {
    const missing = names.backup.filter((n) => n.repo === 'UNSET').map((n) => n.name);
    const unreadable = names.backup.filter((n) => n.repo === 'UNKNOWN').map((n) => n.name);
    const files = filePresence(REQUIRED_FILES.backup);
    const missingFiles = files.filter((f) => !f.present).map((f) => f.path);
    const notes = [];
    if (missing.length) notes.push(`repository secret names absent: ${missing.join(', ')}`);
    if (unreadable.length) notes.push(`secret names could not be read: ${unreadable.join(', ')}`);
    if (missingFiles.length) notes.push(`missing files: ${missingFiles.join(', ')}`);
    const verdict = unreadable.length && !missing.length
      ? UNKNOWN
      : missing.length || missingFiles.length
        ? OWNER
        : READY;
    packages.push({
      id: 'b2-backup',
      title: 'B2 backup + artifact verification',
      gate: 'OWNER-CREDS -> OWNER-AUTH',
      verdict,
      notes,
    });
  }

  /* Package 2 — Disposable hosted restore rehearsal */
  {
    const notes = [];
    let verdict = UNKNOWN;
    if (!workflows) {
      notes.push('workflow list could not be read');
    } else {
      const drill = workflows.get(REQUIRED_WORKFLOWS.drill);
      const asFile = [...workflows.entries()].find(([name]) => name.endsWith('hosted-restore-drill.yml'));
      if (drill) {
        verdict = READY;
        notes.push(`workflow "${REQUIRED_WORKFLOWS.drill}" is registered by name (${drill})`);
      } else if (asFile) {
        verdict = OWNER;
        notes.push(
          `the drill is registered only as a file path ("${asFile[0]}") — it cannot be dispatched by name; ` +
            'the registration fix (PR #190) merged on 2026-11-19, so a file-path registration means the fix ' +
            'is not on main yet',
        );
      } else {
        verdict = OWNER;
        notes.push('the restore drill workflow is not registered at all');
      }
      const backup = workflows.get(REQUIRED_WORKFLOWS.backup);
      notes.push(
        backup
          ? `workflow "${REQUIRED_WORKFLOWS.backup}" is registered by name (${backup})`
          : `workflow "${REQUIRED_WORKFLOWS.backup}" is NOT registered by name`,
      );
    }
    if (prs) {
      const pr190 = prs.get(190);
      // PR #190 merged on 2026-11-19, so the drill is expected to be
      // registered by name. The note says what is actually true, rather
      // than repeating a stale instruction to merge a pull request that
      // is already merged.
      notes.push(
        pr190
          ? `PR #190 is ${pr190.state} (${pr190.head}) — the registration fix is expected to be on main`
          : 'PR #190 is not among the open pull requests (it merged on 2026-11-19)',
      );
    }
    packages.push({
      id: 'restore-rehearsal',
      title: 'Disposable hosted restore rehearsal',
      gate: 'OWNER-AUTH',
      verdict,
      notes,
    });
  }

  /* Package 3 — PITR / recovery evidence */
  {
    const files = filePresence(REQUIRED_FILES.pitr);
    const missingFiles = files.filter((f) => !f.present).map((f) => f.path);
    packages.push({
      id: 'pitr',
      title: 'PITR / recovery evidence',
      gate: 'OWNER-CREDS',
      verdict: missingFiles.length ? OWNER : READY,
      notes: missingFiles.length
        ? [`missing files: ${missingFiles.join(', ')}`]
        : ['the offline checklist is present; the PITR-vs-B2 decision and a human signature are still the owner\'s'],
    });
  }

  /* Package 4 — Auth email + Brevo deliverability */
  {
    const names4 = names.email;
    const missing = names4.filter((n) => n.repo === 'UNSET').map((n) => n.name);
    const unreadable = names4.filter((n) => n.repo === 'UNKNOWN').map((n) => n.name);
    const files = filePresence(REQUIRED_FILES.email);
    const missingFiles = files.filter((f) => !f.present).map((f) => f.path);
    const notes = [];
    if (missing.length) notes.push(`environment names absent: ${missing.join(', ')}`);
    if (unreadable.length) notes.push(`environment names could not be read: ${unreadable.join(', ')}`);
    if (missingFiles.length) notes.push(`missing files: ${missingFiles.join(', ')}`);
    notes.push(
      'Brevo only: the provider is Brevo, not Resend — "RESEND_API_KEY" is deliberately NOT a required name ' +
        'and is never activated by the app',
    );
    notes.push(
      'Brevo must allow Supabase Auth egress IPs (SMTP -> Authorized IPs): with the restriction on, every Auth ' +
        'mail fails with 525 5.7.1 Unauthorized IP address',
    );
    packages.push({
      id: 'email',
      title: 'Auth email + Brevo deliverability',
      gate: 'OWNER-CREDS -> OWNER-AUTH',
      verdict: missing.length || missingFiles.length ? OWNER : unreadable.length ? UNKNOWN : READY,
      notes,
    });
  }

  /* Package 5 — Realtime multi-device verification */
  {
    packages.push({
      id: 'realtime',
      title: 'Realtime multi-device verification',
      gate: 'OWNER-AUTH',
      verdict: OWNER,
      notes: [
        'needs a seeded Staging project, three devices and a human observing the fallback — ' +
          'no local command can stand in for it',
      ],
    });
  }

  /* Package 6 — Guest QR-to-receipt browser E2E */
  {
    const files = filePresence(REQUIRED_FILES.browser);
    const missingFiles = files.filter((f) => !f.present).map((f) => f.path);
    packages.push({
      id: 'browser-e2e',
      title: 'Guest QR-to-receipt browser E2E (hosted stack)',
      gate: 'OWNER-AUTH',
      verdict: missingFiles.length ? OWNER : READY,
      notes: missingFiles.length
        ? [`missing files: ${missingFiles.join(', ')}`]
        : ['the CI workflow is present; the run itself needs an authorized dispatch on a disposable environment'],
    });
  }

  /* Package 7 — Monitoring, alert delivery + recovery */
  {
    const missing = names.monitoring.filter((n) => n.repo === 'UNSET').map((n) => n.name);
    const unreadable = names.monitoring.filter((n) => n.repo === 'UNKNOWN').map((n) => n.name);
    const notes = [];
    if (missing.length) notes.push(`environment names absent: ${missing.join(', ')}`);
    if (unreadable.length) notes.push(`environment names could not be read: ${unreadable.join(', ')}`);
    notes.push('the incident vocabulary is fixed and tenant-free; Auth mail failures raise incidents too');
    packages.push({
      id: 'monitoring',
      title: 'Monitoring, alert delivery + recovery',
      gate: 'OWNER-CREDS -> OWNER-AUTH',
      verdict: missing.length ? OWNER : unreadable.length ? UNKNOWN : READY,
      notes,
    });
  }

  /* Package 8 — Preview/Staging isolation */
  {
    const files = filePresence(REQUIRED_FILES.isolation);
    const missingFiles = files.filter((f) => !f.present).map((f) => f.path);
    const notes = [];
    let productionRefs = [];
    try {
      const parsed = JSON.parse(
        readFileSync(path.join(ROOT, 'lib/supabase/production-projects.json'), 'utf8'),
      );
      productionRefs = parsed.productionProjectRefs ?? [];
    } catch {
      notes.push('the production project ref list could not be read');
    }
    if (productionRefs.length) notes.push(`protected Production project refs: ${productionRefs.join(', ')}`);
    packages.push({
      id: 'preview-isolation',
      title: 'Preview/Staging isolation',
      gate: 'LOCAL -> OWNER-AUTH',
      verdict: missingFiles.length ? OWNER : READY,
      notes: missingFiles.length
        ? [...notes, `missing files: ${missingFiles.join(', ')}`]
        : notes,
    });
  }

  return packages;
}

/* ------------------------------------------------------------------ *
 * Rendering.
 * ------------------------------------------------------------------ */

function renderText(report) {
  const lines = [];
  lines.push('AUTODINE — hosted verification preflight (read-only)');
  lines.push(`repository: ${report.repository}`);
  lines.push('');
  lines.push('CONFIGURATION NAMES (presence only — values are never read)');
  for (const [group, entries] of Object.entries(report.names)) {
    lines.push(`  ${group}:`);
    for (const entry of entries) {
      lines.push(`    ${entry.name.padEnd(32)} local=${entry.local.padEnd(5)} repo=${entry.repo}`);
    }
  }
  lines.push('');
  lines.push('LIVE STATE');
  if (report.state.workflows === null) lines.push('  workflows: UNKNOWN (could not be read)');
  else {
    lines.push(`  workflows: ${report.state.workflows.length} registered`);
    for (const name of [REQUIRED_WORKFLOWS.backup, REQUIRED_WORKFLOWS.drill]) {
      const entry = report.state.workflows.find((w) => w.name === name);
      lines.push(`    ${entry ? 'by name' : 'NOT BY NAME'}  ${name}`);
    }
  }
  if (report.state.pullRequests === null) lines.push('  pull requests: UNKNOWN (could not be read)');
  else {
    for (const pr of report.state.pullRequests) {
      lines.push(`    PR #${pr.number} ${pr.state} ${pr.head} — ${pr.title}`);
    }
  }
  if (report.state.runs === null) lines.push('  recent runs: UNKNOWN (could not be read)');
  else if (report.state.runs.length === 0) lines.push('  recent runs: none');
  else {
    for (const run of report.state.runs) {
      lines.push(`    ${run.status}/${run.conclusion}  ${run.name} (${run.ref})`);
    }
  }
  if (report.state.deployments === null) lines.push('  deployments: UNKNOWN (could not be read)');
  else if (report.state.deployments.length === 0) lines.push('  deployments: none reported for the branch head');
  else {
    lines.push(`  deployments for ${report.headRef}:`);
    for (const deployment of report.state.deployments) {
      lines.push(`    ${deployment.state} — ${deployment.description}`);
      if (deployment.target) lines.push(`      ${deployment.target}`);
    }
    lines.push('    (a Preview deployment is produced automatically when a branch is pushed; a Production');
    lines.push('     deployment is what merging into the production branch produces.)');
  }
  lines.push('');
  lines.push('PACKAGE VERDICTS (READY-TO-AUTHORIZE means the inputs are in place — not that anything was verified)');
  for (const pkg of report.packages) {
    lines.push(`  [${pkg.verdict}] ${pkg.id} — ${pkg.title}`);
    lines.push(`      gate: ${pkg.gate}`);
    for (const note of pkg.notes) lines.push(`      - ${note}`);
  }
  lines.push('');
  lines.push('Presence is not validity; validity is not delivery. Every package still ends in its own');
  lines.push('authorized hosted run with evidence filed under qa-evidence/.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Main.
 * ------------------------------------------------------------------ */

const repoSecrets = repoSecretNames();
const workflows = repoWorkflows();
const prs = repoPullRequests();
const runs = repoRecentRuns();
const deployments = repoHeadDeployments();

const names = {
  backup: REQUIRED_NAMES.backup.map((n) => presenceOf(n, repoSecrets)),
  email: REQUIRED_NAMES.email.map((n) => presenceOf(n, repoSecrets)),
  monitoring: REQUIRED_NAMES.monitoring.map((n) => presenceOf(n, repoSecrets)),
};

const packages = buildPackages({ repoSecrets, workflows, prs, names });

const report = {
  generatedBy: 'scripts/hosted-verification/preflight.mjs',
  readOnly: true,
  repository: REPO,
  headRef: HEAD_REF,
  names,
  state: {
    workflows: workflows
      ? [...workflows.entries()].map(([name, state]) => ({ name, state }))
      : null,
    pullRequests: prs
      ? [...prs.entries()].map(([number, pr]) => ({ number, ...pr }))
      : null,
    runs,
    deployments,
  },
  packages,
};

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write(renderText(report) + '\n');
}
