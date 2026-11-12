# AutoDine — complete hand-off report

**Date: 2026-11-12.** Written to be read by an AI or engineer with **no prior context**.
Everything below is measured from the repository, the live Supabase projects and the live
deployments on 2026-11-11/12 — not inferred from marketing or from documentation that
describes intent. Where a fact could not be verified, it says so explicitly.

Read in this order if you are in a hurry: §1 (what it is) → §5 (current state) →
§6 (work in flight) → §12 (recommended changes) → §14 (pitfalls).

---

## 1. What AutoDine is

AutoDine is a **restaurant ordering and operations web app** for the Indian market
(Nagpur/Maharashtra-based owner). A guest scans a QR code at their table, opens the menu
in the browser, places an order, and **pays at the counter** — there is deliberately no
online payment gateway in the guest flow. Staff (owner / manager / kitchen / cashier) work
from separate dashboards: kitchen sees and advances tickets, cashier settles and closes the
table session, owner manages menus, branding, outlets, staff and subscription.

Money is integer paise end to end. The database, not the browser, is the source of truth
for pricing. Orders are immutable once placed (name/price snapshots), and a closed session
produces a numbered, non-GST receipt.

**Stack:** Next.js (App Router) + React + TypeScript, Tailwind, Supabase (PostgreSQL + Auth
+ Realtime), deployed on Vercel. Supabase Edge TTS for Hindi kitchen announcements with a
browser speech-synthesis fallback. Tests: Vitest (unit + DB integration), Playwright (e2e).

---

## 2. Repository map

| Path | What lives there |
|---|---|
| `app/` | Next.js routes. 41 page components across `(kiosk)`, `(staff)`, `admin`, guest `menu/`, `t/[token]`, `bill/`, `invoice/` groups. |
| `lib/` | 231 TypeScript modules. `lib/db/*` are the DB access layer, `lib/plans.ts` + `lib/trial.ts` are the commercial source of truth, `lib/health.ts` is the health probe. |
| `supabase/migrations/` | **72** checked-in SQL migrations, filename `YYYYMMDDHHMMSS_name.sql`. |
| `e2e/` | 16 Playwright spec files (11 top-level + 5 in `integration/`). |
| `scripts/` | Verification tooling: `check-sql.mjs`, `verify-database.mjs`, `local-pg/` (disposable PostgreSQL harness), `reconcile/`. |
| `AGENTS.md` | **Authoritative project instructions. Read this first.** Contains locked product/money/GST decisions that must not be changed without approval. |
| `FEATURE-INVENTORY.md` | All 37 pages + 9 route handlers with their verification boundaries. |
| `AUDIT-REPORT.md` | **Historical** P2–P10 audit (2026-11-06). Explicitly marked a snapshot; use only its dated status notes. |
| `docs/website-readiness-audit.md` | Current readiness evidence, launch blockers, unverified areas. |
| `docs/production-migration-plan-2026-11-11.md` | The production migration rollout plan. |
| `docs/production-operator-setup-2026-11-11.md` | Operator hand-off for backups and SMTP. |
| `PRODUCTION-BACKUP-RUNBOOK.md` | The vetted backup + isolated-restore procedure. |

**Verification commands** (all must pass before any PR):

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run design:check  # design tokens
npm run sql:check     # SQL DDL parse check
npm test              # vitest
npm run test:db       # DB integration suite (needs a disposable PostgreSQL)
npm run e2e:local     # isolated Playwright run
```

---

## 3. Environments — exact identifiers

| Role | Name | Supabase ref | URL |
|---|---|---|---|
| **Production** | `autodine-production` | `bdbaqpevwmgdvghszjno` | `https://new-alpha-five-43.vercel.app` |
| **Staging / test** | `autodinetest` | `juwyhslzchjevqkdvwjm` | (review deployments) |
| **Review app** | branch preview | uses staging | `https://new-git-arena-a5344572-autodine-iamjarvis9896-3988s-projects.vercel.app?_vercel_share=RbkpxAfZ3c77C7RqytXVzZczITNwO1is` |

Review logins (staging DB, all working — verified with `hasSession: true`):

```
owner@autodine-review.test
manager@autodine-review.test
kitchen@autodine-review.test
cashier@autodine-review.test
password: Review2026!
```

> The Vercel preview is behind deployment protection. The `_vercel_share` token is the only
> bypass; without it the URL returns "Protected Deployment – Vercel".

---

## 4. Branch, merge and deployment state

- The hand-off's former PR #176 is **merged** into `main` at `0f2199c90f356c6bb1b4e7c4f885bd4e1350842b` (2026-11-12 13:23 UTC).
- Production Vercel deployment `52Ck1JvNHo2CBoHgGE9a8EHYk45c` is READY and promoted, from the merged `main` commit. It was created at 13:36 UTC as a **manual deployment**, not automatically on merge.
- Current working branch for this continuation: `arena/cd4d9ad9-autodine`, based on that commit. Open PR #177 is a separate in-flight change; avoid duplicating its work when preparing any follow-up.

### Root cause: main auto-deploy was explicitly disabled

`vercel.json` in the merged baseline explicitly sets `git.deploymentEnabled.main` to `false` (and also disables the old Arena branch). This was introduced by commit `471d0dd` as a temporary deployment hold while coordinating the database/app cutover. Vercel provider events show no deployment at the PR #176 merge time; production did not change until the manual deployment above. The preview deployment seen during that period belonged to `arena/a5344572-autodine`, not `main`.

This branch removes the `git.deploymentEnabled` override while preserving the existing `bom1` region. That restores the normal Vercel Git integration behavior once this change reaches the configured production branch; it does not itself deploy or change Vercel project settings.

**Isolation follow-up completed:** Vercel project-wide `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Preview/Development were updated, with user approval, to the existing staging project (`juwyhslzchjevqkdvwjm`). Read-only verification confirmed both values. Production-scoped variables and secrets were not changed. The open PR #177's branch-specific Preview URL/key were also checked and point to staging. Existing deployments are immutable; subsequent Preview/Development deployments will pick up the corrected environment. Follow `docs/preview-isolation.md` for all later env changes.

## 5. Current measured state (updated 2026-11-12)

### 5.1 Production release and 21-day trials

The production schema rollout (Batch A plus the final member-only migration) is complete, and `/api/health` had reported `ok:true` after the rollout. PR #176 then merged. The current Vercel production deployment is from that merged commit, but its automatic deployment was blocked by the explicit `main: false` setting described in §4 and it was manually promoted later.

Production subscription state was rechecked after the merge. **All four existing restaurants already have active, write-enabled 21-day trials**, so the requested `admin_set_subscription` calls were correctly not repeated:

| Restaurant | Plan / status | Trial end (UTC) | Can write |
|---|---|---|---|
| The King | `trial` / `trialing` | 2026-12-03 15:00:57 | yes |
| maddi | `trial` / `trialing` | 2026-12-03 15:00:57 | yes |
| AutoDine QR Flow Test | `trial` / `trialing` | 2026-12-03 15:00:57 | yes (no members) |
| restro-non-veg | `trial` / `trialing` | 2026-12-03 15:00:57 | yes |

All were updated at 2026-11-12 15:00:57 UTC; the subscription event count was zero. This was an observed pre-existing result, not a fresh mutation in this hand-off session. It supersedes the older §6.2c snapshot that all four accounts were expired.

### 5.2 Migration-history divergence (reconciliation still open)

Production's migration ledger currently has **121 rows**, including this session's recorded expiry-scheduler migration. Compared with the repository, **49 other production-only versions** have no same-named migration file; many are console/MCP timestamped entries. A production catalog probe was attempted, but the Supabase connector truncates large JSON aggregates even when split into several section queries. Therefore an exact per-migration classification has **not** been established here. Do not infer `PRESENT` or `APPLY` from the ledger names alone.

The repository's `scripts/reconcile/reconcile-migrations.mjs classify --probe=...` remains the intended local comparison. Record the precise catalog evidence and the resulting `PRESENT`/`APPLY`/`REVIEW` results before any attempt to reconcile those history rows. No migration ledger rewrite or production schema repair was performed as part of this work.

### 5.3 Realtime

`supabase_realtime` publishes `public.orders` and `public.table_waiter_calls` on both projects. An older audit claim that the publication had zero tables was false; it was annotated in place rather than deleted.

### 5.4 Backup / restore evidence

The backup dump exists on the operator's Mac, not in this sandbox (`~/autodine-private-backups/20261110T151815Z/production.dump`, 961,962 bytes, with archive listing and SHA-256 file).

The vanilla `postgres:18` restore attempt failed at `pg_cron`, as described in the original preflight. **However, restorability was subsequently demonstrated** on 2026-11-10 using an isolated local Supabase PostgreSQL `17.11.0.018` container (`--network none`, `cron.launch_active_jobs=off`, `cron.database_name=restorecheck`): `pg_restore` exited 0 and 20 orders / 30 order-items were preserved. This evidence is recorded in `PHASE-2-PRODUCTION-PREFLIGHT.md`. The older statement that no restore drill ever succeeded is superseded. The dump remains dated 2026-11-10 and is not a current-data backup.

### 5.5 Transactional email

| Setting | Value | Consequence |
|---|---|---|
| `smtp_host` | `null` | No custom SMTP; platform sender fallback |
| `rate_limit_email_sent` | `2` | 2 emails per hour |
| `mailer_autoconfirm` | `true` | Signup needs no email |

Real delivery, staff invitation redemption, and raising the GoTrue send rate remain operator tasks. SMTP setup alone does not raise GoTrue's own rate limit.

### 5.6 Test results and verification boundary

Local checks for this continuation passed: `npm run typecheck`, `npm run lint`, `npm run design:check`, `npm run sql:check`, `npm test -- --reporter=dot` (2,095 passed, 114 skipped across 181 files), `npm run db:reconcile -- converge` (clean replay, classifier self-test 0 wrong verdicts, populated rows preserved), and `npm run test:db:embedded` (114 passed on disposable PostgreSQL). These are local checks, not hosted browser/runtime acceptance.

## 6. Post-merge production follow-ups

**The production rollout and app merge are complete.** The old §6.1–§6.4 rollout narrative below described the pre-merge state and must not be used as an active runbook. Its migration list remains historical evidence only. The final member-only migration was applied as planned; production reported the operational health checks as ready afterwards.

### 6.1 Trial state

All four accounts already have fresh 21-day trials ending 2026-12-03 15:00:57 UTC, with `account_can_write(a.id) = true`. No `admin_set_subscription` mutation was needed. The test restaurant has zero members, so its write gate result does not imply an owner login exists.

### 6.2 Subscription-expiry scheduler

Production has `pg_cron` 1.6.4. The existing `autodine-qr-attempt-retention` job and the new `autodine-subscription-expiry` job are both active every 15 minutes. Staging and disposable local PostgreSQL do not install `pg_cron` by default.

This branch adds `supabase/migrations/20261112000100_schedule_subscription_expiry.sql`, guarded so projects without both the extension and named schedule function safely no-op. After local verification and user approval, the exact checked-in SQL was applied transactionally to production and version `20261112000100` recorded. A read-only verification returned `jobname = autodine-subscription-expiry`, `schedule = */15 * * * *`, `command = select public.expire_subscriptions();`, `active = true`. The function was not manually invoked.

### 6.3 Vercel deployment fix

This branch removes the explicit Vercel Git deployment disable map. It addresses the observed cause of the missed deployment on `main`; the fix takes effect after it is merged to `main`. It does not issue a deployment or alter project dashboard settings.

### 6.4 Legacy migration-history reconciliation

There are 49 production-only migration versions. No production-only ledger records were rewritten and no schema objects were changed for reconciliation in this session. The local catalog classification remains pending because connector output truncation prevents safely assembling the complete production probe. Continue with read-only, bounded catalog extraction and the local classifier; retain any ambiguous result as `REVIEW` rather than guessing.

### 6.5 Historical rollout evidence

The original 33-file Batch A and Batch B application log, policy collision notes, and per-migration execution instructions in the older draft are retained in the repository history, but they describe work completed before this report update. They are not authorization to rerun migrations. The restore rehearsal is documented in `PHASE-2-PRODUCTION-PREFLIGHT.md`; the Vercel hold rationale is in `PHASE-3-HOSTED-BASELINE.md`.

## 7. What is built

All of the following exist in the repository with unit or integration coverage.

**Guest:** QR verification (3 modes: `code` / `scan_confirm` / `scan`), 59-minute table
sessions, menu with categories/items/variants/add-ons, cart, checkout, order status,
10-minute change/cancel window, per-order bill, token-scoped order reads.

**Staff:** owner dashboard, menu management (photo import, AI review as draft only,
translation, pair publish + rollback), branding/theme, outlets, staff invites and RBAC
(owner/manager/kitchen/cashier), tables/QR management, reports with export.

**Operations:** kitchen display with prep state machine (new → preparing → ready →
served/cancelled), Hindi voice announcements (Edge TTS + browser fallback) with per-ticket
replay and speaker lock, cashier counter settlement, session close, numbered non-GST
receipts with void-and-reissue, print/PDF/share.

**Cross-cutting:** server-side price truth (browser sends ids + quantity only), integer-paise
money with half-away-from-zero rounding, `orders_math_check` DB constraint, immutable
order/item/price snapshots, guest-token idempotency, atomic DB rate limits, RLS on every
table, `SECURITY DEFINER` RPCs with fixed `search_path`, CSP nonce, safe login redirects.

**Commercial (Model C):** one subscription per **account**, shared by every outlet. Trial 21
days from activation. Starter ₹999/month (1 outlet), Professional ₹2,699/month (5 outlets),
Business ₹3,699/month (unlimited). `accounts.trial_ends_at` is **materialised**, not
recomputed, so a trial running when the length changed keeps its original activation date
and an already-expired trial stays expired. Downgrades and expiries stop new outlet creation
and make the account read-only — **nothing is ever deleted**.

---

## 8. Bugs and false logic — resolved vs open

The historical audit (`AUDIT-REPORT.md`, 2026-11-06) catalogued C1–C4 (customer), O1–O5
(owner/staff) and S1–S3 (systemic). Their status:

| ID | Issue | Status |
|---|---|---|
| C1 | Cart/checkout fell back to a **sample 5% tax** when the restaurant rate had not loaded, while the DB charged the real rate | **Fixed.** Live path loads a validated explicit rate; a missing/malformed rate fails rather than becoming 5%. The 5% sample is demo-mode only. |
| C2 | "GST 5% · sample" wording reachable by guests | **Fixed.** Labels are generic `Taxes` when no rate is known. |
| C3 | **Duplicate order codes possible** — 5-char code over a 33-character alphabet with **no unique index**; ~50% collision probability after ~7,400 orders per restaurant, causing random order failures | **Fixed.** Unique index on `(restaurant_id, code)` plus a bounded retry wrapper. Production verified zero duplicate groups before the index was added. |
| C4 | Idempotency race depends on PL/pgSQL rollback semantics | **Fixed and regression-tested** on disposable PostgreSQL. Never run against production (correctly). |
| O1 | Two kitchen devices double-announce (dedupe was per-device memory only) | **Fixed.** Server-side one-winner claim per order (`kitchen_announcement_claims`). |
| O2 / O3 | Duplicate codes on boards; old order re-stamped on collision | **Fixed** by the same unique index as C3. |
| O4 | Sample tax label on bill screens | **Fixed.** Stored tax figures and the order's rate snapshot are shown. |
| O5 | Unused-import lint warning; `T${Date.now()}` table label past 999 | **Fixed.** |
| S1 | `lib/pricing.ts` header said "SAMPLE ONLY" while the code was live | **Partially open.** The header is corrected, but the tax model intentionally supports **one exclusive rate and intra-state CGST/SGST only**. It does not implement IGST, inclusive pricing, per-item rates or GSTIN-conditional documents. |
| S2 | Announcement status lived in memory | **Fixed** (persisted claim table). |
| S3 | No invoice numbering anywhere | **Fixed.** Per-restaurant, per-financial-year numbered series (India FY: 1 Apr – 31 Mar), row-locked and transactional, never reused. |

### Open defects and open questions

1. **Quantity contract mismatch (open, needs a product decision — do not "fix" silently).**
   `20261021000005_public_place_order.sql` documents quantities as bounded 1–99, but the
   implementation **caps** values above 99 at 99. Capping may be intentional. Confirm
   whether over-limit quantities should be capped or rejected.
2. **GST is frozen on purpose.** No legal/adviser approval exists. The receipt function is
   deliberately fail-closed for GST documents and issues a clearly-labelled non-GST receipt
   only. **Do not invent rates, defaults, classifications, inclusive/exclusive treatment,
   exemptions or place-of-supply rules.**
3. **Test-database clock is future-dated** relative to the authoritative date. Must be
   resolved before trusting any expiry, retention, timestamp, trial or subscription
   boundary test.
4. **Isolated PostgreSQL/browser job failed once** (`1cef125`) and passed on rerun. The
   failure cause was never retrieved. Do not discard this evidence.

---

## 9. What is not built (deliberately out of scope)

- **Online payment gateway in the guest flow.** Locked decision: pay-at-counter only. The
  schema contains historical provider columns; they are **not** a usable gateway, and there
  are no Razorpay initiation/verification/webhook routes.
- **Payment-mode selector in checkout.** Locked: a simple authorised "mark paid" action.
  "Served" and "paid" are separate states.
- **KOT / kitchen printer output.** Removed by decision. Kitchen tickets are screen-first;
  browser/OS printing is the only supported printing model. No USB/BT/LAN printer
  integration.
- **GST tax invoices.** Await approved tax configuration (see §8).
- **Subscription self-checkout.** Billing plumbing exists (webhook events, payment records),
  but there is no customer-facing subscription purchase flow.

---

## 10. Never verified — do not claim these work

This is the most important section for anyone judging launch readiness.

| Area | Status |
|---|---|
| Real email delivery (reset, invites) | **Never delivered a single real email.** 2/hour limit, no custom SMTP. |
| Staff invitation redemption end to end | **Never completed.** |
| Hosted Realtime, multi-device kitchen | Realtime publication is correct, but **no hosted multi-device test was ever run**. |
| Physical printer / KOT output | Not verified. Browser printing only. |
| TTS audibility | Microsoft Read Aloud is unsupported and has no commercial SLA. Treat TTS as optional. |
| Provider backup restore drill | **Succeeded** in the isolated Supabase PG 17.11.0.018 restore rehearsal (2026-11-10); vanilla PostgreSQL attempt failed on missing `pg_cron`. |
| Load / capacity evidence | No workload sized for the pilot; no 1×/2×/soak test. |
| Monitoring and alerting | `/api/health` exists but is **not wired to any monitoring**. |
| Production response headers, cookie/origin behaviour, external scan | Not verified. |
| Full guest browser → PostgREST → order persistence on the current build | Not demonstrated on a hosted project. |
| Multi-tenant isolation on a hosted project | Not demonstrated. |

Browser E2E historically reports **64 pass / 47 credential-dependent skips**.

---

## 11. Hard constraints — do not violate

These come from `AGENTS.md` and are locked. Read that file before changing code.

- **Money is integer paise (`BIGINT`).** Never floating point. The database is the pricing
  truth; clients never submit trusted totals.
- **Never rewrite historical financial records.** Order/item/payment snapshots and
  idempotency guarantees are immutable.
- **Pay-at-counter only.** No gateway in guest checkout, no payment-mode selector.
- **One table = one open sitting.** Later guest submissions create separate tickets
  containing only the newly submitted items. Preserve the session link, guest-token
  idempotency and payment ledger — do not merge or duplicate tickets.
- **Order submission must never be throttled.** Throttle QR verification, session minting and
  other sensitive endpoints only. Migration `20261110000800` removed the per-session,
  per-restaurant and per-IP attempt budgets; a guard test in
  `lib/db/readiness.integration.test.ts` **fails if those budget keys reappear**.
- **Announcement content order is fixed:** order number, table, items, quantities, guest
  note. Call Waiter copy is exactly `टेबल X, वेटर ध्यान दीजिए。`
- **Public restaurant data is exactly three facts:** name, customer-facing phone,
  customer-facing address. Read it only via `public_restaurant_profile()`. GSTIN, plan,
  trial dates, payee details and internal settings are never public.
- **Never run integration, browser, load or destructive tests against production.** Use
  disposable local PostgreSQL only.
- **Only the production deployment may use the production Supabase project.** Preview,
  development, CI and local runs must point elsewhere; the build and the env loader refuse
  otherwise. **Do not add a bypass.**
- **Never commit secrets.** No service-role key through `NEXT_PUBLIC_*`. Demo flags
  (`AUTODINE_DEMO_MODE`, `AUTODINE_TEST_DEMO_BUILD`) must never reach a deployment.
- **`scripts/local-pg/` scaffolds are test-only approximations**, not production DDL and not
  proof of production-schema parity.

---

## 12. Recommended changes, in priority order

1. **Restore Vercel Git auto-deploys.** Merge this branch's `vercel.json` fix and confirm a later merge to `main` creates the expected production deployment. Do not treat a manual deploy as proof of the Git integration.
2. **Reconcile 49 production-only schema-migration versions.** Exact classify results are not available yet due connector output caps. Capture the probe in bounded chunks or use another authorized read-only path; do not edit migration history or rerun schema migrations based only on ledger names.
3. **Configure SMTP and raise the email send rate limit** — separate settings. Exercise reset and invite flows on staging first. Do not disable `mailer_autoconfirm` without an explicit product decision.
4. **Complete the real hosted integration pass** on an approved non-production project: QR → menu → order → kitchen → cashier/close → receipt, two-tenant isolation, retry/network failure, mobile and desktop.
5. **Wire `/api/health` to monitoring and alerting.**
6. **Settle the quantity 1–99 contract** (cap vs reject) and resolve the test database clock discrepancy before trusting time-bound tests.
7. **Obtain GST adviser sign-off** before enabling GST-dependent invoices or changing the locked tax behavior.
8. **Run a capacity pass** sized for the actual pilot before broad launch.

Completed this continuation: changed and verified Preview/Development Supabase targets to staging; applied and verified the guarded subscription-expiry scheduler migration on production after local checks and user approval; all four restaurant trials were already active and were not rewritten.

## 13. Remaining work and operator decisions

| Item | Who | Status / why |
|---|---|---|
| Production expiry scheduler | Agent | **Complete.** User approved; guarded migration `20261112000100` was applied and the active 15-minute cron job was verified. |
| Confirm Vercel Git deployment restoration | Operator | Merge the config fix, then observe a subsequent `main` deployment; no deploy is triggered by this branch itself. |
| Reconcile 49 production-only migration versions | Agent + operator | Need complete read-only catalog probe and classification; do not use ledger names as proof. |
| Preview/Development Supabase configuration | Agent | **Complete.** Project-level URL and publishable key now target staging; Production variables and secrets unchanged. |
| Configure SMTP and raise email rate limit | Operator | Supabase dashboard configuration; connector exposes no SMTP setting. |
| Approve GST rules | Adviser | Legal/financial approval. |
| Decide cap-vs-reject for quantities > 99 | Product owner | Behavioral contract decision. |

## 14. Pitfalls learned the hard way

- **Never create `auth.users` rows with raw SQL.** That was the root cause of a multi-day
  "passwords don't work" investigation. Always use the GoTrue Admin API
  (`admin.auth.admin.createUser`), which writes the correct empty-string token columns.
  Re-hashing passwords was a dead end; the hash was always correct.
- **`comm` silently drops lines on collation mismatch.** An earlier comparison reported 28
  missing migrations when the true number was 34; six were lost to a sort-order bug. Always
  cross-check with a collation-independent method (`grep -Fxv -f a b`).
- **Images may not be visible to the agent.** In at least one session, screenshots could not
  be rendered and had to be read with OCR. If an image matters, ask for the text.
- **`/docs/*.md` is gitignored** (`.gitignore:38`) with per-file `!` exceptions. A new doc
  under `docs/` commits nothing until an exception is added. Always run
  `git check-ignore -v <path>` first.
- **`supabase.execute_query` returns `row_count: 0` for successful DDL and UPDATEs.** That is
  success, not failure.
- **Do not hand-write backup instructions for this repo.** `PRODUCTION-BACKUP-RUNBOOK.md`
  already exists and is stricter than anything written ad hoc: Docker-based, network-isolated
  restore container, refuses the transaction pooler, sanitised reporting.
- **`supabase_migrations.schema_migrations` has no `inserted_at` column.** Only `version`
  (and, on some projects, `name`).
- **Batch A is not atomic across files.** Each file is wrapped in `BEGIN…COMMIT`, so a
  failure rolls back that file only. Whatever succeeded before it stays applied.
