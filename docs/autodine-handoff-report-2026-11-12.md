# AutoDine — complete hand-off report

**Date: 2026-11-12 (final).** Written to be read by an AI or engineer with **no prior
context**. Everything below is measured from the repository, the live Supabase projects and
the live deployments on 2026-11-11/12 — not inferred from marketing or from documentation
that describes intent. Where a fact could not be verified, it says so explicitly.

Read in this order if you are in a hurry: §0 (status) → §1 (what it is) → §5 (current
state) → §6 (what was done) → §12 (recommended changes) → §14 (pitfalls).

---

## 0. Status at a glance — 2026-11-12 13:45 UTC

| Item | State |
|---|---|
| Trial length on production | **21 days** (`trialDays: 21`, measured) |
| `/api/health` on production | **`ok: true`** |
| Batch A (33 migrations) | **Applied, 33 of 33, 0 failures** |
| Batch B (`20261110000700_restaurants_member_only`) | **Applied and verified** |
| PR #176 | **MERGED** into `main` (`0f2199c`) |
| Production deployment | **Live** — `dpl_52Ck1JvNHo2CBoHgGE9a8EHYk45c`, commit `0f2199c` |
| CI on the merge commit | **All 9 checks green** |
| Guest security hole (tenant enumeration) | **Closed** — anon reads `public.restaurants` → 0 rows |
| ⚠️ All 4 existing restaurants | **Read-only** — their trials had already expired. See §6.2c |
| ⚠️ Restore drill | **Still unproven.** The dump is good; `pg_cron` blocks a plain restore |

The one thing that still needs a human: **decide whether to grant the four existing
restaurants a fresh 21-day trial or a paid plan.** Nothing is broken — they are read-only by
design because their 7-day trials had already run out before this work started. §6.2c has the
copy-pasteable SQL.

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
| `supabase/migrations/` | **71** checked-in SQL migrations, filename `YYYYMMDDHHMMSS_name.sql`. |
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

## 4. Branch and PR state — MERGED AND DEPLOYED

- Branch: **`arena/a5344572-autodine`**, based on `71f46ce` of `arena/e9e78732-autodine`.
- **PR #176 → `main`: MERGED** on 2026-11-12 13:23 UTC as merge commit **`0f2199c`**.
  `main` HEAD is `0f2199c`; the branch tip is `ab6b482`, which is an ancestor of it.
- CI on the merge commit: **all 9 checks green**, including the throttle browser E2E that had
  been failing on every run of this branch (§6.5).
- **Production deployment: `dpl_52Ck1JvNHo2CBoHgGE9a8EHYk45c`**, built from `0f2199c`,
  `READY` + `PROMOTED`, aliased to `new-alpha-five-43.vercel.app`.

### The do-not-merge gate is closed

The gate that stood at the start of this session is satisfied. Measured on
`bdbaqpevwmgdvghszjno` after Batch A:

| Object the merged code needs | Present on production? |
|---|---|
| `public.public_restaurant_profile(text)` | **1 — present** |
| `public.accounts` (table) | **1 — present** (4 rows) |
| `public.subscription_payments` (table) | **1 — present** |

### ⚠️ Vercel did NOT auto-deploy the merge — this will recur

The push to `main` produced a **preview** deployment for the branch but **no production
deployment**. Nothing was queued, building or initialising; the newest production build was
still the 2026-11-11 one. A production deployment was triggered manually through the Vercel
API (`create_deployment`, `git_source = {type: github, ref: main, repoId: 1424626479}`).

**Whoever maintains this next should not assume a merge to `main` reaches production.**
Check `https://new-alpha-five-43.vercel.app/api/health` after every merge, and if
`trialDays` has not changed, trigger a production deployment by hand. The reason was not
established — it may be a project setting (production branch) or a lapsed GitHub↔Vercel hook.

---

## 5. Current measured state (2026-11-12)

### 5.1 The two health probes side by side

`GET /api/health` returns 503 when not ok. It is the single observable proof of the gap.

**Production** (`https://new-alpha-five-43.vercel.app/api/health`):

```json
{"ok":false,"configured":true,"serverKey":true,"reachable":true,
 "credentials":"accepted",
 "schema":{"trialAndWriteGate":"applied","planEntitlements":"applied","restaurantUpi":"applied"},
 "trialDays":7,
 "operational":{"orderSessions":"missing","settlement":"missing","invoices":"missing",
                "paymentReceipts":"missing","announcementClaims":"missing"},
 "checkedAt":"2026-11-11T19:15:20.570Z"}
```

**Review deployment** (staging DB):

```json
{"ok":true,"trialDays":21,
 "operational":{"orderSessions":"applied","settlement":"applied","invoices":"applied",
                "paymentReceipts":"applied","announcementClaims":"applied"},
 "checkedAt":"2026-11-12T08:41:42.207Z"}
```

**Production, FINAL — after PR #176 merged and Vercel deployed (2026-11-12 13:43 UTC):**

```json
{"ok":true,"configured":true,"serverKey":true,"reachable":true,
 "credentialProbe":null,"credentials":"accepted",
 "schema":{"trialAndWriteGate":"applied","planEntitlements":"applied","restaurantUpi":"applied"},
 "trialDays":21,
 "operational":{"orderSessions":"applied","settlement":"applied","invoices":"applied",
                "paymentReceipts":"applied","announcementClaims":"applied"},
 "checkedAt":"2026-11-12T13:43:39.858Z"}
```

**This is the goal state.** `ok: true` *and* `trialDays: 21` together. It was reached by the
sequence: 33 migrations → `ok:true` (with `trialDays` still 7) → merge PR #176 → production
deploy → `trialDays: 21`.

For the record, the intermediate state — production after 23 of the 33 migrations, before the
merge — was `ok:true` with `"trialDays":7`, because that number lives in the application
code, not the database. `ok:true` alone is **not** "the trial fix is live"; both fields must
be read together.

Two things follow, and they are the whole story:

1. **The trial fix is done but not deployed.** `trialDays` is 21 in code, and the review
   deployment proves it. Production still reports 7 only because PR #176 is unmerged.
2. **The five `operational: missing` values are one cause, not five breakages.**
   `lib/health.ts:238` calls a single RPC, `public.operational_schema_readiness()`. It does
   not exist on production, so all five keys read `missing`. The underlying tables
   (`order_sessions`, `payments`, `restaurant_invoices`) **do** exist on production.

### 5.2 Migration history has diverged — this is the real problem

Measured by comparing `supabase/migrations/` against
`supabase_migrations.schema_migrations` on production:

| Measure | Count |
|---|---|
| Migration files in the repository | 71 |
| Versions recorded on production | 86 |
| Present in both | 37 |
| **In repo, missing on production** | **34** |
| **On production with no repo file** | **49** |

The 49 production-only versions are migrations that were applied to production but whose
files no longer exist in the repository (no rename explains them — no repo filename
contains any of those timestamps). **Production was therefore not built purely by replaying
`supabase/migrations/`, and the two have grown apart.** This is why migrations must be
applied one at a time with verification, never as a blind batch.

### 5.3 Realtime — re-verified, previously misreported

`supabase_realtime` publishes `public.orders` and `public.table_waiter_calls` on **both**
projects. An older audit claim that the publication had zero tables is **false**; it has
been annotated in place rather than deleted.

### 5.4 Backup state

A dump exists **on the operator's Mac**, not in this sandbox:

- Path: `~/autodine-private-backups/20261110T151815Z/`
- `production.dump` — **961,962 bytes**
- `archive-list.txt` — **1,328 lines** (a few-hundred-byte file would mean a failed dump)
- `production.dump.sha256` — present

**The dump is good. The restore test is not proven.** `pg_restore` aborted on
`CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog` because the vanilla
`postgres:18` Docker image does not ship `pg_cron` (a Supabase-managed extension). Because
the run used `--exit-on-error`, nothing after that point was restored and no row counts were
obtained. This is a limitation of the **restore target**, not of the dump — but it means
**restorability has never been demonstrated**.

The dump is dated 2026-11-10 15:18 UTC. Acceptable as a schema-migration safety net because
production's schema has not changed since; it is **not** a current-data backup.

### 5.5 Transactional email

| Setting | Value | Consequence |
|---|---|---|
| `smtp_host` | `null` | No custom SMTP; falls back to the platform sender |
| `rate_limit_email_sent` | `2` | **2 emails per hour** |
| `mailer_autoconfirm` | `true` | Signup needs no email, so signup works |

Signup works. **Password reset and staff invitations both need an email that is rate-limited
to two per hour.** Fine for one restaurant; not for real customers. Custom SMTP alone does
**not** raise GoTrue's own send limit — `Authentication → Rate Limits` is a separate setting
and is the step most likely to be missed.

### 5.6 Test results (last full run)

`typecheck` 0 · `lint` 0 · `design:check` 0 · `sql:check` 0 ·
Vitest **177 files, 2095 passed, 4 skipped**. The 4 skips are DB-gated and covered by the
separate `test:db` job in CI on a PostgreSQL 15/17/18 matrix.

---

## 6. The production migration — COMPLETE

**Batch A is COMPLETE — 33 of 33 applied, 0 failures — and Batch B is applied too.**
`/api/health` flipped to `ok:true` at migration 23 of 33 and is still `ok:true` after
everything. See §5.1 for the final probe (`trialDays: 21`).

The rollout order was fixed and was followed exactly:

```
operator: dump confirmed  ✅   / restore re-tested  ❌ (waived by the operator)
   ↓
Batch A = 33 migrations, applied one at a time, filename order        ✅ 33/33
   ↓
/api/health flips ok:false → ok:true   (trialDays stays 7)              ✅
   ↓
PR #176 merged  →  production deployed  →  21-day trial goes live       ✅
   ↓
Batch B = 20261110000700_restaurants_member_only   (LAST)               ✅
```

**Batch B must stay last, and this is not a suggestion.** It drops the guest-readable policy
on `public.restaurants`. Any build that reads that table directly — instead of through
`public_restaurant_profile()` — shows every menu as "not found" once it is applied. It was
applied only after the production deploy of the merged code was confirmed served.

**Why `20261110000700` must be last:** it locks `public.restaurants` to members only. Any
older build reads that table without membership context, so applying it before the deploy
breaks every guest menu.

### 6.1 Already applied to production (verified in `schema_migrations`)

```
20261021000004_missing_qr_tables
20261107080000_payment_audit_ledger
20261108000300_publish_menu_snapshot
20261108000500_order_session_staff_read
20261108001000_order_code_and_kitchen_announce_guard
20261108002000_invoice_receipts
```

### 6.2 Applied — 33 of 33 (complete)

```
 1  20261021000004_missing_qr_tables
 2  20261107080000_payment_audit_ledger
 3  20261108000300_publish_menu_snapshot
 4  20261108000500_order_session_staff_read
 5  20261108001000_order_code_and_kitchen_announce_guard
 6  20261108002000_invoice_receipts
 7  20261108003000_session_checkout_payment_receipts
 8  20261108005000_p9_security_hardening
 9  20261108006000_restore_public_order_session_attach
10  20261108007000_payment_recorded_by
11  20261108008000_p8_require_settlement_before_close
12  20261108009000_p9_financial_read_roles
13  20261108010000_invoice_share_links
14  20261109000100_restore_hold_fields
15  20261109000200_order_attempt_lock
16  20261109000300_payment_state_guards
17  20261109000400_order_write_boundary
18  20261109000500_session_payment_guard
19  20261109000600_finalized_source_guard
20  20261109000700_order_line_removal
21  20261109000800_table_activity_summary
22  20261109000900_staff_tts_budget
23  20261109001000_operational_readiness      ← /api/health flipped to ok:true here
24  20261110000100_counter_payment_lock_order
25  20261110000200_financial_session_serialization
26  20261110000300_shared_wifi_scan_limits
27  20261110000400_durable_order_attempt_budget
28  20261110000500_public_restaurant_profile
29  20261110000600_staff_finance_boundaries
30  20261110000800_remove_order_submission_caps
31  20261110000900_converge_qr_verification_attempts
32  20261110001000_account_subscriptions        ← created public.accounts (4 rows)
33  20261110001100_subscription_billing         ← created public.subscription_payments
```

### 6.2c Consequence of migration 32 that needs an operator decision

`20261110001000` backfills one `accounts` row per existing restaurant and materialises the
trial end from the state **each trial was actually in** at the moment it ran. The rule it
applies is deliberate: a trial still running on the old 7-day rule is extended to 21 days,
a trial that had **already expired stays expired**. All four production restaurants had
already expired, so all four accounts were written as `plan_status = 'expired'`:

| Restaurant | Slug | Trial started | Trial ended | Members |
|---|---|---|---|---|
| The King | `theking` | 2026-10-28 | 2026-11-04 | 1 |
| maddi | `maddi` | 2026-10-20 | 2026-10-27 | 1 |
| AutoDine QR Flow Test | `arena-qr-flow-test-20261021` | 2026-10-20 | 2026-10-27 | 0 |
| restro-non-veg | `restro-non-veg` | 2026-11-03 | 2026-11-10 | 1 |

`account_can_write()` returns false for an expired account, so **all four are now
read-only on the live deployment**. Nothing is deleted and everything stays readable — this is
the designed behaviour — but ordering, menu edits and cashier actions are refused until a
subscription is set.

This is **not a regression introduced by the deploy**. Under the old 7-day rule these
restaurants had already expired before this session started (the last one, `restro-non-veg`,
on 2026-11-10). The 21-day change applies to *new* signups. What changed is that the
authority moved from the legacy `restaurants.plan*` columns to `public.accounts`.

To give a restaurant a fresh 21-day trial, as the service role:

```sql
select public.admin_set_subscription('The King', 'trial', 21);
```

To put one on a paid plan for a month (no provider configured yet, so this is an operator
recording an off-line arrangement):

```sql
select public.admin_set_subscription('The King', 'starter', null, 1);
```

The restaurant name must match exactly (case-insensitive). `trial_grants` has 3 rows for 4
accounts — the fourth account has no owner, because `AutoDine QR Flow Test` has no
membership, so nobody owns it and no grant was recorded.

### 6.3 How the migrations were applied (method, for future work)

Use the Supabase connector's `execute_query` tool with `project_ref = bdbaqpevwmgdvghszjno`.

- **Wrap each migration in `BEGIN; … COMMIT;`** and append
  `insert into supabase_migrations.schema_migrations (version) values ('<timestamp>') on conflict (version) do nothing;`
  as the last statement. If any statement fails, the whole file rolls back **and** the
  version is not recorded.
- Do **not** use the connector's `create_migration` tool for these. It generates its own
  version string, which would not match the repository filenames and would make
  `supabase db push` try to re-apply everything later.
- Verified safe for all 33: no `CREATE TABLE` without `IF NOT EXISTS`, no `DROP` without
  `IF EXISTS`, and **no** transaction-unsafe statements (no `CONCURRENTLY`, no
  `ALTER TYPE … ADD VALUE`, no `VACUUM`).
- Files larger than ~10 KB should be split at statement boundaries; a 1,463-line file in one
  call is error-prone to transcribe.

**Two conflicts already found and how they were handled** — expect more of this kind,
because of the 49-version divergence:

- Migration `20261108002000` does `create policy restaurant_invoices_staff_read` /
  `restaurant_invoice_lines_staff_read` **without** a preceding `drop policy if exists`.
  Both policies **already existed** on production. Fix applied: prepend
  `drop policy if exists <name> on <table>;` so the end state matches the migration's
  intent exactly.
- Migration `20261108001000` raises an exception if duplicate `(restaurant_id, code)` groups
  exist in `orders`. Verified zero before applying.

### 6.4 The restore gate — still open, and it is the operator's, not mine

**Do not apply any further migration until the operator confirms the restore test.** The
dump itself is confirmed; restorability is not. The one-command fix for their Mac (drops
`--exit-on-error` so the run continues past `pg_cron`):

```bash
D=$(ls -dt "$HOME"/autodine-private-backups/*/ | head -1)
C="autodine-restore-v2-$(date -u +%Y%m%dT%H%M%SZ)"
docker run --detach --name "$C" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -v "$D:/backup:ro" postgres:18
for i in $(seq 1 60); do docker exec "$C" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
docker exec "$C" createdb -U postgres restorecheck
docker exec "$C" pg_restore -U postgres --dbname=restorecheck \
  --no-owner --no-privileges "$D/production.dump" > "$D/restore-v2.log" 2>&1
echo "restore_exit=$?"
docker exec "$C" psql -U postgres -d restorecheck -tA -c \
  "select 'orders='||count(*) from public.orders union all select 'order_items='||count(*) from public.order_items"
```

---

### 6.5 A CI regression this branch introduced, and how it was fixed

**Symptom.** The `scan throttle · real browser + disposable PostgreSQL` job failed on
**every** run of `arena/a5344572-autodine` — 14 consecutive failures — while the same job
**passed** on the base commit `71f46ce` (2026-11-09). Not flaky: re-running the identical job
failed again in the same place.

**Cause.** `scripts/e2e/check-local-api.mjs` is a read-only preflight that runs before
Playwright. It mirrored the *old* guest read path:

```js
client.from('restaurants').select('*').eq('slug', slug).eq('is_active', true).maybeSingle()
...
if (!restaurant) throw new Error('Full synthetic restaurant row is not available to anon.');
```

Migration `20261110000700_restaurants_member_only` (added on this branch) drops the
`restaurants_public` policy, so a guest read of `public.restaurants` returns **no rows**. The
disposable database is built from *every* migration in `supabase/migrations/`, so that read
was empty from the moment the migration existed. `check()` treats an empty result as a pass
(PostgREST answers an RLS denial with an empty body, not an error), then the very next line
throws — aborting the job before a single browser test ran.

**Fix.** The preflight now reads through `public_restaurant_profile()`, which is what
`lib/db/public-restaurant.ts` and therefore `getStorefrontStatusBySlug` and
`getRestaurantMenu` already do. It also asserts the property the migration guarantees: a
direct guest read of the tenant table is refused.

**How it was verified without CI logs.** GitHub's log and artifact hosts are unreachable from
the agent sandbox, so the failure was reproduced locally instead: an embedded PostgreSQL
(`embedded-postgres`, already a devDependency) was built from the repository's own migration
runner, seeded with `900_local_seed.sql` + `910_local_e2e_seed.sql`, and probed with
`SET ROLE anon` — the exact switch PostgREST performs for an anon-key request. Result:

```
PASS public_restaurant_profile() storefront read            -> 1 row
PASS direct read of public.restaurants                      -> 0 rows  (root cause)
PASS public_qr_intro() read-only RPC                        -> 1 row
PASS published menus / categories / items reads             -> 1 row each
```

The real-PostgreSQL throttle suite (`app/menu/throttle-db.integration.test.tsx`, 5 tests) was
run against the same database and passed throughout — confirming the failure was in the
preflight, not in the product code. After the fix, all 9 CI checks are green.

---

### 6.6 What is done, and what is genuinely left

**Done, measured, on production:**

1. All 33 Batch A migrations applied, 0 failures.
2. `/api/health` `ok:true`.
3. PR #176 merged (`0f2199c`) with all 9 checks green.
4. Production deployed; `trialDays: 21` measured live.
5. Batch B (`20261110000700`) applied **after** the deploy, exactly in the required order.
6. Guest tenant enumeration closed: as `anon`, `select count(*) from public.restaurants`
   returns **0**; `public_restaurant_profile('restro-non-veg')` returns **1** row.

**Left, in priority order:**

1. **Decide access for the four existing restaurants** (§6.2c). One SQL call each. Blocked on
   the operator, because it is a commercial decision.
2. **Prove the backup restores** (§6.4). One Docker command. Blocked on the operator.
3. **Configure SMTP** (§5.5). Blocked on the operator.
4. **Fix Vercel's missing auto-deploy on `main`** (§4). Otherwise every future merge silently
   fails to reach production.
5. **Run `expire_subscriptions()` on a schedule.** It exists and is granted to the service
   role, but nothing calls it. Until something does, an expired trial is only noticed when the
   owner reloads a page and the write gate refuses them.
6. **Reconcile the migration divergence** (§5.2): production has 49 versions the repository
   does not have. Those are real objects in a live database with no file describing them.

---

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
| Provider backup restore drill | **Failed once (`pg_cron`), never succeeded.** |
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

1. **Finish Batch A (27 migrations).** Blocked only on the operator confirming the restore
   test. Everything else waits behind this.
2. **Prove restorability.** Re-run `pg_restore` without `--exit-on-error` (§6.4). A backup
   you have never restored from is not a backup. Then decide whether platform
   PITR/daily backups are sufficient for ongoing operations.
3. **Reconcile the migration history divergence (49 production-only versions).** This is a
   real, unresolved architectural risk. Either restore the missing migration files to the
   repository, or formally baseline production's history and record the decision. Until
   then, `supabase db push` cannot be trusted and every migration must be hand-applied.
4. **Configure SMTP and raise the email send rate limit** — two separate settings. Do it on
   staging first and exercise reset + invite end to end before touching production.
5. **Turn off `mailer_autoconfirm`** once email delivery works. Today anyone can sign up
   with an address they do not own. This is a **product decision**, not a bug fix — it
   changes behaviour for everyone who signs up afterwards. It was deliberately left alone.
6. **Run the real integration pass:** QR → menu → order → kitchen → cashier/close → receipt
   on a hosted project, including two-tenant isolation, retry/network failure, and mobile
   and desktop browsers.
7. **Wire `/api/health` to monitoring** and add alerting. Right now nothing watches it.
8. **Settle the quantity 1–99 contract question** (§8) before it becomes a data problem.
9. **Resolve the test-database clock discrepancy** before trusting any time-based test.
10. **Do a capacity pass** sized for the actual pilot before broad launch.

---

## 13. Where the remaining work is blocked on a human

| Item | Who | Why it cannot be automated |
|---|---|---|
| Run the backup/restore procedure | Operator (on their Mac) | Requires production DB credentials; must never be pasted into a chat. |
| Configure SMTP, raise email rate limit | Operator | Supabase dashboard only; the connector exposes no SMTP tool. |
| ~~Merge PR #176~~ | ~~Operator~~ | **DONE** — merged 2026-11-12 as `0f2199c`, deployed, verified. |
| Grant the four restaurants a trial or a plan (§6.2c) | Operator | Commercial decision: who gets free access, and for how long. |
| Approve GST rules | Adviser | Legal/financial approval. |
| Decide cap-vs-reject for quantities > 99 | Product owner | Behavioural contract decision. |

---

## 14. Pitfalls learned the hard way

- **Never create `auth.users` rows with raw SQL.** That was the root cause of a multi-day
  "passwords don't work" investigation. Always use the GoTrue Admin API
  (`admin.auth.admin.createUser`), which writes the correct empty-string token columns.
  Re-hashing passwords was a dead end; the hash was always correct.
- **`comm` silently drops lines on collation mismatch.** An earlier comparison reported 28
  missing migrations when the true number was 34; six were lost to a sort-order bug. Always
  cross-check with a collation-independent method (`grep -Fxv -f a b`).
- **A green CI run is not proof the feature works.** `ok:true` in `/api/health` means the
  database matches the code; `trialDays` is a *code* value and only changes when the new code
  is actually served. Read both fields, every time.
- **A migration can break a test without touching it.** `20261110000700` broke the throttle
  E2E purely by changing what a guest may read. When a CI job fails on every run of a branch
  but passes on the base, suspect a migration that the disposable database applies.
- **Reproduce locally when logs are unreachable.** GitHub's log and artifact hosts
  (`productionresultssa6.blob.core.windows.net`) cannot be reached from the agent sandbox.
  `embedded-postgres` is already a devDependency: build the disposable database with it and
  probe with `SET ROLE anon`, which is exactly what PostgREST does for an anon-key request.
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
