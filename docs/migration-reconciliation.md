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

- Anything about a hosted database as it is now. Nothing here has read one since the evidence file was captured.
- Failures that depend on data: a constraint that existing rows violate, a lock held too long under traffic.
- Differences from the server itself. CI replays on PostgreSQL 15, 17 and 18; production reported 17.11.
- Whether a **hosted** backup restores. A local round trip has been run: `pg_dump -Fc` and `pg_restore` (PostgreSQL 16.2,
  from the `pgserver` wheel) over the full 70-migration chain, with byte-identical schema dumps and unchanged row counts
  (see `docs/verification-2026-11-10.md`). That says nothing about the hosted 17.11 database, whose dump has never been
  taken here. Step 7 of the procedure is still a real step.
