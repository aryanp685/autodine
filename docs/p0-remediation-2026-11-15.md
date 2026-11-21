# P0 remediation & launch-blocker completion — 2026-11-15

**Branch:** `arena/9b120325-autodine` · **HEAD at time of writing:** b916e99 + this batch · **Boundaries:** production `bdbaqpevwmgdvghszjno` untouched; staging `juwyhslzchjevqkdvwjm` NOT migrated/configured; GST/IRP not applied anywhere hosted; no providers activated; no deploy; no merge.

**Verdict carried forward: NO-GO for production launch.** This batch removes three P0 engineering items and completes one launch-critical product feature; the remaining blockers are owner-only credentials/approvals that no code change can discharge.

## 1. What this batch changed

### D3 — PR #181 version collision (resolved in-repo)
- PR #181 (`20261112000200_owner_billing_configuration_guard.sql`) collided with `20261112000200_immutable_restaurant_account_link.sql`. **PR #181 remains open, unmerged and unmodified.** The guard was carried forward as **new forward migration `20261115000200_owner_billing_configuration_guard.sql`** (92nd file, unique 14-digit version). Guard body unchanged from the PR; one deployment-boundary addition: EXECUTE revoked from `service_role` too (matches the repository-wide trigger-function boundary enforced by the Phase 0 suite).
- New gate `npm run migrations:verify` (`scripts/verify-migration-chain.mjs`) fails the build on: duplicate 14-digit versions, malformed names, ordering anomalies, or missing deployed-history anchors (`20261115000100`, `20261108005000`, `20261110001220`, `20261112000200`). Wired into CI (`.github/workflows/ci.yml` → `npm run migrations:verify`) and `package.json`.
- Settings surface tightened to match the guard: `saveTaxAction` now owner-only; `saveDetailsAction` rejects a manager-submitted `gstin` change and never writes it from a manager session; GSTIN/tax inputs and save buttons are disabled for managers in `SettingsScreen`; read-only copy updated; `SettingsScreen.test.tsx` extended (35 existing + 1 new case green).
- Regression: `lib/db/owner-billing-guard.integration.test.ts` (6 tests: owner allowed; manager refused 42501; JWT-less paths blocked; ordinary owner/manager writes intact; 30%/GSTIN format enforced even for owner; trigger enabled + SECURITY DEFINER + zero EXECUTE to client roles).

### D1 — account-link immutability (hardened + operator-ready)
- Full mutation-path inventory: signup (`create_account_with_restaurant`) and `create_outlet()` insert links at INSERT (allowed by design); `20261110001000` legacy backfill (allowed, release-ordered first); authenticated client reassignment (**42501**); the pre-guard exploit is covered by `lib/db/restaurant-account-link.integration.test.ts` (updated: owner keeps billing-field writes; manager writes ordinary fields; manager tax/GSTIN refused).
- New forward migration **`20261115000300_audit_restaurant_account_reassignment.sql`** extends the existing guard so **every applied** link change (trusted maintenance/repair) writes an append-only `restaurant_account_link_audit` row (restaurant, before/after link, actor role, actor sub). Client-rejected attempts write nothing (raised before insert). Ledger is append-only (`no_rewrite` trigger refuses UPDATE/DELETE for ALL roles incl. superuser), no client SELECT/INSERT, `service_role` gets SELECT via exactly one policy (matches hosted RLS-bypass behavior in the local harness).
- Regression: `lib/db/account-link-audit.integration.test.ts` (8 tests incl. tamper refusal from privileged paths, INSERT never fires the ledger, client read denial, service read).
- Honest limit: in this disposable shim `service_role` has no BYPASSRLS (hosted it does), so trusted-path audit is proven via the superuser path; hosted verification probe is in `docs/d1-account-link-remediation-2026-11-15.md` §4.
- `docs/d1-account-link-remediation-2026-11-15.md` — path inventory, transition matrix, owner preflight, rollback posture.

### D2 — postgres-owned maintenance ACLs (prepared, not applied)
- Root-cause split documented: `20261110001220` clears current-role-owned objects + that role's defaults; `supabase/owner-operations/20261110000501_…` (owner-run, refuses other roles) clears all public objects + `supabase_admin` defaults. Ordinary DML, anon schema USAGE, service_role sequence USAGE preserved.
- `lib/db/readiness.integration.test.ts` proves (fresh replay): zero TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for client roles on current AND future public tables; client sequence access zero, service_role USAGE intact; anon schema CREATE denied.
- `docs/d2-postgres-acl-remediation-2026-11-15.md` — exact preflight probe (obtains the real "17" names + grantors + default-ACL source), apply sequence, zero-row post-apply verification, honesty limits (the 17 names exist only hosted; this document does not invent them).
- Nothing hosted was read or changed for D2 in this batch.

### Credit/debit notes — UI completed with fail-closed semantics
- Read plumbing `lib/db/invoice-notes.ts` (owner/manager only; 100-row cap; missing-table → honest `unconfigured`), hand-declared `RestaurantNote` types/tables in `lib/db/types.ts`/`lib/db/database.ts` (no generated types exist).
- `InvoiceNotesPanel` (client): issue full-document credit/debit notes against issued GST tax invoices / Bills of Supply (reason code + 5–500 char reason), per-source live-note disabling, note ledger with void flow, IRP-pending honesty labels, no partial-note path (void + re-issue only). Wired into `/dashboard/invoices` for owner/manager; cashier roles unchanged.
- `InvoiceNotesPanel.test.tsx` (5 tests). DB-side guarantees (amount decomposition, one-live-note-per-kind, immutability, owner/manager + can_write, full-source-only, fail-closed IRP) were already covered by `lib/db/credit-debit-notes.integration.test.ts` and remain green (212/212 PG assertions).
- **No GST policy was invented.** Notes are full-document only; e-invoice-applicable parents force `pending`; plain receipts excluded by UI AND by the database.

### Operational recovery — evidence made machine-checkable
- `npm run pitr:check` (`scripts/verify-pitr-checklist.mjs`): P1–P6 evidence validator (template mode + check mode; SHA-256 re-verification of an accessible backup artifact; PITR-chosen consistency rules). Proven end-to-end on a filled fixture (PASS) and on the empty template (names all 11 missing fields, FAIL).
- Additive addenda in `docs/pitr-verification-procedure-2026-11-14.md` and `docs/backup-restore-runbook.md`.
- Local drills at this batch's HEAD: backup selftest **ALL CHECKS PASS** (16 PASS lines); `LOCAL_COLD_RECOVERY_VERIFIED` (92 migrations, 52 tables); `LOCAL_LOGICAL_RESTORE_VERIFIED` (92 migrations, 48 tables / 59 policies / 162 functions). Production recovery claim: **false — hosted gate unmet.**

### Email/monitoring readiness (preparation only, nothing activated)
- `scripts/verify-external-services-config.mjs` — offline shape checker for `RESEND_API_KEY`, SMTP block, `BACKUP_ALERT_WEBHOOK`; proven on set/unset/malformed inputs; never prints values, never sends.
- `docs/email-monitoring-readiness-2026-11-15.md` — tested vs unactivated classification; delivery-test procedures (staging first); alert-delivery proof requirements; incident ack/resolve behavior verified (`app/api/ops/incidents/route.test.ts` et al.); explicit non-authorizations.

### Release workflow safety
- `.github/workflows/staging-e2e.yml`: **push trigger removed** (it pointed at the stale `arena/3711df6a-autodine` branch — any push there would have re-provisioned staging fixtures automatically). `workflow_dispatch` retained; secrets gate unchanged. Restoring any automatic trigger requires the owner's explicit approval.

## 2. Verification at this HEAD (all local/disposable)

| Gate | Result |
|---|---|
| `migrations:verify` / `sql:check` | 92 files OK / parses |
| `typecheck` / `lint` | clean |
| `vitest` | **2340 passed / 212 skipped** (PG-gated) |
| `test:db:integration` (fresh cluster, 92-migration replay) | **212/212** (10 suites) |
| `test:backup` / `test:recovery:cold` / `test:db:logical-restore` | PASS |
| `isolation:verify` / `test:staging:guards` | PASS / 25-25 |
| `e2e:local` (demo build + browser) | **64 passed** (49 env-gated skipped), exit 0 |

## 3. Owner-only items that still block launch (non-exhaustive but exact)

1. Production release authorization (baseline §6–7), incl. Batch A→app→Batch B ordering and the P0 ACL steps (D2 way §4).
2. Backup/PITR gate: P1–P6 with `npm run pitr:check` PASS + signatures; hosted restore rehearsal on a scratch project.
3. Email: provider + DNS decision, staging SMTP activation, delivery proof.
4. Monitoring: uptime check + routed human recipient; one end-to-end observed alert; alert webhook for backups.
5. D2 execution (release migration + `supabase_admin` owner op) and post-apply zero-row re-probe.
6. GST/IRP: separate authorization; adviser sign-off. Not requested, not applied.
7. PR #181: remains open; this batch neither merges it nor modifies main.
8. `staging-e2e.yml`: owner decision whether to restore any automatic trigger (recommended: no).
9. Production deploy itself + rollback readiness.

## 4. Explicitly not claimed

No hosted monitoring, backup or email delivery; no production/staging database change; no GST/IRP application; no provider activation; no merge/deploy; no real customer/payment/invoice data; no weakened RLS/ACL/auth/validation (this batch only tightened them).
