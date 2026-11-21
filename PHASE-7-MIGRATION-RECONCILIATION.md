# Phase 7 — migration reconciliation evidence (Phase 3)

**Phase 3 status: LOCAL RECONCILIATION HARNESS PASS; HOSTED FILE-BY-FILE CLASSIFICATION BLOCKED.** No hosted migration, DDL/DML, ledger repair, branch merge, or Production operation was performed. The available read-only ledger/catalog evidence is enough to identify material divergences and prevent a blind rollout, but not enough to certify every hosted migration.

## 1. Source and local classifier evidence

Current checkout contains **77 uniquely versioned SQL migrations**. The protected historical Phase 3 baseline remains unchanged at SHA-256 `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`.

Command run with the embedded disposable cluster (explicitly unset any inherited reconcile DB URL):

```bash
env -u RECONCILE_PG_ADMIN_URL npm run db:reconcile
```

The runner reported `hostedDatabaseContacted: false` in its source contract and used only local random databases. Results:

- Historical production fixture plus current checkout: **45-file recorded baseline + 32 files with no same-named entry = clean replay of all 77**. The 32 is computed from the checked-in `production-2026-11-10.json`, captured only through repository version `20261110000400`; it is a stale evidence fixture, not a current hosted pending list.
- Classifier self-test covered **33 states with 0 wrong verdicts**. **27 synthesized drift states** were all reported as `REVIEW`/drift.
- A populated synthetic upgrade retained the existing row counts: 1 order, 1 order item, 1 payment, 1 payment-audit event, 1 invoice, and 1 payment receipt.
- The local staging-shaped reconstruction used the historical **49-file** bundle through `20261109000900` plus 22 later source files. It reported four files older than the bundle's high-water mark, a bundled-source hash difference at `20261109000400`, and nine catalog differences on the legacy QR-attempt archive/sequence/constraints/indexes. This is a local reproduction of the older documented shape, not the current hosted Test database.
- Re-running files in that local model demonstrates why not to replay blindly: `20261108009000` and `20261109000600` error on repeat; later files can revert `close_order_session_and_issue_receipt`, `place_public_order`, four payment/financial functions, `set_order_line_quantities`, `operational_schema_readiness`, and other later definitions.

These results validate the local harness/classifier and the known local reconstruction only. They do not turn ledger-only entries into a hosted `PRESENT` verdict.

## 2. Current hosted reconciliation observations

The Phase 0 read-only probes returned these environment-specific facts:

| Object / migration | Production (`bdbaqpevwmgdvghszjno`) | Test candidate (`juwyhslzchjevqkdvwjm`) | Safe interpretation |
|---|---|---|---|
| `restaurants.account_id` immutability (`20261112000200_immutable_restaurant_account_link.sql`) | Ledger does not list `20261112000200`; no immutable-link trigger/function found; authenticated table/column UPDATE remains. | Ledger does not list the immutable-link migration; no immutable-link trigger/function found; authenticated table/column UPDATE remains. | **Effect absent in both catalog snapshots.** This is a current tenant-entitlement P0. The source migration passes local PostgreSQL regression tests; that does not prove a hosted apply plan. |
| Owner-only billing/tax-configuration guard (PR #181 source) | Billing-configuration guard trigger/function not found. | Ledger entry `20261113115007 / owner_billing_configuration_guard`; trigger/function found and body matches the PR source. | **Present in Test under a custom ledger version**, confirmed by catalog. It is not proof that the conflicting filename/version can be merged or applied to Production. |
| `20261110001220_revoke_client_bypass_privileges.sql` and defaults | `anon` and `authenticated` retain direct PostgreSQL-17 `MAINTAIN` on 17 `postgres`-owned public tables; client `postgres` defaults still grant `MAINTAIN`. | `anon` and `authenticated` retain `MAINTAIN`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` on the same 17 `postgres`-owned tables; client defaults also retain these privileges. | **Partial/residual ACL state — REVIEW.** RLS does not protect `TRUNCATE`. Do not call this migration `PRESENT` or `APPLY` from ledger names alone. The separate owner operation for `supabase_admin` defaults is still required by the source design and is not evidenced as run. |
| `20261109001000_operational_readiness.sql` | `operational_schema_readiness()` exists and is service-role-only in the bounded check. | Same. | Existence/grant subset only; function-body/catalog hash is not classified. |
| `20261110000500_public_restaurant_profile.sql` | `public_restaurant_profile(text)` exists and is executable by public-role callers as intended by the source contract. | Same. | Existence/grant subset only; body and every dependency are not classified. |
| Subscription/account helpers | `account_can_write(uuid)`, `create_account_with_restaurant(...)`, `create_outlet(...)` exist with the sampled grants/search paths. | Same sampled results. | This is a narrow RPC check, not proof that the entire account/subscription migration is identical to the source. |
| Migration ledger high-water | Returned listing ends at `20261112000100`. | Returned listing ends at `20261113115007 / owner_billing_configuration_guard` after custom/bundled entries. | These ledgers differ and are not a migration plan. The Test version is later than the authoritative task date because of the clock conflict. |

RLS was enabled on all 44 Production / 42 Test public tables returned, but the ACL findings above remain. No application rows, financial data, Auth users, or Storage objects were queried.

## 3. Version collision and owner-billing PR disposition

Open PR #181 has base SHA `e13720652440fc69280caa09e2e60bc151288426`, older than the active checkout's `main`/base SHA `9ac2b22c698b639f8fe82e8981e5182b86b7dc75`. It adds `20261112000200_owner_billing_configuration_guard.sql`, while the current branch already has `20261112000200_immutable_restaurant_account_link.sql`. Both filenames use the same 14-digit version and define different triggers/functions.

PR #181 is **not merged** and has not been modified or merged by this execution. Its reported green checks ran against a different/older base and carry provider timestamps after the authoritative task date. The live Test catalog independently verifies that its billing guard body was applied there under `20261113115007`; that fact does not resolve the duplicate version. A merge/apply plan must use a reviewed, unique forward migration sequence that preserves both guards and fits the reconciled histories. Because the database and sandbox clocks are seven days ahead of the task date, do not mint a timestamp-based migration version until chronology/versioning is resolved.

## 4. Historic baseline protection and capture requirements

- Preserve `scripts/phase3/staging-baseline.json` as the historic **seven-function** baseline. The later nine-function rehearsal guard in `PHASE-3-HOSTED-BASELINE.md` is a separate local rehearsal, not a replacement or fresh hosted fingerprint.
- No current complete `catalog-probe.sql` result or current `capture-function-bodies.sql` result was obtained. A full catalog aggregation is known to exceed/truncate the connector response; the incomplete result is not parsed as complete evidence.
- Before any migration that redefines a hosted function, capture the current exact function body/hash, owner, security mode, `search_path`, execute ACL, default ACLs, overloads and callers. The five production function bodies marked as drifted in the 2026-11-10 evidence remain a historical warning; the current hosted bodies have not been safely captured here.
- Distinguish the existing legacy QR-attempt table and archived source shape. Do not drop, rename, reset, recreate, or clean unknown hosted objects/rows from this local reconstruction.

## 5. Why hosted classification is blocked

1. Supabase lists only Production and `autodinetest`; no distinct Staging project appears. Current Vercel Preview/Development connection to the Test candidate is not proved through safe redacted config evidence.
2. The task's authoritative date is 2026-11-06, while runtime/provider and Test migration timestamps are 2026-11-13. Time/order-based conclusions are therefore not accepted.
3. Production and Test ledgers are non-canonical/different. Names/versions alone do not prove contents.
4. The connector has truncated broad catalog/function aggregate outputs. A complete current probe and exact function-body capture are not stored; a partial response is not silently classified.
5. Account-link and client/default-ACL findings are current and material. Recovery, target acceptance, independent migration review, and current-release Staging acceptance have not passed.

Until these blocks are removed, hosted migration state for all other files remains **UNKNOWN/REVIEW** unless a bounded, direct catalog check establishes a specific object fact. Do not blindly replay, use `--include-all`, repair ledger rows, rerun bundle SQL, drop unknown objects, or make an order inferred solely from the highest migration timestamp.

## 6. Phase 3 exit status

- [x] Current source chain replayed locally; database/security tests and migration classifier self-tests pass.
- [x] Current Production/Test migration lists and targeted catalog state are recorded in the Phase 0 baseline.
- [x] The same-version PR #181 collision and Test custom ledger entry are reconciled as a **merge/application blocker**, not guessed away.
- [ ] Complete, current per-file hosted `PRESENT`/`APPLY`/`REVIEW` classification with full catalog and function-body evidence.
- [ ] Operator-accepted Staging identity, recovery/RPO/RTO, migration review, and current-release acceptance.

**Phase 3 outcome:** local evidence is refreshed; hosted reconciliation is deliberately **not complete**. No hosted change was made. Independent local source/security review may proceed.
