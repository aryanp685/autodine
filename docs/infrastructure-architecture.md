# AutoDine infrastructure architecture

**Evidence cutoff (Arena's authoritative task date):** 2026-11-06 UTC
**Branch:** `arena/fee715c2-autodine` · **base commit:** `b80ab3c50c3c5067130cde40b2757eb07e15fe7e`
**Status:** source architecture documented; hosted edge, recovery, and deployment state are only partially verified. This is not approval to change hosted infrastructure.
**Chronology:** Vercel/PR #184 metadata dated 2026-11-13 and repository artifacts dated 2026-11-12 are future-dated relative to this cutoff, not current hosted-state evidence; see the [complete report](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md).

## Executive decision

Keep the existing Next.js/Vercel application and Supabase backend. The repository contains no separate production app container, queue, or long-running worker requirement. Do not add an API gateway, reverse proxy, Redis, PGMQ, Kubernetes, or a second application host without a measured need, an owner-approved design, and a tested migration/rollback plan.

This document intentionally distinguishes repository configuration from hosted reality. It does **not** claim that Vercel Firewall/WAF, DDoS, bot protection, a custom edge rate limit, Supabase backups/PITR, or a particular proxy chain is enabled.

## Current topology and confidence

| Area | Evidence in this checkout | Confidence / limit |
|---|---|---|
| Application | Next.js App Router, server-rendered pages, route handlers, and Server Actions. `next.config.mjs`, `proxy.ts`, `vercel.json`, and the Vercel connector identify Vercel as the application host. | Source and provider metadata; no live Production or Preview HTTP probe was made. The effective current deployment and active-branch Preview were not established. |
| Application region | `vercel.json` sets `regions: ["bom1"]`. | Source configuration, not proof of the region serving every current deployment. Provider deployment metadata available in this review was timestamped after the authoritative evidence date and is treated as a chronology anomaly. |
| Data and identity | Source uses Supabase PostgreSQL, Auth, PostgREST/RPC, Storage, and Realtime. Preview isolation is enforced in source by `docs/preview-isolation.md` and the deployment-isolation helpers. | The app's source dependencies are verified; project mappings, migration parity, and the end-to-end runtime path are not blanket-certified. Do not point Preview/Development/CI at Production. |
| Supabase project metadata | The connected project list names `autodine-production` (`bdbaqpevwmgdvghszjno`, `ap-south-1`) and `autodinetest` (`juwyhslzchjevqkdvwjm`, `ap-northeast-2`), both PostgreSQL 17.11. | Metadata only. The test-named project is not assumed to be an accepted Staging target. Project health summaries include a nested Realtime connection discrepancy; it is unresolved, not evidence of either a healthy stream or an outage. |
| Queue / worker | No independent application worker or queue dependency was found in the inspected package/source inventory. Order and kitchen updates use Realtime with polling fallback; subscription expiry uses PostgreSQL scheduling. | Source inventory. There is no demonstrated workload that requires a new worker. |
| Containers | Docker/Supabase CLI is used for disposable local integration environments; the deployed Next.js app is not represented as a Docker production service in the inspected source. | Repository evidence only. No container orchestration service was inspected or changed. |
| Billing provider | `getBillingProvider()` currently returns `null`; provider-dependent subscription/payment actions fail closed, and the billing webhook returns before consuming a body when provider configuration is absent. | Current source behavior. No live provider callback was exercised. |
| Recovery | Backup/PITR configuration, retention, restore points, and a hosted restore were not established. Numeric RPO/RTO remain unknown. | Local synthetic recovery is not provider recovery. See `PHASE-7-RECOVERY-RPO-RTO.md` and `PRODUCTION-BACKUP-RUNBOOK.md`. |

## Trust boundaries

### Vercel and application routes

The Vercel host is the public application entry identified by the repository/provider metadata. `proxy.ts` handles session refresh and staff-session routing; it is not a general role authorization layer. Role layouts, Server Actions, route handlers, RLS/grants, and database RPCs make the application-level decisions. `/api` is excluded from the `proxy.ts` matcher, so each API handler must authorize its own request.

`next.config.mjs` declares response security headers, while `proxy.ts`/`lib/csp.ts` generate a per-request nonce CSP for matched document routes. The matcher excludes `/api` and framework/static assets. These are source facts only: no deployed response header was fetched in this review.

### Supabase

Authenticated client roles and row-level policies are part of the security boundary; security-definer RPCs must independently authorize their caller because they can bypass RLS. Guest order reads use the slug/code/bearer-token tuple. Guest order submission remains server-priced, tenant/session/idempotency checked in SQL, and **must never be throttled**.

Read-only Production catalog queries during this review confirmed an important exception to simplistic UI assumptions: `public.orders` has RLS enabled but not forced; `authenticated` has table/column `SELECT` on all 25 columns, including financial amounts and the guest bearer `guest_token`, and `orders_staff_read` scopes only by restaurant membership, not Owner/Manager/Cashier/Kitchen role. `anon` also retains table/column `SELECT` ACLs, but has no SELECT policy and no RLS bypass was found; no anonymous row access was demonstrated. `authenticated` has only a `prep_status` column UPDATE grant and no direct table INSERT/UPDATE/DELETE. Cashier UI projection is useful application-level minimization, but it is **not** a database finance or guest-token boundary. See the detailed evidence and safe follow-up decision in `docs/AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md`. No order rows or tokens were queried.

Subscription billing RPCs and table policies are also account-membership scoped for reads, while the current UI navigation and route gate permit Owner/Manager and plan-changing actions are Owner-only. Direct authenticated SQL/PostgREST reads remain broader than the page gate. Whether that account-member role visibility is intentional needs an explicit product/security decision; do not treat a route layout as a database boundary.

### Client-IP provenance

`lib/ip-hash.ts` uses the first `x-forwarded-for` value, falls back to `x-real-ip`, then uses the `unknown` bucket; it hashes the chosen string with a caller-provided salt. The code treats this as an abuse-friction key, not a user identity. Vercel's request-header behavior depends on proxy placement. The effective ingress and trusted-proxy chain for AutoDine are not established, so no header change or edge-IP rule is selected here.

## Edge and network architecture decisions

- No NGINX/Traefik/Caddy or Cloudflare proxy configuration was found in the inspected repository. Do not add a proxy or alter DNS/TLS as a default architecture step.
- The Vercel connector does not expose the project Firewall/WAF rule inventory, DDoS/bot state, rate-limit entitlement/rules, request logs, or analytics. Those controls are **UNVERIFIED**; the plan label alone does not prove features or enforcement.
- No request/traffic baseline or false-positive distribution is available. Therefore no numeric threshold, block/challenge action, or rule recommendation is made. Platform behavior described in provider documentation is not proof of this project's plan entitlement or current state.
- Vercel-originated requests and browser-to-Supabase requests are separate paths. A Vercel route rule cannot be assumed to protect a request made directly from the browser to Supabase.
- Do not add a custom rate limit to checkout/order-submission Server Actions. Preserve idempotent retries and existing database transaction rules. Any future edge rule must be proven not to match legitimate order submissions or expected guest/staff polling.

## Compute and asynchronous work

The current application has no independent long-running worker or queue-backed product flow. Realtime/polling handles operational refresh; PostgreSQL scheduling handles subscription expiry. Keep these simple until an approved use case requires retries or asynchronous execution outside an HTTP request.

If a real external side-effect later requires a queue, first define its owner-visible outcome, idempotency key, bounded retry/backoff, poison-message handling, retention, tenant validation, secrets, and recovery behavior. Then compare the smallest managed option with the actual workload. Queue products and provider references in PR #184 are proposals, not deployed architecture; no extension or worker is present by virtue of that PR.

## Recovery and regional planning

Connected project metadata reports the production-named project in `ap-south-1` and the test-named project in `ap-northeast-2`; `vercel.json` selects `bom1`. This does not prove the current request connection path, a supported latency/capacity envelope, or an accepted Staging topology. The reported nested Realtime health fields need operator investigation.

No current provider backup/PITR/retention settings, restore point, or hosted restore evidence was available through the connected surfaces. The local cold-recovery test uses synthetic disposable PostgreSQL and does not establish Production RPO/RTO. Do not publish an RPO/RTO number until an owner sets the objective and an isolated hosted restore drill measures the complete agreed recovery scope.

## Decision record and references

1. Keep Vercel + Next.js + Supabase; no infrastructure migration is justified by the source inventory alone.
2. Do not introduce an idle queue, app container, external proxy, DNS change, or Cloudflare proxy.
3. Keep edge settings and current hosted behavior marked **UNVERIFIED** until an owner-readable dashboard/configuration review and safe traffic baseline exist.
4. Treat table/RPC grants and RLS as distinct from UI projections. The orders finance-column gap is confirmed; a role-aware database read design needs a separate compatibility review before changing grants.
5. Keep Production read-only and Staging **NO-GO** absent the approvals and recovery/migration gates in `AGENTS.md`.

Related evidence: [complete infrastructure hardening report](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md), [edge-security runbook](edge-security-runbook.md), [Preview isolation](preview-isolation.md), [migration reconciliation](migration-reconciliation.md), and [recovery evidence](../PHASE-7-RECOVERY-RPO-RTO.md).
