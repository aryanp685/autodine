# Phase 5C — Synthetic PostgreSQL Validation

**Local Phase 5C result: PASS. Overall Staging disposition: NO-GO pending the separate Phase 5B operator gates.**

**Report date:** 2026-11-06 UTC (Arena-provided date). The sandbox clock discrepancy is recorded below.

**Scope:** Local, disposable PostgreSQL 17 only; synthetic tenants and records only. No Supabase Staging or Production connection, hosted API/RPC, hosted DDL/DML, payment-provider call, deployment, restore, or operator request was made.

## Executive result

- Both candidate files match the exact SHA-256 values recorded in `PHASE-5-HOSTED-STAGING-RECONCILIATION.md` (Phase 5B); neither source was changed.
- A native PostgreSQL **17.11** server was obtained in an isolated user-local directory and bound only to `127.0.0.1`. The clean replay applied all 65 repository migrations. A separate synthetic-Staging-scaffold forward replay also reached all 65 migrations. Both runs passed all 56 database-backed Vitest cases (52 readiness + 4 menu-throttle tests; zero DB-test skips or failures per run).
- An additional 40-client concurrent call to the candidate successful-order limiter admitted exactly 30 orders and refused 10, with 30 order rows, 30 line items, one sitting, both counters at 30, and a quota-free idempotent retry. The database was dropped after the check.
- The full non-DB Vitest run passed **1,961 tests**; its 56 DB tests were intentionally skipped in that invocation because no DB URL was supplied. Those same DB tests were then run with the local database and all passed. Typecheck and `sql:check` also passed.
- **Approval answer:** the local technical validation gate is clear, but the minimal forward-only Staging migration is **not ready for operator Staging approval/execution yet**. Phase 5B still requires operator acceptance of hosted provenance/ACL classification and independently verifiable Staging recovery evidence; clock assurance also remains unresolved. No recovery request was drafted or sent. The Phase 5B NO-GO remains authoritative.

## Exact source-hash verification

| Candidate source | SHA-256 in Phase 5B report | Recomputed SHA-256 | Result |
|---|---|---|---|
| `supabase/migrations/20261110000300_shared_wifi_scan_limits.sql` | `0b8092fb4ec7dfd442866bc8b802b031edc99a2b6a465ba4972ffd10f45882c2` | `0b8092fb4ec7dfd442866bc8b802b031edc99a2b6a465ba4972ffd10f45882c2` | Exact match |
| `supabase/migrations/20261110000900_online_payment_attempt_uniqueness.sql` | `624a9712333108610cd290226fd0a95b0dd21675aeaee121780574393aa977e8` | `624a9712333108610cd290226fd0a95b0dd21675aeaee121780574393aa977e8` | Exact match |

These are the candidate bytes already recorded in the Phase 5B source-hash table. No unrelated migration was added to either candidate, and the old 49-source `scripts/staging/approved-upgrade.sql` was not used as a replay input.

## Runtime, isolation, and environment

- OS/architecture: Debian GNU/Linux 12, x86_64; Node `v22.22.3`; npm `10.9.8`.
- PostgreSQL: server, `initdb`, and `pg_ctl` reported **PostgreSQL 17.11** (`server_version_num = 170011`), matching the PostgreSQL 17.11 version reported for Staging in Phase 5B. The native binaries came from the isolated npm package `embedded-postgres@17.11.0-beta.19` / `@embedded-postgres/linux-x64@17.11.0-beta.19`; no repository dependency or lockfile was changed. The package did not include `psql`; migration replay and tests used the repository's `pg`/node-postgres client.
- The cluster lived under `/home/user/.local/phase5c/runtime`, used a generated port (`40769`), `trust` authentication inside the disposable local cluster, and listened on **127.0.0.1 only**. No password or hosted credential was used. `scripts/verify-database.mjs` generated a fresh random `autodine_check_<hex>` database for each run and drops it in `finally`; the separate concurrency check used a random `autodine_phase5c_order_cap_<hex>` database and also dropped it in `finally`. A post-run catalog check found no remaining `autodine_%` databases.
- The test shim creates only local Supabase-like roles/schema/helpers. All tenants, profiles, menus, tables, QR sessions, orders, payments, and provider references were synthetic. Test references such as `phase1` and UUIDs were never sent to a provider. Environment-variable **names** matching Supabase, Vercel, payment-provider, API-key, database, or PostgreSQL patterns were absent during the recorded check; no values were printed.
- The server was started with loopback-only listen settings and stopped after validation. The npm runtime and scratch harness were outside the repository under `.local`; no runtime files were added to Git. The disposable runtime and scratch tree `/home/user/.local/phase5c` was removed after the tests.

**Clock discrepancy:** Arena supplied the current date as **2026-11-06 UTC**, while `date -u` and the PostgreSQL startup log reported **2026-11-12 UTC** (the latter logged `2026-11-12 09:16:10 UTC`). This six-day disagreement is unresolved; the Phase 5B report also bears a 2026-11-12 date. Do not use these local wall-clock readings as independent clock or recovery evidence. The exercised rate windows compare timestamps within the same database and the tests passed, but provider/host clock synchronization remains an approval gate.

## Dependency and object trace

Both candidate files are `CREATE OR REPLACE FUNCTION` replacements plus comments; **neither adds or alters a table, column, constraint, index, trigger, grant, or revoke**. The required objects come from the earlier repository migrations and remain the caller's schema prerequisites.

### `20261110000300_shared_wifi_scan_limits.sql`

It contains two functions:

1. `public.open_table_session(text,text)` retains the five-column result `(status, session_token, restaurant_slug, table_label, expires_at)`. It reads/locks `table_qr_codes` (`id`, `restaurant_id`, `table_id`, `public_token`, `revoked_at`); reads `restaurants` (`id`, `slug`, `is_active`, `guest_verification_mode`), `dining_tables` (`id`, `restaurant_id`, `label`, `is_active`), and published `menus`; counts/writes `table_session_opens` (`qr_code_id`, `ip_hash`, `opened_at`); and inserts `table_verification_sessions` (`token_hash`, `restaurant_id`, `table_id`, `qr_code_id`, `expires_at`). It calls `restaurant_can_write(uuid)` and uses PostgreSQL UUID/sha256 functions. The QR row lock serializes admission; the existing thresholds remain 10 opens/card/hour and 20 opens/card+IP/hour.
2. `public.place_public_order(text,jsonb,text,text,uuid,text)` depends on `restaurants(id,slug,tax_rate_bps)`, the order/session columns including `orders.guest_token`, `table_id`, `order_session_id`, and `tax_rate_bps_snapshot`, `order_sessions`, and `rate_limit_hits(key,window_started_at,count)`. It calls `hit_rate_limit(text,integer,integer)`, `place_public_order_core_with_code_retry(text,jsonb,text,text)`, and `stamp_guest_verification(text,uuid,text)`. It charges 30/session and 60/restaurant successes per ten minutes, plus an optional 60/IP cap whose key includes the restaurant ID. It serializes a guest-token retry, returns an existing order before charging the quota, snapshots tax, and attaches the order to the table's open sitting.

Relevant pre-existing protection objects include `rate_limit_hits` primary key on `key` and `rate_limit_hits_window_idx`; `orders_guest_token_unique` (partial unique index), `orders_restaurant_code_unique` (code collision handling), `order_sessions_open_unique` (one open sitting/table), and `orders_order_session_idx`. The open-session path uses `table_session_opens_card_idx` and `table_session_opens_ip_idx`. The QR provisioning trigger `trg_dining_tables_ensure_qr` and all these objects are outside the candidate's DDL.

### `20261110000900_online_payment_attempt_uniqueness.sql`

It replaces:

- `public.begin_online_payment(text,text,text,uuid,uuid,bigint)`: depends on `order_sessions(id,restaurant_id)`, `orders(id,order_session_id,restaurant_id,guest_token,prep_status,payment_status,total_paise)`, `restaurants(id,slug,online_payments_enabled)`, `payments(order_id,restaurant_id,method,amount_paise,status,provider,provider_ref,idempotency_key)`, and `restaurant_can_write(uuid)`. It locks session then order; validates the guest/order/tenant, switch, state, and exact due amount; reuses a matching provider-order idempotency row; otherwise rejects any distinct second pending online attempt for that order.
- `public.settle_online_payment(text,text,text,bigint)`: uses the same session → order → payment lock order, rechecks the current full balance and cancelled/paid/refunded states, updates `payments.status`, `provider_payment_ref` and `orders.payment_status`, then appends `payment_audit_events(restaurant_id,order_id,payment_id,actor_id,event_type,method,amount_paise)`.

The function-level one-pending-attempt guard is intentional: `payments.idempotency_key` is unique for same-key retries, while `payments_provider_ref_idx(provider,provider_ref)` is a non-unique lookup index and does not prohibit distinct provider references for one order. Other relevant existing objects are `payments_order_idx`; `payment_audit_events` unique `(payment_id,event_type)` plus `payment_audit_events_restaurant_created_idx`; the existing payment method/status/amount checks and audit method/event checks; and the audit actor FK `payment_audit_events_actor_id_fkey` (`ON DELETE SET NULL`). Existing `payments_stamp_recorded_at` and `payments_issue_invoice_receipt` triggers run on payment status changes; the order write/finalized-source guards also remain installed. Neither candidate creates, drops, or changes these objects.

### Grants and security boundaries

- All four functions remain `SECURITY DEFINER` with `search_path = public, pg_temp`; `CREATE OR REPLACE` preserves their existing owner, and neither candidate changes function ACLs. `begin_online_payment` and `settle_online_payment` retain their service-role-only grants. The 00900 file contains no grant/revoke statements.
- `place_public_order` retains its signature and existing ACL; the source does not widen client access. Keep direct `PUBLIC`, `anon`, and `authenticated` EXECUTE revoked. The application uses `place_public_order_attempt(...)`, the separately budgeted wrapper. `open_table_session` keeps its existing guest-facing grants and five-column result contract.
- `rate_limit_hits` is RLS-enabled with direct client table privileges revoked. `hit_rate_limit(text,integer,integer)` has EXECUTE revoked from `PUBLIC`, `anon`, and `authenticated`, with `service_role` retained; the security-definer order wrappers invoke it internally. `payment_audit_events` remains staff-readable under its policy, with writes through the definer payment function.
- Catalog/privilege assertions in the readiness tests passed for the payment service-role boundary and the retired placement RPC. No ACL change was made in either candidate.

## Replay and test record

All command exit codes below are from the local PostgreSQL 17.11 environment, unless noted.

| Command | Exit | Result |
|---|---:|---|
| `npm install --prefix /home/user/.local/phase5c/pg-binaries --ignore-scripts --no-save --no-package-lock --no-audit --no-fund embedded-postgres@17.11.0-beta.19` | 0 | Isolated local runtime installed; repository manifests untouched. |
| `node /home/user/.local/phase5c/pg-binaries/node_modules/@embedded-postgres/linux-x64/scripts/hydrate-symlinks.js` | 0 | Rehydrated package-local native library symlinks. |
| `/home/user/.local/phase5c/pg-binaries/node_modules/@embedded-postgres/linux-x64/native/bin/initdb -D /home/user/.local/phase5c/runtime/data --username=postgres --auth=trust --encoding=UTF8 --no-locale --no-instructions` | 0 | Fresh disposable cluster initialized. |
| `/home/user/.local/phase5c/pg-binaries/node_modules/@embedded-postgres/linux-x64/native/bin/postgres -D /home/user/.local/phase5c/runtime/data -h 127.0.0.1 -p 40769 -k /home/user/.local/phase5c/runtime/socket -c listen_addresses=127.0.0.1 -c unix_socket_directories=/home/user/.local/phase5c/runtime/socket -c log_min_messages=warning -c log_statement=none` (`start_process`) | Running → stopped | Ready on loopback port 40769; stopped cleanly after tests. Long-running process has no one-shot exit code. |
| `READINESS_PG_ADMIN_URL='postgres://postgres@127.0.0.1:40769/postgres' npm run test:db` | 0 | Clean replay applied all **65** migrations without application-table scaffolds; then **56/56 DB tests passed** (52 readiness + 4 throttle integration), 0 skipped. Candidate migrations both applied. |
| `READINESS_PG_ADMIN_URL='postgres://postgres@127.0.0.1:40769/postgres' READINESS_REPLAY_BASELINE=staging_scaffold npm run test:db` | 0 | Reconstructed the helper's synthetic historical Staging-like starting point using `scripts/local-pg/005_scaffold_missing_tables.sql`; applied the forward repository migration sequence through all **65**; seeded six synthetic legacy QR-attempt events for its compatibility test; then **56/56 DB tests passed**, 0 skipped. This is not a Staging dump. `READINESS_STAGING_BUNDLE` was not set. |
| `node /home/user/.local/phase5c/validate_success_order_limit_concurrency.mjs` | 0 | Separate fresh full-migration replay; **40 concurrent** direct SQL order submissions yielded 30 admitted / 10 `rate-limited`. Persisted state: 30 orders, 30 line items, one sitting; session and tenant counters both 30. Retrying a successful guest token returned the same order without changing counts. The scratch DB was dropped. Provider calls: 0; hosted calls: 0. |
| `npm test -- --reporter=dot` | 0 | **167 files passed, 2 skipped; 1,961 passed, 56 skipped; 0 failures.** The two DB integration files (52 + 4 cases) are intentionally skipped when their local DB URLs are unset; they passed in each `test:db` run above. |
| `npm run typecheck` | 0 | Passed. |
| `npm run sql:check` | 0 | Passed static DDL syntax/inventory check. It labels function bodies in both candidates “nothing parser-checkable”/“UNVERIFIED”; PostgreSQL replay and DB behavior tests, not this static check, provide their runtime validation. |
| `git diff --check` | 0 | Passed for the tracked diff. The new untracked report was also checked for whitespace before completion. |

The database-backed suite includes, among other cases: successful-order session and tenant caps, retry quota exemption, restaurant-scoped optional IP isolation, concurrent QR-card limits, amount-mismatch rollback with unchanged order/payment/audit state, idempotent settlement retries, cancelled-order rejection, one pending attempt per order, stale second capture left pending without double-recording, service-role-only payment ACL, and concurrent distinct intents where only one pending attempt survives. The custom 40-client order test specifically covers concurrent successful-order cap admission and rollback/integrity at the 30-order boundary.

**Harness note:** the first scratch invocation exited 1 at ESM import, before connecting to PostgreSQL. The second exited 1 on an array-parameter shape mistake in the result-inspection query after the 40 parallel calls; its `finally` block dropped that temporary DB. After fixing the CommonJS import and array binding, a fresh rerun exited 0. These were harness-only setup/inspection failures, not candidate or repository-test failures; the scratch script was not added to the repository.

## Limitations and preserved state

- The synthetic Staging-like replay is a local model with `000_supabase_shim.sql` and the explicit local missing-table scaffold, not a clone, backup, or independent catalog inspection of Staging. No result here proves hosted migration history or bytes, backup/PITR, restore ability, or provider clock synchronization.
- Creating the shim's `supabase_realtime` publication emitted PostgreSQL's warning that `wal_level` was not `logical`. No logical-replication subscription or realtime delivery was exercised; this is outside both candidate migrations and the tested function behavior.
- Database behavior was exercised locally with fake provider labels/UUIDs only. Phase 5B found no live online-payment UI/API path; keep online payments disabled and do not operate a provider or hosted payment function.
- `scripts/phase3/staging-baseline.json` was already marked modified in the worktree at Phase 5C entry. Its worktree SHA-256 was `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb` at the initial check and is the same after validation. **This task did not edit, restore, regenerate, or otherwise change it.** Its pre-existing dirty status is preserved for separate review; this report does not certify the file as identical to the base commit.
- The tool output contains a host-clock/Phase 5B date disagreement described above. Do not treat this local run as clock synchronization or recovery evidence.
- No existing tracked source/test file was changed by Phase 5C. The only intended repository addition is this report; no commit was created.

## Disposition and next gate

**Local candidate validation: PASS. Current Staging approval/execution: NO-GO.** The technical test condition is now satisfied, but it does not clear Phase 5B's independent requirements: operator acceptance of the hosted source/ACL provenance classification and independently verifiable operator-owned Staging backup/PITR/restore evidence, with authoritative clock corroboration. Those remain unsupplied, and no request was sent.

If those separate gates are later satisfied and Staging change approval is obtained, prepare a new additive, forward-only migration containing only:

1. the final `place_public_order(...)` body from `20261110000300_shared_wifi_scan_limits.sql` (the full candidate file also replaces `open_table_session(...)`, which Phase 5B found already aligned and should not be replaced just for normalization); and
2. the `begin_online_payment(...)` and `settle_online_payment(...)` bodies from `20261110000900_online_payment_attempt_uniqueness.sql`.

Preserve signatures, `SECURITY DEFINER`, owner, search paths, existing grants, and the client-revoked legacy order RPC boundary. Keep the attempt wrapper. Do not replay the old 49-source artifact, alter the pinned baseline, apply these files to Staging or Production, or invoke a hosted payment path as part of Phase 5C.
