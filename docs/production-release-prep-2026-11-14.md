# Production release preparation — 2026-11-14 (NOT an execution record)

**Scope:** the exact artifacts an operator needs to release AutoDine
`arena/9b120325-autodine` → `main` → production Supabase
(`bdbaqpevwmgdvghszjno`) and Vercel, in the correct order, with rollback
limits stated honestly. Prepared on 2026-11-14 against HEAD
`6c7e1876a254c88f6708b2fd01a07183fd00d0ca`.

**Authorization boundary:** nothing in this document authorizes anything.
No production database, migration, deployment, DNS, secret, or provider
was touched while preparing it. GST/IRP migrations remain
**NOT AUTHORIZED**. The release itself requires explicit owner approval of
each gate in §5. Executing any step without that approval is out of scope.

Companion documents: `docs/migration-manifest-2026-11-14.md` (all 92 migrations
accounted for), `docs/owner-closure-package-2026-11-14.md` (every owner action
with steps + verification), `docs/credential-exposure-remediation-2026-11-14.md`
(B5 detail). `npm run verify:release` re-checks the repository-side invariants
offline and fail-closed (CI step "Release readiness invariants").

This document does not duplicate [production-release-baseline-2026-11-14.md]
(drift D1–D7, ordering limits), [production-migration-plan-2026-11-11.md]
(the authoritative 3-step plan), or [external-services-readiness-2026-11-14.md]
(service matrix). It binds them to a concrete release identity and adds the
environment matrix and checklist those documents defer.

---

## 1. Release identity (pin all four together)

| Item | Value |
|---|---|
| Branch | `arena/9b120325-autodine` (active) |
| HEAD | `6c7e1876a254c88f6708b2fd01a07183fd00d0ca` |
| Repo migrations | **92** files in `supabase/migrations/` (plus owner-operation `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql`, never applied automatically) |
| Preview of this SHA | Vercel deployment `dpl_6hp4kUqMqez8dniTx4ij36EMH7bg` — READY, branch alias `https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app` |
| Node | ≥ 22 (`.nvmrc` = 22) |
| Build | hermetic env required (`GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test`); `next.config.mjs` refuses a non-production deployment pointed at the production project |

CI at this SHA (run `43721924389`): typecheck / lint / design guard / full
suite / Next.js build / migration replay **PG 15, 17, 18** / logical restore
drill — **all green**. E2E (run `43721924317`) and Throttle browser E2E (run
`43721924315`) — **all green**. Staging acceptance for this SHA: run
`43729670878` (see the session report; prior runs 43709710950 etc. predate
this SHA and are NOT acceptance for it).

## 2. Migration set for the release, in exact order

Production ledger high-water (read-only probe, 2026-11-14): listing ended at
`20261112000100` — a **listing boundary, not a completeness proof**. Apply
nothing blind. The release migration set is every repo migration strictly
**after** `20261112000100`, in filename order, **excluding** every GST/IRP
file (NOT AUTHORIZED) and classify-then-verify before applying.

| # | File | Class | Notes |
|---|---|---|---|
| 1 | `20261112000200_immutable_restaurant_account_link.sql` | **P0 security** | Effect ABSENT in both catalog snapshots; direct `restaurants.account_id` UPDATE possible in production today. Same content as PR #181's guard minus nothing; PR #181 stays unmerged. |
| 2 | `20261112000300_report_sales_export_authorization.sql` | done? | Applied to **staging only** (rehearsed 2026-11-15). Verify production absence before applying. |
| 3 | `20261112000400_bound_subscription_history.sql` | subscription | Function-body fix; serialized ordering; no schema change. |
| 4 | `20261112000500_serialize_outlet_creation.sql` | subscription | Concurrency hardening, forward-only. |
| 5 | `20261112000600_serialize_subscription_payments.sql` | subscription/money | Concurrency hardening, forward-only. |
| 6 | `20261112000700_serialize_subscription_expiry.sql` | subscription | Concurrency hardening, forward-only. |
| 7 | `20261115000100_fix_redeem_staff_invite_status_returns.sql` | P0 auth | Single-use invite fall-through fix (23505 instead of `used`). |
| 8 | `20261115000200_owner_billing_configuration_guard.sql` | P0 security | Owner-only `tax_rate_bps`/`gstin` trigger; revokes EXECUTE from service_role too; body identical to PR #181, renumbered (version `20261112000200` occupied). |
| 9 | `20261115000300_audit_restaurant_account_reassignment.sql` | P0 security/audit | Append-only audit of applied `account_id` reassignments; closes D1 silently-reassigned gap. Depends on #1. |
| — | `20261114000400_restrict_trigger_functions_execute.sql` | **GST/IRP Phase B (B5) — NOT AUTHORIZED** | Listed as Phase B5 in `docs/gst-irp-production-readiness-2026-11-14.md` (dependency grouping). Data-safe privilege hardening; may be authorized separately as a pure security item, but **must not be applied without its own authorization decision**. Trigger invocation unaffected (verified locally). |
| — | `20261113000100_gst_two_mode.sql`, `20261114000100_gst_b2b_einvoice_readiness.sql`, `20261114000200_irp_reconciliation.sql`, `20261114000300_gst_mode_gates.sql`, `20261114000400_restrict_trigger_functions_execute.sql`, `20261114000500_credit_debit_notes.sql`, `20261114000600_einvoice_issuance_profile.sql` | **GST/IRP Phase B (B1–B7) — NOT AUTHORIZED** | Apply NOTHING in this group without separate written owner authorization each. See `docs/gst-irp-production-readiness-2026-11-14.md`. Full accounting of all 92 repo migrations: `docs/migration-manifest-2026-11-14.md`. |

All 92 repository migrations are enumerated and classified in
`docs/migration-manifest-2026-11-14.md` (76 legacy rollout scope · 9 branch set
above · 7 GST/IRP Phase B). The owner-operation file
(`supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql`)
is deliberately **not** part of the 92 and is never applied automatically —
it is a manual owner operation, recorded there as well.

Plus the legacy 3-step plan ([production-migration-plan-2026-11-11.md]) for
the older delta it describes (Batch A = 27 migrations, Step 2 = app deploy,
Batch B = `20261110000700_restaurants_member_only`). **That plan predates
this branch's migrations.** The operator must reconcile: (a) which ledger
rows actually exist in production at release time (listing boundary caveat),
(b) Batch A/B ordering with the table above, (c) item #1 must land together
with or before items #8/#9 (audit hardening assumes the guard trigger exists).

**Recommended combined ordering (still requires owner approval of each gate):**

1. Provider backup / confirmed PITR of production (or accepted residual risk, in writing) — see `docs/pitr-verification-procedure-2026-11-14.md`, gate currently **UNMET**.
2. Legacy Batch A (27 files, filename order) — health endpoint turns green at `20261109001000`.
3. Deploy application (Step 2).
4. Legacy Batch B (`20261110000700_restaurants_member_only`).
5. This-branch set #1–#9 above, filename order, **excluding all seven GST/IRP Phase B files** (and excluding B5 `20261114000400` unless separately authorized).
6. Verify: `/api/health` `ok:true`; guest QR menu opens; owner settings save; invite redeem single-use; staff cannot edit tax rate; financial RPCs serialized.
7. GST/IRP set only after separate authorizations + adviser sign-off.

### Rollback reality

There is **no safe down-migration** for money/ledger guards. Rollback = forward
fix or approved restore/cutover from the verified backup. Never drop ledger
tables, never regrant unsafe direct money writes, never edit migration files
that have been applied anywhere. If a release fails mid-batch: stop, capture
state, restore or forward-fix under incident process — do not improvise.

## 3. Environment / secret matrix (names only — never paste values)

| Variable | Where | Required for | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Vercel (all envs) | App ↔ Supabase | Browser-safe. Never a secret key in `NEXT_PUBLIC_*`. |
| `SUPABASE_SECRET_KEY` (server-only; legacy `SUPABASE_SERVICE_ROLE_KEY` supported) | Vercel server | RPCs, admin | Never inlined into the browser bundle; isolation enforced by `next.config.mjs`/`deployment-isolation.mjs`. |
| `NEXT_PUBLIC_SITE_URL` / `SITE_URL` | Vercel | Auth redirects, absolute links | Canonical production origin when live. |
| `AUTODINE_DEPLOY_ENV=production` | Vercel production | Deploy-env guard | Paired with `NEXT_PUBLIC_AUTODINE_DEPLOY_ENV` inlined for browser. |
| `AUTODINE_MODE=live` | Vercel production | Fail-closed live mode | Missing DB ⇒ 503, never demo orders in live. |
| `AUTODINE_CRON_SECRET` | Vercel production + cron caller | `/api/cron/escalate` | Fail-closed 503 when unset; 401 on mismatch. Vercel Hobby: only daily cron `30 1 * * *` is permitted — do not re-add sub-daily crons. |
| `BACKUP_ALERT_WEBHOOK` / `AUTODINE_ALERT_WEBHOOK` (used by `lib/incident-notify.ts`) / `DR_ALERT_WEBHOOK` | Vercel + backup host | Backup/incident alerting | Delivery never verified — must fire one real test alert post-config. |
| `AUTODINE_BACKUP_PASSPHRASE` | Backup runner only | Encrypted backup target | Never in Vercel app env. |
| `AUTODINE_BACKUP_SOURCE_URL` / `AUTODINE_RESTORE_TARGET_URL` / `AUTODINE_D2_VERIFY_URL` / `AUTODINE_EXPECTED_PROJECT_REF` | Backup/DR scripts | Rehearsed recovery | Hosted restore target must be isolated non-production, explicitly approved. |
| `BILLING_PROVIDER` + `AUTODINE_BILLING_SANDBOX=1` | Staging/test only if authorized | Billing sandbox rehearsal | Refuses production-declared deployments. **No live payment activation without separate owner authorization + provider contract.** |
| `BILLING_WEBHOOK_SECRET` | Where webhook is enabled | Billing webhook | 503-when-unconfigured; signature-verified before processing. |
| `QR_VERIFICATION_SECRET` | Vercel | QR verification | Owner to review readable-secret flag (see owner register). |
| `ADMIN_SECRET` | Vercel | Admin endpoints | Rotate per owner register. |
| `RESEND_*` / Supabase custom SMTP settings | Supabase Auth config | Email delivery | **Not activated.** Configure staging first, verify delivery, then production. |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `MENU_VISION_API_KEY` (+ models) | Vercel | Optional AI features | Features fail closed when absent; do not add paid keys without approval. |
| `STAGING_*` (`STAGING_BASE_URL`, `STAGING_SUPABASE_*`, `STAGING_SHARE_URL`) | GitHub Actions secrets | staging-e2e workflow only | Never target production; workflow fail-closes on missing secrets and verifies the share origin before any service access. |

An environment-variable change is a production change. Each row above is an
owner-gated action; nothing here is pre-authorized.

## 4. Release checklist — each gate with its explicit evidence requirement

A gate is not satisfied because "it looks done"; it is satisfied by the named
artifact. **[E:…]** = the exact evidence to attach to the release record.

**Preflight**
- [ ] Release SHA reviewed; PR #181 disposition decided (remains OPEN/unmerged — merge is a separate decision, NOT required by this checklist). **[E: review note + MUST reference `bc54eab` or later as release SHA; staging evidence below is for `6c7e187` — if the release SHA differs from staging-tested SHA, written owner acceptance is required, or staging must be re-accepted under fresh authorization.]**
- [ ] CI green at release SHA. **[E: run IDs — for `6c7e187`: 43721924389 / 43721924317 / 43721924315; for `1193327`: 43730514868 / 43730515580 / 43730514933; for `bc54eab`: 43731260947 / 43731260936 / 43731260937.]**
- [ ] Preview alias verified reachable (deployment `dpl_6hp4kUqMqez8dniTx4ij36EMH7bg`, READY, alias assigned). **[E: `vercel get_deployment` output archived.]**
- [ ] Staging acceptance `43729670878` PASSED (expected=28/skipped=3/unexpected=0/flaky=0) — applies to `6c7e187`; later docs-only commits need no re-dispatch, but **any code-bearing commit invalidates it**. **[E: run URL + annotation, or written owner acceptance of the delta.]**
- [ ] Production migration ledger **freshly probed read-only** at release time; drift D1–D7 reconciled. **[E: dated ledger dump (names only) + reconciliation table vs `docs/migration-manifest-2026-11-14.md`; output reviewed and countersigned by owner.]**
- [ ] Provider backup confirmed restorable, OR owner accepts residual risk in writing; PITR verification per `docs/pitr-verification-procedure-2026-11-14.md`. **[E: P1–P6 record with timestamps, target identified as isolated/non-production, fingerprint match (table/policy/function counts), retention window, accepted RPO/RTO.]**
- [ ] Rollback/cutover owner named; incident contact reachable; `BACKUP_ALERT_WEBHOOK` route exists and fired once. **[E: name + one observed test alert + acknowledgement.]**

**Execution (in §2 order)**
- [ ] §2 step 1 — backup gate satisfied. **[E: A2 drill record reference.]**
- [ ] §2 step 2 — legacy Batch A applied; health turns green at `20261109001000`. **[E: ledger high-water after each file batch; `GET /api/health` → `ok:true` with timestamp.]**
- [ ] §2 step 3 — app deployed from the release SHA. **[E: production deployment ID + READY state + commit SHA match.]**
- [ ] §2 step 4 — Batch B applied; guest QR menu verified live. **[E: anonymous QR open captured (screenshot/log) with timestamp; no login required for guest read.]**
- [ ] §2 step 5 — branch set #1–#9 applied (excluding all seven GST/IRP Phase B files). **[E: ledger diff showing exactly the 9 filenames; catalog probes: guard trigger present, service_role EXECUTE=false on trigger functions, audit ledger present, invite fix present.]**
- [ ] §2 step 6 — verification suite executed and recorded. **[E: checklist from §2 step 6 each with timestamped pass/fail — health, QR guest flow, owner settings save, invite single-use (one token, second redemption rejected), manager tax-rate denial, settlement-before-close refusal.]**
- [ ] §2 step 7 — GST/IRP ONLY under separate written authorization. **[E: per-file authorization document, or dated statement "Phase B NOT AUTHORIZED".]**

**Post-release**
- [ ] Uptime monitor + alert route verified with one real test alert. **[E: monitor screenshot showing test failure AND recovery; alert delivery log.]**
- [ ] Owner dashboards reachable; subscription expiry cron observed once. **[E: cron run log for `30 1 * * *` or named external scheduler; dashboard screenshot.]**
- [ ] Release record filed. **[E: SHA, post-release ledger high-water, backup reference, sign-offs, PR #181 disposition.]**

## 5. What this preparation does NOT do

- No production connection, query, migration, deploy, DNS, or secret change.
- No GST/IRP application anywhere, no e-invoice issuance, no live payment, no
  email/SMTP activation, no paid service activation.
- No claim that AutoDine is production-ready: launch remains gated on the
  owner actions in the consolidated owner-action register and the NO-GO items
  in the final report (backup/PITR gate unmet; email unverified; monitoring
  untested; billing provider absent; GST uncertified).
