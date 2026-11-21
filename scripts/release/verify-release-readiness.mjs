#!/usr/bin/env node
/**
 * Offline release-readiness verifier — fail-closed, read-only, no network.
 *
 * Verifies that the current repository inventory and release gates agree. It does NOT connect to any hosted service, does NOT
 * authorize a release, and deliberately fails if the GST/IRP authorization
 * boundary drifts. Exits 0 only when every invariant holds; prints one line
 * per check with a fixed vocabulary. Run: `npm run verify:release`.
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
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Migration inventory: closed GST/IRP checkpoint plus guest checkout integrity.
const EXPECTED_MIGRATIONS = 123;
const migDir = join(root, 'supabase/migrations');
const migFiles = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const versions = migFiles.map((f) => f.slice(0, 14));
check(`migration_count_${EXPECTED_MIGRATIONS}`, migFiles.length === EXPECTED_MIGRATIONS, `found ${migFiles.length}`);
check('migration_versions_unique', new Set(versions).size === versions.length);
check('migration_versions_14_digit', versions.every((v) => /^[0-9]{14}$/.test(v)));

// 2. Owner-operation stays OUT of migrations/ and is present where expected.
check('owner_operation_present', existsSync(join(root, 'supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql')));
check('owner_operation_not_in_migrations', !migFiles.includes('20261110000501_revoke_supabase_admin_client_defaults.sql'));

// 3. The prior GST/IRP bundle and its follow-ups are NOT AUTHORIZED.
const GST_B = [
  '20261113000100_gst_two_mode.sql',
  '20261114000101_gst_b2b_einvoice_readiness.sql',
  '20261114000200_irp_reconciliation.sql',
  '20261114000300_gst_mode_gates.sql',
  '20261114000400_restrict_trigger_functions_execute.sql',
  '20261114000500_credit_debit_notes.sql',
  '20261114000600_einvoice_issuance_profile.sql',
  '20261118000100_merge_boundary_gst_order_line_edits.sql',
  '20261118000200_gst_configuration_boundary.sql',
  '20261118000300_gst_pricing_boundary.sql',
  '20261118000400_gst_document_integrity.sql',
  '20261118000500_gst_document_report.sql',
  '20261118000600_gst_ca_onboarding.sql',
  '20261118000700_gst_ca_documents.sql',
  '20261118000800_gst_outlet_activation.sql',
  '20261118000900_gst_recipient_documents.sql',
  '20261118001000_gst_irp_readiness.sql',
  '20261118001100_gst_reconciliation.sql',
  '20261118001200_gst_review_lifecycle.sql',
  '20261118001300_gst_direct_fulfilment.sql',
  '20261118001400_gst_irp_rehearsal_store.sql',
  '20261118001500_gst_finance_scope.sql',
  '20261118001600_gst_document_particulars.sql',
  '20261118001700_gst_irp_rehearsal_recovery.sql',
  '20261118001800_irp_execution.sql',
  '20261118001900_irp_document_projection.sql',
];
const manifest = existsSync(join(root, 'docs/migration-manifest-2026-11-14.md')) ? read('docs/migration-manifest-2026-11-14.md') : '';
const rows = [...manifest.matchAll(/^\| `(\d{14})` \| `([^`]+)` \| (.*)$/gm)];
const manifestFiles = new Map(rows.map(([, version, name, classification]) => [`${version}_${name}.sql`, classification]));
check(`manifest_tracks_all_${EXPECTED_MIGRATIONS}`, rows.length === EXPECTED_MIGRATIONS && migFiles.every((file) => manifestFiles.has(file)),
  `manifest ${rows.length} rows vs actual ${migFiles.length} files`);
for (const filename of GST_B) {
  const row = manifestFiles.get(filename);
  check(`gst_irp_present_and_unauthorized:${filename.slice(0, 14)}`,
    migFiles.includes(filename) && row?.includes('GST/IRP') && row.includes('NOT AUTHORIZED'));
}
check('guest_checkout_migration_unauthorized', manifestFiles.get('20261118002000_guest_checkout_integrity.sql')?.includes('NOT AUTHORIZED'));
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

// 7. Release documents exist and report the NO-GO decision honestly.
for (const doc of ['docs/production-release-prep-2026-11-14.md','docs/owner-action-register-2026-11-14.md','docs/owner-closure-package-2026-11-14.md','docs/migration-manifest-2026-11-14.md','docs/credential-exposure-remediation-2026-11-14.md','docs/execution-report-2026-11-14.md']) {
  check(`doc_present:${doc.split('/').pop()}`, existsSync(join(root, doc)));
}
check('execution_report_no_go', read('docs/execution-report-2026-11-14.md').includes('NO-GO'));

// 8. The readiness plan must still distinguish local replay from hosted application.
const gates = read('docs/gst-irp-production-readiness-2026-11-14.md');
check('gst_irp_doc_states_not_applied', /NOT APPLIED/i.test(gates) || /Nothing.*applied/i.test(gates));

for (const n of notes) console.log(n);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`verify:release FAILED (${problems.length} problem(s))`);
  process.exit(1);
}
console.log(`verify:release OK (${notes.length} checks) — repository-side release invariants hold; this is NOT release authorization.`);
