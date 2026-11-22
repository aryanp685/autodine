# D1–D7 remediation, 2026-11-21

Every item below was executed in this session on branch `arena/ce32f7c8-autodine`.
Nothing was merged, no PR was opened, nothing was deployed, and no production row,
setting, bucket or secret was written. The only production interaction was
read-only SQL through the Supabase connector plus one read-only HTTPS GET to the
public health endpoint.

Head before this batch: `2ecb12e`. Migration inventory: **130 files** — 123 at the head of this batch, plus `main`’s 8 ported in and one local duplicate removed (see §D8).

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

Production's ledger held **124** rows when this was first measured on 2026-11-21 and holds
**160** at the same day's later check — production moved. The repository now holds **130**
files and **22** are not in production's ledger: the 20-file GST/IRP block
(`20261118000200`–`20261118002100`) and the two renumbered QR files. The 51-file list this
section used to carry is obsolete; regenerate rather than trust a number in prose. That is the real size of the gap —
the earlier "29 missing RPCs" was the symptom, not the cause.

Ordered apply list (**51 files**, chronological — regenerate rather than copy, it is
derived: `npm run release:apply-plan -- --ledger <ledger-dump.txt>`):

```
20261110000851_payment_audit_provider_actor            20261114000300_gst_mode_gates                          20261118001000_gst_irp_readiness
20261110000950_online_payment_attempt_uniqueness       20261114000400_restrict_trigger_functions_execute      20261118001100_gst_reconciliation
20261110001210_checkout_outstanding_guard              20261114000500_credit_debit_notes                      20261118001200_gst_review_lifecycle
20261110001220_revoke_client_bypass_privileges         20261114000600_einvoice_issuance_profile               20261118001300_gst_direct_fulfilment
20261112000200_immutable_restaurant_account_link       20261115000100_fix_redeem_staff_invite_status_returns  20261118001400_gst_irp_rehearsal_store
20261112000300_report_sales_export_authorization       20261115000200_owner_billing_configuration_guard       20261118001500_gst_finance_scope
20261112000400_bound_subscription_history              20261115000300_audit_restaurant_account_reassignment   20261118001600_gst_document_particulars
20261112000500_role_scoped_order_reads                 20261116000100_revoke_client_maintain_privileges       20261118001700_gst_irp_rehearsal_recovery
20261112000501_serialize_outlet_creation               20261118000100_merge_boundary_gst_order_line_edits     20261118001800_irp_execution
20261112000600_cap_subscription_history_ceiling        20261118000200_gst_configuration_boundary              20261118001900_irp_document_projection
20261112000601_serialize_subscription_payments         20261118000300_gst_pricing_boundary                    20261118002000_guest_checkout_integrity
20261112000700_order_line_edit_boundary                20261118000400_gst_document_integrity                  20261118002100_operational_realtime
20261112000701_serialize_subscription_expiry           20261118000500_gst_document_report                     20261118002200_qr_code_staff_boundary
20261113000100_gst_two_mode                            20261118000600_gst_ca_onboarding                       20261119000100_restore_receipt_helper_boundary
20261114000100_owner_manager_subscription_reads        20261118000700_gst_ca_documents                        20261122000100_announcement_claim_recovery
20261114000101_gst_b2b_einvoice_readiness              20261118000800_gst_outlet_activation                   20261122000200_qr_one_active_cleanup
20261114000200_irp_reconciliation                      20261118000900_gst_recipient_documents                 20261122000300_qr_one_active_per_table
```

The tool reads a ledger dump (pipe-separated versions, or JSON with `name`) and emits
this list plus the before/after verification SQL; `--json` is machine-readable and
`--check` exits 1 while anything is pending, so a release gate can use it. It also
reports the **52** production ledger rows that have no same-version repository file —
those were applied by an earlier ad-hoc path and are why ledger-vs-file parity was
never provable. They are listed, never silently absorbed.


**Collision audit (read-only, against production's catalog).** Every object those
files create without `IF NOT EXISTS` was probed on production:

* 16 tables — `to_regclass` returns null for all of them (no collision);
* 5 indexes (incl. `restaurant_invoices_series_sequence_unique`) — absent;
* 15 `ALTER TABLE ADD COLUMN` statements — none of those columns exists.

So the batch is structurally applicable; it is **not** applied, because a production
schema change is a deploy and this session has no authorization for one.

**Before applying, the owner should:** take a logical backup (the drill in this
branch now proves that artifact restores with data), run the 51 files in this order,
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

## D3a — the apply was rehearsed against a production-shaped database (and why it stops there)

A chain that replays from empty proves the chain, not the push. Production is the
subset its ledger records — 160 rows, 108 of which map to a file here and 52 of which
were applied out of band — so the rehearsal builds exactly that subset and then
applies the pending files on top:

```
node scripts/local-pg/rehearse-prod-apply.mjs --ledger <prod ledger>
ledger rows:            160
replayable from ledger: 108
applied out of band:    52 (no repository file; skipped)
pending:                22
production baseline: 108/108 replayed
pending applied:     22/22
verification:        {"gst_irp_tables":"9","qr_index":"1","advisory_functions":"2","counter_payment_signatures":"1"}
REHEARSAL OK: every pending migration applied to a production-shaped database
```

That is the evidence the 22 fit: every file lands on the schema production actually
has, in order, and the four invariants the release plan checks come back correct.

**The apply itself is not done, and the reason is a missing credential, not a missing
plan.** Two independent facts, both produced here:

- Dispatching the repository's own `Hosted backup (B2)` workflow against production
  fails closed in 40 seconds:

  ```
  Missing required repository secrets: AUTODINE_BACKUP_SOURCE_URL
  — configure them under Settings -> Secrets and variables -> Actions. No backup was attempted.
  ```

  (The step before it, `Install the PostgreSQL 17 client tools`, succeeded on a real
  runner — the ported composite action works on GitHub, not just locally.)

- The Supabase connector can execute SQL against production but cannot carry this
  batch: 22 files are ~250 KB of DDL. Re-typing that into a query console is how a
  controlled rollout becomes an incident, so it was not attempted.

What the owner does, in order, once `AUTODINE_BACKUP_SOURCE_URL` and the four B2
secrets exist or a `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` pair is configured:

```
npm run release:apply-plan -- --ledger <ledger dump>     # prints the 22 in order + verification SQL
supabase link --project-ref bdbaqpevwmgdvghszjno
supabase db push                                          # applies only those 22, records ledger rows
# then run the three verification queries the plan prints
```

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

**Second pass, same day — the drill now asks the restored database the questions the
product asks, and that caught a fifth dumper defect.** Comparing catalogs is not
enough: a database can carry every table, row, policy and function and still be
unusable. The drill now connects to the restored database, inserts one profile and one
membership, and asks, as PostgREST would:

```
restored policies still enforce tenant isolation:
  {"memberRows":1,"strangerRows":0,"anonDenied":true}
```

The first run of that probe failed with `permission denied for table table_qr_codes`
for a legitimate member. Root cause: `lib-dump.mjs` emitted function EXECUTE ACLs but
**never table or sequence privileges** — a restore produced a database where RLS would
allow the read but the role had no `GRANT`. On Supabase the target's *default*
privileges would have made it worse in the other direction, handing `anon` and
`authenticated` everything. The dump now emits, per relation, an explicit
`revoke all … from public, anon, authenticated, service_role` followed by the exact
`GRANT` list read from `relacl`. The drill asserts member=1 / stranger=0 / anon=42501
on the restored database, and reports `securityRestoreVerified` in its JSON.

**Hosted side, probed on 2026-11-21:** the restore drill cannot run yet, and not because
of the drill. `Hosted backup (B2)` has never run — its first dispatch from here (run
44998836032) failed closed in 40 s naming the one missing secret,
`AUTODINE_BACKUP_SOURCE_URL`, so there is no artifact in B2 for the drill to download.
Supabase branching was tried as an alternative hosted copy of production and refused
with `entitlement_required`: "Branching is supported only on the Pro plan or above".
So the hosted rehearsal needs one owner action — configure the five backup secrets
(`AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`,
`B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY`) — after which both buttons exist and the
pipeline is already proven end to end locally, with data and with policies.

Still missing for DR READY (unchanged, and it is the only thing that can change it):
a **hosted** restore rehearsal against an authorized target (P3–P5 of
`docs/pitr-verification-procedure-2026-11-14.md`), measured RPO/RTO, and a proven
alert. Authorization for that has not been given, so it was not attempted.

## D5 — closed PR #194 lineage (ported; 230 assertions green)

The branch behind closed PR #194 (`arena/88c342c2-autodine`) had moved on: its head
is now `8e9a701`. Against this branch it held **33 additive infrastructure files**,
**19 modified backup scripts** and `.github/actions/postgres-client/*`.

That port is now **done**, as one coherent change rather than a fragment:

| Landed | What it buys |
|---|---|
| `scripts/backup/*` (48 files) | the whole refactored pipeline: pg client resolution (`lib-pg-client`), service-file URLs (`lib-pg-service`), source guard (`lib-backup-source`), mode selection (`lib-backup-mode`), B2 read (`lib-b2-read`), restore-target guard (`lib-restore-target`), redacted errors (`lib-backup-error`), rehearsal comparison, staging-source validation, disposable-target preparation |
| 20 test suites, **230 assertions** | `test:dr` is now `node --test scripts/backup/*.test.mjs scripts/release/*.test.mjs` — the wiring tests (docs ↔ code ↔ workflows) are what keep the rest honest |
| `.github/actions/postgres-client` | one pinned PostgreSQL client (17) installed *and verified* in CI, the hosted backup and the restore drill, so a dump and its restore can never disagree about the archive format |
| `hosted-backup.yml`, `hosted-restore-drill.yml` | use that action; the drill now prepares the disposable container explicitly and labels the restore duration as "not end-to-end RTO" |
| `staging-b2-rehearsal.yml` | the gated B2 rehearsal, with an **exact-code gate**: a manifest of the 53 pinned files, byte for byte, before any credential is materialised. The manifest is regenerated from this tree (the test recomputes it and fails on drift) |
| `docs/operations/B2_OWNER_CHECKLIST.md` | the owner-facing checklist the tests hold against the workflows |
| `yaml@^2.9.1` (dev) | the wiring tests parse workflows instead of grepping text |

Two fixes from this branch were **re-applied on top of their `lib-dump.mjs`**, because
their fork predates them:

1. **Raw date/time text** (`RAW_TEXT_OIDS` + `types: rawTimeTypes`): their version
   went back to letting the driver parse `timestamptz`, which truncates
   microseconds. Their own `taken_at.toISOString()` call broke immediately once the
   parser was restored — evidence that the two lineages really had diverged.
2. **Relation ACLs** (`relacl` → `revoke`/`grant`): without it the restored database
   is unusable, which the drill's security probe reports as
   `permission denied for table table_qr_codes`.

Evidence at this head:

```
npm run test:dr           230 passed / 0 failed (was 6 files before the port)
npm run test:backup       backup selftest: ALL CHECKS PASS (15 checks)
npm run test:db:logical-restore
                          LOCAL_LOGICAL_RESTORE_VERIFIED {migrations:123, tables:64,
                            policies:63, functions:236, dataRestoreVerified:true,
                            securityRestoreVerified:{memberRows:1,strangerRows:0,anonDenied:true}}
npm run test:recovery:cold LOCAL_COLD_RECOVERY_VERIFIED {migrations:123, tables:68}
```

Still not taken from that lineage, deliberately: its `ci.yml` additions that depend
on files this branch does not carry (demo-seed isolation, hermetic browser count,
`print-test-failure-annotation`). Those are CI-ergonomics changes, not DR capability,
and they would have to land with their own scripts and workflow steps.

## D6 — main's red jobs (fixed upstream; this branch was never affected)

`main` is now green: at `3b1ca5b`, `CI`, `E2E (browser)`, `Throttle` and `TTS Smoke`
all pass. The duplicate `record_counter_payment` overload was removed upstream in
`20261121000200_upi_ref_at_mark_paid` + `20261122000100_single_counter_payment_function`
(drop the five-argument function; the six-argument one takes
`p_upi_ref text default null`, so both shapes resolve). The guard added here
(`supabase/checks/09_rpc_overloads.sql`) now protects both lineages.

This branch never carried the defect: its chain defines exactly one signature, and
the guard fails the build if a second overload ever appears. The UPI-reference
*requirement* was **not** ported: this branch's cashier UI does not collect a
reference, so requiring one would turn every UPI settlement into a runtime error.
The attempt is worth recording because the gate caught it immediately —
`lib/db/readiness.integration.test.ts` failed with `UPI transaction reference is
required.` and the migration was withdrawn rather than special-cased.

Merge impact (recorded, not acted on — merging is out of scope): `main` has 8
migrations this branch lacks, this branch has 23 `main` lacks, and the version
prefix `20261122000100` is used by two different files. That renumbering is a merge
decision.

`main`'s one remaining red is `Disposable Supabase E2E and load` (run 44987998244):
the `prepare-local-supabase` step emits no log and the Playwright JSON never appears
(`ENOENT test-results/supabase-e2e/integration-results.json`) — an infrastructure
failure before any assertion, in a workflow this branch does not run.

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
| `npm run test:db:logical-restore` | `LOCAL_LOGICAL_RESTORE_VERIFIED` — 130 migrations, 64 tables, 63 policies, 241 functions, data rows identical, `securityRestoreVerified {memberRows:1,strangerRows:0,anonDenied:true}` |
| `npm run test:recovery:cold` | `LOCAL_COLD_RECOVERY_VERIFIED` |
| `npx vitest run` | 2,614 passed / 309 skipped (2,925) |
| `npm run test:e2e:journey` | 20 passed |
| `npm run test:dr` · `test:backup` · `test:d2` · `test:staging:guards` | exit 0 (`test:dr` is now **230** assertions: 20 backup suites + the apply-plan suite; selftest ALL CHECKS PASS, 15 checks) |
| `npm run release:apply-plan -- --ledger <prod ledger>` | 130 repo files vs **160** ledger rows → **22 pending**, 108 applied, 52 ledger rows with no repository file |
| `npm run migrations:verify` | 130 files, 130 unique versions, 4 anchors |
| `npm run verify:release` | 47 checks OK |
| `npm run lint` | **0 problems** |
| `npx tsc --noEmit` | clean |

## What remains, and it is not code

1. **Owner authorization** to apply the 51-file batch to production (D3).
2. **Owner authorization** for the hosted recovery rehearsal (D4) — the only route
   to DR READY.
3. A merge decision for `main`: 8 migrations it has, 23 it does not, and one
   colliding version prefix (`20261122000100`).
4. The B2 staging setup stays exactly as the owner reported it: accepted as done, not
   verified here (a 403 from this session would mean UNKNOWN, never "missing").
