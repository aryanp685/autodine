# AutoDine infrastructure architecture

**Evidence and review date:** 2026-11-06 UTC. Active branch `arena/f104d5d8-autodine`; checked-out HEAD and base are `b866601d5b0441b49b1c5aa7c9eb7d26b664d06c` (`main`, grafted checkout). No separate hardening commit is present in this checkout.
**Decision:** retain Next.js/Vercel + Supabase; do not add a second app host, queue, worker, proxy, or edge rule without measured need and separate approval. **Release remains NO-GO**; Production stays read-only and Staging NO-GO under `AGENTS.md`.
**Chronology:** HEAD's Git author/committer metadata (`2026-11-14T11:56:45+05:30`) and migration filenames beginning `20261112` / `20261114` are later than the authoritative cutoff and remain unexplained. They are not test timestamps or proof of hosted state/approval. The migrations are repository artifacts replayed only against disposable PostgreSQL. See the [complete hardening report](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md).

## Executive decision

Keep the managed Next.js App Router application on Vercel and Supabase for PostgreSQL, Auth, PostgREST/RPC, Storage, and Realtime infrastructure. No separate production application server, worker, queue, or container workload is justified by the repository inventory. Do not add an API gateway, reverse proxy, Redis, PGMQ, Kubernetes, or a second host without an approved workload, threat model, cost/operations owner, and tested migration/rollback plan.

This record separates **repository behavior** from **hosted configuration**. Source declarations and disposable-PostgreSQL tests do not prove which deployment is live, whether its migrations are applied, or which provider settings are active.

## Current topology and confidence

| Area | Repository evidence in this checkout | Hosted / operational evidence and limit |
|---|---|---|
| Application | Next.js App Router, Server Components, route handlers, Server Actions. `next.config.mjs`, `proxy.ts`, and `vercel.json` identify Vercel; `vercel.json` selects `bom1`. | No live Production or Preview HTTP/header probe was made. The serving deployment, effective region, runtime headers, and project settings are **UNVERIFIED**. |
| Data and identity | Supabase PostgreSQL, Auth, PostgREST/RPC, Storage, and Realtime SDKs are used by source. Preview isolation rules are in `docs/preview-isolation.md`. | Project mapping, migration parity, PostgREST behavior, and hosted role grants were not freshly queried in this continuation. Never point Preview, Development, CI, or local tests at Production. |
| Order-read boundary | The reviewed source includes forward migrations that limit authenticated staff to operational columns on `orders`/`order_items`, provide Owner/Manager/Cashier role-filtered finance views, and preserve guest-token edits while applying the restaurant write gate. No staff projection contains `guest_token`. | The migrations and role probes passed on disposable embedded PostgreSQL only. Direct PostgREST HTTP and hosted migration history, grants, RLS, and view state are **UNVERIFIED**. |
| Kitchen refresh / Realtime | Kitchen has no Postgres Changes subscription. It refreshes operational order and waiter-call reads every five seconds. The migration removes `orders` and `table_waiter_calls` from `supabase_realtime` and resets their replica identity from `FULL` to `DEFAULT`. | The source and publication change passed local database replay. The hosted publication and Realtime status are not checked; do not claim that Production stopped publishing these tables. |
| Disposable Supabase E2E/load CI | `.github/workflows/supabase-e2e-load.yml` is configured to run on pushes to `arena/e9e78732-autodine`; `workflow_dispatch` is also enabled. The active branch is `arena/f104d5d8-autodine`. | The full-stack workflow was not run. No rationale for the pin is documented in the grafted checkout; it is unclear whether it is an intentional long-term restriction or stale. The trigger was left unchanged pending owner confirmation. |
| Async work | No separate long-running app worker or queue is present in the checked source inventory. Subscription expiry is scheduled in PostgreSQL. | No workload or hosted metric justifies a new queue. The database scheduler's hosted state was not queried here. |
| Billing provider | `getBillingProvider()` returns `null`; provider-dependent actions fail closed, and the billing webhook returns before reading a body when no provider is configured. | No live provider callback or provider configuration was inspected. |
| Recovery | Local cold-recovery tooling uses synthetic disposable PostgreSQL. | Backup/PITR configuration, retention, restore points, hosted restore, and numeric RPO/RTO are **UNVERIFIED**. |
| Vercel edge | Security headers and nonce CSP are declared in source (`next.config.mjs`, `proxy.ts`, `lib/csp.ts`). | Effective Firewall/WAF, DDoS, bot, rate-limit entitlement/rules, request logs, analytics, and deployed headers are **UNVERIFIED**. No threshold is recommended. |

An earlier infrastructure report records project metadata, a read-only Production catalog observation, and a nested Realtime health-summary discrepancy. Those are historical observations, not a fresh check or diagnosis of this branch's hosted state; see the report's evidence and chronology sections.

## Trust boundaries

### Vercel and application routes

`proxy.ts` handles session refresh and staff-session routing; it is not the only role authorization layer. Layouts, Server Actions, route handlers, PostgreSQL grants/RLS, and RPC authorization must each enforce their own boundary. `/api` is excluded from the proxy matcher, so every API handler must authorize independently.

`next.config.mjs` declares response security headers, and `proxy.ts`/`lib/csp.ts` create a per-request nonce CSP for matched document routes. These are **source facts only**. No deployed response was fetched in this assessment.

### Supabase: tenant, role, and column boundaries

Owner, Manager, Cashier, and Kitchen are membership roles, not separate PostgreSQL login roles: their Supabase requests use PostgreSQL's shared `authenticated` role. Therefore table grants alone cannot distinguish Kitchen from Finance. In this checkout:

- RLS remains the tenant row boundary on `orders`; operational columns are granted to `authenticated`, while payment state, amounts, cancellation internals, and `guest_token` are excluded.
- Owner/Manager/Cashier access to order money is through `orders_finance` and `order_items_finance`; each view has a `security_barrier` and calls `has_restaurant_role` for the order's restaurant. The role-filtered views deliberately omit `guest_token`.
- `anon` receives no direct `orders` or `order_items` SELECT in the new migration. Guest order access continues through purpose-built functions and the existing guest credential contract.
- The cancellation RPC keeps guest-token cancellation and its existing session/payment safeguards, but ordinary staff cancellation is limited to Owner/Manager/Cashier. Kitchen receives a generic authorization denial before the function checks settlement state. Migration `20261112000700_order_line_edit_boundary.sql` applies the same finance-role boundary to staff edits, restores the restaurant write gate for the SECURITY DEFINER edit RPC, and keeps token-bound guest edits. Both gates run after caller authorization and before mutation. The edit RPC checks the write gate before its payment-state guards; cancellation retains its pending-online check and already-cancelled idempotent return before the write gate, then checks paid/served state. Already-cancelled retries remain idempotent.

These rules were exercised with disposable PostgreSQL under actual `anon` and `authenticated` roles and synthetic user claims. That is not a full PostgREST HTTP test or hosted migration-parity check.

The Kitchen UI previously displayed a payment-state badge and order total. This checkout **removes both** to honor the standing boundary that Kitchen must not receive financial order fields; it is an explicit product behavior change, not an accidental visual omission. The Kitchen board now polls ticket and waiter-call data every five seconds. If an unpaid indicator is later requested, it needs a separately approved, nonfinancial design that does not expose raw payment state or amounts to Kitchen.

Subscription billing is a separate read boundary enforced in source migration `20261114000100_owner_manager_subscription_reads.sql`. Direct `accounts`, `subscription_events`, `subscription_payments`, and `subscription_receipts` reads, plus all four billing-read RPCs, now admit only Owner/Manager memberships; guests, nonmembers, Cashier, and Kitchen receive no billing state/history/amount/receipt data. The event/payment history RPCs still clamp to 1–50 rows before JSON aggregation. Legacy `restaurants.plan`, `plan_status`, `trial_started_at`, `plan_started_at`, and `plan_expires_at` columns are not directly granted to API-facing roles. The completed application caller/type audit found no direct `.from('restaurants')` read that requests `account_id` or those billing columns. `Restaurant` has no `account_id`; `StaffRestaurant` omits the legacy billing fields; `staff.ts` receives the Owner/Manager account id from `restaurant_access()`, not the restaurant row. The role-safe `restaurant_access()` RPC returns Owner/Manager billing presentation but only `can_write`, `read_only`, and `features` to Cashier/Kitchen; `restaurant_trial_ends_at()` is Owner/Manager-only, while `restaurant_features()` / `restaurant_has_feature()` preserve member operational feature checks. The Cashier dashboard omits the plan notice and its Plans/Subscription links when this billing projection is null. These controls and tests passed only on disposable local PostgreSQL; hosted RLS, PostgREST behavior, and migration parity remain **UNVERIFIED**.

### Guest credential and request origin

Guest order reads use the restaurant/order identifiers and a bearer token. The initial order link still carries that token in its query string; the new staff database boundary does not remove that URL exposure. `lib/ip-hash.ts` treats forwarded IP data as an abuse-friction input, not identity. The actual ingress and trusted-proxy chain are unknown; do not change IP-header handling or use IP-only blocking until that chain and shared-NAT effects are established.

## Edge and network decisions

- No NGINX/Traefik/Caddy or Cloudflare proxy configuration was found in the inspected repository. Do not add a proxy or alter DNS/TLS by default.
- No evidence supports a custom rate-limit threshold, block/challenge action, or Vercel WAF recommendation. A plan label or provider documentation is not proof of a particular project's entitlement or effective protection.
- Browser-to-Supabase requests and Vercel-originated requests are separate paths. Vercel edge rules cannot be assumed to protect direct Supabase traffic.
- Do not rate-limit guest order submission or valid idempotent retries. Preserve server-priced checkout, verified table session, tenant validation, and database transaction rules.
- Follow `docs/edge-security-runbook.md` for any future, separately approved read-only discovery or change process.

## Compute, Realtime, and recovery

The application has no queue-backed product flow requiring an independent worker. Keep the managed architecture until a concrete external side effect requires bounded retries, idempotency, tenant validation, poison-message handling, retention, and an accountable operator.

Raw `orders` and `table_waiter_calls` rows are removed from Postgres Changes in the local migration candidate. The app uses five-second polling for those views instead of relying on a client-side filter as authorization. That trades sub-second waiter-call updates for minimized row delivery. Hosted publication state is **UNVERIFIED** until the migration is applied and independently checked in an approved environment.

Provider backup/PITR settings and a hosted restore were not established. Do not publish an RPO/RTO number until an owner approves the target and an isolated hosted restore drill measures the agreed recovery scope. Production must never be used for destructive or restore testing.

## Validation and decision record

Fresh local reruns are recorded in [`AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md`](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md): disposable PostgreSQL replayed 83 migrations and reported 157 passed / 2 optional direct PostgREST HTTP tests skipped across 7 files; the full Vitest suite reported 2,201 passed / 157 skipped across 203 files; typecheck, lint, design check, and parser-only SQL check passed. `npm run e2e:local` rebuilt the test-mode app and reported 64 Playwright passed / 49 Supabase-backed tests skipped / 0 failed. The 152-pass focused caller/UI suite is recorded from the earlier targeted rerun and includes the confirmed-row branding regression. These are local-source results only: the SQL HTTP skips and E2E integration skips are not passes. They do not establish remote PostgREST compatibility, Production/Staging parity, live Realtime behavior, hosted capacity, release readiness, or recovery.

1. Keep Vercel + Next.js + Supabase; add no infrastructure without measured need and owner approval.
2. Treat table/column grants, RLS, role-filtered views, RPCs, and UI projections as separate controls.
3. Keep hosted edge rules, current deployment, hosted migration state, request ingress, Realtime health, backups, and restore objectives marked **UNVERIFIED** until directly evidenced.
4. Release remains **NO-GO** pending approved hosted migration/parity checks and the other gates in the complete report and `AGENTS.md`.
