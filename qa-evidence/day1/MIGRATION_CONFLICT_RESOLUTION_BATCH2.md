# AutoDine — Batch 2 Migration Conflict Resolution

**Review date:** 2026-11-06 UTC

**Disposition:** Source-level conflict review and fresh disposable-local replay completed. No Production/Staging database was accessed or modified. No migration was created, renamed, overwritten, committed, deployed, or applied to Staging.

## Executive findings

1. **`20261112000400` and `main:20261112000600` are sequential replacements of the same two RPCs, not alternative signatures.** Both signatures, tenant lookup, authorization policy, newest-first ordering, JSON shape, and financial fields match. `120004` correctly moves the row `LIMIT` inside the input query before `jsonb_agg`, but has no upper ceiling. `120006` adds the missing hard `1..50` ceiling without changing the row/financial semantics. The later `20261114000100` carries that ceiling forward and tightens authorization from any restaurant member to Owner/Manager. **The final `14000100` implementation is the correct effective source. No concatenated/combined function body is needed in the existing ordered migration history.**
2. **There are no literal same-version file collisions in the inspected trees.** The four named files have the same content hashes in the preserved branch and local `main`; there is one file per numeric version in both trees. There are meaningful *same-object replacements* across different versions, particularly for the subscription-history RPCs and the order-finance views.
3. **Proposed nine-file set:** eight tracked `main` files from `20261112000100` through `20261114000100`, plus the preserved worktree-only `20261115000100_rls_write_gate_role_scope.sql`. This is the only nine-file set supported by the local inventory. The additional `20261115120000_order_read_realtime_expiry_hardening.sql` is preserved separately and is **not** included in that nine-file set or the test replay.
4. **A new Staging batch cannot yet be called “already resolved.”** No environment migration ledger/catalog was queried (as required). Keep immutable source history; determine what an incremental Staging batch would contain only after separate, authorized read-only reconciliation.
5. The 84-file proposed clean replay (83 SQL migrations from `main`, then the candidate `20261115000100`) and the focused role/tenant/financial suites passed locally: **95 passed, 3 skipped, 0 failed**. One scheduler test skipped because this embedded PostgreSQL has no `pg_cron`; two PostgREST HTTP tests skipped because `PGRST_BIN` was not supplied.

## 1. References, scope and exact source identity

- Preserved Arena branch: `arena/660b8f7e-autodine`, `HEAD` `cd2e37e41372553249507eac6509c6f9d4c5415a`.
- Local `main` ref inspected without switching branches: `b385bf4c65c887e73657a93d125eb3d29d280df5`.
- `git diff --name-status main -- supabase/migrations` is empty for tracked files. All eight listed `main` migrations are byte-identical at the branch and `main` paths.
- The ninth candidate, `20261115000100_rls_write_gate_role_scope.sql`, is untracked in the preserved worktree and absent from both committed trees. It is not assumed authoritative merely because it is present.
- A separate untracked migration, `20261115120000_order_read_realtime_expiry_hardening.sql`, is also present. It was previously approved for Staging only (SHA-256 below), but that approval does not authorize this task to apply it; it is excluded from the nine-file proposal and local replay.
- The phrase “nine branch-set migrations” is interpreted as the eight tracked files below plus the worktree-only `20261115000100` file. No other nine-file manifest was found locally. If a different intended set was meant, its exact manifest remains an owner decision.
- All nine candidate filenames postdate the authoritative review date. Filenames, Git metadata, and migration ordering are **not** evidence of an environment apply or approval.

| # | Filename | SHA-256 | Source presence |
|---:|---|---|---|
| 1 | `20261112000100_schedule_subscription_expiry.sql` | `5ae4c9b508d70630fbc0687602e9b354504c1cd9d10331f01619ffbd6fb790e2` | Identical in branch and `main` |
| 2 | `20261112000200_immutable_restaurant_account_link.sql` | `6a3d620ed2030420131e8b860fef9fd2187813bb92645e3f3553bd3692ad9ffb` | Identical in branch and `main` |
| 3 | `20261112000300_report_sales_export_authorization.sql` | `968ae47c3e785f5f6596d988be7df4e200a07f562343b494c1c0952295b874a4` | Identical in branch and `main` |
| 4 | `20261112000400_bound_subscription_history.sql` | `e29d30fb4654f8ae712e60daac30bebba5450b41691d73ebf6883298c6b3c5f9` | Identical in branch and `main` |
| 5 | `20261112000500_role_scoped_order_reads.sql` | `0c7b9e3a520020142ba3abe21501a1a3ee73b8286234fa6ae45a6ae26f1128f9` | Identical in branch and `main` |
| 6 | `20261112000600_cap_subscription_history_ceiling.sql` | `bb41f597eee24017a4573221d1de7fd0bad1346f78de55625b7de79ec21f1cf5` | Identical in branch and `main` |
| 7 | `20261112000700_order_line_edit_boundary.sql` | `fd0b27034ae67c44836497844efb35441fa778aaec2b471e7239ee20bb2a82ee` | Identical in branch and `main` |
| 8 | `20261114000100_owner_manager_subscription_reads.sql` | `d352c29fae28b8dceb91d6b63d87acd4ceef4779a92f1b080534380a4ae9dcff` | Identical in branch and `main` |
| 9 | `20261115000100_rls_write_gate_role_scope.sql` | `10dd7a69899643cad50ed04378240efabbaf76f226062bf4108fd39da5042edc` | Worktree-only, untracked; absent from `main` |

Separate preserved file: `20261115120000_order_read_realtime_expiry_hardening.sql`, SHA-256 `85ba2a19d61c0f6b8e92feb7cc2b30c5e24a6b0a29a1207e033efbf769a22129`.

## 2. Exact comparison: `12000400` vs `main:12000600`

Both source files define the same two functions:

```text
public.account_subscription_history(p_restaurant_id uuid, p_limit integer DEFAULT 50) RETURNS jsonb
public.account_payment_history(p_restaurant_id uuid, p_limit integer DEFAULT 50) RETURNS jsonb
```

Both are `LANGUAGE plpgsql`, `STABLE`, `SECURITY DEFINER`, with `SET search_path = public, pg_temp`. The files are at `supabase/migrations/20261112000400_bound_subscription_history.sql` and `supabase/migrations/20261112000600_cap_subscription_history_ceiling.sql`.

### Function-level comparison

| Concern | `12000400` | `main:12000600` | Assessment |
|---|---|---|---|
| Authentication / tenant scoping | Return `NULL` if `auth.uid()` is null. Resolve `v_account` from the requested restaurant joined to a membership for `auth.uid()`; require non-null `account_id`. Return `NULL` if no account is resolved. | Same check and lookup. | Same tenant boundary. `p_restaurant_id` determines the account; the caller cannot supply an unrelated account ID. At these two stages **any** membership role is accepted. |
| Event ordering | Rows filtered by `event.account_id = v_account`, sorted `occurred_at DESC, id DESC`. | Same. | Deterministic newest-first order. |
| Payment ordering | Rows filtered by `payment.account_id = v_account`, sorted `occurred_at DESC, recorded_at DESC, id DESC`. | Same. | Deterministic newest-first order. |
| Aggregation / LIMIT placement | Inner ordered `SELECT` has `LIMIT greatest(coalesce(p_limit, 50), 1)`; outer `jsonb_agg` builds the JSON. | Inner ordered `SELECT` has `LIMIT v_limit`, where `v_limit = least(greatest(coalesce(p_limit, 50), 1), 50)`. | Both correctly limit source rows **before** JSON aggregation. `12000600` adds the missing upper ceiling. This corrects the earlier `20261110001100` shape, which put `LIMIT` on the one-row aggregate result and therefore did not bound the rows aggregated. |
| Input semantics | `NULL` -> 50; zero/negative -> 1; positive values are not capped above 50. | `NULL` -> 50; zero/negative -> 1; any value above 50 -> 50. | `12000400` leaves a direct-RPC resource-amplification path. `12000600` enforces the documented/UI maximum. |
| Payment/receipt semantics | Selects payment rows first; left-joins `subscription_receipts` after the limited payment set. Emits the same amount, status, period, provider, failure, and receipt fields. | Same row selection, projection, and post-limit receipt join. | No financial calculation, amount, currency, status, or receipt semantics change. These functions return history rows; they do not recompute or sum subscription money. |
| ACL/comment differences | Revokes `PUBLIC`/`anon`, grants `authenticated`/`service_role`; comments describe caller-provided limits. Also updates the `account_receipt` comment. | Same history RPC grants; comments explicitly document the `1..50` clamp. Does not repeat the `account_receipt` comment. | ACLs remain compatible. The receipt-comment statement in `12000400` is documentation-only and does not change the receipt function body. |

The normalized function diff from `12000400` to `12000600` is only the addition of `v_limit` and use of that clamped variable in each inner `LIMIT`; comments change to describe the cap. Authorization, query scoping, tie-break ordering, aggregation order, result keys, and financial fields are otherwise unchanged.

### Which implementation is correct? Is combining necessary?

- `12000400` is a valid intermediate improvement: it bounds aggregation by the requested limit. It is **not** a sufficient final guard because a direct authenticated caller can pass a very large integer.
- `12000600` is the correct ceiling implementation: clamp to `1..50` before the ordered inner query is aggregated. This protects both history RPCs without changing reported rows or financial values.
- `14000100` later redefines both history RPCs with that same `1..50` ceiling and adds Owner/Manager authorization. Its exact final definitions are at lines 410–466 and 468–527. The only body-level changes from `12000600` are the Owner/Manager role check and removal of the redundant membership join after that role check; the selected account still comes from the requested restaurant.
- Therefore **no single combined function migration is required to preserve the existing versioned history**: retain `12000400` as its historical step, then `12000600`, then `14000100` as the final effective source. Do not concatenate three copies of each function. If an authorized future forward repair is separately required, its one canonical function body should match `14000100`; do not edit/rename the historical files.

## 3. Same-version and same-object conflict investigation

The worktree has **no duplicate 14-digit migration version prefixes**: 83 SQL files in `main`/the tracked baseline and 85 SQL files in the current worktree, with no duplicate prefixes in either inventory. For the four named versions, branch and `main` hashes are identical. Thus no divergent same-version source collision was found. The following are the actual cross-version object overlaps:

| Version | Branch vs `main` | Objects / overlap | Conflict and resolution signal |
|---|---|---|---|
| `20261112000500` | Same SHA-256 `0c7b…`; one file per version. | Revokes table and column SELECT on `orders`/`order_items`; creates `orders_finance` and `order_items_finance`; removes orders and waiter calls from Realtime; restores default replica identity; replaces `cancel_order`. | The finance views use plain `CREATE VIEW` (lines 81 and 112), not `CREATE OR REPLACE`; applying this file twice to a database that already has the views will fail at duplicate-object creation. It is safe on the clean first replay. `15120000` later reasserts the view/ACL/publication/replica-identity subset using `CREATE OR REPLACE VIEW`, but does **not** carry the `cancel_order` replacement. It is a partial later overlap, not a full replacement for `12000500`. |
| `20261112000600` | Same SHA-256 `bb41…`; one file per version. | Replaces the two history RPCs from `12000400`/`11001100`. | Not a filename collision. It supersedes `12000400`'s unbounded input limit; `14000100` later supersedes its role policy while retaining the ceiling. |
| `20261112000700` | Same SHA-256 `fd0b…`; one file per version. | Replaces `set_order_line_quantities(uuid,jsonb,uuid)`, previously defined and serialized in earlier order migrations. | No same-version duplicate. Adds Owner/Manager/Cashier staff authorization and checks `restaurant_can_write` before payment/kitchen guards; guest-token edits remain. No later file in the nine-file candidate set replaces this function. |
| `20261114000100` | Same SHA-256 `d352…`; one file per version. | Replaces subscription/account read functions and account-related policies/column grants; also defines `has_account_role`, role-scoped outlet count, and operational-vs-billing entitlement projections. | No same-version duplicate. This is the final subscription-read implementation, not an alternate spelling of `12000600`. It must remain after the earlier history steps in a clean chronological replay. |

### Separate later worktree artifact: `20261115120000`

This preserved, untracked file partially converges the `12000500` order boundary and `12000100` expiry scheduler: it uses `CREATE OR REPLACE VIEW`, reasserts order grants/publication/replica identity, and checks for an existing correctly configured pg_cron job before scheduling. It does **not** replace `cancel_order`, so it cannot replace all of `12000500` by itself. It is excluded from the nine-file test sequence and this task's proposed Staging batch. Its prior Staging-only approval is not permission to apply it here; it remains untouched.

## 4. Nine-file dependency graph and replay/idempotency review

### Dependency graph

```text
Earlier source foundations (all present in local main)
  20261026001100 has_restaurant_role / restaurant_can_write
      ├──> 20261112000300 report_sales role predicate
      ├──> 20261112000500 finance-view predicates / cancel_order
      ├──> 20261112000700 line-edit authorization and write gate
      ├──> 20261114000100 account/role-scoped reads
      └──> 20261115000100 RLS/write-gate policies

  20261110001000 account schema + restaurants.account_id
      ├──> 20261112000200 immutable account-link trigger
      └──> 20261114000100 account-level RLS and projections

  20261110001100 billing tables, expire_subscriptions(), history/receipt RPCs
      ├──> 20261112000100 optional pg_cron scheduler
      ├──> 20261112000400 pre-aggregation history bound
      │       └──> 20261112000600 hard 1..50 ceiling
      │               └──> 20261114000100 final Owner/Manager history definitions
      └─────────────────────────────────────────────────────> 20261114000100

  Earlier orders/order_items/order_sessions/payments/publication schema
      ├──> 20261112000500 views, ACLs, publication and cancel_order
      └──> 20261112000700 set_order_line_quantities

Chronological candidate tail
  20261112000100 -> 12000200 -> 12000300 -> 12000400 -> 12000500
                -> 12000600 -> 12000700 -> 14000100 -> 15000100

Related but outside the nine-file set
  12000100 + 12000500 --partial overlap--> 20261115120000 (preserved; excluded)
```

The arrows from the account/billing/role foundations are required object dependencies; the chronological tail is the clean sorted order, not evidence of historical environment application. `12000600` has a same-signature foundation in `11001100`, but follows `12000400` in this source history so its intended replacement relationship is explicit. `15000100` depends on the already-created tables, role helpers, active-restaurant helper, and write gate.

### Per-file purpose, supersession and repeatability

| Version | Purpose / dependency | Replacement or repeatability notes |
|---|---|---|
| `12000100` | Schedule `expire_subscriptions()` every 15 minutes if pg_cron is already installed and the three-argument scheduler function exists. | No explicit job existence/name/schedule reconciliation in this file; it calls `cron.schedule` on every execution. The exact behavior of repeat scheduling depends on pg_cron. Local pg_cron is absent, so the scheduler branch was not exercised. Compare with the separate, guarded `15120000` only after owner approval. |
| `12000200` | Trigger function for authenticated changes to `restaurants.account_id`; depends on the account-link column and `auth.uid()`. | `CREATE OR REPLACE FUNCTION` plus `DROP TRIGGER IF EXISTS`/`CREATE TRIGGER`; safe to reassert from source. Trigger rejects only a changed account link with a non-null user subject; other settings and trusted migration/service paths are unchanged. |
| `12000300` | Owner/Manager and 10,000-order-cap `report_sales` replacement; depends on base RPC and `has_restaurant_role`. | `CREATE OR REPLACE FUNCTION`; keeps existing function ACL. No duplicate object creation. It changes access policy and order-detail bound, not report-wide financial semantics. |
| `12000400` | Move event/payment history limit before JSON aggregation; depends on `11001100` history tables/functions. | `CREATE OR REPLACE FUNCTION`; grants/revokes are repeatable. It is intentionally an intermediate, not ceiling-protected final body. |
| `12000500` | Order/line read projections, base-table ACLs, publication and `cancel_order`. | `CREATE VIEW` twice is non-idempotent on reapplication. Policy-free ACL changes and replica identity are repeatable; publication `DROP TABLE` is conditional. Preserve the historical file and do not manually reapply it against an existing view. |
| `12000600` | Clamp both subscription history RPC limits to 1..50 before aggregation. | `CREATE OR REPLACE FUNCTION`; safe replacement of `12000400`. Same row/financial projection. |
| `12000700` | Gate staff line edits by role/write entitlement while retaining token-bound guest edits. | `CREATE OR REPLACE FUNCTION`; replaces earlier `set_order_line_quantities`; grants are explicit. No duplicate relation/policy creation. |
| `14000100` | Owner/Manager-only billing state/history/receipts and RLS, plus safe restaurant column projection and staff operational entitlement projection. | Function replacements, explicit grants, and drop-then-create policies. Dynamic column grants deliberately clear API-role column ACLs before rebuilding the allow-list; review any future `restaurants` columns separately. |
| `15000100` | Reassert authenticated menu/table management policies, public published-menu reads, and remove anon execution of `restaurant_can_write`. | Worktree-only, absent from `main`; policies are dropped before creation and grants are repeatable. It passed in the candidate local replay but needs owner approval as canonical source. |

## 5. Canonicalization proposal

This is a **source proposal**, not an apply list. “Keep unchanged” means retain the existing file/version as historical source; it does not assert that Staging has or has not applied it.

| File | Proposed category | Proposed treatment |
|---|---|---|
| `20261112000100_schedule_subscription_expiry.sql` | **Requires owner decision** | Keep the file immutable for now. Decide whether the simple schedule call is intended to coexist with the separate guarded scheduler in `15120000`; confirm desired single-job behavior before preparing any environment batch. |
| `20261112000200_immutable_restaurant_account_link.sql` | **Keep unchanged** | Retain the trigger guard and its existing version. No competing same-version source found. |
| `20261112000300_report_sales_export_authorization.sql` | **Keep unchanged** | Retain Owner/Manager authorization and 10,000 detail cap; focused report tests pass. |
| `20261112000400_bound_subscription_history.sql` | **Keep unchanged (historical predecessor)** | Do not overwrite or rename. It is superseded by 006/140001 in a clean ordered replay; do not select it alone as the final implementation. |
| `20261112000500_role_scoped_order_reads.sql` | **Keep unchanged (apply once only)** | Retain the full boundary including `cancel_order`. Its plain `CREATE VIEW` makes manual reapplication unsafe. If a future repair is needed, use a **new** reviewed forward migration rather than edit this file. |
| `20261112000600_cap_subscription_history_ceiling.sql` | **Keep unchanged (forward ceiling step)** | Retain as the 004 successor. Its cap is preserved by 140001. Do not combine/rewrite old versions. |
| `20261112000700_order_line_edit_boundary.sql` | **Keep unchanged** | Retain staff/guest authorization ordering and write-gate behavior. No alternate same-version source found. |
| `20261114000100_owner_manager_subscription_reads.sql` | **Keep unchanged (final subscription source)** | Use this as the effective Owner/Manager history/RLS implementation. It incorporates the 50 ceiling; no separate combined history function is needed. |
| `20261115000100_rls_write_gate_role_scope.sql` | **Requires owner decision** | The file exists only as an untracked worktree artifact, not in `main`; local tests pass, but that does not approve its inclusion in a future batch. Preserve it until an owner accepts/rejects the source set. |

**Not assigned:** No file is labeled **Exclude as already resolved** for Staging because there is no authorized migration-ledger/catalog evidence. The later source replacement in `14000100` proves source-level supersession, not environment state. No **Combine into one canonical source** action is required for the existing history. No migration has been created as a “replacement” in this task. If a future read-only reconciliation proves drift, make a new forward-only artifact with a new reviewed version and complete final body; never overwrite or silently rename these files.

**Separate artifact `20261115120000`:** keep preserved and outside this nine-file proposal. Its prior Staging-only approval does not authorize application under this task. Owner decision is required before any future inclusion or use as a canonical replacement; it is only a partial replacement for `12000500`.

## 6. Fresh disposable-local validation

### Replay sequence

- Started a new embedded PostgreSQL cluster on loopback. Server: **PostgreSQL 17.11**.
- Created a random disposable database `autodine_check_*`, installed the repository's local Supabase role/auth shim and local default grants, then replayed in filename order:
  1. all **83 SQL migrations from local `main`** (including the full historical base and the eight tracked candidate migrations), and
  2. the worktree-only candidate `20261115000100_rls_write_gate_role_scope.sql` as migration 84.
- Applied the owner-correct local `supabase_admin` default-privilege operation used by the repository's verifier.
- **Did not replay** the separate `20261115120000` file.
- Replay completed without SQL/dependency errors; the random test database and embedded cluster were dropped/destroyed in the runner's `finally` cleanup.

### Targeted test results

| Suite | Result | Relevant evidence |
|---|---:|---|
| `lib/db/subscription-billing.integration.test.ts` | 34 total; 33 passed, 1 skipped | 60 synthetic events/payments requested with `p_limit=500` return exactly the newest 50 in deterministic order; Owner/Manager receive billing history/amounts/receipts; Cashier/Kitchen, guests and outsiders do not; account cross-tenant reads return null/empty; payment/receipt amount and billing invariants also pass. |
| `lib/db/report-sales.integration.test.ts` | 17 passed | Owner/Manager success; Cashier/Kitchen and unrelated tenant denied; 10,002 synthetic orders produce 10,000 max order details at an oversized input while full-range bill/billed totals remain complete; the tested billed amount is 1,000,200 paise. |
| `lib/db/order-read-boundary.integration.test.ts` | 11 total; 9 passed, 2 skipped | Role/tenant projections, financial-column restrictions, line-edit/cancel guards and write-gate paths pass. Two direct PostgREST HTTP checks were skipped because `PGRST_BIN` was not configured. |
| `lib/db/restaurant-account-link.integration.test.ts` | 8 passed | Client account-link immutability and permitted non-link restaurant updates pass. |
| `lib/db/phase0-security.integration.test.ts` | 28 passed | Baseline role/RLS security checks pass with candidate `15000100` applied. |
| **Total** | **95 passed, 3 skipped, 0 failed** | Five test files; fresh disposable DB. |

The one scheduler skip is explicit in the test: `cron.job` is absent because embedded PostgreSQL does not package `pg_cron`. Consequently, `12000100` took its documented no-extension path, and actual job uniqueness/schedule was **not** tested locally. The two PostgREST skips mean SQL role tests passed, but API/JWT behavior was not validated through a running PostgREST server.

The report-sales fixture contains synthetic order totals but no payments/order lines, so this suite verifies bill/billed totals and the list cap, not every tax/refund/category calculation. The subscription-billing suite separately exercises payment amounts, receipts, and billing semantics. No hosted behavior is claimed.

### Validation caveats

- The preserved worktree has **85 SQL files**, while the modified `scripts/e2e/prepare-local-supabase.mjs` still asserts exactly **83** repository migrations (lines 88–100). It enumerates/applies the directory before checking that count, so running it against this worktree would reach a stale-count failure after applying the added files. This runner was not invoked or modified; reconcile its manifest/count only after the nine-file set is approved.
- No migration filename in the nine-file set is GST/IRP-specific. The clean local baseline replay did include the existing `20261108002000_invoice_receipts.sql`, whose source mentions `gst_tax_invoice` while explicitly keeping GST tax invoices fail-closed. No GST/IRP feature change was authored; no hosted environment was touched. If “No GST/IRP migrations” is meant to prohibit even replaying a historical baseline file containing that token, that scope interpretation must be clarified before further replays.
- A non-failing `pg` client deprecation warning appeared during the run; Vitest completed successfully.

## 7. Unresolved owner decisions / safe next step

1. Confirm the intended nine-file manifest (this report's interpretation is the eight tracked `12000100`–`14000100` files plus worktree-only `15000100`).
2. Decide whether `15000100`, currently untracked and absent from `main`, is part of the reviewed source set.
3. Decide whether the separate guarded `15120000` artifact belongs in a future sequence alongside `12000100`/`12000500`, after considering its partial overlap and separate Staging-only approval.
4. Clarify the intended `pg_cron` one-job behavior. Local runtime verification was unavailable; no live job state was inspected.
5. Before any future Staging batch, obtain separately authorized read-only migration ledger and catalog evidence. Only then decide what is pending, already applied, or needs a new forward-only repair. Do not infer from filenames or this local replay.
6. Reconcile the local Supabase prep script's 83-file invariant with the approved canonical manifest before using that runner.

**Safety record:** No Production SQL, hosted SQL, credentials, Staging database access, Staging migration application, deployment, merge, or commit occurred. No dedicated GST/IRP migration was authored or applied as part of the candidate set; the existing invoice-receipts baseline caveat above applies to the disposable local replay. All pre-existing worktree changes and the separate approved-hash migration were preserved.