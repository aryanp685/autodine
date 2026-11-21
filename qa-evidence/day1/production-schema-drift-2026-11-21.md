# Production schema drift, read-only census — 2026-11-21

Read-only. Every number below comes from `select` statements executed through the
Supabase connector against the two projects visible to this session. Nothing was
written, no migration was applied, no secret was read.

Projects: `autodine-production` = `bdbaqpevwmgdvghszjno` (ap-south-1, PG 17.11.0.003),
`autodinetest` = `juwyhslzchjevqkdvwjm` (ap-northeast-2, PG 17.11.0.018).

## 1. Ledger counts

| Target | `schema_migrations` rows | Newest version | `public` functions |
|---|---|---|---|
| production | **124** | `20261120190553` | 122 |
| autodinetest | **15** | `20261120190520` | 112 |
| this branch (files) | **120** | `20261119000300` | — |

The repository is no longer a superset of production.

## 2. Three production migrations have no repository file

| Version | Name | Exists as a file on `main`? | On this branch? |
|---|---|---|---|
| `20261119101116` | `announcement_claim_recovery` | no | no |
| `20261120190546` | `qr_code_staff_boundary` | no | no |
| `20261120190553` | `qr_owner_management` | no | no |

They were applied out of band on 2026-11-19/20 (SQL editor, most likely), so
production's state cannot be rebuilt from either branch, and `db push` cannot
tell that the objects already exist.

`20261120190546`'s own header says: *"AutoDine — migration 20261118002200: QR code
staff boundary (F-01/F-02/F-03)"* — i.e. it is the repository file
`supabase/migrations/20261118002200_qr_code_staff_boundary.sql` (this branch only)
executed under a different, later version number.

## 3. Is the QR vulnerability closed in production? Yes — with more than the repo has

Membership gate, advisory lock and grants, read from `pg_proc`:

| Function | `has_restaurant_role` | `pg_advisory_xact_lock` | EXECUTE grantees |
|---|---|---|---|
| `rotate_table_qr_code(uuid)` | yes | yes | `authenticated`, `postgres`, `service_role` |
| `retire_table_qr_code(uuid)` | yes | yes | `authenticated`, `postgres`, `service_role` |
| `restore_table_qr_code(uuid)` | yes | yes | `authenticated`, `postgres`, `service_role` |
| `issue_table_qr_code(...)` | n/a | n/a | `postgres`, `service_role` |
| `revoke_table_qr_code(...)` | n/a | n/a | `postgres`, `service_role` |

Concurrency invariant present on production and on `autodinetest`:

```
CREATE UNIQUE INDEX table_qr_codes_one_active_per_table
  ON public.table_qr_codes USING btree (table_id) WHERE (revoked_at IS NULL)
```

**The repository has neither the advisory lock nor that index.** The branch file
`20261118002200_qr_code_staff_boundary.sql` contains `has_restaurant_role` gates
(F-01/F-02) but:

* no `pg_advisory_xact_lock` (0 occurrences in the file), and
* no `create unique index ... table_qr_codes_one_active_per_table` (the name does
  not appear anywhere under `supabase/`).

## 4. Consequence — a real downgrade hazard

`supabase db push` applies every version it finds missing from the ledger,
regardless of its position relative to the ledger maximum. `20261118002200` is
missing from production's ledger. Applying this branch to production would
therefore run it *after* production's newer `20261120190546`, and its
`create or replace function public.rotate_table_qr_code/retire_table_qr_code`
would **replace the locked bodies with unlocked ones** — silently removing the
F-03 race protection that production has today. The index would survive (it is a
separate object and the file never touches it), the lock would not.

Also absent from the repository but present on production:
`restore_table_qr_code(uuid)` (from `20261120190553`), the whole owner-side
restore surface behind the new "one active card per table" rule.

Fix that must precede any push (owner decision, not taken here):

1. Capture the three production statements
   (`select version, statements from supabase_migrations.schema_migrations where version in (...)`)
   and either
   a. commit them verbatim as `supabase/migrations/20261119101116_*.sql`,
      `..._20261120190546_*.sql`, `..._20261120190553_*.sql` and delete
      `20261118002200` (its content is a strict subset), or
   b. keep `20261118002200` but rewrite it to be at least as strong as the
      production text (advisory lock inside both functions, plus
      `create unique index if not exists table_qr_codes_one_active_per_table`),
      accepting that its version number then sits below production's maximum.
2. Only then run `supabase db push` (or the SQL editor) with a before/after
   ledger and `pg_proc` diff.

## 5. Why option (b) is not a five-minute edit here

Adding the unique index to the repository turns 72 of 280 embedded tests red
(`npm run test:db:embedded`: 72 failed / 104 passed / 104 skipped, exit 1). The
first failure is

```
error: duplicate key value violates unique constraint "table_qr_codes_one_active_per_table"
  at app/menu/throttle-db.integration.test.tsx:247
```

because `dining_tables` already carries `after insert ... execute function
public.ensure_table_qr_code()`, which provisions one live card per table. The
fixtures then insert a second live card by hand, so they model a state the
production schema forbids. The index experiment was reverted (`20261122000100`
removed, manifest back to 120, `verify:release` 47/47 green) and the fixture
rework is listed as pending work instead.

Fixture sites that insert their own live card (12 sites, 7 files) — each must
read the trigger-provisioned token instead:

| File | Lines |
|---|---|
| `app/menu/throttle-db.integration.test.tsx` | 248, 256 |
| `lib/db/credit-debit-notes.integration.test.ts` | 46 |
| `lib/db/gst-two-mode.integration.test.ts` | 53, 1207 |
| `lib/db/operational-realtime.integration.test.ts` | 63, 231, 242 |
| `lib/db/p5-cross-module.integration.test.ts` | 37 |
| `lib/db/phase0-security.integration.test.ts` | 53 |
| `lib/db/readiness.integration.test.ts` | 27, 549 |

## 6. Code → production function parity

83 distinct `rpc('...')` names are called from `lib/`, `app/`, `scripts/` and
`.github/`; **29 of them do not exist on production**:

`call_verified_waiter_at, choose_irp_route, floor_service_snapshot,
get_guest_order_status, issue_invoice_note, list_gst_direct_destinations,
list_gst_direct_prep_routes, list_gst_irp_preflights, list_gst_outlet_deferrals,
list_my_waiter_outlets, list_order_floor_labels,
list_restaurant_irp_reconciliation, place_gst_direct_ticket,
public_order_pricing, queue_irp_dispatch, read_active_irp_document,
read_irp_dispatch, read_verified_waiter_state, record_gst_irp_preflight,
record_gst_outlet_deferral, report_gst_documents, report_gst_finance,
report_irp_register, request_irp_dispatch_action, save_restaurant_gst_buyer,
save_restaurant_gst_config, set_guest_order_lines_at_version,
transfer_open_sitting, void_invoice_note`

All 29 are defined in repository migrations, so they are *pending*, not missing
from the design: producing a build from this branch and pointing it at production
would break GST/IRP, waiter and floor paths until those migrations are applied
and verified. Deploying this branch to production stays blocked on that.

## 7. Reconcile tool output (informational, local replay only)

`node scripts/reconcile/reconcile-migrations.mjs staging` replays an embedded
"staging-shaped" history; it connects to no hosted target. Exit 1 with four
`REVIEW` lines:

* 4 pending files are older than the newest bundled migration
  (`20261108007*`–`20261108010000_invoice_share_links.sql`);
* `20261109000400_order_write_boundary.sql` was edited after bundling;
* the staging-shaped history differs from a clean replay in 9 objects — all of
  them `qr_verification_attempts_legacy_<timestamp>` (the rename target) plus its
  sequence/constraint/index;
* 75 of 120 repository migrations have no hosted ledger record, so hosted state
  is unknown from inside the repository.
