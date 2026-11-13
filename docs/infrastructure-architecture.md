# AutoDine infrastructure architecture decision record

**Date:** 2026-11-13  
**Status:** Proposed architecture; no hosted infrastructure changes authorized by this document  
**Scope:** Reverse proxy/API gateway, edge security/CDN, containers/orchestration, background jobs/queues, managed database

## Executive decision

Keep the existing Vercel + Next.js + Supabase architecture. Do not add all five technology groups as separate products just because they are available. Prefer the fewest moving parts that satisfy a measured product requirement.

| Area | Current state found in repository / latest handoff | Decision |
|---|---|---|
| Reverse proxy / API gateway | Next.js App Router hosted on Vercel; Vercel region `bom1`; no NGINX/Traefik/Caddy integration found in the inspected code/config | Use Vercel's native edge network, routing and firewall. Do not place a self-hosted proxy in front of Vercel without a documented requirement and Vercel compatibility review. |
| Cloud security / CDN | Vercel deployment already includes an edge delivery network and platform firewall; no Cloudflare integration/config found | Start with Vercel Firewall/WAF and existing app/database controls. Defer Cloudflare proxy/CDN until a specific gap is measured. Cloudflare DNS-only is a separate, optional DNS decision. |
| Containers / orchestration | `supabase/config.toml` documents `supabase start` using Docker for a disposable local Supabase stack; no app Dockerfile/Compose deployment was identified in the inspected paths. CI already uses isolated local Supabase/Postgres workflows. | Keep Docker for local integration testing. Do not containerize the Vercel web app merely for consistency. No Kubernetes/ECS now. Add a worker container only when a real long-running worker exists. |
| Background jobs / queues | No Redis, BullMQ, Celery, Sidekiq or application queue dependency found in `package.json`. Kitchen/order state already uses Supabase Realtime with polling fallback. Subscription expiry uses the existing Postgres scheduler. | Do not add an idle queue. For a concrete transactional side-effect that needs retry (e.g. provider-backed email/webhook), evaluate Supabase Queues (pgmq) first because it is PostgreSQL-native and can be enqueued in the same transaction as the domain change. Keep Redis/BullMQ as a later option if measured requirements demand a separate high-throughput worker platform. |
| Managed database | Supabase PostgreSQL/Auth/Realtime is the existing backend. Latest handoff records production DB region `ap-south-1`; Vercel app region is `bom1` (Mumbai). Staging is in `ap-northeast-2`. | Keep Supabase. Production app/database region alignment is already appropriate. Do not migrate to RDS or Neon without a concrete capability, residency, availability or cost case. |

## Evidence-backed architecture notes

### 1. Reverse proxy and API gateway

Vercel already provides the application's public ingress, TLS/CDN delivery, routing and firewall. Its current documentation explicitly advises against placing a reverse proxy in front of a Vercel project because it reduces Vercel's traffic visibility, can obscure client IP identification and can weaken firewall effectiveness. Vercel documents a Verified Proxy path for supported providers, but that is an exception path, not a reason to add NGINX, Traefik or Caddy by default.

**Decision:** no external reverse proxy in the current topology. Use:
- Vercel native routing/rewrites for path routing;
- Next.js route handlers and existing authorization for application APIs;
- Supabase RLS and carefully scoped RPCs for data authorization;
- Vercel Firewall for edge request filtering.

Revisit an API gateway only if AutoDine splits into independently deployed services with separate routing, authentication, quotas or ownership requirements.

### 2. Cloud security and CDN

Vercel already provides CDN delivery, platform DDoS mitigation and configurable Firewall/WAF capabilities. Adding Cloudflare as a reverse proxy would put another proxy/CDN in front of Vercel. Vercel documents a Cloudflare Verified Proxy Lite header (`CF-Connecting-IP`), but Vercel also documents visibility and bot-detection trade-offs with reverse proxies. Avoid a double-proxy setup unless a measured requirement justifies it and the correct Vercel proxy mode is confirmed.

**Initial security posture:**
- Review the existing Vercel Firewall configuration in the dashboard.
- Start new custom rules in log/monitor mode where available; inspect legitimate traffic before enforcing blocks.
- Add targeted limits only for abuse-sensitive routes (for example authentication, password recovery, QR verification and expensive optional endpoints) after identifying their actual route paths and observing baseline traffic.
- Preserve the repository's hard product invariant: **never rate-limit legitimate order submission**. Platform-wide DDoS mitigation remains distinct from an application rule that can refuse a legitimate order.
- Keep existing application/database rate limits; edge rules are an additional layer, not a replacement.
- Keep current security headers, CSP/origin behavior and cookie protections under regression tests.

Cloudflare may be reconsidered for DNS management or a specific security feature Vercel does not cover. Before enabling Cloudflare proxying, produce a routing/TLS/client-IP/cache/bot-protection design and test it on a non-production hostname. Do not change nameservers, DNS records, proxy status or TLS mode as part of this ADR.

### 3. Containers and orchestration

The repository's Supabase local configuration states that `supabase start` requires Docker and starts disposable Auth, PostgREST, Realtime, Storage and Studio services. CI workflows use disposable local services for full-stack tests. That is already a containerized development/test environment.

The deployed Next.js application is a Vercel workload; running a second production copy behind Docker Compose would duplicate hosting without solving a current product problem.

**Decision:**
- Continue using Supabase CLI + Docker for local/full-stack test environments.
- Do not introduce Kubernetes or AWS ECS for the present single Next.js + managed Supabase architecture.
- Do not add a generic Compose stack unless a concrete independent service (such as a queue worker) needs local lifecycle orchestration.
- If a long-running worker is eventually required, compare managed Vercel Daemons (currently documented as public beta), a small managed container service, and a VPS using cost, worker restart semantics, observability, regional connectivity and operational ownership. A container restart alone does not guarantee a job is completed; acknowledgements, retries and idempotency must be proven.

### 4. Background jobs and queues

No Redis/BullMQ dependency is present in the inspected `package.json`. The application already uses Supabase Realtime plus polling fallback for kitchen/order updates, and Postgres scheduling for subscription expiry. A separate queue is not required for those existing UI update paths.

A queue becomes useful for an actual asynchronous side-effect: provider-backed email/SMS/WhatsApp notifications, external webhooks, batch exports, or another task that must retry independently of a guest/staff HTTP request. The latest handoff reports custom SMTP is not configured and Auth email delivery is constrained, so do not pretend an email worker can deliver mail until an SMTP/provider is approved and verified.

**Preferred first candidate:** Supabase Queues / pgmq, subject to local disposable-stack proof and owner approval for a staging migration. PGMQ is Postgres-native; messages can be stored in the database, read with a visibility timeout, retried when not acknowledged, and archived. Supabase documents consuming messages in an Edge Function and triggering that function with Supabase Cron.

Required design controls before implementation:
- define one real job type and its owner-visible success/failure semantics;
- enqueue only after/within the same successful domain transaction where possible;
- use minimal identifiers in payloads, not customer notes, guest tokens, auth tokens or payment data;
- make every consumer idempotent because a side-effect can be retried;
- define bounded retries, backoff, poison-message handling, archive/retention and operator visibility;
- isolate queue schemas/functions from `anon` and ordinary `authenticated` access;
- ensure tenant identity is derived/validated server-side, never trusted from a message-supplied restaurant ID alone;
- test worker crash, duplicate delivery, timeout, retry, replay and deploy interruption on disposable Supabase;
- never make an order's committed status depend on notification delivery.

**Alternatives:**
- Vercel Queues is a managed alternative designed for serverless producers/consumers, but current Vercel documentation labels it beta and its delivery is at-least-once; consumers must be idempotent.
- Vercel Daemons is currently public beta and can host continuously running pull workers/containers. Evaluate only when there is a real persistent consumer.
- Redis + BullMQ is justified when AutoDine needs Redis-specific queue semantics, independent worker scaling, priorities/delayed jobs or throughput beyond a database-native queue. It adds a separate managed service, credentials, monitoring, recovery and worker lifecycle. Do not add Redis merely as a default.
- Celery/Sidekiq are not appropriate to the existing Node.js codebase unless a dedicated Python/Ruby service is deliberately introduced.

**Current decision:** queue implementation is deferred until a concrete external side-effect/provider and worker execution model are approved. Do not add unused queue migrations, packages or hosted extensions.

### 5. Managed database

Supabase already provides the managed PostgreSQL, Auth, REST and Realtime surfaces AutoDine uses. The latest handoff records production PostgreSQL in `ap-south-1` and Vercel in `bom1`, which is a good regional alignment for the production request path. Staging is in `ap-northeast-2`; use it for validation only and account for cross-region latency when interpreting staging performance.

**Decision:** keep Supabase as the system of record. Do not migrate to AWS RDS or Neon as part of this work. Instead prioritize:
- current provider backup/PITR/retention verification and repeatable isolated restore drills;
- migration ledger/catalog reconciliation before schema changes;
- reviewed role/default-ACL hardening;
- pool/connection and lock-wait budgets;
- query plans and indexes based on measured slow queries;
- p50/p95/p99 request and database latency, errors, Realtime health and saturation alerts;
- documented RPO/RTO only after provider configuration and restore evidence support the numbers.

No database region migration, plan change, extension enablement, migration or production query/write is authorized by this document.

## Implementation sequence

| Phase | Work | Scope / gate |
|---|---|---|
| 0 — Architecture baseline | Record existing stack, regions, proxy/queue/container inventory and decisions | Completed by this ADR; source and provider claims retain dated evidence boundaries |
| 1 — Edge security review | Inventory actual public API paths; review Vercel Firewall/WAF; propose log-first, route-specific rules | Dashboard-only changes require owner access/approval. Never block legitimate order submission. |
| 2 — Database operations | Verify backup/PITR/restore, connection budget, migration parity and monitoring | Read-only review first; any production mutation separately approved |
| 3 — Queue proof | Select one real external side-effect; build a local disposable PGMQ proof and worker contract | No hosted extension/migration until backup, migration review and explicit staging approval |
| 4 — Worker deployment | Compare Supabase Edge Function + Cron, Vercel Queue/Daemon, and managed container worker | Choose only after queue proof; beta dependencies must be explicitly accepted |
| 5 — Scale review | Load/soak test and cost model from measured traffic | Disposable/staging only; no unsupported capacity claims |
| 6 — Reconsider external proxy/DB/orchestration | Revisit Cloudflare proxy, NGINX, Redis, Compose, ECS/Kubernetes, RDS/Neon only if measured need exists | Separate design and approval before any DNS, vendor, plan or production change |

## Acceptance criteria

- No production app/database behavior changes from this ADR alone.
- No custom proxy is introduced in front of Vercel without a Verified Proxy and client-IP design.
- Vercel firewall rules are tested in log mode before enforcement.
- Legitimate guest order submission remains outside custom rate-limit rules.
- Any future queue has explicit idempotency, retry, retention, tenant-isolation and failure-monitoring tests.
- Docker/worker deployment has a defined owner, restart/recovery behavior, secrets boundary and monitoring.
- Supabase remains the only system of record unless an approved architecture review says otherwise.
- Cost and capacity claims are based on actual provider plan data and controlled measurements, not assumed user counts.

## Official technical references

- Vercel: [Reverse Proxy Servers and Vercel](https://vercel.com/docs/security/reverse-proxy)
- Vercel: [Firewall](https://vercel.com/docs/vercel-firewall)
- Vercel: [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- Vercel: [Queues](https://vercel.com/docs/queues)
- Vercel: [Daemons](https://vercel.com/docs/daemons)
- Supabase: [Queues overview](https://supabase.com/docs/guides/queues)
- Supabase: [PGMQ extension](https://supabase.com/docs/guides/queues/pgmq)
- Supabase: [Consume Queue messages with Edge Functions](https://supabase.com/docs/guides/queues/consuming-messages-with-edge-functions)
- Docker: [Compose documentation](https://docs.docker.com/compose/)
