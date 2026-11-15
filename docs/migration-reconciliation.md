# Migration reconciliation

How to find out what a database still needs from `supabase/migrations/` without trusting its migration ledger.

This file describes a local method and what it has established so far. It authorises nothing. Steps that touch a hosted project stay in `PHASE-3-HOSTED-BASELINE.md` and `PRODUCTION-BACKUP-RUNBOOK.md`, and each needs the owner's approval.

## Current merge update — 2026-11-06

The active branch has reconciled the incoming `main` migration set without
reusing a Supabase version prefix. The competing branch-only migrations were
renumbered as follows:

| Kept behavior | Current migration | Reason |
|---|---|---|
| Payment-audit provider actor repair | `20261110000851_payment_audit_provider_actor.sql` | Main uses `20261110000700` for restaurant membership. |
| Online-payment attempt uniqueness | `20261110000950_online_payment_attempt_uniqueness.sql` | Main uses `20261110000900` for QR-attempt convergence. |
| Checkout outstanding-balance guard | `20261110001210_checkout_outstanding_guard.sql` | Main uses `20261110000800` to remove order-submission throttles. |
| Client bypass privilege cleanup | `20261110001220_revoke_client_bypass_privileges.sql` | Main uses `20261110000500` for the public restaurant projection. |

The incompatible standalone `20261110000600_qr_attempt_budget_compat.sql` draft
was not kept. Its data-preservation requirement is incorporated into the main
`20261110000900_converge_qr_verification_attempts.sql`: supported active QR
attempt state is imported into the canonical table while the original source
remains archived. The source shape is still unknown for hosted Staging and
Production; no hosted operation is authorized. `scripts/check-sql.mjs` now
rejects duplicate 14-digit migration versions.

## Phase 6D account-entitlement link guard — evidence 2026-11-06

The forward-only migration `20261112000200_immutable_restaurant_account_link.sql`
adds a `BEFORE UPDATE` trigger on `public.restaurants`. If an authenticated
request changes `account_id`, the trigger raises SQLSTATE `42501`. It does not
change the existing owner/manager RLS policy or authenticated table-level
`UPDATE` grant, revoke any restaurant columns, change account/trial functions,
or alter ordinary settings, tax, guest-verification, branding, storefront,
operational, UPI, or online-payment-switch behavior. Inserts used for initial
account creation and `create_outlet()` remain valid. `account_id` remains
nullable with its existing `ON DELETE SET NULL` FK, and the legacy
`restaurant_can_write()` fallback remains in place. No transfer/linking RPC is
added.

The migration version follows the repository high-water file
`20261112000100_schedule_subscription_expiry.sql`, so it runs after the
account-link column and account/subscription functions. It makes no data update.
Do not drop the guard as a rollback: doing so restores the P0 vulnerability.
A future approved association repair should use a trusted migration/service
operation; any customer-facing transfer flow requires its own reviewed design.

The disposable native-PostgreSQL runner now proves both sides of the change:

1. Before the guard migration, a synthetic owner detaches an expired linked
   restaurant and observes the legacy gate switch to writable; a synthetic
   manager reassigns it to a different writable account and observes the
   entitlement/account-RLS change. Both attempts run under the actual local
   `authenticated` role with simulated JWT subjects and are rolled back.
2. After migration, the same owner and manager changes are rejected, while
   ordinary settings and brand publish/rollback writes, initial service-role
   account creation, authenticated `create_outlet()`, and nullable legacy rows
   continue to work.

Run the full disposable PostgreSQL 17.11 replay and DB regression suite with:

```bash
npm run test:db:embedded
```

The Phase 6D run replayed 77 migrations and passed 130 direct-SQL integration
tests across five files. It uses a local Supabase shim and synthetic data; it is
**not** HTTP/PostgREST validation and is not hosted Staging/Production evidence.
`npm run sql:check` remains a static parser check, not proof of function, trigger,
grant, RLS, or migration behavior. Staging remains NO-GO and Production
read-only until independent rollout gates pass.

## Why the ledger is not enough

- Production's ledger uses console-style versions, repeats names, holds names that are not in this repository, and ends at `20261108000200 drift_reconcile`. Its versions cannot be compared with file names here.
- Staging was built from six early migrations and then one bundled script, `scripts/staging/approved-upgrade.sql`. Its ledger has nine entries.
- SQL has been run by hand and written down afterwards (`20261108000200` says so about itself), and five production function bodies match no version of this repository.

A file with **no ledger record** is therefore not called "unapplied" until the catalog has been read.

## Tools

| File | Purpose |
|---|---|
| `scripts/reconcile/reconcile-migrations.mjs` | Every check below, on a throwaway PostgreSQL. Refuses a non-loopback server and reads no application environment. |
| `scripts/reconcile/catalog-probe.sql` | One read-only statement that returns one JSON document: functions (body hash, security mode, grants), policies, columns, relations and their grants, triggers, indexes, constraints. The harness runs this same file locally, so a hosted result is directly comparable. |
| `scripts/reconcile/evidence/production-2026-11-10.json` | What was kept from production reads made on 2026-11-10: a ledger summary, the files with no same-named entry, six function body hashes and two functions that were absent. The full ledger was not kept. |
| `scripts/reconcile/evidence/production-2026-11-14.json` | The ledger summary refreshed on 2026-11-14 (121 entries, last `20261112000100`, unnamed): which repository files have no same-version ledger entry. `catalogFacts` inside are unchanged 2026-11-10 observations and are superseded by the probe. |
| `scripts/reconcile/evidence/production-2026-11-14-catalog-probe.json` | The seven-section read-only catalog probe captured on 2026-11-14 (1030 objects, per-object md5s, server-side checksum verified). Input to `classify`. |
| `scripts/reconcile/evidence/classify-production-2026-11-14.json` | The `classify` report produced from that probe and the refreshed fixture. |
| `scripts/local-pg/with-embedded-postgres.mjs` | Runs any command against a disposable local PostgreSQL. |

```bash
npm run db:reconcile        # evidence, converge and staging checks
npm run test:db:embedded    # clean replay, then the SQL role and concurrency tests
node scripts/reconcile/reconcile-migrations.mjs staging --emit-probe=<file>
node scripts/reconcile/reconcile-migrations.mjs classify --probe=<file>
node scripts/reconcile/reconcile-migrations.mjs integration --base=<ref> --main=<ref> --pr=<ref>
```

## Findings on 2026-11-10

These are for PR #172 combined with `main` at `8ae4feb`, the Phase 0 files, and the three migrations this branch adds
(`20261110000800`, `20261110000900` and `20261110001000`): 70 migrations. All of it is local. Re-run the commands for the current picture.

### Production

- 25 files have no ledger record (listed below). Two older files, `20261021000004_missing_qr_tables` and `20261107080000_payment_audit_ledger`, have no same-named entry either.
- The captured body of `place_public_order` equals the repository after `20261108006000`. So `20261109000200` and `20261110000300` were not in production when it was captured.
- `operational_schema_readiness` and `place_public_order_attempt` were absent. They are first created by `20261109001000` and `20261110000400`.
- The captured bodies of `cancel_order`, `open_table_session`, `record_counter_payment`, `set_order_line_quantities` and `settle_online_payment` match **no** state of this repository. Pending migrations replace all five, so the drift is overwritten rather than explained. Reading the five bodies is a separate, authorised step.
- The recorded baseline (45 files) followed by the 25 gives exactly the catalog of a clean replay of all 70.
- A populated database at the recorded baseline, holding an order, a payment, an audit event, an invoice and a receipt, takes the 25 with every row count unchanged.

### Staging

- The bundle holds 49 migrations, the newest being `20261109000900`. Fifteen repository files are not in it.
- Four of those fifteen are **older** than the newest bundled file: `20261108007000`, `20261108008000`, `20261108009000` and `20261108010000` (PR #172). Any rule of the form "apply what is newer than the last one applied" skips them without a word. `scripts/verify-database.mjs` had such a cut-off on its bundle path; it now reads the bundle's own `SOURCE` list.
- `20261109000400_order_write_boundary.sql` was edited after it was bundled. The edit widens one `revoke` to every `place_order` overload. A database built from the bundle ran the earlier text and will never run the new one under that name. The edit predates
Rule 3 below and needs an explicit decision: either fold the same tolerance into a forward migration (so every database
reaches one body) or record the divergence as accepted. It is not something to change quietly in either direction.
- A staging-shaped history followed by the fifteen files differs from a clean replay in 9 objects, all on one table: `qr_verification_attempts`. See the open question below.

### `qr_verification_attempts`

`20261108000200_drift_reconcile.sql` creates this table with `create table if not
exists`, as a counter keyed by `(qr_code_id, ip_hash)`, and
`reserve_qr_verification_attempt()` writes with `on conflict (qr_code_id,
ip_hash)`. A pre-existing table with another shape is not repaired by that DDL.

The merged `20261110000900_converge_qr_verification_attempts.sql` now:

1. Recognizes the exact canonical six-column table and pair primary key; if the
table is absent it creates that shape, and if it is noncanonical it renames the
source (including its indexes, constraints and sequence) to
`qr_verification_attempts_legacy_<timestamp>` before creating the canonical
counter.
2. Imports active state from the two evidenced legacy layouts: the four-column
event log `(id, qr_code_id, ip_hash, attempted_at)` and the six-column
pair-keyed counter. Event attempts in the active 15-minute window are grouped
by pair and capped at five; expired events remain in the archive but do not
charge the current budget.
3. If the branch-only `qr_verification_attempt_budgets` table exists, copies
its active counter/block state too. For a pair present in that table, that live
state is authoritative, so its archived source rows are not charged twice.
4. Re-declares the reservation and clear functions against the canonical table.
The clear function also clears the optional branch budget table; archived source
rows remain intact for inspection.

Unknown shapes, invalid identity/state, or malformed row data fail closed rather
than silently reset rate limits. The local stand-in in
`scripts/local-pg/005_scaffold_missing_tables.sql` is the event-log shape. A
synthetic migration test seeds six rows (four recent, two expired) and verifies
four active attempts are imported while all six source rows remain preserved;
this is local evidence only. The actual hosted Staging and Production shapes
have not been queried during this merge.

### The 25 files with no ledger record

"Objects" is what the file changes when first applied to the recorded baseline.

| Migration | Objects | Run a second time | Run again after the whole chain |
|---|---|---|---|
| `20261108000500_order_session_staff_read` | 0 | no change | no change |
| `20261108007000_payment_recorded_by` | 0 | no change | no change |
| `20261108008000_p8_require_settlement_before_close` | 2 | no change | no change |
| `20261108009000_p9_financial_read_roles` | 6 | **errors** (policy exists) | **errors** |
| `20261108010000_invoice_share_links` | 44 | no change | no change |
| `20261109000100_restore_hold_fields` | 1 | no change | no change |
| `20261109000200_order_attempt_lock` | 1 | no change | **reverts** `place_public_order` |
| `20261109000300_payment_state_guards` | 4 | no change | **reverts** four financial functions, including the lock order from `20261110000100` and `000200` |
| `20261109000400_order_write_boundary` | 8 | no change | no change |
| `20261109000500_session_payment_guard` | 1 | no change | no change |
| `20261109000600_finalized_source_guard` | 3 | **errors** (trigger exists) | **errors** |
| `20261109000700_order_line_removal` | 1 | no change | **reverts** `set_order_line_quantities` |
| `20261109000800_table_activity_summary` | 1 | no change | no change |
| `20261109000900_staff_tts_budget` | 1 | no change | no change |
| `20261109001000_operational_readiness` | 1 | no change | **reverts** `operational_schema_readiness` |
| `20261110000100_counter_payment_lock_order` | 1 | no change | no change |
| `20261110000200_financial_session_serialization` | 4 | no change | no change |
| `20261110000300_shared_wifi_scan_limits` | 2 | no change | no change |
| `20261110000400_durable_order_attempt_budget` | 3 | no change | no change |
| `20261110000500_public_restaurant_profile` | 1 | no change | no change |
| `20261110000600_staff_finance_boundaries` | 7 | no change | no change |
| `20261110000700_restaurants_member_only` | 2 | no change | no change |
| `20261110000800_remove_order_submission_caps` | 2 | no change | no change |
| `20261110000900_converge_qr_verification_attempts` | 3 | no change | no change |
| `20261110001000_account_subscriptions` | 20 | no change | no change |

## Safety checks the harness runs on itself

- The classifier must name the true state for every prefix of the pending set: 26 states, 0 wrong verdicts on 2026-11-10.
- 22 synthesised drift states — one for each pending migration that changes a catalog marker (25 are pending; three change no
  catalog object), each given a catalog value no migration produces — must every one be reported as REVIEW/drift. A drifted
  database classified `PRESENT` would have its repairing migration recorded as already applied and never run.
- A populated pre-upgrade database must take the whole pending set with no row lost.

## Findings on 2026-11-14

Read-only re-verification of Production (`bdbaqpevwmgdvghszjno`), no DDL/DML, nothing applied.

**Capture.** All seven catalog sections were read via the read-only connector and saved to `scripts/reconcile/evidence/production-2026-11-14-catalog-probe.json` (1030 objects: 120 functions, 71 policies, 405 columns, 44 relations, 17 triggers, 126 indexes, 247 constraints). Every section was verified against a server-side `md5(string_agg(...))` aggregate computed on the server, except functions, whose aggregate ordering differs from the local reconstruction; those 120 per-object values were instead compared row by row and are all identical. One transcription error in the manually copied column page (`restaurant_invoice_share_links.access_count`) was found by this check and fixed.

**Ledger.** Production now reports 121 ledger entries (was 86 on 2026-11-10); the newest is `20261112000100` with no name. 49 entries still carry no repository file name. Ten repository files have no same-version ledger entry: `20261110000851_payment_audit_provider_actor`, `20261110000950_online_payment_attempt_uniqueness`, `20261110001210_checkout_outstanding_guard`, `20261110001220_revoke_client_bypass_privileges`, `20261112000200_immutable_restaurant_account_link`, `20261112000300_report_sales_export_authorization`, `20261112000400_bound_subscription_history`, and the three unapplied serialization migrations `20261112000500`, `20261112000600`, `20261112000700`. The first four (Phase 6/PR #181-era) are branch files that were never recorded; the last three have never been applied anywhere.

**Classification (local only, against the probe).** Verdicts for the ten pending files, recorded in `classify-production-2026-11-14.json`:

| Migration | Verdict |
|---|---|
| `20261110000851_payment_audit_provider_actor` | NO FOOTPRINT |
| `20261110000950_online_payment_attempt_uniqueness` | REVIEW — drift 2 (`begin_online_payment`, `settle_online_payment`) |
| `20261110001210_checkout_outstanding_guard` | REVIEW — drift 1 (`close_order_session_and_issue_receipt`) |
| `20261110001220_revoke_client_bypass_privileges` | NO FOOTPRINT |
| `20261112000200_immutable_restaurant_account_link` | APPLY — effects absent |
| `20261112000300_report_sales_export_authorization` | REVIEW — drift 1 (`report_sales`) |
| `20261112000400_bound_subscription_history` | APPLY — effects absent |
| `20261112000500_serialize_outlet_creation` | REVIEW — drift 2 (`create_account_with_restaurant`, `create_outlet`) |
| `20261112000600_serialize_subscription_payments` | REVIEW — drift 2 + absent 1 (`record_subscription_payment`, `record_subscription_payment_failure`) |
| `20261112000700_serialize_subscription_expiry` | REVIEW — drift 1 (`expire_subscriptions`) |

**Baseline drift.** 75 objects that no pending migration touches differ from the recorded baseline the repository replays — including `place_order` overloads absent in production (`place_order(text,text,jsonb,text)` missing), and the subscription functions the repository itself defines (`account_can_write`, `account_outlet_limit`, `admin_set_subscription`, `plan_price_paise`, `protect_account_plan`, `confirm_subscription_cancellation`, `request_subscription_cancellation`, `withdraw_subscription_cancellation`, `expire_subscriptions`, and others). Production's definitions of these match neither the repository baseline nor any state a repository migration produces.

**Production-only objects.** 95 probe objects exist that no repository migration creates, including the whole relations `restaurant_subscriptions`, `restaurant_verification_settings` and `qr_token_migration_issues`, the column `orders.idempotency_key`, and the `table_verification_sessions`/`restaurant_subscriptions` constraint families. Production therefore runs a hand-applied or separately-deployed feature set that the repository never contained. This is the substance behind the 49 nameless ledger entries: they are not cataloguing artifacts, they correspond to real, unaccounted-for SQL.

**Decisions this forces (not made here).**

1. Do not apply any repository migration to Production on the strength of the ledger; the drift above must be read first. In particular the three 2026-11-12 serialization migrations read REVIEW/drift against production — they were verified only on disposable local PostgreSQL, and whether production carries the same function bodies must be established (read-only body capture) before they are applied or reworded.
2. The two `APPLY` verdicts (`20261112000200`, `20261112000400`) are candidates to apply, in version order, once the rollout gates in `PHASE-3-HOSTED-BASELINE.md` / `PRODUCTION-BACKUP-RUNBOOK.md` are satisfied and the owner explicitly authorises the target.
3. `classify` exits non-zero while 176 drift findings are unacknowledged. `--ack-drift` was deliberately **not** passed: each finding still needs a migration-safety decision (a converging forward migration, or a recorded reason to leave it).
4. Production contains a subscription/verification schema direction that conflicts with the repository's account-subscription design. Reconciling or retiring it is a product decision, not something to settle by editing migrations.

Nothing was applied, committed or acknowledged as part of this verification.

## Drift triage — 2026-11-14 (follow-up to the probe)

Method: replay every repository migration on disposable local PostgreSQL and record `md5(prosrc)` per public function after each step; fetch production's per-function `md5(prosrc)` (and a comment/whitespace-normalized variant) read-only; compare. This separates "production applied the same code written slightly differently" from "production runs code the repository never contained".

Cross-check artifacts: `scripts/reconcile/evidence/prosrc-comparison.json` (raw hash per production function vs repository replay history), `normalized-comparison.json` (comment/whitespace-normalized hash vs the repository's final replayed state), `production-2026-11-14-prosrc.json` (raw hashes). Repository bodies are regenerable by replay; nothing from production beyond hashes and the few bodies quoted here is stored.

**Headline.** Of 120 production functions:

- **92 match the repository's final replayed state once comments/whitespace are normalized** — production runs semantically identical code, minus comments (and with `security invoker`/search_path style differences that do not affect the catalog markers used by `classify`).
- **15 differ for real** (below).
- **13 exist nowhere in the repository's migration history** (below).
- 59 matched some repository state byte-for-byte; the rest of the apparent drift is comments/formatting.

### The 15 real differences, by danger

Security-relevant, in production today:

1. `report_sales(uuid,timestamptz,timestamptz,text,text,integer,boolean)` — production's body **never calls `has_restaurant_role`**. It is `SECURITY DEFINER`, so it bypasses RLS, and it exposes every restaurant's sales report and up to `p_order_limit` underlying orders to any authenticated caller. Repository migration `20261112000300_report_sales_export_authorization.sql` exists precisely to add the owner/manager predicate (plus a 400-day range cap, a 10000-row order bound and a safe timezone fallback). Not applied; production is open. Owner decision needed now, independent of the migration ledger story.
2. `payment_audit_events` — production holds `actor_id uuid NOT NULL` and no `profiles` FK. Repository migration `20261110000851_payment_audit_provider_actor.sql` is a designed idempotent repair for exactly this state (drop NOT NULL; add the FK `not valid`; then validate). It changes nothing on a healthy database and would fix the settlement RPC's rollback-after-update failure mode on production. Not applied.

Correctness-relevant, confirmed by body/lock inspection:

3. `record_subscription_payment(...)` — production validates plan/amount/currency/INR and deduplicates on `(provider, provider_event_id)`, but takes **no row lock** before reading the replay ledger and the account. Consequences: a retried webhook racing the original can surface a raw unique-violation instead of the documented `duplicate` result, and two different-event payments computed from the same pre-payment view overwrite `plan_expires_at` instead of stacking months; `from_plan` is recorded from the post-update row, so the history says `renewed` when the plan changed. Repository `20261112000600_serialize_subscription_payments.sql` (verified locally only) fixes exactly these three defects. Production has the pre-fix shape.
4. `record_subscription_payment_failure(...)` — same name lookup, no row lock; sets `past_due` without re-checking the row. Covered by the same migration.
5. `record_subscription_refund(...)` — differs from repository; same family (refund also records `kind = 'payment_failed'` by design). Not line-by-line reviewed; read before any apply.
6. `expire_subscriptions()` — production loops over a snapshot and runs an **unlocked** `update ... set plan_status = 'expired'` with no re-check, and inserts an `expired` event unconditionally; a retry or concurrent run can double-insert events and miscount. Repository `20261112000700_serialize_subscription_expiry.sql` makes it idempotent (UPDATE-with-recheck). Not applied anywhere hosted.
7. `create_outlet(text,text)` and `create_account_with_restaurant(...)` — production checks `v_used >= v_limit` with **no row lock**, so two concurrent calls can both pass the limit check and both insert; the anti-over-outlet race the repository's `20261112000500_serialize_outlet_creation.sql` closes. Not applied anywhere hosted.
8. `account_payment_history(uuid,integer)` / `account_subscription_history(uuid,integer)` — production puts `limit greatest(coalesce(p_limit,50),1)` on the **outer** single-row aggregate, so it bounds one row (the aggregate itself) and aggregates **every** historical payment/event. Repository `20261112000400_bound_subscription_history.sql` moves the limit into the subquery (newest N first, then aggregate). This matches the `classify` verdict `APPLY` for `20261112000400`.
9. `begin_online_payment(...)` / `settle_online_payment(...)` — production locks sessions/orders (`for update` present) but lacks the repository's one-open-intent uniqueness and stale-duplicate-capture refusal from `20261110000950_online_payment_attempt_uniqueness.sql`. Dormant only because the payment provider is disabled; the moment a provider is configured, the guard needs to be there first.
10. `reserve_qr_verification_attempt(uuid,text)` / `clear_qr_verification_attempts(uuid,text)` — production's bodies match no repository state; the repository's `20261110000900_converge_qr_verification_attempts.sql` rewrites these against the canonical budget table (5 attempts / 15 min) and archives legacy shapes. Production's `clear` is a hard `delete`. The actual rate-limit semantics live unverified on the host.
11. `create_staff_invite(uuid,member_role,integer)` — production's body is coherent (owner/manager boundary, owner-only manager grants, 5-retry code minting) and differs from the repository text; judged cosmetic/stylistic on read, not a correctness finding.
12. `verification_code_for(text,bigint)` — differs in text; not line-by-line reviewed. Treat as unknown.
13. `report_sales` export path — see (1); also note the repository adds the 400-day range cap that is absent in production.

### The 13 functions that exist nowhere in the repository

`place_order(text,jsonb,text)`, `place_counter_order(text,jsonb,text)`, `place_order_idempotent(text,jsonb,text,uuid)`, `record_cash_payment(text,uuid,bigint,uuid)`, `record_qr_verification_failure(uuid,text)`, `issue_table_qr_code(uuid,uuid,text,uuid)`, `set_restaurant_tax_rate(uuid,integer)`, `rotate_restaurant_verification_code(uuid,uuid)`, `revoke_table_qr_code(uuid,uuid)`, `revoke_sessions_on_qr_revocation()`, `revoke_sessions_for_ineligible_target()`, `cleanup_expired_qr_verification_attempts()`, `has_restaurant_role(uuid,member_role[])`.

None is referenced by application code in this repository (the only mentions are comments and the hand-written generated-types file `lib/db/database.ts`, which itself exists because the live database could not be introspected and admits it documents the deployed production-era RPC surface, including `place_counter_order` and `record_cash_payment`). The `member_role[]` `has_restaurant_role` overload is production-only; the repository defines only the `text[]` overload (used by `report_sales` after `20261112000300`). These are remnants of the hand-applied console era. Disposition for every one: **inventory only; never drop, rename or retype without hosted usage evidence** (application logs + a restore to scratch). None of them may be used as a compatibility target for new work.

### Non-function drift (catalog objects)

- `table_verification_sessions` — production has **no `id` column** and uses `token_hash text` as the natural key; `qr_code_id` differs; primary key differs; `table_id_fkey`/`token_hash_key` absent because production instead uses composite `(table_id, restaurant_id)` references (same pattern as `table_qr_codes_table_restaurant_fkey` and `table_verification_sessions_table_restaurant_fkey`). This is a deliberately different, hand-applied QR-verification design the repository never contained. Migration convergence on this table would mean **adopting** the production design or a designed replacement — an owner decision, not a replay.
- `payment_audit_events` — see above; additionally `payment_audit_events_actor_id_fkey` and `categories_menu_id_fkey` / `items_category_id_fkey` / `table_qr_codes_table_id_fkey` / `table_verification_sessions_table_id_fkey` are absent in production because production uses composite-restaurant FKs there too. The four `payment_audit_events_*_check` constraints differ in definition from the repository's.
- RLS: production's policy set is `*_staff_*` (e.g. `items_staff_read`); the repository's equivalent policies are `*_manage` (e.g. `items_manage`) and are **missing in production**, while the production policies are missing from the repository. Row-level security semantics need a deliberate comparison before any convergence; do not drop production policies.
- `relation restaurants (differs)` and `place_order(text,text,jsonb,text) (missing)` — production runs a different `restaurants` definition and lacks the four-argument repository overload entirely.
- `orders.idempotency_key`, `restaurant_subscriptions`, `restaurant_verification_settings`, `qr_token_migration_issues` (relations) — exist only in production; referenced by no migration and no application code in this repository.
- `orders_idempotency_key_unique` and the other "in the database but not in the repository" indexes — same console-era provenance; inventory only.

### What this means for the pending set

- `20261112000200_immutable_restaurant_account_link.sql` and `20261112000400_bound_subscription_history.sql` (APPLY verdicts) — the classification stands: effects absent in production. `20261112000400` additionally fixes the no-op limit verified above.
- The three `20261112000500..00700` serialization migrations are **correct for production's actual state** (production exhibits every defect they close) and remain unapplied and uncommitted; applying them there means `create or replace` over the hand-written bodies, which is exactly what capture-before-replace demands: the bodies above are now captured (hashes + full text for the subscription/financial group), so a reviewed apply is technically possible — but it still needs the owner's explicit target authorization, a backup with proven restore, and staging rehearsal first. None of those gates is satisfied.
- `20261110000950_online_payment_attempt_uniqueness.sql` — production has locking but not the uniqueness discipline; keep this REVIEW until the provider question is settled; it must land **before** any payment provider is configured.
- `20261112000300_report_sales_export_authorization.sql` — **do this one early**: production is currently running an SECURITY DEFINER report RPC with no role predicate. It is a contained, signature-preserving change; still gated on the same target authorization.
- `20261110000851_payment_audit_provider_actor.sql` — designed for exactly production's audit table; lowest-risk repair in the set. Same gates.
- `20261112000200_immutable_restaurant_account_link.sql` — adds the account-link guard trigger; verify no legitimate reassign flows beforehand (there are none in the repository).
- `--ack-drift` remains unrun: every finding above now has a documented read, but acknowledgment is the owner's migration-safety decision to record, not the agent's.

### Decisions only the owner can make

1. Converge now (apply the repair set to production) versus freeze and document — and in which order, under which backup.
2. The parallel subscription schema: production's hand-applied `restaurant_subscriptions`/`restaurant_verification_settings`/`qr_token_migration_issues` versus the repository's account-subscription Model C. Retire, adopt or quarantine; this is a product decision with data implications and is **not** something to script blindly.
3. The QR-verification subsystem: adopt production's design into the repository, or converge production onto the repository's canonical budget model (accepting the data implications for `qr_verification_attempts`).
4. The `report_sales` role-predicate fix urgency; this is the one item with a direct confidentiality impact.
5. Whether the `*_staff_*` policies vs `*_manage` policies difference is intended (rename in repository) or a divergence to eliminate.

## Rules

1. Decide file by file. Never use "newer than the last one applied".
2. Apply what is missing in version order, once. Two files error on a second run, and four silently revert later fixes if run again out of order.
3. Do not edit a migration that any database has run. Add a new one.
4. `create table if not exists` does not reshape a table that already exists. When a table was first made by hand, check its columns and keys.
5. `20261110000500` and `000600` go before the application release that reads restaurants through `public_restaurant_profile`. `20261110000700` goes after that release is live. Applied earlier, it makes every guest menu on the old release answer "not found".
6. `20261108008000` changes what the checkout function accepts: a sitting cannot be closed while money is outstanding. Sittings closed unpaid before it stay valid and can still be paid. Tests that need that older state build it directly.
7. Capture before you replace. A `create or replace function` deletes the only copy of a body that exists nowhere else — five production functions
   (`cancel_order`, `open_table_session`, `record_counter_payment`, `set_order_line_quantities`, `settle_online_payment`) match no state of the
   repository. Run `scripts/reconcile/capture-function-bodies.sql` read-only and keep the output beside the probe **before** applying anything that
   redefines one.
8. Drift ends in a decision, not in a shrug. `classify` exits non-zero while any drift finding is unacknowledged; `--ack-drift` records that each
   finding has been read and either converged by a forward migration or left alone on purpose.

## Procedure once a hosted read is authorised

1. Run `scripts/reconcile/catalog-probe.sql` on the target and save the JSON. It is a single `select`.
2. Run `scripts/reconcile/capture-function-bodies.sql` the same way and keep the output next to the probe: every definition with its body hash, recorded
   before anything is replaced. Both queries are read-only.
3. Run `classify --probe=<file>`. It exits non-zero while drift is unacknowledged; add `--ack-drift` only once each finding is recorded.
4. Read one verdict per file:
   - `APPLY`: its effects are absent.
   - `PRESENT`: its effects are there. Record it in the ledger; do not run it.
   - `REVIEW`: something it defines exists in a different form. Stop and read it.
   - `NO FOOTPRINT`: the catalog cannot say. Decide from the file's content.
5. Read the `baseline:` lines. They list objects that no pending file touches but that differ from the repository, and objects that exist in no migration.
6. Resolve every `REVIEW` before anything is applied.
7. Take the backup and prove the restore, as in `PRODUCTION-BACKUP-RUNBOOK.md`.
8. Apply the `APPLY` files in version order.
9. Probe again. Every file must now read `PRESENT`.

## What this cannot tell you

- Anything about a hosted database as it is now beyond the dated read-only sessions. The 2026-11-14 production probe and ledger read above are dated observations; re-run the read-only procedure before acting on them.
- Failures that depend on data: a constraint that existing rows violate, a lock held too long under traffic.
- Differences from the server itself. CI replays on PostgreSQL 15, 17 and 18; production reported 17.11.
- Whether a **hosted** backup restores. A local round trip has been run: `pg_dump -Fc` and `pg_restore` (PostgreSQL 16.2,
  from the `pgserver` wheel) over the full 70-migration chain, with byte-identical schema dumps and unchanged row counts
  (see `docs/verification-2026-11-10.md`). That says nothing about the hosted 17.11 database, whose dump has never been
  taken here. Step 7 of the procedure is still a real step.
