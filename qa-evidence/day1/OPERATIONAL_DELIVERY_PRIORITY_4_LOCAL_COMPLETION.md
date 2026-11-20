# Operational delivery — Priority 4 local completion

Branch `arena/ce32f7c8-autodine` · base `7064c912b1b85ab6364f23d1755d855ff4f462ad` ·
local date 2026-11-19 (UTC) · **local evidence only**

## What this closes locally

The operational half of the product — a waiter working the floor, a table
moving mid-service, and staff screens that notice a change without a timer —
now has one implemented path with database authority:

| Area | Implemented |
|---|---|
| Live signal | `outlet_live_revisions`: one row per outlet holding `outlet_id`, `event_id`, `version`, `changed_at`. Deferred triggers on orders, lines, payments, sittings, tables, QR codes and waiter calls collapse every change in a committed transaction into one revision (`xmin` guard). Only this projection is added to `supabase_realtime`, with `publish = insert, update`; the migration refuses to alter a publication that already contains other tables, because DELETE cannot be row-filtered safely. |
| Staff delivery | `components/owner/OperationalRealtime.tsx` replaces the Kitchen 5 s, Counter 10 s and Owner 15 s per-page timers. It validates outlet/event/time/version, drops duplicates and stale signals, and calls `router.refresh()` — the wire record is never applied as business state. Visible-only reads, 45 s safety resync, visibility/offline pause, serial topic reuse, CLOSED retry, auth-refusal stop, focus/editing guard and the existing Kitchen speech relay are preserved. |
| Waiter | New `waiter` membership role. `list_my_waiter_outlets`, a bounded `floor_service_snapshot` (200 tables, 100 oldest calls, both with truncation flags) and column-level waiter-call reads. Broad staff policies keep their previous role list (`current_restaurant_ids`, `is_member`, `order_sessions_staff`), so a waiter cannot read orders, payments, sittings or finance. |
| Calls | Guest `read_verified_waiter_state` / `call_verified_waiter_at` bind the request to the exact slug, table label and live token; expiry/revocation reads as `expired` and a call raises. Staff `acknowledge_waiter_call` is separate from the device speech claim and idempotent (first actor/time preserved); `finish_waiter_call` and the legacy `resolve_table_waiter_call` share the same lock and refuse foreign outlets. |
| Transfer | `transfer_open_sitting` locks both tables in UUID order, then the sitting. It refuses unavailable, occupied, open-call and financially encumbered moves, preserves `orders.table_id`/guest bearer, moves the sitting, revokes both tables' verification proofs and records `sitting_table_moves` under a request UUID (replay returns `already_recorded`). Tripwires reject a stale order stamp and a call created against a revoked table. |
| Guest versions | `orders.guest_live_version` increments on real content/state changes only. `get_guest_order_status` returns six minimal fields plus the version; `get_public_order` carries it with the bill. `set_guest_order_lines_at_version` takes the sitting→order locks, refuses a stale version, then delegates to the existing authority, pricing and audit path. |
| Audit | `order_operation_history` records prep/accept/quantity changes with actor, line and before/after values, readable by owner/manager only. No notes, tokens, prices or guest profile. |

New migration: `supabase/migrations/20261118002100_operational_realtime.sql`
(525 lines). It is **NOT AUTHORIZED** for any hosted target. All 117
predecessors, including the 26 GST/IRP files and `20261118002000`, are
byte-preserved.

## Evidence

| Check | Result |
|---|---|
| Native replay + regression suites (PG 17, clean chain) | **118 migrations, 67 tables, 200 public functions; 12 files, 281 passed / 1 skipped.** The new `lib/db/operational-realtime.integration.test.ts` (6 tests) covers one-revision-per-transaction coalescing, publication shape, waiter ACL/isolation, call binding + idempotent acknowledgement + expiry, transfer/occupancy/call/money refusals + ticket identity, guest version staleness + audit rows, and the 200-table floor bound. |
| Populated upgrade replay (117 → 118) | **10 files, 270 passed / 3 skipped.** All populated financial, GST, IRP, payment and share rows byte-preserved (predecessor column set pinned, so the new nullable column cannot masquerade as an edit); the only changed existing functions are the four documented replacements (`get_public_order`, `resolve_table_waiter_call`, `current_restaurant_ids`, `is_member`). |
| Production Next build + Chromium journey | **17/17 passed** (16 desktop, 1 phone), including a new `realtime.desktop.spec.ts`: staff socket reaches `live`, a committed `prep_status` change arrives through `router.refresh()` with no navigation (document identity unchanged), a forced socket drop degrades the indicator, and the coordinator rejoins and still delivers the next change. |
| Application unit/component suite | **2,612 passed / 291 skipped across 2,905 tests (235 files passed, 13 skipped)**; no failures. |
| Static and policy guards | lint, `design:check`, `sql:check` (also taught to strip `ALTER TYPE … ADD VALUE` and plain `CREATE FUNCTION`), `migrations:verify`, `typecheck`, `verify:release` (47 checks, 118 files) and a hermetic production `build` all pass. |
| Definer audit | **148 security-definer functions audited, 81 flagged** (was 133/74). New flags are the three token-scoped anon RPCs (`call_verified_waiter_at`, `read_verified_waiter_state`, `set_guest_order_lines_at_version`) plus internal trigger functions with no tenant predicate — the same posture as the already-accepted guest RPCs. |

## Transport boundary

The journey harness serves Auth/REST/Realtime and the app from **one loopback
origin**, so Chromium uses the same-origin socket without a CSP exception.
The realtime endpoint is a fixture: a Phoenix subset over `ws` that wakes from
PostgreSQL's commit-gated `NOTIFY` and re-checks each delivery through the
real SELECT policy. It is **not** Supabase Realtime, WAL decoding, the hosted
authorization model, or a production server. Browser sign-in, token refresh
and hosted project configuration remain unproven; the seed cookie is a
synthetic session in the real SSR cookie format.

## Known limits / next steps before any hosted claim

1. Hosted apply needs an exact target, read-only ledger/catalog checks, a
   review of that project's `supabase_realtime` publication, and a separate
   written authorization for `20261118002100` (and `20261118002000`).
2. Realtime adapter behaviour on the hosted project — publication, RLS on the
   revision table, `REPLICA IDENTITY`, subscription authorization — must be
   observed there, not inferred from the fixture.
3. Auth sign-in, renewal and multi-device sessions need genuine Supabase
   identity; the fixture only proves the UI and SQL contract.
4. Counter's floor summary is rendered; a dedicated visual pass on the waiter
   board at phone width is still worth a human look.
5. Staging, Production, pilot and release remain **NO-GO**.

## Reproduction

```
npm run test:db:integration                 # native 118 replay + suites
READINESS_GST_UPGRADE=1 node scripts/local-pg/with-embedded-postgres.mjs node scripts/verify-database.mjs
npm run test:e2e:journey                    # production build + Chromium + socket fixture
npm run lint && npm run design:check && npm run sql:check && npm run migrations:verify
npm run typecheck && npm run verify:release
GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build
npm run audit:definer
```

No hosted access, provider call, payment, commit or push was performed for
this evidence.
