# Production migration plan — 2026-11-11

> **Historical plan, superseded:** the 2026-11-12 hand-off report records that the production rollout and application merge were subsequently completed. This plan was written before that work and is not an active execution checklist or authorization. Production was not re-queried in the current code audit; use the latest dated hand-off for recorded evidence and re-verify live state before any new production action.

At the time this plan was written, production (`autodine-production`, ref
`bdbaqpevwmgdvghszjno`) was measured as **28 migrations behind** this repository.
That was the gap this plan was designed to close.

At the 2026-11-11 snapshot, this was a **plan, not an execution record**. The
2026-11-12 hand-off report records subsequent rollout completion. Applying any
new production database change still requires explicit approval under
`AGENTS.md`.

---

## 1. State at the 2026-11-11 snapshot (measured then, not current)

All values in this table are historical measurements from 2026-11-11; later production changes are recorded in the 2026-11-12 hand-off report.

| | Staging (`autodinetest`) | Production |
|---|---|---|
| `GET /api/health` | `ok: true` (200) | **`ok: false` (503)** |
| `trialDays` reported | `21` | **`7`** |
| Operational probe | all 5 `applied` | all 5 `missing` |
| Landing copy | 21-day trial, ₹999 / ₹2,699 / ₹3,699 | **7-day trial, ₹899 / ₹1,599 / ₹2,699** |
| Served commit | this branch | `7dae9b48` (main, PR #173) |

The five "missing" operational probes are **one** root cause, not five separate
breakages. `lib/health.ts` calls `operational_schema_readiness()`, a function
created by `20261109001000_operational_readiness.sql`. That function is absent,
so the whole map reports `missing`. The underlying tables
(`order_sessions`, `payments`, `restaurant_invoices`,
`restaurant_payment_receipts`, `kitchen_announcement_claims`) **do exist** in
production.

What genuinely does not exist in production:

- tables `accounts`, `account_subscriptions`, `subscription_payments`
- functions `public_restaurant_profile()`, `account_can_write()`,
  `create_outlet()`, `record_subscription_payment()`,
  `operational_schema_readiness()`

So the accurate statement is: **the financial safety guards and the entire
Model C subscription schema are missing from production**, not "the product is
broken".

### Why the gap is 28 and not 34

Comparing migration *versions* over-counts. Production applied several
migrations under renumbered versions — for example
`order_code_and_kitchen_announce_guard` is `20261107114638` in production and
`20261108001000` in the repository. Comparing by migration **name** gives the
true figure: **28**.

---

## 2. The one hard ordering constraint

`20261110000700_restaurants_member_only.sql` revokes guest/member SELECT on
`public.restaurants` so that storefronts must go through
`public_restaurant_profile()`. Its own header says:

> *An older application reads the table directly as a guest and would show
> every menu as "not found" after this migration. Apply 20261110000500 first,
> deploy the application, then apply this file.*

At the 2026-11-11 snapshot, production served an **older** application. Applying
this file before deploying the newer storefront reader would have taken every
guest menu offline. That constraint dictated the historical three-step rollout;
the hand-off report records its later completion.

---

## 3. Rollout: three steps, in this order

### Step 1 — Batch A: 27 migrations (safe with the currently deployed app)

Apply every missing migration **except** `20261110000700`, in filename order:

| # | Migration | What it does |
|---|---|---|
| 1 | `20261021000004_missing_qr_tables` | `create table if not exists` for `table_qr_codes` / `table_verification_sessions`. **No-op on production** — both tables already exist there. Retained only so fresh replays work. |
| 2 | `20261107080000_payment_audit_ledger` | Adds `payments.recorded_by` and the `payment_audit_events` table. Additive. |
| 3 | `20261108000500_order_session_staff_read` | Grants SELECT on `order_sessions` to `authenticated`. Header notes this was **already applied directly to production**; idempotent re-grant. |
| 4 | `20261108007000_payment_recorded_by` | Explicit `payments.recorded_by` column to keep replays compatible with deployed RPC contracts. Additive. |
| 5 | `20261108008000_p8_require_settlement_before_close` | Session must be fully settled before checkout closes it and issues the final receipt. Enforced in the SECURITY DEFINER transaction. |
| 6 | `20261108009000_p9_financial_read_roles` | Financial receipts readable by finance-capable staff only; kitchen cannot fetch invoices by UUID. |
| 7 | `20261108010000_invoice_share_links` | New table `restaurant_invoice_share_links`; only a SHA-256 digest of the share token is stored. Additive. |
| 8 | `20261109000100_restore_hold_fields` | Restores `hold_required` / `confirmed_at` output from `get_public_order`. |
| 9 | `20261109000200_order_attempt_lock` | Restores open-or-join session attachment in the public-order wrapper; serializes guest-token replays. |
| 10 | `20261109000300_payment_state_guards` | A pending online payment now counts as a lock, so three paths stop treating such an order as untouched. |
| 11 | `20261109000400_order_write_boundary` | Revokes direct INSERT/UPDATE/DELETE on `orders` / `order_items`; kitchen keeps `update (prep_status)` only. |
| 12 | `20261109000500_session_payment_guard` | Manual session settlement refuses to collect against in-flight gateway money. |
| 13 | `20261109000600_finalized_source_guard` | An issued, unpaid receipt freezes its source; cancellation/repricing cannot silently change the live bill. |
| 14 | `20261109000700_order_line_removal` | Correct removal semantics; order-line edits validated atomically. |
| 15 | `20261109000800_table_activity_summary` | Server-side `table_order_activity()` aggregation — the floor plan stops counting only the first page of PostgREST rows. |
| 16 | `20261109000900_staff_tts_budget` | Fixed shared TTS budgets; identity from the verified JWT, membership checked in SQL. |
| 17 | `20261109001000_operational_readiness` | Adds `operational_schema_readiness()`. **This is what turns `/api/health` green.** |
| 18 | `20261110000100_counter_payment_lock_order` | Aligns counter collection with session settlement. Additive replacement. |
| 19 | `20261110000200_financial_session_serialization` | Serializes financial/source RPCs against checkout at the sitting. |
| 20 | `20261110000300_shared_wifi_scan_limits` | Serializes scan admission per QR row so one shared IP cannot consume a whole venue's access. |
| 21 | `20261110000400_durable_order_attempt_budget` | Failed order work rolls back in a subtransaction; admission counters commit. Order submission itself stays uncapped. |
| 22 | `20261110000500_public_restaurant_profile` | Adds `public_restaurant_profile()`. Additive. **Required before step 3.** |
| 23 | `20261110000600_staff_finance_boundaries` | Payment audit ledger becomes finance-only. Header states no screen relies on the access removed. |
| 24 | `20261110000800_remove_order_submission_caps` | Removes throttling from guest order submission, per the rule now canonical in `AGENTS.md`. |
| 25 | `20261110000900_converge_qr_verification_attempts` | Converges `qr_verification_attempts` onto the canonical non-counter shape. |
| 26 | `20261110001000_account_subscriptions` | **Model C**: `accounts`, `account_subscriptions`, trial materialisation, `account_can_write()`, `create_outlet()`. |
| 27 | `20261110001100_subscription_billing` | Subscription payments, immutable receipts, event history, cancellation, one-trial-per-identity, owner dashboard reads. |

**Risk notes for step 1**

- Items 6, 11, 13, 23 and 24 **remove** access or tighten behaviour. They are
  the ones to watch. Each header states that no screen depends on the access
  removed, but that claim was verified against the *current* application, and
  production is serving an *older* one.
- Item 1 is a deliberate no-op on production; do not expect it to correct any
  column drift that exists there.
- Take a provider backup (or confirm PITR) immediately before this step. See
  §5.

**Verify after step 1:** `GET /api/health` should return `ok: true`. Item 17 is
what makes that happen. The trial figure it reports will still be `7` until
step 2.

### Step 2 — Deploy the application

Deploy the branch containing the 21-day trial and the approved prices
(₹999 / ₹2,699 / ₹3,699). This is the version that reads storefronts through
`public_restaurant_profile()`, which step 3 depends on.

Until this deploy lands, production keeps running `7dae9b48`, which reports a
7-day trial and the superseded ₹899 / ₹1,599 / ₹2,699 prices.

Order matters: step 1 must precede this deploy, because the new application
expects `accounts` and `public_restaurant_profile()` to exist.

### Step 3 — Batch B: 1 migration

| # | Migration | What it does |
|---|---|---|
| 28 | `20261110000700_restaurants_member_only` | Restaurant rows readable by members only. Guests and non-members lose SELECT on `public.restaurants` entirely. |

Apply **only after** step 2 is serving traffic. Verify a guest can still open a
menu by QR immediately afterwards.

---

## 4. How to verify each step

```sh
# before and after every step
curl -s "https://<host>/api/health" | jq .
```

Expect `ok: false` → `ok: true` after step 1, and `trialDays: 7` → `21` after
step 2.

Re-run the migration comparison to confirm the gap is closed:

```sh
npm run db:reconcile
```

---

## 5. Historical pre-rollout prerequisite

At the 2026-11-11 snapshot, there was no confirmed production backup/PITR or
hosted restore evidence. The 2026-11-12 hand-off later records an isolated local
restore rehearsal but still marks current production backup/PITR settings as
unverified. Steps 1 and 3 change grants and function bodies in ways that cannot
be undone by a later forward migration.

Before any future consequential production database change, acceptable
recovery evidence must include either provider PITR successfully rehearsed into
a separate throwaway target, or a fresh production `pg_dump` whose integrity
has been checked. Do not rely on the old dashboard screenshot or this historical
plan.

---

## 6. Status (snapshot from 2026-11-11; superseded)

The table below records the state when this plan was drafted. It is retained as history only; the 2026-11-12 hand-off report records the later production rollout as complete. Do not infer current live state from this table or rerun the batches.

| Step | State |
|---|---|
| Plan written | done — this document |
| Step 1 (Batch A, 27 migrations) | **not started — needs approval** |
| Step 2 (deploy application) | **not started — needs approval** |
| Step 3 (Batch B, 1 migration) | **not started — needs approval** |

At this plan's 2026-11-11 snapshot, none of these batches had been applied. The later 2026-11-12 hand-off records rollout completion; verify against current live state before relying on it.
