# Workstream B · Priority 1 — two-mode GST closure evidence

## Final owner-readiness handoff — offline

**GO for offline owner/adviser review only. NO-GO for hosted preflight,
Staging, Production, migrations, deployment, activation or release.**
The implementation is locally verified; outlet and hosted gates are open.

| Evidence class | What this handoff establishes |
|---|---|
| **Locally verified implementation** | The acknowledged product matrix and prior local results below stand (235/235 PostgreSQL, 10/10 scoped HTTP fixtures). This pass matched the complete 86-path inventory (70 tracked modified / 16 untracked), verified both local branch refs and an empty index, rechecked the migration bytes, and ran the offline release inventory (34/34), migration chain (104 files / 4 anchors) and whitespace checks. No application, SQL integration or E2E rerun was needed for this documentation-only review. |
| **Synthetic populated upgrade** | The recorded 98→104 PostgreSQL rehearsal was reviewed against its fixture, assertions and local transcript: 230 passed / 2 optional direct PostgREST skips. The two legacy paid-sitting refusals below are reproduced cutover conditions, not a live-data finding. |
| **Actual hosted evidence** | **None for this candidate.** No provider metadata, database, ledger, data, Auth/PostgREST, cache, recovery or runtime was inspected. Existing pins and historical observations neither prove absence/presence of the legacy state nor grant access. |
| **Owner/adviser decisions** | Product-level CA confirmation is on record; no outlet permission, roster sign-off, legal/licence verification, profile/date, series allocation, legacy disposition or target authorization was supplied. Use the [single decision register](GST_OWNER_ACTION_REGISTER_2026-11-18.md#1-owner-action-register) and [preflight prerequisites](GST_OWNER_ACTION_REGISTER_2026-11-18.md#h0--exact-target-and-authorization-record). |

Only this closure report and the owner register were updated. The active ref
`arena/ce32f7c8-autodine` remains at `7064c912b1b85ab6364f23d1755d855ff4f462ad`;
local `main` remains at `3e17c44577a5236dca7dea5b4d35a16c0ffc1186`. See the
[14-file NOT AUTHORIZED inventory](#phase-b-migration-fingerprints). Do not
apply it. Read-only preflight, if later authorized, permits neither DDL nor
DML, restore, deployment, activation or migration.

## 2026-11-19 — CA-confirmed specification: local closure

**Local Priority 1 is implemented and verified. Hosted GST is not DONE.**
**Staging, Production and release: NO-GO. All 14 GST/IRP Phase B files: NOT AUTHORIZED.**
CA confirmation approved the product specification and local implementation,
not an outlet's eligibility, a migration, an activation or hosted acceptance.

### Workspace recovery and scope

| Check | Observed result |
|---|---|
| Workspace and branch | `/home/user/autodine`, one observed worktree; `arena/ce32f7c8-autodine` remains active. |
| Commit and tree | Actual HEAD `7064c912b1b85ab6364f23d1755d855ff4f462ad`; available handoff commit `3e17c44577a5236dca7dea5b4d35a16c0ffc1186` has the same committed tree `9967015f994ee23abd73c13b0e4a673e80fa0b36`. No branch switch, merge, reset, clone or commit was needed. |
| Recovered work | Opening status matched all **78 paths** (65 tracked modified / 13 untracked), including the owner package and earlier GST files. No path was discarded. Only GST-related refinements were made. The index was and remains empty. See both inventories below for the final working tree. |
| Protected history | All 98 baseline migration files and the prior four forward SQL files are byte-identical. Protected `scripts/phase3/staging-baseline.json` SHA-256 `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`. No protected baseline or historical apply bundle changed. |

No hosted connection, query, write, migration, deployment or activation;
no real payments/refunds, Git staging, commit, push or release action. No
IRP/e-invoice, full guest-to-receipt E2E, Realtime or later priority was started.

### Implementation versus specification

| Requirement | Local implementation and evidence |
|---|---|
| **Exactly two top-level choices** | Settings shows **GST** and **No-GST**. Composition is a No-GST situation, not a third mode. Server derives the stored treatment; direct DB inputs must match registration/profile. Legacy ordinary receipts are not a selectable third mode. Scoped Chromium exercised both choices and the conditional fields. |
| **Validated GST/FSSAI identity** | GST and Composition require a usable 15-character GSTIN (format, checksum and state code, PAN derived) and exactly 14 FSSAI digits. Unregistered requires FSSAI, the non-registration/no-obligation declaration and saved name/address/phone; active GSTIN and related fields are cleared, history retained. Server and DB reject missing, malformed or mismatched inputs. No external licence or portal verification. |
| **Standalone 5% without ITC** | Business type and six-digit service SAC required for GST. No free rate field: 5% without ITC for restaurant services (dine-in, takeaway and delivery); nonqualifying hotels also use 5%. The rate has no channel override. Tested shared pricing, not any newly built delivery/takeaway workflow. Existing inclusive gross and no-discount policy retained. |
| **Hotel 18% with ITC only at Specified Premises** | Mandatory hotel type, applicable FY, reviewed evidence/reference, attestation and effective date. Actual preceding-FY value **strictly greater than ₹7,500 per unit per day** or a valid opt-in filed within the adviser-confirmed applicable period. Equal threshold, wrong FY, incomplete evidence, standalone and out-of-window filings rejected. No filed-date rule invented. Tests cover both paths, India FY rollover/review and a paid 18% issue: ₹105.00 total, ₹88.98 taxable, ₹8.01 CGST + ₹8.01 SGST. |
| **TAX INVOICE** | Shared template for staff print/PDF/thermal and authorized shared links; saved seller GSTIN, FSSAI, SAC, issue date and FY/number, saved ticket lines, buyer details where applicable, outlet-state place of supply and tax breakup. Uses saved gross and one document-level extraction. Plain-text copy uses the same saved values. Unknown or applicable existing B2B e-invoice status still holds the document; no provider called. |
| **RETAIL BILL / CASH MEMO** | Reviewed unregistered quote and admission are zero tax even with a nonzero stored legacy rate; legacy tax/GSTIN controls cannot override reviewed billing. Document uses the saved business name/address/phone/FSSAI. Neither GSTIN nor GST amount or breakup printed in the sheet/text. Old plain receipts retain their earlier presentation and saved amounts. |
| **BILL OF SUPPLY** | No GST or breakup; document prints GSTIN and FSSAI and exact “Composition taxable person, not eligible to collect tax on supplies”. Registration/eligibility acknowledgment and alcohol gate preserved. Already-issued legacy declarations are preserved as saved. |
| **Independent consecutive FY numbers** | Per-outlet India FY `(outlet, FY, series)` serialization, `INV`, `BOS`, `RBL`, six digits, max 16 characters from A–Z, 0–9, slash, hyphen. Old INV counter continues. Real concurrent issue allocated 1 and 2, rollback did not consume a number, retry of an issued sitting kept the ID, void replacement used 3, BOS/RBL each began at 1, return to GST used 4. Prior FY counter unchanged. Registration-wide allocation for shared GSTINs/external systems is a separate activation constraint. |
| **Cancellation/history and money** | DB immutability tests, audited void/retained number and linkable replacement. Existing holds and expired/voided bearer links reveal no document. Snapshot upgrade kept original invoices/lines/config/history/payments, credit-note source amounts and no refund. Per-ticket recorded settlement, original gross/taxes and order history preserved; no second payment or repricing. |
| **Tenant and authority controls** | Authenticated Owner membership of selected outlet + entitlement + optimistic version, rechecked after lock. Managers read own only; no Manager/cross/sibling/no-membership saves, stale form/owner demotion and expiry refused, no private pricing executes for API roles. Open and closed-but-unissued noncancelled sittings block settings changes. Native roles/RLS and real Next action requests with synthetic sessions provide separate evidence. |
| **Reports, CSV and links** | Existing Owner/Manager `report_gst_documents` and no-store CSV use saved amounts and distinct kind/FY/series/status/hold buckets. Retail tax cells are blank; legacy rounding remains unknown rather than zero; older plain receipts stay in invoice history/ticket reports. No notes netting, payment or refund writes. Document and history links still use immutable IDs and seller snapshots, not active settings. |

### Exact verification results

| Command | Result on the local candidate |
|---|---|
| `npm ci --no-audit --no-fund` | **Passed**, 350 packages, Node 22.22.3. |
| `npm test` | **2,549 passed, 244 skipped**, **226 passed / 11 skipped suites** (237 files, 2,795 tests). Integration env not set here. All 244 gated SQL checks covered by the union below: 235 native, 9 additional order-read PostgreSQL cases in the embedded runner. |
| `npm run test:db:integration` | **235/235, no skips**, 10 suites (GST **41/41**, credit/debit notes **11/11**). Disposable PostgreSQL 17 replayed **104 migrations / 51 tables / 139 public functions** with the local harness. |
| `READINESS_GST_UPGRADE=1 npm run test:db:embedded` | **230 passed, 2 skipped**, 9 suites. Seeded the old catalog and 98-file handoff with its own RPCs, then a classified paid closed-unissued GST ticket at 102. Upgraded to 104 with no application-table scaffolds; snapshot comparison and refusal/continuity checks passed. The two optional direct PostgREST tests (anonymous direct order/finance vs token RPC; finance-view/operational-column role checks) were skipped without the local PostgREST binary. |
| `bash scripts/e2e/run-with-bundled-chromium.sh npx playwright test --config=playwright.gst-fixtures.config.ts --reporter=line` | **10/10, no skips.** Three cart/checkout quote cases, final-print GST/Composition, retail print identity, held/void/malformed share refusal, signed-out CSV, role-bound real Settings POST, conditional onboarding, and role-bound CSV. Next.js + loopback fixture; no genuine Auth JWT validation, PostgREST, persistent Settings write, real settlement or end-to-end order. Dev CSP/hydration warnings were logged; assertions passed. |
| `npm run typecheck`; `npm run lint`; `npm run design:check`; `npm run sql:check` | **Passed.** SQL parser check is DDL-only; function bodies/grants/RLS proof comes from real PostgreSQL above. |
| `GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build` | **Passed.** Guarded hermetic Next build with empty Supabase public/key/service overrides; no deploy. |
| `npm run migrations:verify`; `npm run verify:release`; `npm run test:staging:guards`; `npm run test:d2` | **Passed:** 104 migration versions / 4 anchors, **34/34** release invariants, **25/25** offline staging guard tests, **2/2** ACL guard tests. No access to Staging. |
| `npm run audit:definer`; `git diff --check`; `node --check` on edited runners/fixture | **Passed as checks.** Definer inventory: **112 inspected, 69 heuristic flags**, not clearance; private `gst_pricing_at` excluded from every client role by real ACL tests. |

### Synthetic populated-upgrade findings — legacy paid sittings

The disposable 98→104 rehearsal in
[`scripts/verify-gst-upgrade.mjs`](../../scripts/verify-gst-upgrade.mjs) reproduced
**two distinct synthetic cases**. In each, payment was already recorded
through the legacy settlement RPC; refusal was not an outstanding-balance
failure.

| Fixture and migration point | Reproduced result after the upgrade |
|---|---|
| **Paid, open Regular GST sitting** seeded at 98 files, before `20261118000200`. The historical lines had no `is_alcoholic_snapshot` evidence after the forward migration. | Atomic `close_order_session_and_issue_receipt` failed with `P0001` for unclassified historical lines. The sitting stayed open; no document or number was allocated. |
| **Paid, closed-but-unissued Regular 5% GST sitting** seeded at 102 files, after `20261118000500` and before `20261118000600`. The fixture modelled a prior close without an invoice; this was not produced by the new atomic close. The lines were explicitly classified non-alcoholic, but the old config had no CA-era FSSAI, business type or SAC. | `issue_closed_session_receipt` failed with `P0001` (review GST settings). Even an otherwise valid Owner save via `save_restaurant_gst_config` failed with `P0001` because the closed sitting still had no invoice row. The sitting stayed closed and unissued; there was no config version/history change, document, or number allocation. |

Snapshot comparison showed unchanged orders, ticket amounts, recorded
payments and counters on refusal. The already-issued final legacy invoice
kept **1,002p tax on 21,022p** (the modern calculation would be 1,001p); the
old held link returned no payload and did not increment access. Null legacy
rounding stayed null. The legacy paid Normal receipt still issued **11,772p**
including **1,261p** saved tax, and later enrolment continued the old INV
counter. Pre-classification menu rollback refused atomically.

**Cutover blocker if present on the approved target:** any unresolved
incompatible open or closed-but-unissued GST sitting (including a fully paid
one) must be resolved under signed owner/adviser disposition before an app or
schema cutover could affect that outlet. No live records have been checked;
prevalence and even presence are unknown. Defer the affected cutover if scope
or safe disposition is unresolved, including a shared change that would still
affect a deferred outlet. Never retry collection, reprice, backfill guessed
facts, change history, reset numbering or bypass the save guard to clear it.

### Remaining gates — outside local implementation

- **Owner/adviser:** confirm the outlet role split/roster and a written
  activate-or-defer decision for each outlet. Verify actual registration and
  FSSAI/licence mapping, business/address/SAC, tax profile, effective date,
  hotel qualification and annual review where relevant. Sign off item
  classification, existing B2B hold handling, correction policy and
  non-overlapping registration/external series allocation. Do not enrol an
  unsupported or unresolved outlet. The CA decision is a product decision.
- **Authority/isolation/compatibility:** O-B1 exact non-production target,
  immutable build and origin/API binding, and separate approval for fresh
  read-only preflight. Reconcile native and bundle ledgers, checksums,
  function/schema/ACL/RLS and Data API cache against the 104-file inventory.
  Check legacy open and closed-but-unissued tickets and rollback liabilities
  without modifying them. No query of Production or protected Staging.
- **Recovery and acceptance:** require target-bound backup, isolated restore
  proof and RPO/RTO disposition. Only then request written authority for
  exact files, a compatible deployment and the separately scoped synthetic
  acceptance. Genuine Auth, live PostgREST/catalog and Settings acceptance
  did not run. Full guest-to-receipt E2E, Realtime, IRP/e-invoice and later
  work remain deferred. Existing production/release blockers still apply.

See [owner-action register](GST_OWNER_ACTION_REGISTER_2026-11-18.md),
[operator guide](../../docs/gst-two-mode-2026-11-14.md#2026-11-19--ca-approved-product-specification-local-only)
and [migration inventory](../../docs/migration-manifest-2026-11-14.md).
Stop after this local closure; no hosted action is authorized by it.

<a name="ca-forward-migration-fingerprints"></a>

### Phase B migration fingerprints

**All 14 files are NOT AUTHORIZED for hosted use.** This is a fingerprint
inventory, **not** an apply order or evidence of hosted presence/absence.
The 104-file [manifest](../../docs/migration-manifest-2026-11-14.md) and the
offline release guard identify exactly this set. The six previously recorded
forward digests matched byte-for-byte: the [prior four](#forward-migration-artifacts)
and the two CA files. The other eight files' bytes matched both local refs;
their digests below were computed for this handoff. The subscription file
`20261114000100_owner_manager_subscription_reads.sql` and the separate
owner operation are not Phase B entries in this inventory. The latter has
its own authorization gate. No historical bundle replay or ledger repair.

| File (`supabase/migrations/`) | Workspace SHA-256 | Hosted use |
|---|---|---|
| `20261113000100_gst_two_mode.sql` | `cbbbb417d0e6c609bf6488a5d3cdf12879222213eedc24ec24747ec4bf480bd1` | **NOT AUTHORIZED** |
| `20261114000101_gst_b2b_einvoice_readiness.sql` | `79734085c67568f33bbfab8c2edd4648d52fb7a4a994e1b3adcb58d6aa140947` | **NOT AUTHORIZED** |
| `20261114000200_irp_reconciliation.sql` | `d0e3427d8f9dccb9b66222477cf10625b038c99c1799209dc530421b9ac8315d` | **NOT AUTHORIZED** |
| `20261114000300_gst_mode_gates.sql` | `baeab2d7402d5879d09b3f49127e80dcd5bbe9ffa907ec779264fe908aea918c` | **NOT AUTHORIZED** |
| `20261114000400_restrict_trigger_functions_execute.sql` | `87193d6e5fb72d618ee01e570593b8926e9803e9a0dc00f25d5dfd25e399b3d1` | **NOT AUTHORIZED** |
| `20261114000500_credit_debit_notes.sql` | `5e635edfb884fb7e3ff9d87876010791410e723fa7bd3279ca8d47559a0b9198` | **NOT AUTHORIZED** |
| `20261114000600_einvoice_issuance_profile.sql` | `c2d7f4e345a5aeb39607cddabf973a3827bcb3f670d6e9c4f7628994bae13101` | **NOT AUTHORIZED** |
| `20261118000100_merge_boundary_gst_order_line_edits.sql` | `d60b974c198578a8d52a2c5041a1759db76cc7759a2dca3a41214935972be2b8` | **NOT AUTHORIZED** |
| `20261118000200_gst_configuration_boundary.sql` | `6b344190a3b520a00e439c1ec0bac7ad01851acdf4b600ca3d14998068091b4f` | **NOT AUTHORIZED** |
| `20261118000300_gst_pricing_boundary.sql` | `0b1090d4bd5bf9241cde399cdfae73b1f1eb3069ecad3fb691390d1c96f2faeb` | **NOT AUTHORIZED** |
| `20261118000400_gst_document_integrity.sql` | `b89deb96ec378851031a4d1a152142e6def420063ce5441db6bb3f7c5b05ea51` | **NOT AUTHORIZED** |
| `20261118000500_gst_document_report.sql` | `840feb4cca68408f705a8aab7371a5d886a93bb7099ccf542c61316d876ec5d5` | **NOT AUTHORIZED** |
| `20261118000600_gst_ca_onboarding.sql` | `1fdd1c7dd80aa2d46dbc17e84aba5a97b26063663d7e821e23d1a1ab91332128` | **NOT AUTHORIZED** |
| `20261118000700_gst_ca_documents.sql` | `e5a9c9dd729044c28923832086f750a5749a3a6788a976ce2456c1ac0de0b50e` | **NOT AUTHORIZED** |

### Changed-file inventory

At local implementation closure, compared with recovery opening: **37** recovered paths refined,
**8** paths added to the local diff, **41** recovered paths
byte-identical; no recovered path missing. All 86 working-tree paths are
uncommitted (70 tracked modified,
16 untracked), with no staged paths.

**CA pass only** (`refined` was already in the GST diff; `added` is newly in
this diff, including changes to existing tracked files):

```text
added   AGENTS.md
refined RELEASE-BLOCKER-REPORT.md
added   app/(staff)/dashboard/settings/actions.ts
refined app/(staff)/dashboard/settings/gst-actions.test.ts
refined app/(staff)/dashboard/settings/gst-actions.ts
refined components/screens/GstSettingsPanel.tsx
added   components/screens/InvoiceHistoryScreen.test.tsx
added   components/screens/InvoiceHistoryScreen.tsx
refined components/screens/InvoiceScreen.test.tsx
refined components/screens/InvoiceScreen.tsx
refined components/screens/ReportsScreen.test.tsx
refined components/screens/ReportsScreen.tsx
refined components/screens/SettingsScreen.test.tsx
refined components/screens/SettingsScreen.tsx
refined docs/gst-irp-production-readiness-2026-11-14.md
refined docs/gst-staging-application-plan-2026-11-15.md
refined docs/gst-two-mode-2026-11-14.md
refined docs/migration-manifest-2026-11-14.md
refined docs/production-release-prep-2026-11-14.md
refined e2e/fixtures/gst-api.mjs
refined e2e/gst-http-fixtures.spec.ts
refined lib/db/credit-debit-notes.integration.test.ts
refined lib/db/database.ts
refined lib/db/gst-settings.ts
refined lib/db/gst-two-mode.integration.test.ts
refined lib/db/invoice-share.test.ts
refined lib/db/invoice-share.ts
refined lib/db/invoice.ts
refined lib/db/reports.test.ts
refined lib/db/reports.ts
refined lib/db/types.ts
added   lib/gst/composition.ts
added   lib/gst/onboarding.ts
refined lib/gst/test-fixtures.ts
refined lib/invoice.ts
refined qa-evidence/day1/GST_OWNER_ACTION_REGISTER_2026-11-18.md
refined qa-evidence/day1/GST_P1_CLOSURE_2026-11-18.md
refined qa-evidence/day1/MASTER_EXECUTION_STATUS.md
refined qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md
refined scripts/e2e/prepare-local-supabase.mjs
refined scripts/release/verify-release-readiness.mjs
refined scripts/verify-database.mjs
refined scripts/verify-gst-upgrade.mjs
added   supabase/migrations/20261118000600_gst_ca_onboarding.sql
added   supabase/migrations/20261118000700_gst_ca_documents.sql
```

**Complete recovered-plus-current working-tree inventory:**

```text
M  AGENTS.md
M  RELEASE-BLOCKER-REPORT.md
M  app/(staff)/dashboard/invoices/page.tsx
M  app/(staff)/dashboard/menus/actions.ts
M  app/(staff)/dashboard/menus/import-actions.ts
M  app/(staff)/dashboard/reports/export/route.ts
M  app/(staff)/dashboard/settings/actions.ts
M  app/(staff)/dashboard/settings/gst-actions.ts
M  app/menu/cart/page.tsx
M  app/menu/checkout/page.tsx
M  components/owner/CloseSessionButton.tsx
M  components/screens/BillScreen.test.tsx
M  components/screens/BillScreen.tsx
M  components/screens/CartScreen.test.tsx
M  components/screens/CartScreen.tsx
M  components/screens/CheckoutScreen.test.tsx
M  components/screens/CheckoutScreen.tsx
M  components/screens/DashboardScreen.test.tsx
M  components/screens/DashboardScreen.tsx
M  components/screens/GstSettingsPanel.tsx
M  components/screens/InvoiceHistoryScreen.test.tsx
M  components/screens/InvoiceHistoryScreen.tsx
M  components/screens/InvoiceNotesPanel.test.tsx
M  components/screens/InvoiceNotesPanel.tsx
M  components/screens/InvoiceScreen.test.tsx
M  components/screens/InvoiceScreen.tsx
M  components/screens/MenuEditorScreen.tsx
M  components/screens/MenuImportScreen.tsx
M  components/screens/ReportsScreen.test.tsx
M  components/screens/ReportsScreen.tsx
M  components/screens/SettingsScreen.test.tsx
M  components/screens/SettingsScreen.tsx
M  components/screens/VerifyToOrderScreen.tsx
M  docs/gst-irp-production-readiness-2026-11-14.md
M  docs/gst-staging-application-plan-2026-11-15.md
M  docs/gst-two-mode-2026-11-14.md
M  docs/migration-manifest-2026-11-14.md
M  docs/production-release-prep-2026-11-14.md
M  lib/bill.test.ts
M  lib/bill.ts
M  lib/cart-pricing.ts
M  lib/db/bill.ts
M  lib/db/cart-screen.test.ts
M  lib/db/cart-screen.ts
M  lib/db/credit-debit-notes.integration.test.ts
M  lib/db/dashboard-screen.ts
M  lib/db/database.ts
M  lib/db/gst-settings.ts
M  lib/db/gst-two-mode.integration.test.ts
M  lib/db/invoice-notes.ts
M  lib/db/invoice-share.ts
M  lib/db/invoice.ts
M  lib/db/menu-editor.ts
M  lib/db/report-sales.integration.test.ts
M  lib/db/reports.test.ts
M  lib/db/reports.ts
M  lib/db/settings-screen.ts
M  lib/db/types.ts
M  lib/gst/composition.ts
M  lib/invoice.ts
M  lib/menu-import.test.ts
M  lib/menu-import.ts
M  lib/menu-undo.test.ts
M  lib/menu-undo.ts
M  lib/pricing.ts
M  qa-evidence/day1/MASTER_EXECUTION_STATUS.md
M  qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md
M  scripts/e2e/prepare-local-supabase.mjs
M  scripts/release/verify-release-readiness.mjs
M  scripts/verify-database.mjs
?? app/(staff)/dashboard/settings/gst-actions.test.ts
?? e2e/fixtures/gst-api.mjs
?? e2e/gst-http-fixtures.spec.ts
?? lib/db/invoice-share.test.ts
?? lib/gst/onboarding.ts
?? lib/gst/test-fixtures.ts
?? playwright.gst-fixtures.config.ts
?? qa-evidence/day1/GST_OWNER_ACTION_REGISTER_2026-11-18.md
?? qa-evidence/day1/GST_P1_CLOSURE_2026-11-18.md
?? scripts/verify-gst-upgrade.mjs
?? supabase/migrations/20261118000200_gst_configuration_boundary.sql
?? supabase/migrations/20261118000300_gst_pricing_boundary.sql
?? supabase/migrations/20261118000400_gst_document_integrity.sql
?? supabase/migrations/20261118000500_gst_document_report.sql
?? supabase/migrations/20261118000600_gst_ca_onboarding.sql
?? supabase/migrations/20261118000700_gst_ca_documents.sql
```

---

## 2026-11-18 — Pre-CA checkpoint (historical)

**2026-11-18 UTC · Active branch `arena/ce32f7c8-autodine`**  
Arena branch point `7064c912b1b85ab6364f23d1755d855ff4f462ad`; checked-out
HEAD `3e17c44577a5236dca7dea5b4d35a16c0ffc1186` (PR #191). Tests ran against
the uncommitted working tree on that HEAD, not against a release or hosted
schema. **Implemented and locally verified; not DONE. Release/Staging NO-GO.
GST/IRP Phase B NOT AUTHORIZED.**

## IMPLEMENTED

The existing patch was audited in place, including the four new untracked
forward SQL files. No unrelated source changes were identified. The closure
pass changed only GST settings safeguards, local evidence and the associated
operator/readiness records; the previously implemented flows were preserved.

- **Settings:** actual selected outlet + expected config version required by
  the server action. A stale tab cannot save into a different outlet that
  happens to have the same version. The form outlet is a comparison, not an
  authorization input. The protected RPC rechecks and locks the current owner
  membership after the outlet lock; it rechecks the write entitlement, then
  writes the new version and its actor/declaration history in one transaction.
  Owner/Manager read within their memberships; a Manager cannot save GST.
- **Billing:** Normal retains the legacy ordinary receipt amounts. Composition
  issues a no-GST Bill of Supply with the required notice. Regular 5%/18%
  extracts GST from saved inclusive gross once per issued document. The
  ticket rate/mode/version and new line classification are frozen; stale or
  incompatible pricing is refused. The extra paisa goes to CGST, not to
  the amount collected. Counter settlement remains per ticket; no online
  guest payment, new tax treatments or discount policy.
- **Documents/reports:** immutable invoice/line/payment snapshots, final-only
  sharing, audit-marked voids, held B2B documents, full-document credit/debit
  notes separate from refunds, and a role-scoped GST report and signed-paise
  CSV. Authorised legacy note RPC calls against held sources still record
  a **nonfinal** held note; no such issue control is offered in the UI.

## VERIFIED

### Current runs

Run at repository root with the locked dependencies and no hosted service
configuration. Node 22.22.3, embedded PostgreSQL 17 and bundled Chromium
153.0.8010.0. The two PostgreSQL suite totals overlap; they are **not** added
as distinct cases. Earlier checkpoint counts are historical.

| Command | Result |
|---|---|
| `npm test` | **2,538 passed, 241 skipped**, 226 passed files / 11 skipped files. See SQL skip recovery below. |
| `npm run test:db:integration` | **232/232**, ten suites, including GST **38/38** and notes **11/11**. Replayed **102 migrations**, 51 tables and 136 public functions in the disposable harness. |
| `READINESS_GST_UPGRADE=1 npm run test:db:embedded` | **227 passed, 2 optional HTTP skipped**, nine suites. Populated upgrade assertions passed in addition to Vitest. Replayed all 102 without application-table scaffolds (local Supabase/ACL shims only). |
| `bash scripts/e2e/run-with-bundled-chromium.sh npx playwright test --config=playwright.gst-fixtures.config.ts --reporter=line` | **8/8**, no retries. Actual Next pages, native Settings multipart POST, CSV and print media; synthetic Auth/REST responses, no persistent write. |
| Guarded build and full default Chromium run below | **Build passed; 64 passed, 49 skipped, 0 failed** of 113. All hermetic cases passed; the integration project did not run against a real stack. |
| `npm run typecheck`, `npm run lint`, `npm run design:check` | Passed. |
| `npm run sql:check`, `npm run migrations:verify`, `npm run verify:release` | Parser-only DDL check passed; **102 unique** versions and **4** hashable anchors; **32/32** release inventory checks. Body/role execution evidence comes from PostgreSQL, not the parser. |
| `npm run test:staging:guards`, `npm run test:d2`, `npm run audit:definer` | **25/25**, **2/2**, and catalog inventory of **111** definers / **68** heuristic flags for triage. Offline checks only. |
| `node --check scripts/e2e/prepare-local-supabase.mjs`, `git diff --check`, protected bytes | Passed. All 98 tracked migration files unchanged; staging baseline SHA-256 `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`. No index changes. |

The hermetic build/browser pair used:

```sh
export GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test
export NEXT_TELEMETRY_DISABLED=1 AUTODINE_MODE='' NEXT_PUBLIC_SUPABASE_URL=''
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='' NEXT_PUBLIC_SUPABASE_ANON_KEY=''
export SUPABASE_SERVICE_ROLE_KEY='' SUPABASE_SECRET_KEY=''
unset E2E_BASE_URL E2E_OWNER_EMAIL E2E_OWNER_PASSWORD E2E_STAFF_EMAIL E2E_STAFF_PASSWORD
unset E2E_QR_TOKEN E2E_TABLE_CODE E2E_SLUG E2E_OTHER_ORDER_ID E2E_EXPIRED_QR_TOKEN E2E_EXPIRED_INVITE_CODE DB_URL
npm run build && bash scripts/e2e/run-with-bundled-chromium.sh npx playwright test --retries=0 --reporter=line
```

### What those runs prove

| Boundary | Evidence |
|---|---|
| Settings request | Actual Next server action: allowed owner payload (fixture acknowledgment only); signed-out proxy redirect; unassigned, Manager, Cashier, Kitchen and read-only refusals; forged sibling-outlet binding refused; stale form refused after switching two entitled outlets at the same version. Manager sees own read-only settings, other roles see no form. CSV allows Owner/Manager only, checks active membership rather than cookie/query claims, uses `no-store` and keeps `-0.01` numeric. |
| SQL authorization | Tested with `SET LOCAL ROLE anon/authenticated/service_role` and synthetic subjects. Only entitled member Owner saves. Both independent tenants and same-account siblings with disjoint memberships tested **with rows present**. Account ownership alone gives no row/config mutation rights. No direct app-role table writes; RLS and grants checked, owner and Manager own-outlet reads work. The active-slug quote exposes only treatment and bps; internal `gst_pricing(uuid)` is not a client RPC. |
| Concurrent writes | Two saves with one expected version produce one committed history row; a blocked save after a committed owner demotion or account expiry is refused. Composition activation and alcohol classification serialize in either order. Actual anonymous guest placement through `place_public_order_attempt` refuses stale pricing after a competing save, leaves no ticket, and succeeds at the refreshed rate; active tickets stop further saves. |
| Money and documents | 5% and 18% inclusive, two-ticket +1/−1 paise invoice rounding with unchanged gross, odd paisa to CGST, portion/add-on amounts once, and Composition zero GST. Settlement cannot use surplus from another ticket. Direct issue, mismatch and historical classification gates fail closed without consuming numbers. Voids/notes preserve sources and payments. New and existing held/void links withheld at SQL and loader boundaries; ordinary/Composition output, locale paise and the required notice exercised. |
| Populated forward upgrade | `scripts/verify-gst-upgrade.mjs` created a real old publish before `20261114000101`, then seeded the 98-file state at `20261118000100` with three issued documents (Regular final, B2B held, Composition), six ticket lines and recorded payments, two minted links, an open paid GST sitting and an open paid Normal sitting. Applied only `20261118000200`–`20261118000500` from that boundary. Compared full saved rows (excluding newly added nullable fields, independently checked as NULL). No rewrite, migration replay of deployed versions or backfill. |
| Selected upgrade results | Old final GST link still shows saved **1,002 paise** tax on **21,022 paise** gross, not the new **1,001**; reports preserve unknown old rounding, not zero. Old held link returns no payload and no access increment. A credit note uses old amounts and does not change payments. The paid old Normal sitting issued **11,772 paise** with **1,261** legacy tax. Old GST close refused atomically, and old menu rollback lacking `is_alcoholic` refused atomically (23502) without clearing a live flag. No automatic repair or guessing. |

### Skips and recovered coverage

- **Default Vitest:** no `READINESS_DB_URL` / `THROTTLE_DB_URL`. Disposable
  `test:db:integration` ran the ten gated suites: `gst-two-mode` (38),
  `credit-debit-notes` (11), `owner-billing-guard` (6), `report-sales` (28),
  `readiness` (62), `phase0-security` (25), `subscription-billing` (41),
  `restaurant-account-link` (8), `account-link-audit` (8) and `throttle-db`
  (5). The embedded run also covered the **nine SQL** `order-read-boundary`
  cases. This covers the 241 SQL cases skipped by the default run.
- **Two separate optional HTTP cases:** `order-read-boundary` direct
  anonymous/guest RPC and authenticated finance/operational response tests
  require an executable `PGRST_BIN`. No local executable. The official
  v16.5 asset redirects to `release-assets.githubusercontent.com`, outside
  the sandbox's allowed endpoints. The GitHub API binary endpoint also
  returned a 302 to that host. Neither native SQL nor the synthetic HTTP
  fixture qualifies as a PostgREST pass. On an isolated runner with the
  official binary, set `PGRST_BIN` for the embedded test and exercise the
  GST RPC/raw table boundary as part of real-stack acceptance.
- **49 default Playwright integration skips:** `guest-order-flow` (8),
  `cashier-flow` (7), `kitchen-flow` (6), `security-flow` (6),
  `brand-studio-flow` (9), `responsive-owner` (7), `invites` (4), `throttle`
  (2). No local Supabase CLI/container stack or synthetic Auth/QR environment
  was available. Guards need a real isolated base URL, appropriate synthetic
  credentials, QR/slug/table fixture, and, for the two-ticket assertion,
  disposable `DB_URL`; negative cases also name a foreign order, expired QR
  or expired invite as appropriate. The isolated throttle runner separately
  requires PostgreSQL client tools and PostgREST. Recovered the GST-relevant
  pricing/placement, settlement, authorization and publish/rollback via
  actual SQL, and Settings/quote/print/share/CSV routes via local fixtures.
  This does **not** close real sign-in, Auth/JWT, gateway/schema cache,
  full QR-to-receipt/print/CSV, or real-stack catalog browser coverage.

### Forward migration artifacts

These are **test fingerprints, not an apply list**. All four retain their
not-authorized status, as do the earlier eight Phase B files. See the
[manifest](../../docs/migration-manifest-2026-11-14.md).

| Filename | SHA-256 |
|---|---|
| `20261118000200_gst_configuration_boundary.sql` | `6b344190a3b520a00e439c1ec0bac7ad01851acdf4b600ca3d14998068091b4f` |
| `20261118000300_gst_pricing_boundary.sql` | `0b1090d4bd5bf9241cde399cdfae73b1f1eb3069ecad3fb691390d1c96f2faeb` |
| `20261118000400_gst_document_integrity.sql` | `b89deb96ec378851031a4d1a152142e6def420063ce5441db6bb3f7c5b05ea51` |
| `20261118000500_gst_document_report.sql` | `840feb4cca68408f705a8aab7371a5d886a93bb7099ccf542c61316d876ec5d5` |

## BLOCKED

1. **Owner authority and activation:** written confirmation of Owner-only
   GST saves (Manager read-only) versus earlier Manager editing, plus the
   decision to activate or defer for each legal registration/outlet.
2. **Adviser:** dated approval of each seller identity, approved mode and
   profile/date/eligibility, AATO/B2B and hold handling, catalog classification
   and lawful correction procedure. See the [decision record](../../docs/gst-two-mode-2026-11-14.md#owner-and-adviser-decision-record).
   GSTIN checksum/fixture arithmetic cannot grant this approval.
3. **Separate authorization and evidence:** identify the exact isolated
   non-production target and authorize read-only inspection. Reconcile both
   migration ledgers, live SQL objects/grants/RLS and app/schema compatibility;
   record isolation and restore proof and resolve old unsettled/unissued GST
   sittings and required legacy catalog rollbacks. Only then authorize exact
   forward filenames/checksums, change window, and synthetic real-stack
   acceptance (real Auth/JWT/PostgREST role checks, lifecycle, print, share,
   reports, legacy row comparison and recovery). See the [preflight](../../docs/gst-staging-application-plan-2026-11-15.md).
   No connection, earlier plan, or local green result supplies that approval.

## NOT DONE

No per-tenant tax/legal approval, rollout/activation or hosted preflight.
No hosted migration, schema-cache test, deployment, recovery/rollback drill,
real guest-to-receipt acceptance, payment or refund. No IRP/GSP/NIC call,
validated IRN, e-invoice implementation or later Workstream B priority.
No staged changes, commit, push or merge. Work stopped after this Priority 1
closure review; the [live blocker register](../../RELEASE-BLOCKER-REPORT.md)
remains authoritative for release status.

## Worktree audit appendix

Before closure: **63 modified tracked + 10 untracked**. At handoff:
**65 modified tracked + 12 untracked**, index empty. All 73
opening paths retained; 60 byte-identical, 13 refined within scope. Four paths
were added to the closure diff (two already tracked in HEAD, two untracked).
Audit inputs: `git status --short --branch --untracked-files=all`,
`git diff HEAD`, and a SHA-256 inventory/read of untracked files. Existing
protected and historical migration bytes were not changed.

**Closure delta** relative to the opening worktree:

```text
refined  RELEASE-BLOCKER-REPORT.md
refined  app/(staff)/dashboard/settings/gst-actions.test.ts
refined  app/(staff)/dashboard/settings/gst-actions.ts
refined  components/screens/GstSettingsPanel.tsx
refined  components/screens/SettingsScreen.tsx
refined  docs/gst-staging-application-plan-2026-11-15.md
refined  docs/gst-two-mode-2026-11-14.md
refined  e2e/fixtures/gst-api.mjs
refined  e2e/gst-http-fixtures.spec.ts
refined  lib/db/gst-two-mode.integration.test.ts
refined  qa-evidence/day1/MASTER_EXECUTION_STATUS.md
refined  qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md
refined  supabase/migrations/20261118000200_gst_configuration_boundary.sql
new diff components/screens/SettingsScreen.test.tsx
new diff qa-evidence/day1/GST_P1_CLOSURE_2026-11-18.md
new diff scripts/verify-database.mjs
new diff scripts/verify-gst-upgrade.mjs
```

**Complete audited patch inventory** (`M` = modified tracked, `??` = untracked):

```text
M  RELEASE-BLOCKER-REPORT.md
M  app/(staff)/dashboard/invoices/page.tsx
M  app/(staff)/dashboard/menus/actions.ts
M  app/(staff)/dashboard/menus/import-actions.ts
M  app/(staff)/dashboard/reports/export/route.ts
M  app/(staff)/dashboard/settings/gst-actions.ts
M  app/menu/cart/page.tsx
M  app/menu/checkout/page.tsx
M  components/owner/CloseSessionButton.tsx
M  components/screens/BillScreen.test.tsx
M  components/screens/BillScreen.tsx
M  components/screens/CartScreen.test.tsx
M  components/screens/CartScreen.tsx
M  components/screens/CheckoutScreen.test.tsx
M  components/screens/CheckoutScreen.tsx
M  components/screens/DashboardScreen.test.tsx
M  components/screens/DashboardScreen.tsx
M  components/screens/GstSettingsPanel.tsx
M  components/screens/InvoiceNotesPanel.test.tsx
M  components/screens/InvoiceNotesPanel.tsx
M  components/screens/InvoiceScreen.test.tsx
M  components/screens/InvoiceScreen.tsx
M  components/screens/MenuEditorScreen.tsx
M  components/screens/MenuImportScreen.tsx
M  components/screens/ReportsScreen.test.tsx
M  components/screens/ReportsScreen.tsx
M  components/screens/SettingsScreen.test.tsx
M  components/screens/SettingsScreen.tsx
M  components/screens/VerifyToOrderScreen.tsx
M  docs/gst-irp-production-readiness-2026-11-14.md
M  docs/gst-staging-application-plan-2026-11-15.md
M  docs/gst-two-mode-2026-11-14.md
M  docs/migration-manifest-2026-11-14.md
M  docs/production-release-prep-2026-11-14.md
M  lib/bill.test.ts
M  lib/bill.ts
M  lib/cart-pricing.ts
M  lib/db/bill.ts
M  lib/db/cart-screen.test.ts
M  lib/db/cart-screen.ts
M  lib/db/credit-debit-notes.integration.test.ts
M  lib/db/dashboard-screen.ts
M  lib/db/database.ts
M  lib/db/gst-settings.ts
M  lib/db/gst-two-mode.integration.test.ts
M  lib/db/invoice-notes.ts
M  lib/db/invoice-share.ts
M  lib/db/invoice.ts
M  lib/db/menu-editor.ts
M  lib/db/report-sales.integration.test.ts
M  lib/db/reports.test.ts
M  lib/db/reports.ts
M  lib/db/settings-screen.ts
M  lib/db/types.ts
M  lib/invoice.ts
M  lib/menu-import.test.ts
M  lib/menu-import.ts
M  lib/menu-undo.test.ts
M  lib/menu-undo.ts
M  lib/pricing.ts
M  qa-evidence/day1/MASTER_EXECUTION_STATUS.md
M  qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md
M  scripts/e2e/prepare-local-supabase.mjs
M  scripts/release/verify-release-readiness.mjs
M  scripts/verify-database.mjs
?? app/(staff)/dashboard/settings/gst-actions.test.ts
?? e2e/fixtures/gst-api.mjs
?? e2e/gst-http-fixtures.spec.ts
?? lib/db/invoice-share.test.ts
?? lib/gst/test-fixtures.ts
?? playwright.gst-fixtures.config.ts
?? qa-evidence/day1/GST_P1_CLOSURE_2026-11-18.md
?? scripts/verify-gst-upgrade.mjs
?? supabase/migrations/20261118000200_gst_configuration_boundary.sql
?? supabase/migrations/20261118000300_gst_pricing_boundary.sql
?? supabase/migrations/20261118000400_gst_document_integrity.sql
?? supabase/migrations/20261118000500_gst_document_report.sql
```
