# Production release baseline & migration reconciliation — 2026-11-14

**Scope:** what an operator must know and capture before AutoDine `new`/`main` is
released to the production Supabase project (`bdbaqpevwmgdvghszjno`). This is a
reconciliation, not an execution record.

**Authorization boundary:** no production connection was made for this document.
Every production fact below is carried from dated, read-only probes recorded in
the repository (see §2). GST/IRP migrations remain **NOT AUTHORIZED**. Nothing
here authorizes `supabase db push`, a ledger repair, or a production deploy.
Staging (`juwyhslzchjevqkdvwjm`, `autodinetest`) receives **no** new migrations
from this branch either.

---

## 1. Exact release identity (this branch, today)

| Item | Value |
|---|---|
| Branch | `arena/9b120325-autodine` (active) |
| HEAD | `9a313d7b6100c895b0595ce5e7039d97b43f10ba` (pushed before this batch; this batch adds the two docs below and the code changes listed in §8) |
| Working tree | clean at batch start (`git status --short` → no entries) |
| Repo migrations | 90 files in `supabase/migrations/` (including `20261115000100_fix_redeem_staff_invite_status_returns.sql`) + `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` (owner operation, never applied automatically) |
| Node | ≥ 22 (`.nvmrc` = 22; engines `>=22`) |
| Build config | `next.config.mjs` refuses a non-production deployment pointed at the production project (`scripts/deployment-isolation.mjs`); `NEXT_PUBLIC_AUTODINE_DEPLOY_ENV` is inlined for the browser bundle |

Repository state is **not** the release. The release is a four-part artifact:
branch SHA + exact migration set + application deploy + configuration/secrets.
All four must be pinned together; §6 is the required preflight.

## 2. Evidence inventory (all in-repo, dated)

| Source | Date | What it establishes |
|---|---|---|
| `docs/production-migration-plan-2026-11-11.md` | 2026-11-11 | Production was 28 migrations behind (by name); `/api/health` `ok:false`, `trialDays: 7`; three-step rollout (Batch A → deploy app → Batch B `restaurants_member_only`) |
| `docs/production-only-migrations-2026-11-14.md` | 2026-11-14 | All 49 production-only ledger versions classified; zero unapplied effects; catalog probe of 1030 objects captured under `scripts/reconcile/evidence/` |
| `PHASE-7-MIGRATION-RECONCILIATION.md` | 2026-11-14 (authoritative date conflict noted inside) | Read-only probes of **both** projects; PR #181 same-version collision; entitlement drift findings (§4) |
| `docs/gst-staging-application-plan-2026-11-15.md` | 2026-11-15 | **Staging** compatibility: 33 of the repo migrations are NOT applied on staging; Phase A (26 pre-GST) and Phase B (7 GST/IRP) sequence; PREPARED ONLY / NOT APPLIED / NOT AUTHORIZED |
| `docs/report-sales-staging-rehearsal-2026-11-15-result.md` | 2026-11-15 | `report_sales_export_authorization` applied to staging only (version `20261115051514`); production unchanged |
| `docs/final-hosted-acceptance-2026-11-15.md` / `docs/hosted-synthetic-acceptance-2026-11-15-result.md` | 2026-11-15 | Hosted staging acceptance **PASSED** (workflow run `43709710950`, headSha `9a313d7…`, Playwright annotation expected=28/skipped=3/unexpected=0/flaky=0) |
| `docs/backup-restore-runbook.md`, `docs/pitr-verification-procedure-2026-11-14.md` | 2026-11-14 | Local logical backup/restore verified; **no hosted destination; production backup gate unmet** |
| `PRODUCTION-READINESS.md` | living | Feature-level classification; online payments NOT launch-certified; receipts NOT GST TAX INVOICE |
| Local gates this batch (2026-11-14) | today | typecheck, lint, `vitest` 2334 pass/198 skipped, embedded PG replay 90 migrations + 198 integration assertions, backup selftest 14/14, cold physical recovery PASS, logical restore PASS, build PASS (see §8) |

## 3. Repo ↔ staging ledger ↔ production ledger

### 3.1 Staging (`juwyhslzchjevqkdvwjm`, `autodinetest`) — measured 2026-11-15, read-only

Ledger (`supabase_migrations.schema_migrations`): 11 rows, high-water
`20261115051514 report_sales_export_authorization` (plus the staging-only
corrective `20261115113153` = `fix_redeem_staff_invite_status_returns`).
Manifest (`supabase_migrations.arena_staging_upgrade_manifest`): 50 rows
(`arena_staging_forward_upgrade_55` + `20261112000300_report_sales_export_authorization`).

**33 repo migrations are NOT applied on staging** (26 pre-GST + 7 GST/IRP),
enumerated in `docs/gst-staging-application-plan-2026-11-15.md` §1. Catalog
absence of every GST object verified directly (`restaurant_gst_config(_history)`,
`einvoice_attempts`, credit/debit note tables, `restaurant_irp_requests`,
`issue_irn(uuid)` — all NULL).

### 3.2 Production (`bdbaqpevwmgdvghszjno`) — evidence-only, no access this batch

From the 2026-11-14 probes (no fresh probe was made today):

- `operational_schema_readiness()` **exists** (bounded check: service-role-only).
- `public_restaurant_profile(text)` **exists** and is executable by the intended
  public roles.
- Subscription helpers sampled present: `account_can_write(uuid)`,
  `create_account_with_restaurant(...)`, `create_outlet(...)`.
- Migration ledger high-water returned by the earlier listing **ended at
  `20261112000100`**; that is a listing boundary, not a completeness proof.
- `restaurants.account_id` immutability (`20261112000200_immutable_restaurant_account_link.sql`):
  **effect ABSENT in both catalog snapshots.** Authenticated UPDATE on
  `restaurants.account_id` remains possible at the time of the probe.
- ACL residual: `anon`/`authenticated` retain PostgreSQL-17 `MAINTAIN` on 17
  `postgres`-owned `public` tables in production (and additionally `TRUNCATE`,
  `REFERENCES`, `TRIGGER` in Test). `20261110001220_revoke_client_bypass_privileges.sql`
  is **not effectively in force** for those privileges, and the separate owner
  operation for `supabase_admin` defaults is not evidenced as run.
- Owner-billing configuration guard (PR #181 source): **not** present in
  production; applied in Test under custom ledger version `20261113115007`.

### 3.3 The gap nobody may hand-wave

The production migration plan of 2026-11-11 is **stale** and must not be used
verbatim:

1. It assumes repository high-water `20261110001100`; the repo today carries 15
   further files (`20261110000851` … `20261115000100`), several of which are
   prerequisites for or inside the corrective set.
2. It predates the staging rehearsal evidence (`report_sales` remediation,
   `20261110000900` QR-attempts convergence, GST plan).
3. Its "27+1" set omits `20261110000851`, `20261110000950`, `20261110001210`,
   `20261110001220`, `20261112000200`, `20261112000400`–`20261112000700`.
4. It cannot know the current production catalog; only the Phase 0 read-only
   probes (§2) exist, and they found **live drift** (§4).

A production release that applies "the plan" without re-probing would ship
known-unreviewed state.

## 4. Drift, divergence and ordering findings (must be resolved pre-release)

| # | Finding | Where | Severity | Required disposition |
|---|---|---|---|---|
| D1 | `restaurants.account_id` immutability (`20261112000200…`) absent (trigger/function not found; authenticated UPDATE remains) | **both** projects | **P0** — tenant entitlement can be re-pointed by any authenticated writer with table UPDATE | Ship the reviewed forward migration in the release batch; verify trigger/function exists with a bounded catalog check afterwards. Local PG regression already green; do not apply to staging without the owner authorization named in the GST plan (it is Phase A item 22). |
| D2 | `anon`/`authenticated` retain `MAINTAIN` (prod) / `MAINTAIN+TRUNCATE+REFERENCES+TRIGGER` (test) on 17 `postgres`-owned tables; `20261110001220` not effective; `supabase_admin` default-ACL owner operation not evidenced | both | **P0** — RLS does not protect `TRUNCATE` | Owner runs `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` (never automatic) + apply `20261110001220`; verify with an ACL catalog probe (test does NOT suffice without re-probe). |
| D3 | PR #181 `20261112000200_owner_billing_configuration_guard.sql` collides with repo `20261112000200_immutable_restaurant_account_link.sql` — same 14-digit version, different objects | repo + test catalog (`20261113115007`) | **P0** — a blind merge/apply mints a broken history | Do not merge #181 as-is. Mint a renumbered forward migration containing the owner-billing guard **and** the immutability guard, preserving both; confirm version uniqueness at mint time (timestamp clocks differ; do not date from the sandbox clock). |
| D4 | Production ledger ≠ Test ledger ≠ repo order; 49 production-only versions re-executed under console versions | histories | Structural | Name-based diffing only; migration **contents** must be reviewed per file, never inferred from version order. |
| D5 | `20261110000700_restaurants_member_only` ordering constraint: applying before the app deploy serving `public_restaurant_profile()` takes every guest menu offline | both | P0 release-stop if violated | Three-step rollout (§5): Batch A → application deploy → Batch B. |
| D6 | `/api/health` flips green only after `20261109001000_operational_readiness`; the reported `trialDays` flips only after the application deploy carrying the 21-day trial | production | operational | Verify both after each step; do not declare release "ready" on build success alone. |
| D7 | Test catalog holds objects under custom ledger versions; repo file hashes in bundles may differ from files replayed locally | test | REVIEW | Treat staging as a rehearsal, not a template; keep `PHASE-7-MIGRATION-RECONCILIATION.md` as the authority for hosted state. |

## 5. Release order and rollback posture

### 5.1 Ordering constraints (hard)

1. `20261110000500_public_restaurant_profile` **before** `20261110000700_restaurants_member_only`.
2. Application deploy (branch carrying `public_restaurant_profile()` storefront read + 21-day trial) **between** Batch A and `20261110000700`.
3. `20261109001000_operational_readiness` before relying on `/api/health` as a release gate.
4. `20261110000851_payment_audit_provider_actor` requires `payment_audit_events` from `20261107080000_payment_audit_ledger` (satisfied in any ordered replay).
5. `20261112000700_serialize_subscription_expiry` depends on `expire_subscriptions()` and can schedule `pg_cron` only where the extension exists (no-op otherwise — safe).
6. `20261110001000_account_subscriptions` backfills `accounts` from `restaurants.owner…` and **rewrites `restaurants.account_id`** for every row; it is the largest data-affecting step in the pre-GST chain. It must run before `20261110001100_subscription_billing` and before the immutability trigger (D1).
7. GST/IRP chain strictly after the 26 pre-GST migrations; **not authorized**.

### 5.2 Rollback limits (what cannot be undone)

| Step | Effect | Rollback reality |
|---|---|---|
| `20261110000800_remove_order_submission_caps` | **Deletes** `rate_limit_hits` rows `po:*` | Rows are gone; not reconstructable. Acceptable: counters were telemetry, not money. |
| `20261110000900_converge_qr_verification_attempts` | Renames legacy QR-attempt table to `…_legacy_<suffix>` and transfers live state | Forward-only: reverse requires renaming back and re-analysing transferred rows; treat as one-way. |
| `20261110001000_account_subscriptions` | Backfills/updates `accounts`, rewrites `restaurants.account_id` | Not lossless: pre-backfill `account_id` (all NULL) is known, but per-row old plan/trial values were overwritten from restaurant state. Restore-before-apply only. |
| `20261110001100_subscription_billing` and later serializers | Create immutable-ish ledgers (`subscription_payments`, receipts, events), append-only triggers | Append-only by design; "rollback" = restore, not delete. |
| `20261108010000_invoice_share_links` | New tables + token digests | Drop table reverse possible; issued share links die with it (acceptable). |
| Any GST migration | `orders_math_check` replaced; invoice document-type constraint replaced; new NOT-NULL defaults | Schema reversible only via forward fix; tenant data inserted under new rules is not. |
| D2 owner operation | Revokes `MAINTAIN`/default privileges | Affects only privileges; reversible by re-grant, but the intermediate window weakens nothing (privileges removed, never added). |

**Point-in-time snapshot before step 1 is the only universal rollback.** See
`docs/pitr-verification-procedure-2026-11-14.md`; until a hosted destination and
PITR are confirmed by the owner, production changes must be treated as
irreversible in planning terms.

## 6. Required preflight capture (owner executes or authorizes; additive to §2)

Before **any** write to production, in one sitting, stored out-of-band:

1. `list_migrations` (production) + full `arena_*_manifest` dump; sha256 of every
   candidate file from the working tree.
2. `md5(prosrc)`/`pg_get_functiondef` of every function the batch creates or
   replaces (`close_order_session_and_issue_receipt`, `place_public_order`,
   `place_public_order_attempt`, `report_sales`, `record_counter_payment`,
   `issue_closed_session_receipt`, `operational_schema_readiness`,
   `public_restaurant_profile`, `account_can_write`, `create_outlet`,
   `admin_set_subscription`, plus all triggers removed by
   `20261114000400` if GST is ever in scope).
3. Existence probe (`to_regclass`/`to_regprocedure`) for every new object.
4. ACL probe (`proacl`, `relacl`) for the 17 tables implicated in D2 and for
   `operational_schema_readiness`.
5. `count(*)` + `relrowsecurity` for all `public` tables; confirm no open
   transaction and `wal_level`/replication health from the dashboard.
6. `count(*)` of `restaurants`, `orders`, `payments`, `restaurant_invoices`,
   `order_sessions`, `accounts` (if backfilled) as the "data must not change"
   baseline (the backfill in `20261110001000` updates `restaurants` rows —
   expected and allowed, but it must be counted and reconciled).
7. Confirmation that **no** open PR (e.g. #181) carries a same-version migration,
   and that the intended release SHA is built and READY on Vercel.
8. Hosted backup: provider backup taken, or PITR confirmed, **immediately**
   before step 1 — or an explicit owner waiver in writing. The current runbook
   states this gate is **unmet**; this batch does not waive it.

## 7. Staged execution sequence (when authorized — not today)

| Step | Action | Verify |
|---|---|---|
| 0 | Owner authorization names `bdbaqpevwmgdvghszjno`, this document, the exact file set and SHA. Preflight §6 complete. PITR/backup confirmed. | Operator checklist countersigned |
| 1 | **Batch A (25 files, exact filename order)** — every pre-GST file in `docs/gst-staging-application-plan-2026-11-15.md` §3 Phase A **except** `20261110000700_restaurants_member_only` (that is Batch B). One transaction per file via `create_migration`, manifest updated per file | After each file: object markers; after all: `/api/health` `ok:true`; `count(*)` unchanged except `accounts`/`restaurants.account_id` backfill |
| 2 | **Application deploy** of the reviewed SHA; confirm storefront loads for a guest **before** Batch B; verify 21-day trial copy | `curl /api/health` `trialDays: 21`; guest QR smoke; staff sign-in smoke |
| 3 | **Batch B:** `20261110000700_restaurants_member_only` only | Guest menu still loads via QR immediately after |
| 4 | D1/D2 owner operations: immutability verification probe; `20261110001220` + `supabase_admin` default-ACL revoke; ACL re-probe | Trigger exists; `relacl` no longer grants `TRUNCATE`/`MAINTAIN` to `anon`/`authenticated`/`supabase_admin` |
| 5 | PR #181 disposition: renumbered guard merged via normal review, **after** D1 is live; unique version asserted | Guard present in catalog; both guards coexist |
| 6 | GST/IRP: separate authorization; see `docs/gst-irp-production-readiness-2026-11-14.md` | Phase B markers; **not part of this release unless separately authorized** |
| 7 | Post-release: re-run read-only probe pack; record ledger; monitor `/api/health` and alert lines for 24–72h; keep previous Vercel deployment READY for rollback of the **app** (DB steps are forward-fix only) | Incident = automatic rollback decision to the previous READY deployment |

## 8. Engineering changes in this batch (none touch production/staging)

- `app/auth/actions.ts`: server logs for the password-reset send/set failure
  paths and the signup rollback/cleanup paths no longer write raw provider
  `error.message`/objects; they emit fixed-vocabulary `{ name, status, code }`
  only (`safeErrorShape`). No behavior, response or cookie change.
- `.github/workflows/*`: `ubuntu-latest` → `ubuntu-24.04`; `checkout`/`setup-node`/
  `upload-artifact` `@v4` → `@v7`; `tts-smoke` Node 24 → 22 (matches `.nvmrc`).
  This addresses the Node.js 20 deprecation and runner-migration annotations
  from the hosted run; it does **not** change any job's steps or secrets.
- New: `docs/gst-irp-production-readiness-2026-11-14.md`,
  `docs/pitr-verification-procedure-2026-11-14.md` (this doc's companions).

Local gates executed after the changes: `typecheck` ✅, `lint` ✅, `vitest`
2334 passed/198 skipped ✅, `test:db:integration` (embedded PG 17, 90-migration
replay + 8 suites, 198 assertions) ✅, `test:backup` 14/14 ✅,
`test:recovery:cold` PASS ✅, `test:db:logical-restore` PASS ✅,
`isolation:verify` PASS ✅, production build PASS ✅. Hosted staging acceptance
(run 43709710950) is **not** re-run and remains the current hosted evidence.

## 9. Explicit non-goals (unchanged)

No production access or change; no staging migration/config change; no GST/IRP
application; no IRP/NIC e-invoice submission; no Resend/payment/provider
activation; no real customer data; no merge to `main`; no deploy; existing READY
deployments preserved; destructive git operations not used.
