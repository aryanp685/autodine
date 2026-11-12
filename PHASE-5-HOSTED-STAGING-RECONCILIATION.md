# Phase 5 — Hosted Staging Baseline Reconciliation

**Phase 5B status (2026-11-12 UTC): NO-GO — no hosted migration or payment operation.**

**Scope:** Read-only verification of the user-designated Supabase Staging ref `juwyhslzchjevqkdvwjm` only. Production remains untouched.

## Phase 5B executive summary

- The nine pinned function-body hashes still differ (0/9 match), and the legacy `place_public_order(...)` ACL differs. Semantic review is now complete for all nine pinned functions; the hashes alone are not treated as defects.
- The historical `20261109000400_order_write_boundary.sql` manifest hash is traced to the exact older source bytes embedded in `scripts/staging/approved-upgrade.sql` and present at GitHub commit `14a9391ef29e5c35323d3676f5e2844a5935b32b`. The current canonical file is a later privilege-revocation-only revision. This explains the hash, but the database's own manifest is not independent proof of which artifact was executed.
- Source review found material forward-fix candidates for stale/duplicate online-payment settlement and for successful-order rate limits. The active order-attempt/readiness path, staff TTS, and QR signatures/return shapes are compatible with the checked application callers. The repository contains no live online-payment UI/API implementation despite README prose describing one; online payment must remain disabled and unoperated.
- The hosted timestamp is not six days ahead: the trusted date is 2026-11-12 UTC. Provider clock synchronization and operator-owned Staging recovery evidence remain unverified.
- `npm test -- --reporter=dot` passed 1,961 tests; 56 database-backed tests were skipped because this continuation had no local PostgreSQL server. No hosted application RPC, DDL, DML, permission change, migration, deployment, restore, or Production operation was performed.

## Executive result

The requested Staging project ref was reached, and all nine expected pre-cutover function signatures exist. The hosted state does **not** match the pinned baseline in `scripts/phase3/staging-baseline.json`: **all nine `md5(prosrc)` fingerprints differ**, and the `place_public_order(...)` EXECUTE ACL differs. Eight function ACLs and all nine recorded search paths match. The pinned JSON does not record security mode, owner, or dependencies, so those fields were observed but cannot be compared to an expected value from that file.

The pinned snapshot remains an unreconciled historical baseline; no values were rewritten to fit Staging, and no migration or permission change was attempted. The historical hash for `20261109000400_order_write_boundary.sql` is now traced to an older reviewed artifact (details below). No saved Phase 5 candidate `.manifest.json` or seven-source rehearsal bundle was found; `scripts/staging/approved-upgrade.sql` is an older, separate 49-source Staging artifact.

## Project identity and read-only boundary

- Supabase returned ref `juwyhslzchjevqkdvwjm`, display name `autodinetest`, region `ap-northeast-2`, status `ACTIVE_HEALTHY`, PostgreSQL `17.11`.
- DB, REST, and Auth health checks returned healthy.
- The Supabase migration ledger contained nine rows and ended at `20261109053540 / operational_readiness_catalog_probe`; none of the seven candidate filenames appears there as a standalone migration. The separate custom 49-row source manifest records the historical `20261109000400` entry, as detailed below.
- Queries were catalog-only `SELECT`s. No application RPC, customer row, test order, DDL, DML, permission change, migration, deployment, or Production operation occurred.

**Clock assessment (corrected):** the hosted database returned `now() = 2026-11-12 07:26:47.876065+00` and `clock_timestamp() = 2026-11-12 07:26:47.878229+00` (session timezone UTC). The trusted current date is **2026-11-12 UTC**, so this does not establish a six-day clock lead; the two database readings are only 2.164 ms apart. A later local clock check was `2026-11-12T08:44:35Z`, not a contemporaneous measurement, so it cannot establish drift either. The manifest `applied_at` on 2026-11-09 is date-consistent. Provider NTP/UTC synchronization remains unverified; have the operator corroborate timestamps from an authoritative provider clock before accepting recovery evidence. Do not use this one database timestamp as backup evidence.

## Nine-function fingerprint comparison

The pinned JSON stores MD5 of each function's `prosrc`. The additional `pg_get_functiondef` MD5 below is a fresh hosted full-definition fingerprint; it has no pinned counterpart in the JSON.

| Signature | Pinned body MD5 | Hosted `md5(prosrc)` | Hosted `md5(pg_get_functiondef)` |
|---|---|---|---|
| `begin_online_payment(text,text,text,uuid,uuid,bigint)` | `35f77b0e60c17f14907aab6ebe588a38` | `cc8c20745da2c2cb9b37df198cd80fbb` | `23bbf95d7dd5dbf077f0de2671f0b9af` |
| `cancel_order(uuid,uuid,text)` | `4dd19752f4108536024a0418afc77e4b` | `50de4a0f6f6e36f832bd48970bbaee53` | `5975c7e6bfae4af4c4323c23fbdd74b2` |
| `close_order_session_and_issue_receipt(uuid)` | `aa91f0ae7000bd92c736439bc59abcb0` | `a054a8bec53bfc759e135c575e492d63` | `66d067715b6e086c10e47ba22fb14ab6` |
| `open_table_session(text,text)` | `196e2aeba5f3955e0c025fa7618c70ee` | `51b162d16ad287f2b22b8de01f07ab2f` | `eeec2e6e398126a9a043a8ec5da2ad4f` |
| `operational_schema_readiness()` | `70f434bbe555c10ba825d4aaae807ee6` | `89b894cf36b36d582f4b0d8f1e999e5c` | `9e996f1c206bb56e993a7556a75ed968` |
| `place_public_order(text,jsonb,text,text,uuid,text)` | `dbb59213d65d7724c9862938c5e983f8` | `0e921b1802f5d5cf9e85e451c51e34cd` | `41592a492a6cee316a6323f00c85f881` |
| `record_counter_payment(text,uuid,text,bigint,uuid)` | `ed721313afc568cd8754707c9ee215a3` | `5595d00670f3c5807e06ffb4837cd8c2` | `e1a7be58c2dcee6f7e12b9f5716a5a93` |
| `set_order_line_quantities(uuid,jsonb,uuid)` | `633ba6d2eda433b39650a6573da3807b` | `f6755fdd8980e552579dda228d46201b` | `d9a6bc838428b7ef13ca82e50a0982fe` |
| `settle_online_payment(text,text,text,bigint)` | `145e808e862fef95dc7b4784599d5223` | `888fc83de05e08a852c19fd6c78333b3` | `5a0701fbff69b033edacc79a3600a165` |

**Result: 0/9 body fingerprints match.** This is not explained away by the readiness function: its hosted body is the new readiness implementation, but its body hash still differs from the pinned pre-cutover value.

### Security mode, owner, settings, and targeted EXECUTE ACLs

All nine hosted functions are `SECURITY DEFINER`, owned by `postgres`, and written in `plpgsql` except `operational_schema_readiness()`, which is `sql`. Security mode and owner are **not present in the pinned JSON**, so these are observations, not baseline matches.

All nine hosted `proconfig` search paths exactly match the pinned settings:

- `search_path=public, pg_temp`: begin/cancel/close/open/place/set/settle functions.
- `search_path=pg_catalog, public`: `operational_schema_readiness()`.
- `search_path=public`: `record_counter_payment(...)`.

Eight hosted function ACL strings exactly match the pinned ACLs. The sole ACL difference is:

```text
place_public_order(text,jsonb,text,text,uuid,text)
  pinned:  {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  hosted:  {postgres=X/postgres,service_role=X/postgres}
```

Thus the pinned snapshot grants `PUBLIC`, `anon`, and `authenticated` EXECUTE on this legacy function, while hosted Staging currently grants only `postgres` and `service_role`. This is a real baseline difference; no attempt was made to grant or revoke anything.

Hosted effective EXECUTE checks for the nine signatures:

| Function | `PUBLIC` | `anon` | `authenticated` | `service_role` | `postgres` | `supabase_admin` |
|---|---:|---:|---:|---:|---:|---:|
| `begin_online_payment(...)` | no | no | no | yes | yes | yes* |
| `cancel_order(...)` | no | yes | yes | yes | yes | yes* |
| `close_order_session_and_issue_receipt(...)` | no | no | yes | yes | yes | yes* |
| `open_table_session(...)` | no | yes | yes | yes | yes | yes* |
| `operational_schema_readiness()` | no | no | no | yes | yes | yes* |
| `place_public_order(...)` | no | no | no | yes | yes | yes* |
| `record_counter_payment(...)` | no | no | yes | yes | yes | yes* |
| `set_order_line_quantities(...)` | no | yes | yes | yes | yes | yes* |
| `settle_online_payment(...)` | no | no | no | yes | yes | yes* |

`*` `supabase_admin` access is effective through its superuser attribute, not a direct per-function ACL entry. The two online-payment functions remain non-client-callable: `anon=false` and `authenticated=false`; direct EXECUTE is granted to `postgres` and `service_role`.

### Dependencies

For all nine signatures, `pg_depend` exposed only the function language (where applicable) and `public` schema; `information_schema.routine_table_usage` and `routine_routine_usage` returned no rows. The pinned JSON has no expected dependency inventory. PostgreSQL does not record normal table/routine dependencies from these string-body PL/pgSQL definitions in the way required to certify their runtime call graph. **Hosted dependency verification therefore remains incomplete**, rather than being marked as a pass.

Phase 5B completed source and caller review, but ordinary PL/pgSQL dependencies are still not fully visible through catalog dependency views. The source call chain is: `place_public_order_attempt` → `current_table_session` / `hit_rate_limit` → `place_public_order` → `place_public_order_core_with_code_retry` → `place_public_order_core`, with verification stamping and order-session attachment in the wrapper. The hosted attempt wrapper is `SECURITY DEFINER` owned by `postgres`, so its call to the restricted legacy function does not require browser-role EXECUTE on that legacy function. Candidate `20261110000900` is the final online-payment replacement; `20261110000800` calls `issue_closed_session_receipt`. The source/caller and catalog evidence is detailed below; it is not a reason to replay any bundle.

## Rehearsal source hashes and hosted history

The seven candidate source files were SHA-256 hashed from their current repository bytes in builder order. No saved Phase 5 candidate `.manifest.json` or seven-source rehearsal bundle exists in the workspace, and no candidate bundle was written or executed during this check. The separate `scripts/staging/approved-upgrade.sql` is an older 49-source Staging artifact; its provenance relationship to the 2026-11-09 hosted run is analyzed in the Phase 5B source-byte investigation below.

| Order | Canonical source file | Current repository SHA-256 |
|---:|---|---|
| 1 | `20261109000400_order_write_boundary.sql` | `e604a331a3f0e71850ecb93cc2fdc4266c001773de0af921cc9bd4e8aeead650` |
| 2 | `20261110000100_counter_payment_lock_order.sql` | `c592c4ab1f3065775b229fc35e3fc62b389aedfa53a37c7225ac8c3390109363` |
| 3 | `20261110000200_financial_session_serialization.sql` | `eb1173128cdc88cf87af696b337df9041fd58f11e49fd8e56cb2518e6374287d` |
| 4 | `20261110000300_shared_wifi_scan_limits.sql` | `0b8092fb4ec7dfd442866bc8b802b031edc99a2b6a465ba4972ffd10f45882c2` |
| 5 | `20261110000400_durable_order_attempt_budget.sql` | `ab648932e0e84a898936c002e6dbf86f4625ba7f9856e3f3b03b4c25fd903f0b` |
| 6 | `20261110000800_checkout_outstanding_guard.sql` | `1c7f87210d347124fe519a5790c5c843cf654c9823d5e23c451e4450685df62f` |
| 7 | `20261110000900_online_payment_attempt_uniqueness.sql` | `624a9712333108610cd290226fd0a95b0dd21675aeaee121780574393aa977e8` |

The hosted `supabase_migrations.arena_staging_upgrade_manifest` has 49 historical source records. Of the seven current candidate filenames, only `20261109000400_order_write_boundary.sql` is present: SHA-256 `891b6dd75e69d794437340b4d3c60904193a092cf7503868dd629e92f8759d0c` at `2026-11-09 05:25:19.738192+00`. This matches the historical source bytes embedded in the older approved bundle, not the later canonical file (`e604a331a3f0e71850ecb93cc2fdc4266c001773de0af921cc9bd4e8aeead650`). The other six current candidate filenames are absent from that historical manifest. Do not overwrite historical migration history or replay the old source/bundle to resolve the discrepancy.

## ACL inventory (catalog-only; no permissions changed)

In `public`, the catalog reported 42 tables, 3 sequences, and 109 functions. Direct/effective object ACLs were inspected for `PUBLIC`, `anon`, `authenticated`, `service_role`, `postgres`, and `supabase_admin`.

- **Tables:** no direct `PUBLIC` grants. `anon` has `SELECT` on 17 tables and `INSERT`/`UPDATE`/`DELETE` on 13; `authenticated` has `SELECT` on 28 and those DML privileges on 14; `service_role` has all eight PostgreSQL table privileges on 33; `postgres` has all eight on all 42. `supabase_admin` has effective privileges on all 42 as superuser, not via a direct table ACL entry.
- **Sequences:** no direct `PUBLIC` grants. `anon`, `authenticated`, and `service_role` each have `SELECT`, `UPDATE`, and `USAGE` on all 3; `postgres` has all three on all 3. `supabase_admin` has effective privileges as superuser.
- **Functions:** among 109 public functions, ACL expansion reports `EXECUTE` for `PUBLIC` on 17, `anon` on 32, `authenticated` on 76, `service_role` on 108, and `postgres` on 109. `supabase_admin` has effective EXECUTE on all 109 as superuser. These aggregate grants are broader than the nine-function gate; the nine targeted ACLs are detailed above.
- All 42 public tables have RLS enabled, none has FORCE RLS, and 51 public policies / 231 public constraints exist. `anon` and `authenticated` do not have `BYPASSRLS`; `service_role`, `postgres`, and `supabase_admin` do. Policy predicates were not evaluated as part of this catalog-only snapshot.
- `postgres` has schema-scoped default ACL entries in `public` and `storage`; `supabase_admin` has them in `public`, `extensions`, `graphql`, `graphql_public`, and `realtime`. There are no global-scope default ACL rows for either owner. In `public`, both owners' defaults grant table and sequence privileges to `anon`, `authenticated`, and `service_role`; their function defaults grant EXECUTE to those roles. PostgreSQL's built-in default `PUBLIC EXECUTE` for new functions remains in effect. Additional schema-specific entries exist in the namespaces listed above (including grant-option/admin entries in `extensions` and `postgres`/`dashboard_user` entries in `realtime`). No defaults were changed.

## Catalog-only data-preservation snapshot

The hosted `public` catalog currently reports 42 tables, 3 sequences, RLS on all 42 tables (0 FORCE RLS), 51 policies, 231 constraints, approximately 468 estimated table rows (`pg_class.reltuples`), and 2,523,136 total relation bytes. This used catalog statistics only; no customer rows were selected. The row estimate is approximate and is **not** an exact data checksum. The pinned baseline contains no pre-migration table/content snapshot, and no before/after hosted comparison exists. Since no hosted writes or migration occurred in this phase, nothing was changed by this verification; preservation across a future migration is still unproven.

## Readiness check and online-payment gate

Direct inspection of hosted `operational_schema_readiness()` confirms it checks `public.place_public_order_attempt(text,jsonb,text,text,uuid,text)`, not the retired `place_public_order(...)` signature. The attempt RPC exists and has EXECUTE for `anon` and `authenticated`; the legacy RPC still exists but has neither. This is a positive readiness-source observation despite the readiness fingerprint mismatch above.

## Phase 5B semantic reconciliation — all nine pinned functions

Bodies were read from `pg_proc`/`pg_get_functiondef` using catalog `SELECT`s and compared to historical and current migration source. No function was invoked. Body MD5 drift remains a reconciliation signal, not the semantic conclusion.

### Financial and order-write behavior

1. **`begin_online_payment(text,text,text,uuid,uuid,bigint)` — material gap.** Hosted source validates provider/reference, guest token + restaurant slug, online-payment enablement, write access, unpaid/non-cancelled order, and exact outstanding amount; it locks session then order and creates a pending payment keyed by provider/order reference. Its duplicate lookup is not `FOR UPDATE`, validates order/amount but not every attempt attribute, and it does not reject a second, distinct pending online attempt for the same order. Candidate `20261110000900_online_payment_attempt_uniqueness.sql` serializes the attempt row, validates restaurant/method/amount on reuse, and refuses a second pending attempt. A unique index on `payments.idempotency_key` protects identical keys, not distinct provider references for one order.
2. **`settle_online_payment(text,text,text,bigint)` — highest financial risk.** Hosted source locks session → order → payment, returns an already-recorded attempt idempotently, rejects refunded attempts and a supplied amount mismatch, and refuses a cancelled order. It does **not** require the order to remain `payment_status='pending'` or require the attempt amount to equal the current outstanding balance before recording it; a different attempt can therefore be recorded/audited after another payment has settled the order. Candidate `20261110000900` adds those current-state and exact-due checks and leaves stale attempts pending for provider-side reconciliation. Hosted EXECUTE remains `service_role`/owner only; no provider or payment function was called.
3. **`record_counter_payment(text,uuid,text,bigint,uuid)` — materially aligned.** Hosted source authenticates owner/manager/cashier, takes the session then order lock, rejects pending online payment, scopes the order to the restaurant, reuses a matching method/order/amount/idempotency key, requires the exact outstanding balance, and writes the counter payment, paid status, and method-specific audit event. The hosted body hash also occurs in candidate `20261110000100_counter_payment_lock_order.sql`; no material behavior delta was found.
4. **`cancel_order(uuid,uuid,text)` — materially aligned.** Hosted source takes the session then order lock, obscures wrong guest tokens, checks the staff roles, rejects pending online payments and paid/served orders, treats repeat cancellation idempotently, and limits guest cancellation to a new order within ten minutes. Candidate `20261110000200_financial_session_serialization.sql` preserves these guards while using the same lock order.
5. **`set_order_line_quantities(uuid,jsonb,uuid)` — materially aligned.** Hosted source locks session then order; validates guest/staff authority, pending-online/paid/prep state, bounded array/UUID/integer quantities, duplicate and foreign line IDs; deletes zero-quantity lines before updates; and recomputes subtotal/tax/total using the order tax snapshot. The current candidate has the same business guards and lock order. No line-edit RPC was invoked.
6. **`close_order_session_and_issue_receipt(uuid)` — hosted guard already present.** Hosted source authorizes owner/manager/cashier, locks the session, sums each non-cancelled order's balance net of recorded tenant-matched payments, refuses first close with a positive balance, and repeats the balance check for a closed session that has no issued invoice before calling `issue_closed_session_receipt`. This is materially equivalent to candidate `20261110000800_checkout_outstanding_guard.sql`; replacing it only to chase the body hash is not justified.
7. **`place_public_order(text,jsonb,text,text,uuid,text)` — order admission gap, distinct from payment.** Hosted source validates the table session, serializes a guest-token retry, returns a matching prior order, calls the priced core, stamps verification, snapshots tax, and attaches the order to its table session. The hosted function body contains no success-order `hit_rate_limit` calls. The separate hosted `place_public_order_attempt` wrapper charges 60/session and 120/restaurant attempts per ten minutes, but that does not restore the intended 30/session and 60/restaurant successful-order caps or optional tenant-scoped IP cap. Candidate `20261110000300_shared_wifi_scan_limits.sql` adds those successful-order limits (including an IP key scoped by restaurant) while preserving the order/session behavior. This is a bounded throttling difference, not an unthrottled order path.

### Remaining pinned functions

8. **`open_table_session(text,text)` — materially aligned with current candidate and caller.** Hosted source validates token/IP-hash formats, locks a live QR row, respects code-verification mode, checks active table/restaurant/write state and published menu, enforces 10 opens per card/hour and 20 per card+IP/hour, then mints a 59-minute session and records the open. Its five-column return contract is the one consumed by `app/t/[token]/route.ts`; `limited` is handled. The candidate preserves these limits and contract.
9. **`operational_schema_readiness()` — compatible, intentionally narrow.** Hosted SQL checks five schema/permission probes (`orderSessions`, `settlement`, `invoices`, `paymentReceipts`, `announcementClaims`) and returns JSON booleans. Its order probe now names `place_public_order_attempt(...)`. The keys match `lib/health.ts` and its hosted body matches the current candidate source. This probe does not attest all nine function bodies, online-provider configuration, QR compatibility, or a recovery point; a green result cannot replace the NO-GO gates.

## Application callers, least-privilege ACL, and compatibility

### Order-attempt and legacy RPC callers

- The shipped checkout action `app/menu/checkout/actions.ts` calls only `place_public_order_attempt` with `p_slug`, `p_lines`, `p_note`, `p_session_token`, `p_guest_token`, and `p_ip_hash`. Hosted signature/result shape (`jsonb` containing `code` and `error`) matches `lib/db/database.ts` and `lib/order-attempt-result.ts`.
- Repository-wide runtime-source review found no application caller of the legacy `place_public_order(...)`. The only runtime SQL caller is the `SECURITY DEFINER` attempt wrapper; direct calls in `app/menu/throttle-db.integration.test.tsx` and `lib/db/readiness.integration.test.ts` are local test fixtures, not shipped browser call sites.
- The older `place_order(...)` name is a separate retired entrypoint. Do not conflate its overload revocation with the active `place_public_order(...)` API.

**Least-privilege recommendation:** keep `PUBLIC`, `anon`, and `authenticated` EXECUTE revoked on `place_public_order(...)`; do not restore the pinned snapshot's broader grants. Keep client access on the session-checking, attempt-budget wrapper. Hosted Staging currently allows the legacy function to `postgres` and `service_role`; the source scan found no direct application use by `service_role`, so a later operator-approved ACL review may consider removing that residual grant if no separate trusted server integration requires it. Do not change it in Phase 5B. The current state is safer than the pinned snapshot for the actual call graph.

### Readiness, staff TTS, online payments, and QR verification

- **Readiness:** hosted `place_public_order_attempt` is `SECURITY DEFINER`, owner `postgres`, returns `jsonb`, and has `anon`/`authenticated`/`service_role` EXECUTE. Its six arguments match the checkout action. Hosted readiness uses the active wrapper signature, and the app consumes the five expected boolean keys. The current migration preserves that compatibility.
- **Staff TTS:** hosted `reserve_staff_tts_attempt(uuid)` is `SECURITY DEFINER`, owner `postgres`, has `authenticated`/`service_role` EXECUTE, and returns `(allowed, retry_after_seconds)`. Its body hash matches `20261109000900_staff_tts_budget.sql`; `lib/tts-access.ts` consumes that row shape. The candidate client restriction on direct `hit_rate_limit` calls does not alter the definer-owned call path.
- **Online payments:** hosted begin/settle signatures match generated database types and remain non-client-callable (`service_role`/owner only). `payments.idempotency_key` has a unique index. On this Staging project, `payment_audit_events.actor_id` is nullable and its validated FK references `profiles(id) ON DELETE SET NULL`, so hosted settlement's null provider actor is schema-compatible. Candidate `20261110000700_payment_audit_provider_actor.sql` is unnecessary for the observed Staging shape. However, the checked application tree has no `begin_online_payment`/`settle_online_payment` call site, PayOnline component, or `/api/payments/razorpay/{verify,webhook}` route; README prose describes a flow not present in the tree. Keep online payments disabled; do not test or operate hosted payments.
- **QR verification:** hosted `verify_table_qr_with_code(text,text,text)` returns the seven fields consumed by `app/t/[token]/actions.ts`, and its `anon`/`authenticated`/`service_role` ACL matches the guest verification path. Its definer-owned reserve/clear helpers remain non-client-callable. Hosted `qr_verification_attempts` has the supported state shape (`qr_code_id`, `ip_hash`, `attempt_count`, `window_started_at`, `blocked_until`, `updated_at`) and unique `(qr_code_id, ip_hash)` key; the compatibility migration's state-shape branch recognizes it. No row data was inspected. The candidate migration keeps the public verification signature stable.
- **Table opening:** hosted `open_table_session(text,text)` returns the five columns typed in `lib/db/database.ts`; app code handles `opened`, `limited`, `code`, `revoked`, `notserving`, `nomenu`, and `unreadable`. Extra future `reused`/`held` handling in application helpers fails safely; those are not returned by the current hosted body.

### `20261109000400_order_write_boundary.sql` historical source-byte investigation

The recorded SHA-256 `891b6dd75e69d794437340b4d3c60904193a092cf7503868dd629e92f8759d0c` is reproducible from the exact 2,478-byte migration file at GitHub commit [`14a9391ef29e5c35323d3676f5e2844a5935b32b`](https://github.com/aryanp685/autodine/commit/14a9391ef29e5c35323d3676f5e2844a5935b32b). The `20261109000400` source block in `scripts/staging/approved-upgrade.sql` embeds those same bytes; after excluding the one extra newline added by the bundle builder, its SHA-256 is exactly the hosted manifest value. The bundle's source marker and insert both carry that value.

The current canonical file hash `e604a331a3f0e71850ecb93cc2fdc4266c001773de0af921cc9bd4e8aeead650` matches the later GitHub file at commit [`cbc4fcb4413b9370a8918af56d336bef19af8dab`](https://github.com/aryanp685/autodine/commit/cbc4fcb4413b9370a8918af56d336bef19af8dab). That revision changes the retired `place_order` revocation from a hard-coded four-argument overload to a catalog loop revoking every overload; it does not change the function bodies. The hosted migration ledger reports `20261109052519 / arena_staging_forward_upgrade_55`, and the manifest row timestamp is `2026-11-09 05:25:19.738192+00`, near the earlier artifact commit timestamp. This is strong source-level corroboration that the hosted row records the older reviewed bundle, not unexplained byte corruption. The hosted ledger exposes names/versions, not the executed SQL bytes or an independent execution receipt, so operator acceptance of deployment provenance is still required.

## Staging recovery-evidence request — operator action required

No operator-owned backup/PITR evidence has been verified. Earlier connected-app searches did not find a matching Drive record; that absence is not proof that no provider/operator record exists. The prior local cold-recovery drill is not hosted Staging evidence, and no restore was initiated or requested by this agent.

**Please provide an independently verifiable recovery record for Supabase Staging ref `juwyhslzchjevqkdvwjm` (`autodinetest`, `ap-northeast-2`) before any migration approval.** Metadata only—no customer rows, credentials, API keys, or payment data. Include:

1. The exact UTC snapshot/PITR recovery point, earliest/latest recoverable timestamps, retention window, and retention expiry.
2. The provider backup/PITR method and evidence provenance (provider operation/ticket/export reference and responsible operator).
3. The exact project ref and recovery scope (database schema/data and any excluded auth/storage/external dependencies).
4. Restore-verification timestamp in UTC, isolated target/ref, outcome, and metadata-level checks performed (schema/catalog checks, integrity/consistency results, and any approved row-count/checksum method—do not attach customer rows).
5. The authoritative time source/synchronization status used for these timestamps, plus the time and measured offset of the check.

This request has **not** been sent through Drive, Linear, or another operator channel. The operator should supply the evidence; this agent must not fabricate it or initiate a restore. Corroborate all timestamps against the provider clock because provider synchronization has not been independently verified.

## Remaining blockers

1. **Hosted baseline/provenance acceptance:** all nine pinned hashes still differ and the legacy order ACL differs. The historical source hash is explained by the older artifact, but the hosted manifest/ledger are not an independent execution receipt. Preserve `scripts/phase3/staging-baseline.json`; do not regenerate it. An operator must accept the provenance and the semantic classification without broadening legacy EXECUTE.
2. **Operator-owned recovery evidence:** not supplied or independently verified.
3. **Financial/order safety deltas:** the hosted online-payment functions lack the final stale-balance/second-pending safeguards, and the legacy order body lacks the intended successful-order caps. These are candidate forward fixes, not permission to migrate now.
4. **Online-payment application path:** no runtime UI/API call sites were found in the current tree, although README describes them. Do not enable online payment or operate hosted payment functions until the application flow exists and is separately reviewed.
5. **Fresh local SQL behavior validation:** this continuation had no local PostgreSQL binary/listener, so DB-backed Vitest suites were skipped. Earlier clean/synthetic PostgreSQL replay results remain historical evidence but do not validate the latest Phase 5B candidate functions. Run the necessary synthetic replay before any future migration decision.
6. **Clock assurance:** the six-day claim is withdrawn; the provider's authoritative synchronization status and recovery timestamp corroboration remain outstanding.

## Minimal forward-only migration plan (proposed only; not authorized or executed)

1. Keep NO-GO until the operator accepts the hosted source/ACL provenance and supplies independently verified Staging recovery evidence. Keep the pinned baseline immutable; capture any accepted hosted provenance in a separate, versioned reconciliation record.
2. Before touching Staging, replay the exact proposed final bodies on a disposable local PostgreSQL 17 environment with synthetic rows only. Include concurrent same-key and distinct-key online attempts, counter-vs-online settlement, stale amount/state, cancellation/repricing during a pending attempt, recorded/refunded/cancelled cases, order-rate budgets, and QR budget migration shapes. Use only fake provider identifiers; do not contact a payment provider.
3. If a separate Staging change is then approved, prepare a **new additive, forward-only migration** containing only the confirmed material deltas:
   - the final `begin_online_payment` and `settle_online_payment` bodies from `20261110000900_online_payment_attempt_uniqueness.sql`, preserving their signatures, `SECURITY DEFINER`, owner, search path, and existing service-role-only ACL; do not broaden permissions;
   - the `place_public_order` body from `20261110000300_shared_wifi_scan_limits.sql` that restores 30/session and 60/restaurant successful-order caps plus the restaurant-scoped optional IP cap. Keep the existing signature/ACL and attempt wrapper. The hosted `open_table_session` behavior is already materially aligned, so do not replace it merely as part of hash normalization.
4. Do not replay `scripts/staging/approved-upgrade.sql`, reapply historical migrations, or apply semantically equivalent replacements just to make MD5 values match. For the observed Staging state, counter collection, cancel/edit locking, close-session balance guard, order-attempt wrapper, readiness probe, QR state-table shape, and audit-actor nullable/FK shape are already materially compatible; `20261110000700_payment_audit_provider_actor.sql` is unnecessary for this Staging catalog. Defer the QR compatibility copy migration unless a separately verified schema need justifies it. Keep the table/sequence ACL cleanup and its `supabase_admin` owner-specific operation as a distinct, separately approved security change.
5. After any future approved Staging migration, take a fresh catalog-only before/after comparison of signatures, bodies, owners, settings, ACLs, and required columns, then use synthetic local tests for behavior. No Production action is part of this plan. Keep online payments disabled; no hosted payment event or provider flow is authorized by this reconciliation.

## Phase 5B validation and boundary

- `npm test -- --reporter=dot`: **167 test files passed, 2 skipped; 1,961 tests passed, 56 skipped**. The DB-backed suites were skipped because no local PostgreSQL server was available; the passing migration/contract and application tests are source/unit tests, not hosted behavior proof.
- `npm run typecheck` passed. `npm run sql:check` passed as the repository's static DDL-syntax/inventory check; by design it does not validate PL/pgSQL function bodies or prove a migration runs against PostgreSQL. `git diff --check` passed, and the updated report has no trailing-whitespace issues.
- Earlier local work documented clean and synthetic-Staging PostgreSQL 17.11 replays and 56/56 DB tests, plus other regression checks. Those results are retained as historical local evidence, not operator-owned hosted recovery evidence and not a fresh replay of the Phase 5B candidate deltas.
- Supabase inspection in this phase used catalog `SELECT`s only. No customer rows or secrets were read; no application RPC, DDL, DML, function/table permission change, migration, deployment, restore, or Production operation occurred. No hosted payment was operated.

## Required disposition and next gate

Remain **NO-GO**. First accept hosted baseline provenance and the semantic/ACL classification; independently verify the operator-owned Staging recovery evidence and timestamp source; then complete the fresh synthetic PostgreSQL replay. Only a separately approved, minimal forward-only Staging migration may follow. Do not update the pinned baseline, broaden `place_public_order(...)`, replay the old bundle, invoke hosted payments, or access Production.
