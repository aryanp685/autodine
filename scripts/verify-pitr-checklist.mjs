#!/usr/bin/env node
/**
 * Machine-checkable PITR/backup evidence validator — offline, no hosted access.
 *
 * Two modes:
 *   --template        print the evidence template the owner/operator fills in
 *                     during the P1–P6 procedure (the procedure doc was removed in the
 *                     2026-11-21 cleanup; see docs/backup-restore-runbook.md)
 *   --check <file>    validate a filled-in evidence file. Exits 1 and names every
 *                     failing field; exits 0 with a PASS summary when every
 *                     checkpoint required for the "backup gate met" claim is present.
 *
 * The validator never contacts a database or a network endpoint. When the
 * evidence names a backup file that exists in the filesystem, its SHA-256 is
 * recomputed and compared against the recorded digest — that is the one
 * genuinely machine-verifiable artifact. Everything else is schema/consistency
 * checking of human-produced evidence (dates, digests, booleans), which is why
 * the PITR procedure still requires signatures; this script is the checklist,
 * not the signature.
 *
 * Usage:
 *   node scripts/verify-pitr-checklist.mjs --template > pitr-evidence.json
 *   node scripts/verify-pitr-checklist.mjs --check pitr-evidence.json
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const argv = process.argv.slice(2);
const mode = argv[0];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const HEX64 = /^[0-9a-f]{64}$/i;
const HEX40 = /^[0-9a-f]{7,64}$/i; // release refs: git sha (any abbreviation) or sha256
const DECISIONS = new Set(['pitr', 'scheduled_backups', 'logical_pipeline', 'written_waiver']);

const template = {
  release_ref: '<release commit sha>',
  generated_at: '<ISO-8601 timestamp>',
  p1: {
    plan_tier: '<Free|Pro|Team|Enterprise>',
    pitr_enabled: false,
    region: '<project region>',
    db_size_bytes: 0,
    access_owners_recorded: true,
    dated: '<ISO-8601>',
  },
  p2: {
    decision: '<pitr|scheduled_backups|logical_pipeline|written_waiver>',
    backup_owner: '<named human>',
    alert_route: '<where the alert goes — a human, not a mailbox nobody reads>',
    written_at: '<ISO-8601>',
  },
  p3: {
    backup_file: '<path of the encrypted backup, optional to validate hash>',
    backup_sha256: '<64-hex digest>',
    restore_target: '<scratch project ref or local disposable database>',
    restore_verified_at: '<ISO-8601>',
    row_fingerprint_match: true,
    money_invariant_match: true,
    health_ok_on_scratch: true,
    scratch_destroyed: true,
    transcript_ref: '<where the raw output lives>',
  },
  p4: {
    pitr_tested: false,
    measured_rpo_seconds: null,
    measured_rto_seconds: null,
    copy_project_destroyed: null,
    notes: '',
  },
  p5: {
    schedule_installed: false,
    alert_webhook_proven: false,
    quarterly_drill_calendared: false,
    notes: '',
  },
  p6: {
    owner_decisions_remaining: [],
    signed_by: '<name>',
    signed_at: '<ISO-8601>',
  },
};

if (mode === '--template') {
  process.stdout.write(JSON.stringify(template, null, 2) + '\n');
  process.exit(0);
}
if (mode !== '--check' || !argv[1]) {
  console.error('Usage: node scripts/verify-pitr-checklist.mjs --template | --check <evidence.json>');
  process.exit(2);
}

let evidence;
try {
  evidence = JSON.parse(await readFile(argv[1], 'utf8'));
} catch (error) {
  console.error(`Cannot read evidence file: ${error.message}`);
  process.exit(2);
}

const failures = [];
const notes = [];
const ok = (cond, field, message) => { if (!cond) failures.push(`${field}: ${message}`); };
const isIso = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

ok(isObj(evidence), 'file', 'top level must be a JSON object');
if (!isObj(evidence)) finish();

ok(typeof evidence.release_ref === 'string' && HEX40.test(evidence.release_ref), 'release_ref', 'must be the release commit sha');
ok(isIso(evidence.generated_at), 'generated_at', 'must be an ISO-8601 timestamp');

// ---- P1: platform baseline observed (read-only dashboard) ------------------
const p1 = evidence.p1;
ok(isObj(p1), 'p1', 'required object (plan, PITR, region, size)');
if (isObj(p1)) {
  ok(typeof p1.plan_tier === 'string' && p1.plan_tier.trim().length > 1, 'p1.plan_tier', 'record the observed plan tier');
  ok(typeof p1.pitr_enabled === 'boolean', 'p1.pitr_enabled', 'must be an explicit boolean from the dashboard');
  ok(typeof p1.region === 'string' && p1.region.trim().length > 1, 'p1.region', 'record the project region');
  ok(Number.isFinite(p1.db_size_bytes) && p1.db_size_bytes >= 0, 'p1.db_size_bytes', 'record the observed size in bytes');
  ok(p1.access_owners_recorded === true, 'p1.access_owners_recorded', 'pass requires an explicit true (who holds owner/password/passphrase)');
  ok(isIso(p1.dated), 'p1.dated', 'must be an ISO-8601 timestamp of the observation');
}

// ---- P2: protection posture decided in writing ------------------------------
const p2 = evidence.p2;
ok(isObj(p2), 'p2', 'required object (decision, owner, route)');
if (isObj(p2)) {
  ok(DECISIONS.has(p2.decision), 'p2.decision', `must be one of ${[...DECISIONS].join(', ')}`);
  ok(typeof p2.backup_owner === 'string' && p2.backup_owner.trim().length > 1, 'p2.backup_owner', 'a named human, or the waiver signatory');
  ok(typeof p2.alert_route === 'string' && p2.alert_route.trim().length > 3, 'p2.alert_route', 'record where the alert is routed');
  ok(isIso(p2.written_at), 'p2.written_at', 'must be an ISO-8601 timestamp');
  if (p2.decision === 'written_waiver') notes.push('p2 is a written waiver — the backup gate is explicitly NOT met by design; see docs/backup-restore-runbook.md.');
}

// ---- P3: restore verified on disposable infrastructure ------------------------
const p3 = evidence.p3;
ok(isObj(p3), 'p3', 'required object (encrypted backup restored to scratch)');
if (isObj(p3)) {
  ok(typeof p3.backup_sha256 === 'string' && HEX64.test(p3.backup_sha256), 'p3.backup_sha256', 'must be the 64-hex sha256 of the encrypted backup');
  ok(typeof p3.restore_target === 'string' && p3.restore_target.trim().length > 1, 'p3.restore_target', 'name the scratch project/database used');
  ok(isIso(p3.restore_verified_at), 'p3.restore_verified_at', 'must be an ISO-8601 timestamp');
  ok(p3.row_fingerprint_match === true, 'p3.row_fingerprint_match', 'pass requires true (full chain fingerprint identical after destroy-and-restore)');
  ok(p3.money_invariant_match === true, 'p3.money_invariant_match', 'pass requires true (money invariants identical)');
  ok(p3.health_ok_on_scratch === true, 'p3.health_ok_on_scratch', 'pass requires true (/api/health ok against scratch)');
  ok(p3.scratch_destroyed === true, 'p3.scratch_destroyed', 'pass requires true, or the scratch must be recorded elsewhere with its retention');
  ok(typeof p3.transcript_ref === 'string' && p3.transcript_ref.trim().length > 3, 'p3.transcript_ref', 'point at where the raw transcript is stored');
  if (typeof p3.backup_file === 'string' && p3.backup_file.trim()) {
    try {
      const info = await stat(p3.backup_file);
      if (!info.isFile()) {
        failures.push('p3.backup_file: exists but is not a regular file');
      } else {
        const digest = createHash('sha256').update(await readFile(p3.backup_file)).digest('hex');
        if (HEX64.test(p3.backup_sha256 ?? '') && digest.toLowerCase() !== p3.backup_sha256.toLowerCase()) {
          failures.push(`p3.backup_file: sha256 recomputed ${digest} does not match recorded ${p3.backup_sha256}`);
        } else {
          notes.push('p3.backup_file: sha256 recomputed and matches the recorded digest.');
        }
      }
    } catch {
      notes.push('p3.backup_file: path not readable from this host — hash NOT re-verified (acceptable for owner-held evidence gathered elsewhere).');
    }
  }
}

// ---- P4: PITR verified (only when PITR is the chosen posture) -----------------
const p4 = evidence.p4;
ok(isObj(p4), 'p4', 'required object (PITR drill or explicit n/a)');
const pitrChosen = isObj(p2) && p2.decision === 'pitr';
if (isObj(p4)) {
  if (pitrChosen) {
    ok(p4.pitr_tested === true, 'p4.pitr_tested', 'PITR was chosen in p2 — pass requires a completed restore-to-new-project drill');
    ok(Number.isFinite(p4.measured_rpo_seconds) && p4.measured_rpo_seconds >= 0, 'p4.measured_rpo_seconds', 'measured, not estimated');
    ok(Number.isFinite(p4.measured_rto_seconds) && p4.measured_rto_seconds >= 0, 'p4.measured_rto_seconds', 'measured, not estimated');
    ok(p4.copy_project_destroyed === true, 'p4.copy_project_destroyed', 'the PITR copy project must be destroyed');
  } else if (p4.pitr_tested === true) {
    ok(Number.isFinite(p4.measured_rpo_seconds) && p4.measured_rpo_seconds >= 0, 'p4.measured_rpo_seconds', 'PITR was tested — record the measured RPO');
    ok(Number.isFinite(p4.measured_rto_seconds) && p4.measured_rto_seconds >= 0, 'p4.measured_rto_seconds', 'PITR was tested — record the measured RTO');
  } else {
    notes.push('p4: PITR not chosen/tested — acceptable only because p2 chose another posture or a written waiver.');
  }
}

// ---- P5: ongoing protection scheduled and proven -------------------------------
const p5 = evidence.p5;
ok(isObj(p5), 'p5', 'required object (schedule + alert proof)');
if (isObj(p5)) {
  ok(p5.schedule_installed === true, 'p5.schedule_installed', 'no cron/schedule, no backup — pass requires true');
  ok(p5.alert_webhook_proven === true, 'p5.alert_webhook_proven', 'an observed test alert is required — "configured" is not "proven"');
  ok(p5.quarterly_drill_calendared === true, 'p5.quarterly_drill_calendared', 'record the calendared restore drill');
}

// ---- P6: sign-off -------------------------------------------------------------
const p6 = evidence.p6;
ok(isObj(p6), 'p6', 'required object (sign-off and remaining decisions)');
if (isObj(p6)) {
  ok(Array.isArray(p6.owner_decisions_remaining), 'p6.owner_decisions_remaining', 'must be an array (empty allowed)');
  ok(typeof p6.signed_by === 'string' && p6.signed_by.trim().length > 1, 'p6.signed_by', 'a named human');
  ok(isIso(p6.signed_at), 'p6.signed_at', 'must be an ISO-8601 timestamp');
}

finish();

function finish() {
  if (failures.length) {
    console.error(`PITR evidence check FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('PITR evidence check PASSED: every checkpoint required for the backup gate is present and self-consistent.');
  for (const note of notes) console.log(`  note: ${note}`);
  console.log('Reminder: this validates evidence shape, not honesty. The signature in p6 is what carries it. No hosted claim is made by this script.');
  process.exit(0);
}
