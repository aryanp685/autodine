# AutoDine production SaaS readiness assessment

> **Historical assessment (2026-10-28).** Its measured migration counts, hosted-project state, test totals and recommendations are snapshots, not current facts. The 2026-11-12 [handoff report](autodine-handoff-report-2026-11-12.md) records later production changes. The launch blockers that require external evidence (backup/restore, alert delivery, full hosted workflows, supported devices and capacity) remain unverified unless a newer record says otherwise. Production was not re-queried in the current code audit.

## Continuation update (2026-10-28)

The current safe test evidence is stronger than the prior hosted-project snapshot but still does not close the full-stack gate. The branch now has a reproducible GitHub-hosted workflow for a disposable Supabase stack (Postgres 17, Auth, Storage, Realtime and Studio), synthetic auth/data fixtures, all 47 real integration tests, and 5,000-guest API/Realtime load measurements; that workflow has not yet completed, so it is a plan, not evidence. This sandbox did run the 64 hermetic Playwright cases (**64 passed, 0 skipped, 0 failed**) and the embedded PostgreSQL 17 suite (all 45 migrations with the marked local-only scaffold, 10 scan/order SQL checks, 5 PostgreSQL-gated tests, and 5,000 synthetic sessions plus 5,000 SQL orders across 100 restaurants; pool cap 64; session-open 2.378s ≈2,103/s and order-write 35.545s ≈141/s). That embedded DB has no Supabase Auth, Storage HTTP API, Realtime service or Studio, so these metrics are not hosted capacity claims. `npm test` passed 1,905 tests with 5 database-only cases skipped; typecheck, lint, design guard and SQL syntax checks passed. No production database rows/configuration were accessed, no deployment occurred, and no restore drill was run. The connected project listing identifies production as `autodine-production` (`bdbaqpevwmgdvghszjno`, `ap-south-1`, PostgreSQL 17.11, `ACTIVE_HEALTHY`) and the separately designated test project as `autodinetest` (`juwyhslzchjevqkdvwjm`, `ap-northeast-2`, PostgreSQL 17.11). The Supabase connector does not expose backup/PITR/retention settings; production backup state remains unverified. The earlier dashboard screenshot saying “No backups” remains the only backup-specific evidence. Minimum next external access: read-only Supabase Dashboard visibility for the production project's Backups/PITR/retention page only; do not provide credentials in chat. Any restore test still needs a separately approved non-production restore target.

**Snapshot:** 2026-10-28
**Branch:** `arena/e9e78732-autodine` (not merged to `main` or deployed to production)

**Hosted checks on `068dd68`:** [CI 42463704016](https://github.com/aryanp685/autodine/actions/runs/42463704016), [browser E2E 42463703991](https://github.com/aryanp685/autodine/actions/runs/42463703991), and [isolated PostgreSQL/browser E2E 42463704311](https://github.com/aryanp685/autodine/actions/runs/42463704311) passed.

**Decision:** **NO-GO for general commercial production launch today.** The repository contains substantial production-minded controls and several real disposable-PostgreSQL proofs, but there is no verified capacity envelope, live-schema parity evidence, operator-grade monitoring/backup/restore/incident process, or supported guarantee for the kitchen TTS dependency. No production service or data was used for tests, load tests, or schema verification. No production deployment/configuration was changed. GST Option A is unchanged; this is not a tax/legal approval.

## 1. Scope and evidence standard

This assessment reviewed the checked-in Next.js/Supabase architecture, route/action authorization, kitchen/status polling, payment and receipt migrations, operational workflows, CI/E2E setup, deployment configuration and the current local test results. The repository has 45 Supabase migrations. `npm run sql:check` reports parseable DDL where supported, but explicitly does **not** validate function bodies, grants, RLS policy behavior, or live schema parity.

Evidence is classified as:

- **Code-reviewed:** implementation and policies were read; not equivalent to runtime proof.
- **Unit/mock:** deterministic logic or UI; external service/database behavior is mocked.
- **Disposable DB:** synthetic data on a throwaway PostgreSQL environment built from migrations and local-only compatibility scaffolding.
- **Hosted service:** one user-designated non-production Supabase project was checked for project health, migration history, and catalog metadata only. No table rows were read, no schema or data was changed, and no provider-backed app tests were run. Production was not queried.

The former non-production ref `jubaqjlnmbntogeyjiwt` returned 404 `Resource has been removed`; do not retry it. The earlier candidate `dealflow` (`pkabdtuowxdgqovkfvmp`) was verified to be another application's schema; it was not changed. The visible `autodine-production` project was not queried or used. The user designated `autodinetest` (`juwyhslzchjevqkdvwjm`, `ap-northeast-2`) as the dedicated non-production target. It reports `ACTIVE_HEALTHY` on PostgreSQL 17.11. After confirming it was initially empty, I applied three repository migrations (`20261019000001_init`, `20261019000002_public_read`, `20261020000004_counter_payment`) plus the explicitly marked local-only `autodine_local_test_scaffold`; 42 repository migrations remain, so this is not the app's full schema. It now has 16 public tables, all 16 with RLS enabled, 22 policies, and the expected base/order/payment functions plus platform `rls_auto_enable`. The Supabase migration ledger has four entries: the three repository migrations plus the test-only scaffold; its generated version timestamps are 2026-11-08 because of the database clock. The earlier disposable SQL order smoke created a synthetic restaurant/table/item/QR token, called `place_order` for two 1,234-paise items, verified one order line and the expected 2,591-paise total (including 5% sample tax), then deleted its fixtures; follow-up counts confirmed zero restaurants, orders, order lines, or residual smoke table/item. No customer data was present or used. The test-only scaffold and partial schema do not establish production parity. Realtime is marked healthy but details still report `db_connected=false` and `replication_connected=false`. The DB clock returned `2026-11-08 09:13:39 UTC` (server start `05:23:22 UTC`), and project metadata says created 2026-11-08—11 days ahead of the authoritative date 2026-10-28. Migration versions were also generated with that future date. Treat this as a confirmed clock anomaly: do not run date-sensitive app flows or Realtime tests until explained/fixed. The partially initialized test schema does not establish production parity and must not receive customer traffic.

## 2. Architecture and operating model

- **Web:** Next.js 16 / React 19, deployed target configured for Vercel region `bom1` in `vercel.json`.
- **Data/auth:** Supabase Auth, Postgres, PostgREST and Realtime. The ordinary app uses the publishable key and authenticated server/browser clients; the server-only secret client bypasses RLS and must remain isolated.
- **Tenant model:** staff restaurant scope is derived from authenticated membership in `lib/db/staff.ts`, never from a client-selected restaurant ID. Staff writes also use role checks and database RLS/SECURITY DEFINER functions. Guest paths use QR/session capabilities and unguessable order tokens rather than opening guest access to all orders.
- **Business invariants:** monetary totals are stored in paise and computed server-side; order lines snapshot item details; guest order retries use an idempotency token; payment and session settlement and receipt issuance use database functions/constraints.
- **Realtime/fallback:** kitchen uses Supabase Realtime with periodic server refresh as fallback; guest order status polls at 10 seconds while visible, backs off on errors and stops at terminal state. Kitchen board refresh is five seconds during Realtime degradation. Kitchen Web Locks elect a speaker only within a browser profile; database announcement claims arbitrate across devices.
- **Deployment limits visible in repository:** only a preferred Vercel region is specified. No function maximum concurrency, database tier/compute, connection-pool budget, autoscaling limit, multi-region failover, or service-level objective is configured here. The app mainly uses Supabase HTTP APIs rather than opening a direct PostgreSQL connection per web request, but database/PostgREST/Realtime plan limits remain unknown.

## 3. Explicit planning capacity (assumptions, not a promise or measurement)

Registered accounts are not concurrent users. Use this initial planning scenario until product analytics and a controlled load test replace it:

| Dimension | Planning assumption | Derived load |
|---|---:|---:|
| Registered/contracted restaurants | 1,000 | Not treated as simultaneous workload |
| Simultaneously serving restaurants at lunch | 50 (5% of the assumed base) | Active-tenant basis |
| Staff screens per active restaurant | 5 | 250 simultaneous staff screens |
| Visible guest order-status screens | 1,000 (20 per active restaurant) | 1,000 simultaneous polling clients |
| Sustained new orders | 6/minute/restaurant | 300/minute = 5 order writes/second across 50 tenants |
| Brief order burst | 2× the sustained aggregate for up to 60 seconds | 10 order writes/second aggregate; must be proven under disposable load |
| Kitchen fallback polling | One request per board every 5 seconds while Realtime is unhealthy | 250 boards = 50 requests/second |
| Guest status polling | One request per active guest every 10 seconds | 1,000 guests = 100 requests/second |
| Poll-only subtotal | Excludes menu browse, auth, table validation, cashier/dashboard refreshes, images, and Realtime events | At least 150 app requests/second at this scenario, before other traffic |

The existing database order budget is 60 accepted order attempts per restaurant per 10-minute window (plus per-session and optional hashed-IP budgets). That is a safety brake, not proof of serving this planning scenario indefinitely; a 6/minute average uses that tenant budget. Rate-limit refusals, normal-load headroom and recovery behavior must be measured. Kitchen refresh is only periodic fallback; Realtime connection/channel quotas must be obtained from the provider before treating this as a supported capacity.

A minimum acceptance exercise before launch should run on a fresh disposable database with 1× and 2× the scenario above, then a 30-minute soak and a controlled database/API slowdown. Record p50/p95/p99 latency, error and rate-limit percentages, DB CPU/IO/lock waits, PostgREST pool waits, Realtime disconnects, Vercel function concurrency/duration/memory and order/receipt reconciliation. Proposed engineering gates (to be ratified with product/ops): ordinary browse/status p95 < 1 s, order submit p95 < 2 s, staff state change p95 < 1 s, error rate < 0.5% at 1×, zero lost/duplicate financial/order records, and recovery to the 1× SLO within five minutes after the injected fault. These are proposed targets, not achieved results.

### Scaling and likely bottlenecks

- `hit_rate_limit` performs an atomic upsert; each restaurant order shares a tenant counter key. This gives cross-instance consistency but serializes bursts on that key and adds database work to every order. Measure row-lock wait and transaction duration.
- Kitchen fallback and guest polling create predictable high request volume (150 requests/sec in the scenario above, before regular browsing). SSR refreshes may fan into multiple Supabase queries per request; query count and database work per view have not been profiled.
- QR verification counts recent opens, order/session rows, reports, and Realtime subscriptions may become hot/index-sensitive at scale. Query plans, representative data volume, connection/compute ceilings and index bloat have not been tested.
- Vercel can scale application invocations, but horizontal app scaling does not raise Supabase Postgres, PostgREST, Realtime, or provider limits. No safe maximum capacity can be claimed from source inspection.

## 4. Security and tenant-isolation assessment

| Area | Current control/evidence | Remaining production gate |
|---|---|---|
| Tenant selection | Staff restaurant and role are membership-derived; actions generally bind `restaurant_id`; RLS is the database backstop. | Run adversarial two-tenant authenticated tests through the real app and PostgREST for every table/RPC/storage path; verify production schema permissions only through approved non-production clone. |
| Privileged DB access | Admin client is marked `server-only`; secret key is documented as RLS-bypassing; admin trial route/action use a constant-time secret check. | Rotate/manage keys through provider controls, audit secret access/rotation, and inventory all definer functions/grants against deployed schema. No organization-wide secret scanning/rotation evidence was established here. |
| Guest IDOR | QR session/token functions restrict guest reads; guest order status uses an unguessable token and no broad `anon` order read policy was identified. | Fuzz malformed, expired, revoked, cross-tenant, replayed and guessed capabilities against disposable PostgREST; do not infer exhaustive IDOR resistance from selected tests. |
| Input/injection | SQL values generally pass via typed RPC parameters; SSML text is escaped and voice/prosody are normalized. | Complete hostile input/property and authorization testing across imports, AI output, settings, uploads, and all function arguments. |
| Rate limits | Database-backed atomic budgets exist for QR verification, order placement and staff invites. | IP hashes depend on forwarded headers that may be caller-forged unless the platform's trusted ingress behavior is configured; treat those as abuse signals, not identity. Confirm edge/WAF rules and limits on all public routes. |
| TTS relay | This assessment hardens `/api/tts`: kitchen-role authentication, bounded request size/text, a shared tenant counter, no-store audio, and no announcement text in error logs. Unit tests cover the route contract. | Provider response is still dependent on unsupported Microsoft Read Aloud; validate real authenticated behavior only in an approved non-production deployment. Configure platform-level DDoS/WAF limits too. |
| Browser headers | `next.config.mjs` sets `nosniff`, referrer, frame and permissions headers. | Review CSP, cookie flags, origin/CSRF behavior and security headers against actual production responses; no external scanner was run. |
| Sensitive data/privacy | Guest IP is hashed before storage in the documented rate-limit flows; TTS is not designed to store text. | Specify retention/deletion for orders, invoices, audit records, account data, hashed IP counters and logs; assign privacy owner and retention schedule. |
| Webhooks/secrets | No active online-payment or subscription webhook route was found under `app/api`. | Keep provider variables disabled unless a separate approved implementation adds signature verification, replay protection, idempotency and rotation. |

**TTS route change in this branch:** anonymous access previously allowed arbitrary server-side synthesis and had no input length or shared request limit; the success response was cacheable. It now refuses unauthenticated/non-kitchen callers, caps body at 8 KiB and text at 1,200 Unicode characters, applies 120 requests/minute per membership-derived restaurant through the shared DB counter, returns 429 with `Retry-After`, fails closed if the shared limiter is unavailable, sets `private, no-store`, and logs only an error class. Browser speech remains a fallback. This does not establish Microsoft service reliability.

## 5. Reliability and business-critical feature matrix

| Workflow | Implemented path | Available evidence | Gap/qualification |
|---|---|---|---|
| QR/table verification | QR token + code/scan mode, session expiry and attempt budgets in SQL | Unit tests; historical isolated Postgres/PostgREST browser suite passed QR-throttle cases | Exact live-schema parity and broad abuse/failure scenarios unavailable; forwarded IP inputs are forgeable |
| Guest order placement | Server-priced order RPC, session binding, per-session/table/IP budgets, unique guest idempotency token | Disposable PostgreSQL integration proves complete order lifecycle; C4 two-writer race persisted one order/item/session; hosted isolated run also passed the 16-guest/16-connection order burst with 16 unique persisted orders, one line each and correct totals | This is a small synthetic burst, not 1×/2× production capacity, soak, resource or horizontal-scale evidence |
| Incremental ordering / KOT | Order sessions, immutable order items, kitchen board, database announcement claims | Unit/component coverage and prior order lifecycle evidence | No sustained kitchen/Realtime failure test, hardware printer evidence, or multi-device physical restaurant trial |
| Kitchen state | Compare-and-set prep transitions; realtime fast path and polling fallback | Unit/action tests; database order lifecycle | Web Locks only coordinate same browser profile; external-device election is DB-based. Realtime quotas/outage delivery not measured |
| Guest checkout | Cart to order, idempotent submit and explicit retry outcomes | Unit tests and DB idempotency race | Browser/network fault-injection for lost response after commit, captive portal and long outage remains incomplete |
| Cashier settlement | Manual/counter payment and session settlement, amounts derived by SQL | Prior disposable lifecycle asserted amount, `recorded_by`, closed session and audit event | No real cashier authorization matrix across two tenants in browser; cash drawer/reconciliation process is operationally external |
| Invoice/receipt | Atomic session close and numbered immutable receipt/invoice issuance | Disposable lifecycle proved one receipt and same ID on retry | GST Option A intentionally untouched and not reviewed for legal compliance; invoice/financial-year boundary and recovery drills need expansion |
| Subscription expiry | Database write gate and plan/entitlement functions | Code/migration tests and schema logic review | No live billing provider, payment collection, renewal webhook, expiry ops dashboard or billing reconciliation; trial renewal is admin-operated |
| Discounts/roles | Permission and discount/business rules in application/SQL | Unit coverage | Need end-to-end privilege-escalation and concurrent role-change tests against throwaway PostgREST |
| TTS / kitchen announcement | Optional server speech with browser fallback; cross-device announcement claim | Mocked route tests and informational live-probe workflow exists | Microsoft Read Aloud interface is undocumented/unsupported and has no availability guarantee. No current live provider verification here |
| AI/menu integrations | Optional AI features via configured provider keys | Mocked unit behavior | No authorized non-production provider credentials in this run; mocks are not integration verification |
| Online guest payments | Not enabled in the approved pay-at-counter product path | Code/config audit; no online-payment route found | Historical schema remnants are not an enabled provider integration. Do not enable from old migration references alone |

The successful recent disposable lifecycle was: guest order persistence → kitchen transition → cashier settlement with recorded staff identity → session close → receipt issue and idempotent retry. It is valuable evidence, but it is not proof for every role, browser, production schema, or outage case.

## 6. Database, migrations and rollback

- 45 ordered migration files; recent migrations add shared rate limits, idempotency, QR/session flows, menu snapshots, subscriptions/write gates, payment audit, receipts/invoices, and security hardening.
- Migration tests and static SQL checking exist. The local PostgreSQL runner builds a throwaway database from repository migrations plus explicitly marked compatibility scaffolding for objects absent from this repository. It is not a production schema clone.
- Prior CI at branch head `626ba26` passed isolated PostgreSQL/browser workflows, including the receipt lifecycle. On branch commit `068dd68`, hosted CI `42463704016`, browser E2E `42463703991`, and isolated PostgreSQL/browser run `42463704311` passed; the latter passed all five database cases, including the new 16-independent-order/16-connection smoke. Browser E2E reported 64 passed, 47 skipped, and zero failed. Ordinary local `npm test` skips those five DB cases when `THROTTLE_DB_URL` is not set.
- No complete automated downgrade/rollback path was found. Many business migrations are forward-only. Before any production migration: take a provider snapshot/PITR point, run the exact migration on a schema-faithful disposable clone, verify pre/post object/grant/index/data behavior, capture executable rollback or forward-fix steps, and obtain separate deployment approval. The user has not authorized production changes.
- The designated `autodinetest` project now contains three ordered repository migrations, one explicitly local-only scaffold, and a successful synthetic SQL `place_order` smoke whose fixtures were removed. The other 42 repository migrations and full app/PostgREST integration tests remain outstanding. `record_counter_payment` is defined but not yet runtime-tested: `restaurant_can_write(uuid)` and `payments.recorded_by` arrive in later migrations, while `payment_audit_events` has no checked-in create migration and exists here only through the inferred local scaffold. Do not treat this partial project as production-ready. Its DB clock is future-dated; the Realtime status must be rechecked after applying the Realtime publication migration rather than diagnosed from the current partial schema. `dealflow` is unrelated. Keep local-only scaffolds labeled as inferred test scaffolding, not production DDL. No production queries or schema comparisons are authorized; no independent approved production schema artifact was available. Never use production.

## 7. Operations, availability, backup/DR and privacy

- CI includes unit/lint/type checks and browser/isolated-DB workflows. The TTS workflow is informational and contacts an unsupported external service. CI success is not a production deployment gate; no release approval/rollback policy was established by repository configuration alone.
- `/api/health` reports fixed, low-detail configuration/schema booleans with `no-store`; it is a diagnostic endpoint, not monitoring. No checked-in uptime monitor, error tracker, metrics dashboard, paging/alert thresholds, on-call rota, SLO burn alert, or incident runbook was found in the reviewed repository.
- No repository-defined automated backup schedule, retention policy, PITR guarantee, restore automation, or restore-drill record was found. Provider-side backup capability and plan are unknown. RPO/RTO are therefore **undefined**, not zero.
- There is no documented incident severity model, escalation/contact tree, customer notification process, security incident/evidence procedure, lost-order/payment reconciliation playbook, or disaster-region failover exercise.
- Vercel region is pinned to Mumbai (`bom1`) while the database region/compute is unknown. Confirm data residency, latency, backup region, subprocessors and contractual availability with the provider before setting customer commitments.
- Implement external synthetic checks, structured redacted request/error metrics, database saturation/connection/lock alerts, Realtime health, abuse/WAF dashboards, backup success alerts, and a scheduled restore drill. Logs must not include guest order content, QR/session tokens, auth cookies, or credentials.

## 8. Cost model (not a vendor quote)

A defensible INR/USD monthly amount is **not available from repository evidence**: the deployed Vercel/Supabase plans, database size/compute, egress, storage, Realtime quotas, retention, support tier and current rates are not present, and no vendor pricing was verified in this task. Do not treat the ₹0 label for Microsoft Read Aloud as a commercial SLA or committed price.

The planning scenario above implies, if sustained for four lunch hours/day and 22 days/month:

- Poll-only app/API volume: `150 req/s × 3,600 × 4 × 22 ≈ 47.5 million requests/month`, before menu browsing and staff/dashboard reads.
- New-order attempts: `300/min × 60 × 4 × 22 ≈ 1.584 million/month` (subject to the actual per-restaurant rate budget).
- Up to one TTS synthesis per announced order: as many as 1.584 million provider calls/month if every order is announced via server speech; real share should be measured and capped.
- Approximate serverless compute formula: request volume × mean billed duration × memory allocation; database cost additionally depends on active compute, storage/backup retention, egress, realtime connections/messages, and query count per request.

Before a budget is approved, obtain actual vendor plans/rate cards and quotes, instrument request/query/egress metrics on non-production, then calculate 0.25×, 1×, and 2× demand including a recovery margin. Cost per restaurant should include support, backup/restore, monitoring, taxes/FX and incident cover, not just hosting.

## 9. Checks run in this assessment

| Check | Result | Interpretation |
|---|---|---|
| `npm ci` | Passed; 314 packages audited, npm reported 0 vulnerabilities | Dependency audit only; provider/runtime security is separate |
| `npm test` | 1,905 passed; 5 database-backed tests skipped | 156 test files passed and 1 integration-only file skipped; those 5 are not passes |
| `npm run lint` | Passed | Static lint only |
| `npm run typecheck` | Passed | TypeScript check only |
| `npm run design:check` | Passed | UI design constraints only |
| `npm run sql:check` | Completed with explicit DDL-only/unverified caveats | Not a full SQL/RLS/migration validation |
| `npm run env:check` | Failed because local Supabase URL, publishable key and server secret are absent | Expected in this environment; no credentials were requested or supplied |
| Production build (hermetic, no service credentials) | Passed in `npm run e2e:demo`; app built against explicit demo mode | No production credentials; this build does not prove service integration |
| Hermetic Playwright | `npm run e2e:demo`: **64 passed, 0 skipped, 0 failed** in 1m50s using bundled Chromium | Demo-mode browser behavior only; the remaining 47 integration cases require the full disposable stack |
| `npm run test:db:local` | Passed: all 45 repository migrations plus marked local-only shim/scaffold, schema checks, 10 SQL scan/order assertions and all 5 PostgreSQL-gated tests; synthetic load verified 5,000 sessions + 5,000 orders across 100 restaurants with a 64-connection cap | Embedded PostgreSQL is not Supabase Auth/Storage/Realtime/Studio. Measured 2.378s session open (≈2,103/s) and 35.545s order writes (≈141/s); database-only, not hosted/API capacity |
| Full Supabase CI workflow | `.github/workflows/supabase-e2e-load.yml` added; its external GitHub Actions run has not completed yet | No claim for the 47 Supabase-backed Playwright tests, API requests or Realtime fan-out until artifact evidence exists |
| 16-order DB capacity smoke | Historical isolated PostgreSQL workflow `42410329254`: 16 synthetic independent orders through a 16-connection pool, unique orders/lines and correct totals | Small database burst only; no measured hosted service/resource profile, 1×/2× target load, soak, or horizontal-scale proof |
| Historical hosted test-project work | An earlier snapshot of `autodinetest` recorded a partial migration application, inferred test scaffold, and synthetic order smoke | Historical only: the hosted project was not used for this turn's tests. Its future-dated clock and incomplete schema remain reasons not to treat it as a full-stack target without review; no production was queried |
| Current Supabase project metadata | Read-only project listing: `autodine-production` ref `bdbaqpevwmgdvghszjno`, `ACTIVE_HEALTHY`, `ap-south-1`, PostgreSQL 17.11; `autodinetest` ref `juwyhslzchjevqkdvwjm`, `ACTIVE_HEALTHY`, `ap-northeast-2`, PostgreSQL 17.11 | Metadata only; no production rows or configuration were read. Connector has no backup/PITR/retention endpoint, so backup state remains unknown |
| Production/non-production provider tests | No provider-backed application, backup, restore, or load tests in this turn | The new full-stack workflow targets only disposable local Docker services; `dealflow` remains unrelated, and no production deployment/data use is authorized |

## 10. Go-live blockers and concrete next actions

**P0 — before any commercial production launch**

1. Complete and inspect the newly added disposable Supabase CI run. The local-only fixture preparer applies all 45 checked-in migrations plus the explicitly inferred scaffold, seeds ephemeral Auth users and synthetic records, and supplies 25 distinct per-test guest cards plus a reserved throttle card. Verify the uploaded integration report is exactly 47 passed, 0 skipped, 0 failed; do not treat the workflow definition itself as evidence. No hosted database, production data, or production schema is a test target.
2. Inspect the workflow's actual 5,000-session/order, Next.js menu-read and kitchen Realtime report. It is an initial 100-restaurant synthetic peak workload, not a hosted Supabase capacity guarantee; add a 30-minute soak, injected service degradation and provider resource telemetry before publishing an SLA or supported capacity. Preserve the embedded PostgreSQL results as a database-only baseline.
3. For exact project `autodine-production` (`bdbaqpevwmgdvghszjno`), obtain minimum read-only Dashboard visibility limited to Backups/PITR/retention and verify schedule, retention, restore points and dates. Do not access customer tables or change configuration. A restore drill needs a separately approved non-production destination; no production restore test is allowed without explicit approval. Set RPO/RTO and runbook only after evidence exists.
4. Add service monitoring/alerts/on-call and incident/security/privacy response processes; prove alert delivery and recovery in a tabletop/drill.
5. Decide whether unsupported Microsoft TTS is acceptable as a best-effort, noncritical convenience. If it becomes operationally critical, choose a supported speech service with a vendor SLA and test credentials; browser speech remains fallback only.
6. Confirm provider plans, region/data residency, terms, rate cards, retention and contractual support; produce a budget and customer-facing availability/capacity commitments from measurements.
7. Run authenticated multi-tenant adversarial browser/PostgREST tests across owner/manager/kitchen/cashier, account switching, storage, guest capabilities, order replay, checkout/receipt races and subscription expiry; include dependency and security scanning as a release gate.
8. Define migration review, snapshot, rollback/forward-fix and release approval procedure. Production deployment/database changes remain subject to separate user approval.

**P1 — before broad rollout**

- Load-test realistic menu sizes, QR scans, status refresh, kitchen Realtime reconnect, concurrent checkouts, cashier close/receipt retry and table-session traffic.
- Define data retention/deletion, audit access, privacy notices and support workflow; validate log redaction and rate-limit anti-abuse controls at trusted ingress.
- Verify email/auth recovery, image/storage limits and AI providers only with authorized non-production credentials; clearly record which providers are mocks versus live verification.
- Preserve the frozen GST Option A behavior; route tax/legal questions through the separate adviser-approval process.

## 11. Final assessment

AutoDine has a credible application foundation: server-priced/idempotent guest ordering, membership-derived staff tenancy, database authorization and money invariants, explicit polling fallback, security-oriented SQL grants and a tested settlement/receipt lifecycle. This supports continued controlled pre-production work. It does **not** yet substantiate general production readiness, an availability/capacity promise, disaster recoverability, provider reliability, exact live-schema parity, or a cost estimate. The go-live decision remains **NO-GO** until the P0 actions above have evidence and owners.
