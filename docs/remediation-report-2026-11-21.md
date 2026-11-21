# D1–D7 remediation, 2026-11-21

Every item below was executed in this session on branch `arena/ce32f7c8-autodine`.
Nothing was merged, no PR was opened, nothing was deployed, and no production row,
setting, bucket or secret was written. The only production interaction was
read-only SQL through the Supabase connector plus one read-only HTTPS GET to the
public health endpoint.

Head before this batch: `2ecb12e`. Migration inventory: **123 files** (was 120).

---

## D1 — the repository is no longer weaker than production (fixed)

**Problem.** Production's QR correction lives in `20261120190546_qr_code_staff_boundary`
(and `20261120190553_qr_owner_management`, `20261119101116_announcement_claim_recovery`)
with no repository file; the repository's `20261118002200` carried the membership
gates but neither the advisory lock nor the unique index. `db push` applies missing
versions regardless of order, so pushing would have run the weaker bodies *after*
production's newer ones.

**Fix.** Two forward migrations that are newer than every hosted ledger row, so a
push ends on them:

| File | What it does |
|---|---|
| `20261122000200_qr_one_active_cleanup.sql` | Collapses duplicate live cards, keeping the newest. Separate file on purpose — see the 55006 note below. |
| `20261122000300_qr_one_active_per_table.sql` | Creates `table_qr_codes_one_active_per_table` (unique partial index on `table_id where revoked_at is null`) and re-creates `rotate_table_qr_code` / `retire_table_qr_code` with `pg_advisory_xact_lock(hashtext(table_id))` on top of the existing row lock. Idempotent: `IF NOT EXISTS`, `CREATE OR REPLACE`. |
| `20261122000100_announcement_claim_recovery.sql` | `claim_kitchen_order_announcement` now deletes a claim older than two minutes before inserting, so a device that claims and crashes no longer holds an order announcement forever (`ON CONFLICT DO NOTHING` made the claim permanent). Adds the waiter-board partial index on `table_waiter_calls(announcement_claimed_at)`. |

All three are marked **NOT AUTHORIZED** in the manifest: they are repository
corrections, not applied anywhere by this session.

**Cleanup and index are two files because of a real failure.** Replaying the whole
chain in one session (`READINESS_FINANCIAL_UPGRADE=1 node scripts/verify-database.mjs`,
the native-database CI job) first failed with

```
error: cannot CREATE INDEX "table_qr_codes" because it has pending trigger events   (55006)
```

The cleanup `UPDATE` fires `revoke_sessions_on_qr_revocation`, whose AFTER-trigger
events stay pending until commit, and PostgreSQL refuses `CREATE INDEX` on a table in
that state. One file per transaction flushes them. That exact command now replays the
chain, seeds the legacy financial fixture, upgrades it and runs all ten integration
suites: **281 passed / 3 skipped**.

**Tests added (real database, disposable PostgreSQL 17):**

* `supabase/checks/09_rpc_overloads.sql` — fails the replay if any public RPC has two
  overloads. This is the class of defect that made main's CI red today.
* `phase0-security.integration.test.ts`
  * *refuses a second live card for one table at the database level* — a hand insert
    of a second live card is rejected with `23505`; after revoking the live card the
    slot is free again.
  * *serialises concurrent rotations* — two real connections rotate the same table
    at the same time; both succeed, tokens differ, exactly one live card remains.
  * *hands a stale claim to another device and keeps a fresh one* — first claim
    wins, an immediate second claim returns `false`, after the claim ages past two
    minutes another kitchen device takes it over and exactly one claim row remains.
  * *keeps the claim gate closed to non-kitchen staff and to guests* — `42501` for a
    cashier and for `anon`.

## D2 — the fixtures now model the production invariant (fixed)

Enforcing one live card per table turned **72 of 280** embedded tests red, because
`ensure_table_qr_code` (an `AFTER INSERT` trigger on `dining_tables`) already
provisions the card and the fixtures inserted a second one.

Twelve sites in seven files, plus the local seed, were rewritten to *use* the
provisioned card instead of creating a duplicate:

| File | Change |
|---|---|
| `app/menu/throttle-db.integration.test.tsx` | `UPDATE table_qr_codes SET public_token = …` for the two deterministic cards |
| `lib/db/credit-debit-notes.integration.test.ts` | asserts the trigger provisioned exactly one live card |
| `lib/db/gst-two-mode.integration.test.ts` | same assertion; the replacement-card case updates the token |
| `lib/db/operational-realtime.integration.test.ts` | reads the provisioned token twice; the replacement card revokes before inserting (the rotation semantics) |
| `lib/db/p5-cross-module.integration.test.ts` | reads the provisioned token |
| `lib/db/phase0-security.integration.test.ts` | reads the provisioned token |
| `lib/db/readiness.integration.test.ts` | reads the provisioned token in both places |
| `scripts/local-pg/900_local_seed.sql` | takes over the provisioned card instead of inserting a second |

Result: `npm run test:db:embedded` **281 passed / 3 skipped**.

## D3 — production upgrade package (prepared and proven safe; not applied)

Production's ledger holds **124** rows; the repository holds **122** files; **50**
repository files are not in production's ledger. That is the real size of the gap —
the earlier "29 missing RPCs" was the symptom, not the cause.

Ordered apply list (50 files, chronological):

```
20261110000851_payment_audit_provider_actor          20261118000600_gst_ca_onboarding
20261110000950_online_payment_attempt_uniqueness     20261118000700_gst_ca_documents
20261110001210_checkout_outstanding_guard            20261118000800_gst_outlet_activation
20261110001220_revoke_client_bypass_privileges       20261118000900_gst_recipient_documents
20261112000200_immutable_restaurant_account_link     20261118001000_gst_irp_readiness
20261112000300_report_sales_export_authorization     20261118001100_gst_reconciliation
20261112000400_bound_subscription_history            20261118001200_gst_review_lifecycle
20261112000500_role_scoped_order_reads               20261118001300_gst_direct_fulfilment
20261112000501_serialize_outlet_creation             20261118001400_gst_irp_rehearsal_store
20261112000600_cap_subscription_history_ceiling      20261118001500_gst_finance_scope
20261112000601_serialize_subscription_payments       20261118001600_gst_document_particulars
20261112000700_order_line_edit_boundary              20261118001700_gst_irp_rehearsal_recovery
20261112000701_serialize_subscription_expiry         20261118001800_irp_execution
20261113000100_gst_two_mode                          20261118001900_irp_document_projection
20261114000100_owner_manager_subscription_reads      20261118002000_guest_checkout_integrity
20261114000101_gst_b2b_einvoice_readiness            20261118002100_operational_realtime
20261114000200_irp_reconciliation                    20261118002200_qr_code_staff_boundary
20261114000300_gst_mode_gates                        20261119000100_restore_receipt_helper_boundary
20261114000400_restrict_trigger_functions_execute    20261122000100_announcement_claim_recovery
20261114000500_credit_debit_notes                    20261122000200_qr_one_active_per_table
20261114000600_einvoice_issuance_profile
20261115000100_fix_redeem_staff_invite_status_returns
20261115000200_owner_billing_configuration_guard
20261115000300_audit_restaurant_account_reassignment
20261116000100_revoke_client_maintain_privileges
20261118000100_merge_boundary_gst_order_line_edits
20261118000200_gst_configuration_boundary
20261118000300_gst_pricing_boundary
20261118000400_gst_document_integrity
20261118000500_gst_document_report
```

**Collision audit (read-only, against production's catalog).** Every object those
files create without `IF NOT EXISTS` was probed on production:

* 16 tables — `to_regclass` returns null for all of them (no collision);
* 5 indexes (incl. `restaurant_invoices_series_sequence_unique`) — absent;
* 15 `ALTER TABLE ADD COLUMN` statements — none of those columns exists.

So the batch is structurally applicable; it is **not** applied, because a production
schema change is a deploy and this session has no authorization for one.

**Before applying, the owner should:** take a logical backup (the drill in this
branch now proves that artifact restores with data), run the 50 files in this order,
then verify with the queries below, then re-run `GET /api/health` and compare the
`schema` / `operational` flags.

```sql
-- post-apply verification (read-only)
select count(*) from supabase_migrations.schema_migrations where version >= '20261122';      -- 2
select to_regprocedure('public.report_gst_documents(uuid,timestamptz,timestamptz)') is not null;
select to_regprocedure('public.save_restaurant_gst_config(uuid,int,jsonb)') is not null;
select to_regprocedure('public.set_guest_order_lines_at_version(uuid,jsonb,int)') is not null;
select to_regprocedure('public.transfer_open_sitting(uuid,uuid,uuid,uuid,uuid)') is not null;
select indexname from pg_indexes where indexname = 'table_qr_codes_one_active_per_table';    -- 1 row
select proname, position('pg_advisory_xact_lock' in pg_get_functiondef(oid)) > 0
  from pg_proc where proname in ('rotate_table_qr_code','retire_table_qr_code');              -- both true
select r.rolname, a.privilege_type from pg_proc p, aclexplode(p.proacl) a
  join pg_roles r on r.oid = a.grantee
 where p.proname = 'issue_closed_session_receipt';                                            -- postgres only
```

Production state today that matters for that list (read-only):

* `has_restaurant_role(uuid, text[])` is granted to **anon** on production
  (`20261114000400` is pending) — a hardening the upgrade closes;
* `issue_closed_session_receipt` still has the obsolete **one-argument** signature,
  `postgres`-only, and `close_order_session_and_issue_receipt(uuid)` is the
  one-argument wrapper: production never received the two-argument receipt rework;
* the three out-of-band rows (`20261119101116`, `20261120190546`, `20261120190553`)
  will not be "re-applied" by the list above, because the list contains the
  repository equivalents under different versions — they are idempotent
  (`CREATE OR REPLACE`, `IF NOT EXISTS`, cleanup `DO`).

## D4 — recovery evidence is now data-level, not catalog-level (fixed)

`test:db:logical-restore` used to compare schemas only, with **0 rows** in the dump.
It now seeds the local harness tenant, dumps, restores, and compares row counts *and
row content*; it failed that comparison, which uncovered a real dumper defect:

* the pg driver parses `timestamptz` into a JS `Date`, which carries milliseconds;
  `20:49:52.657403` was restored as `20:49:52.657`. Microseconds were being lost on
  every backup.

`scripts/backup/lib-dump.mjs` now asks the driver for PostgreSQL's own text for
`date`, `time`, `timestamp`, `timestamptz`, `interval`, `timetz` and their array
forms (`types: rawTimeTypes`), so the emitted literal is exact.

Evidence:

```
source rows:   {"restaurants":1,"menus":1,"dining_tables":1,"table_qr_codes":1,"orders":1,
                "restaurant_slug":"kings-of-kings","first_order_code":"L-1001"}
restored rows match the source  (identical, including checksums)
LOCAL_LOGICAL_RESTORE_VERIFIED {… "migrations":122, "dataRestoreVerified":true,
                "productionBackupClaim":false, "ciCustomFormatDrill":"not-run-locally"}
```

The drill also prints both sides of a divergence now, so a future failure names the
row instead of only reporting a count.

Still missing for DR READY (unchanged, and it is the only thing that can change it):
a **hosted** restore rehearsal against an authorized target (P3–P5 of
`docs/pitr-verification-procedure-2026-11-14.md`), measured RPO/RTO, and a proven
alert. Authorization for that has not been given, so it was not attempted.

## D5 — closed PR #194 lineage (assessed; port deliberately not taken)

The branch behind closed PR #194 (`arena/88c342c2-autodine`) has moved on: its head
is now `8e9a701`. Against this branch it holds **33 additive infrastructure files** —
`scripts/backup/{lib-pg-client,lib-pg-service,lib-b2-read,lib-restore-target,lib-backup-error,lib-backup-mode,lib-backup-source,prepare-disposable-restore,validate-staging-source,verify-b2-staging-scope,compare-rehearsal-manifests}.mjs`,
`scripts/hosted-verification/preflight.mjs`, `scripts/staging/seed-demo.ts`,
`.github/actions/postgres-client/*`, `.github/workflows/staging-b2-rehearsal.yml` —
plus **22 extra `test:dr` files** (28 there vs 6 here) and modified versions of
`backup-logical.mjs`, `restore-logical.mjs`, `verify-restored-db.mjs`,
`run-scheduled.mjs`.

Notable: that branch independently found the **same** dump-ordering defect fixed
here, and solved it with a catalog dependency graph (`lib-dump.mjs`, +182/−129)
rather than the function-first ordering used here.

A bounded port was attempted and **reverted**: with the modules, the four modified
scripts and their tests copied in, `node --test scripts/backup/*.test.mjs` ran 127
tests with **15 failures** (runbook-text assertions, postgres-client CI-action
wiring, scheduled-alert redaction, mode A/B contract), i.e. the port needs their
docs, their CI action wiring and their workflow edits together. Shipping a
half-ported backup library would have replaced a green tree with a red one, so the
branch was restored (`test:dr`, `test:backup` and the drill are green again) and the
work is listed as one dedicated pass with an owner-approved scope.

What this branch already has instead: a restorable dumper, data-fidelity restore
evidence, a fail-closed empty-target guard, and the DR unit suites that exist here.

## D6 — main's six red jobs (diagnosed; not fixable from this branch)

`main` is `89fa684`. Six checks fail there. Root causes read from the check-run
annotations:

1. `clean migrations · SQL boundaries (PG 15)` — **`error: function
   record_counter_payment(unknown, unknown, unknown, unknown, unknown) is not
   unique`** at `lib/db/readiness.integration.test.ts:1028`. Cause: main carries a
   **second overload**, `record_counter_payment(text, uuid, text, bigint, uuid, text)`,
   added by `20261121000200_upi_ref_at_mark_paid.sql`, beside the five-argument one.
   With two candidates, `unknown`-typed literals cannot be resolved. This branch has
   one signature and passes.
   *Recommended fix:* rename the six-argument RPC (`record_counter_payment_with_upi_ref`)
   and update its call sites, or drop the five-argument one and pass the reference
   explicitly everywhere. A `drop function` alone would break the UPI path.
2. `typecheck · lint · design · test · build` — the annotation only reports missing
   diagnostic logs (`restore-drill.log`, `pg-client-install.log`) and exit 1, so the
   underlying failure is masked by the diagnostics step itself.
3. `scan throttle · …`, `staff shell · …`, `64 hermetic + 49 Supabase-backed E2E …` —
   all three fail on missing artifacts (`test-results/supabase-e2e/*.json`,
   `prepare-local-supabase.log`), i.e. the local-Supabase preparation step dies
   before Playwright runs.
4. `encrypted backup → verify → B2 upload (SHA-256 verified)` — fails on main's
   hosted-backup workflow (the workflow that exists only on main and in the PR #194
   lineage).

This branch cannot repair main: it may not switch branches, push to `main`, or open
a PR. The guard added here (`supabase/checks/09_rpc_overloads.sql`) makes cause 1
impossible to merge unnoticed in any branch that replays migrations.

## D7 — deployment verified live (solved, read-only)

The Vercel connector remains `limited: true`, so the project is still invisible
through it. The public health endpoint was probed directly instead:

```
GET https://new-alpha-five-43.vercel.app/api/health   (2026-11-21T20:52:17Z)
{"ok":true,"configured":true,"serverKey":true,"reachable":true,"credentials":"accepted",
 "schema":{"trialAndWriteGate":"applied","planEntitlements":"applied","restaurantUpi":"applied"},
 "trialDays":21,
 "operational":{"orderSessions":"applied","settlement":"applied","invoices":"applied",
                "paymentReceipts":"applied","announcementClaims":"applied"}}
```

So a production deployment is up, its server key is present, the database
credentials are accepted, and the schema capabilities it probes are all applied.
What this does **not** prove: which commit is deployed (the connector cannot list
deployments), or that the deployed build matches this branch — it does not, because
this branch's migrations are not applied to production (D3).

## Also fixed in this batch

* **Lint is now 0 problems** (was 0 errors + 2 warnings): removed the unused
  `superseded` binding in `components/screens/GuestOrderEditor.tsx` and the unused
  `floorLabelRows` helper in `lib/db/cashier-screen.test.ts`.
* `scripts/local-pg/900_local_seed.sql` now takes over the trigger-provisioned card
  (the one-live-card invariant made the old insert fail).

## Verification (all re-run at this head)

| Command | Result |
|---|---|
| `npm run test:db:embedded` | **281 passed / 3 skipped** |
| `READINESS_FINANCIAL_UPGRADE=1 node scripts/verify-database.mjs` (on an embedded cluster) | 281 passed / 3 skipped — the closed-loop replay the CI job runs |
| `npm run test:db:integration` | **299 passed / 1 skipped** (13 files) |
| `npm run test:db:local` | pass — schema, checks (incl. the new overload check), 5 gated suites, 5,000-guest load |
| `npm run test:db:logical-restore` | `LOCAL_LOGICAL_RESTORE_VERIFIED`, data rows identical |
| `npm run test:recovery:cold` | `LOCAL_COLD_RECOVERY_VERIFIED` |
| `npx vitest run` | 2,614 passed / 309 skipped (2,925) |
| `npm run test:e2e:journey` | 20 passed |
| `npm run test:dr` · `test:backup` · `test:d2` · `test:staging:guards` | exit 0 |
| `npm run migrations:verify` | 123 files, 123 unique versions, 4 anchors |
| `npm run verify:release` | 47 checks OK |
| `npm run lint` | **0 problems** |
| `npx tsc --noEmit` | clean |

## What remains, and it is not code

1. **Owner authorization** to apply the 50-file batch to production (D3).
2. **Owner authorization** for the hosted recovery rehearsal (D4) — the only route
   to DR READY.
3. A dedicated pass for the PR #194 lineage port (D5), with the docs and CI wiring.
4. Repair of main's six jobs (D6), which needs branch/PR permission.
5. The B2 staging setup stays exactly as the owner reported it: accepted as done, not
   verified here (a 403 from this session would mean UNKNOWN, never "missing").
