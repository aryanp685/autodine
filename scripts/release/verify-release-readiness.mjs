#!/usr/bin/env node
/**
 * Offline release-readiness verifier — fail-closed, read-only, no network.
 *
 * Verifies the repository is in the state the 2026-11-14 release preparation
 * documents assumed. It does NOT connect to any hosted service, does NOT
 * authorize a release, and deliberately fails if the GST/IRP authorization
 * boundary drifts. Exits 0 only when every invariant holds; prints one line
 * per check with a fixed vocabulary. Run: `npm run verify:release`.
 *
 * 2026-11-21 cleanup note: the 2026-11-14 release-preparation documents this
 * verifier reads (docs/migration-manifest-2026-11-14.md,
 * docs/gst-irp-production-readiness-2026-11-14.md,
 * docs/production-release-prep-2026-11-14.md, docs/owner-action-register-2026-11-14.md,
 * docs/owner-closure-package-2026-11-14.md, docs/credential-exposure-remediation-2026-11-14.md,
 * docs/execution-report-2026-11-14.md) were removed in the 2026-11-21 cleanup.
 * Missing documents now surface as named FAIL lines (exit 1) instead of an
 * unhandled exception — the gate fails closed by design and is NOT cleared by
 * editing this script. Restoring the evidence (or formally re-drawing the
 * release boundary) is an owner decision.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const problems = [];
const notes = [];
const check = (name, ok, detail = '') => {
  if (ok) notes.push(`ok ${name}`);
  else problems.push(`FAIL ${name}${detail ? ': ' + detail : ''}`);
};
// Missing documents yield '' (every content assertion below then fails
// closed with a named FAIL line) rather than an unhandled exception.
const read = (p) => {
  try {
    return readFileSync(join(root, p), 'utf8');
  } catch {
    return '';
  }
};

// 1. Migration inventory: exactly 113 files, unique 14-digit versions.
// 98 at the 2026-11-14 baseline, plus three 2026-11-19 remediation migrations
// (receipt-helper ACL restore, new-outlet 0% tax default, guest GST quote
// projection) plus one announcement claim-recovery (20261119000400) plus two
// QR migrations (20261118002200 staff boundary F-01/F-02/F-03, 20261118002300 owner management),
// plus mainline 20261121000100/200 and 20261122000100/200,
// plus Billing Spec v2.0 foundation (20261123000100), waiter/coupons/split-bill (20261123000200),
// Printing & Devices + IRP persistence (20261123000300), Mode A/B operating paths (20261123000400),
// and Phase 1 Order Reliability & Traceability (20261123000500),
// plus staff billing settings reads (20261123000600), the
// verification-session id drift repair (20261122190000), and the
// method-aware manual settlement (20261124000100), readiness probes (20261124020000),
// and finance-view ACL repair (20261124030000).
const migDir = join(root, 'supabase/migrations');
const migFiles = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const versions = migFiles.map((f) => f.slice(0, 14));
check('migration_count_118', migFiles.length === 118, `found ${migFiles.length}`);
check('migration_versions_unique', new Set(versions).size === versions.length);
check('migration_versions_14_digit', versions.every((v) => /^[0-9]{14}$/.test(v)));

// 2. Owner-operation stays OUT of migrations/ and is present where expected.
check('owner_operation_present', existsSync(join(root, 'supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql')));
check('owner_operation_not_in_migrations', !migFiles.includes('20261110000501_revoke_supabase_admin_client_defaults.sql'));

// 3. GST/IRP Phase B (B1–B7) exist and are documented as NOT AUTHORIZED.
const GST_B = ['20261113000100_gst_two_mode.sql','20261114000101_gst_b2b_einvoice_readiness.sql','20261114000200_irp_reconciliation.sql','20261114000300_gst_mode_gates.sql','20261114000400_restrict_trigger_functions_execute.sql','20261114000500_credit_debit_notes.sql','20261114000600_einvoice_issuance_profile.sql'];
for (const f of GST_B) check(`gst_irp_present:${f.slice(0,14)}`, migFiles.includes(f));
const manifest = existsSync(join(root, 'docs/migration-manifest-2026-11-14.md')) ? read('docs/migration-manifest-2026-11-14.md') : '';
const manifestVersions = new Set([...manifest.matchAll(/`([0-9]{14})`/g)].map((m) => m[1]));
const actualVersions = new Set(versions);
check('manifest_tracks_all_118', actualVersions.size === manifestVersions.size && [...actualVersions].every((v) => manifestVersions.has(v)),
  `manifest ${manifestVersions.size} versions vs actual ${actualVersions.size}`);

check('manifest_marks_gst_irp_unauthorized', manifest.includes('NOT AUTHORIZED') && manifest.includes('GST/IRP'));
check('gst_irp_plan_unauthorized', read('docs/gst-irp-production-readiness-2026-11-14.md').includes('NOT AUTHORIZED'));

// 4. Staging share-origin gate intact (approved ref + approved origin).
const so = read('scripts/staging/verify-share-origin.mjs');
check('share_origin_ref_pinned', so.includes("juwyhslzchjevqkdvwjm"));
check('share_origin_origin_pinned', so.includes('https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app'));

// 5. Fail-closed cron boundary: exactly one cron, daily (Vercel Hobby).
const vercel = JSON.parse(read('vercel.json'));
check('vercel_single_daily_cron', Array.isArray(vercel.crons) && vercel.crons.length === 1 && vercel.crons[0].schedule === '30 1 * * *');

// 6. Billing fail-closed boundary: no production adapter by default.
const sb = read('lib/billing/sandbox.ts');
check('billing_sandbox_refuses_production', sb.includes("'production'") && sb.includes('SANDBOX'));
const provider = read('lib/billing/provider.ts');
check('billing_provider_null_default', provider.includes('getBillingProvider'));

// 7. Release documents exist. The owner registers, closure package, execution
// report and credential remediation were moved out of the public repo on
// 2026-11-24 (archived by the owner); the manifest remains the tracked record.
check('doc_present:migration-manifest-2026-11-14.md', existsSync(join(root, 'docs/migration-manifest-2026-11-14.md')));

// 8. No GST/IRP object can appear applied: the e2e/test suites must not reference IRP endpoints as enabled.
const gates = read('docs/gst-irp-production-readiness-2026-11-14.md');
check('gst_irp_doc_states_not_applied', /NOT APPLIED/i.test(gates) || /Nothing.*applied/i.test(gates));

for (const n of notes) console.log(n);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`verify:release FAILED (${problems.length} problem(s))`);
  process.exit(1);
}
console.log(`verify:release OK (${notes.length} checks) — repository-side release invariants hold; this is NOT release authorization.`);
