# D1 — restaurant↔account link immutability: inventory, enforcement, operator runbook (2026-11-15)

**Status: code complete and locally proven on disposable PostgreSQL 17. NOT applied to any hosted project.**
Production (`bdbaqpevwmgdvghszjno`) and staging (`juwyhslzchjevqkdvwjm`) are untouched by this document and by the migrations it describes. Applying anything hosted requires the owner authorization named in `docs/production-release-baseline-2026-11-14.md` §7 (this is release Phase A item 22 / the `20261112000200` guard).

## 1. Every identified account-link mutation path

| # | Path | Kind | Status after this batch |
|---|---|---|---|
| 1 | `create_account_with_restaurant()` (`20261010001000` family, re-serialized `20261112000500`) | INSERT of the first restaurant, `account_id` set at creation | **Allowed, by design.** BEFORE UPDATE trigger cannot fire on INSERT; signup unchanged. |
| 2 | `create_outlet()` (re-serialized `20261112000500`) | INSERT of an additional outlet with the caller's existing `account_id` (or a fresh first-outlet bootstrap account) | **Allowed, by design.** Plan-limit + advisory-lock logic unchanged. |
| 3 | `20261110001000_account_subscriptions.sql` legacy backfill DO-block | One-time `UPDATE restaurants SET account_id = …` for every pre-subscription row, run as the migration role | **Allowed, by design and by ordering.** Runs before the guard in the release sequence (baseline §5.1 item 6). |
| 4 | Any authenticated client `UPDATE restaurants … SET account_id` (owner "detach" to NULL — the write-gate bypass; manager "reassign" into the target account — the entitlement/RLS leak) | Direct PostgREST/SQL write | **REJECTED with 42501** by `restaurants_account_id_immutable` (migration `20261112000200`). Regression: `lib/db/restaurant-account-link.integration.test.ts`, pre-guard proof in `scripts/verify-account-link-guard.mjs`. |
| 5 | Trusted maintenance / reviewed operator repair (service_role where RLS-bypassed, or superuser SQL as the migration runner) | Reassign / backfill after the fact | **Allowed and now AUDITED** by migration `20261115000300`: every applied change writes an append-only `restaurant_account_link_audit` row (restaurant, before/after `account_id`, actor role, actor sub, timestamp). Regression: `lib/db/account-link-audit.integration.test.ts`. |
| 6 | Application code | — | **No path exists.** No UI, server action, or RPC transfers a restaurant between accounts; `lib/db/staff.ts` only reads `account_id` (entitlement context); `lib/db/database.ts` carries types only. Adding one would require its own review; the guard and the audit ledger both fire for it regardless of what it does. |

Not found anywhere in the repository: a "transfer restaurant"/"move account" RPC, an `UPDATE … SET account_id` in `app/` or `lib/`, or any policy/grant that explicitly permits client reassignment. The vulnerable surface was the *absence of a guard*, not an explicit grant.

## 2. Enforcement anatomy (all local, all disposable-PG proven)

`20261112000200_immutable_restaurant_account_link.sql`
- `public.prevent_restaurant_account_reassignment()` — SECURITY DEFINER, fixed `search_path`; raises 42501 when `auth.uid() IS NOT NULL` and `old.account_id IS DISTINCT FROM new.account_id`. JWT-less callers (migration runner, reviewed repair) proceed. Other column changes pass through untouched.
- Trigger `restaurants_account_id_immutable` BEFORE UPDATE on `public.restaurants`.
- EXECUTE revoked from `public`, `anon`, `authenticated`.

`20261115000300_audit_restaurant_account_reassignment.sql` (new this batch)
- Replaces the function body to **also** write `public.restaurant_account_link_audit` for every *applied* change: `{restaurant_id, old_account_id, new_account_id, actor_role (current_user), actor_user (auth.uid()), occurred_at}`.
- Client-rejected attempts abort with 42501 **before** the insert — the ledger contains applied changes only, by construction.
- The ledger is append-only: `restaurant_account_link_audit_no_rewrite` trigger refuses UPDATE and DELETE for **every** role including superuser; no client role can SELECT or INSERT; `service_role` holds SELECT through exactly one policy (hosted `service_role` bypasses RLS anyway — the policy makes the support read explicit and matches hosted behavior in the disposable harness).
- Additive only; no grant, policy, trigger or function of any other object is changed.

## 3. Allowed vs rejected transition matrix (tests, not promises)

| Caller | Initial INSERT (signup/outlet) | Ordinary settings UPDATE | `account_id` unchanged | `account_id` changed |
|---|---|---|---|---|
| anon | n/a (no INSERT grant) | denied | denied | denied |
| authenticated owner (member) | n/a (no INSERT grant) | allowed | allowed (row must pass RLS + guards) | **42501** |
| authenticated manager (member) | n/a | allowed (not billing columns) | allowed | **42501** |
| authenticated non-member | n/a | 0 rows (RLS) | 0 rows | 0 rows/42501 |
| service_role (hosted, RLS-bypassing) | via RPC only | allowed | allowed | allowed → **audited** |
| migration runner / superuser | yes | yes | yes | yes → **audited** |

Proof: `npm run test:db:integration` → 10 suites / 212 assertions, all green, full 92-file chain replayed on a fresh disposable PostgreSQL 17 per run.

## 4. Owner preflight before applying hosted (verbatim)

1. Backup/PITR gate: satisfied or explicitly waived in writing (see `docs/pitr-verification-procedure-2026-11-14.md`).
2. Confirm the release will run `20261110001000` (legacy backfill) **before** `20261112000200` — enforced by filename ordering; the migration-chain gate (`npm run migrations:verify`) fails the build on duplicates/misordering.
3. Read-only existence probe on the target after Batch A but before declaring done:
   ```sql
   select p.proname, p.prosecdef
     from pg_proc p where p.proname = 'prevent_restaurant_account_reassignment';
   select t.tgname, t.tgenabled
     from pg_trigger t where t.tgrelid = 'public.restaurants'::regclass
     and t.tgname in ('restaurants_account_id_immutable', 'restaurant_account_link_audit_no_rewrite');
   select count(*) from public.restaurant_account_link_audit;  -- 0 immediately after apply
   ```
4. Baseline counts for the "nothing moved" reconciliation: `select count(*), count(account_id), count(*) - count(account_id) as unlinked from public.restaurants;` (record; compare after Batch A — only the documented `20261110001000` backfill may change these).
5. After any future operator repair of a link, require: `select * from public.restaurant_account_link_audit order by id desc limit 1;` shows the expected before/after and actor — **and** exactly one new row per repaired restaurant. If a repair did not produce a row, it did not happen (or it went through a path outside the trigger — report it).
6. Ledger spot check after release: `select count(*) from public.restaurant_account_link_audit;` must equal the number of deliberate repairs executed, and be 0 otherwise.

## 5. Rollback / failure posture

- The guard and the ledger are forward-only. Reverse by forward fix: `drop trigger restaurants_account_id_immutable on public.restaurants;` only under incident review — this reopens the exact bypass this document closes; do not.
- The audit migration creates one table + one policy + one trigger. Removing it means dropping the trigger and table; the guard remains fully functional without it.
- Neither migration rewrites or deletes tenant data. `restaurant_account_link_audit` is `on delete restrict`-anchored and append-only; it survives restores like any other table.

## 6. Explicit non-goals

No staging/production apply in this batch. No app-code "transfer" feature. No weakening of any existing grant/policy. The 20261112000200 file was **not** edited; its effect is redefined by the forward 20261115000300 migration (function body replacement is the only change).
