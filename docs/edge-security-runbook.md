# AutoDine edge security and Vercel Firewall runbook

**Status:** Owner-operated configuration guide; no Firewall rules changed by this document  
**Applies to:** AutoDine Vercel project  
**Related:** [Infrastructure architecture decision](infrastructure-architecture.md), [Feature inventory](../FEATURE-INVENTORY.md), [AGENTS.md](../AGENTS.md)

## Purpose

Use the Vercel platform edge and Firewall as the first external request-control layer. Do not add Cloudflare proxying or a self-hosted reverse proxy by default. Vercel's platform-wide DDoS protection is enabled without custom configuration; the WAF provides custom rules, IP blocking, challenge and plan/feature-dependent managed protections.

This runbook is a safe review sequence, not approval to change production traffic. Confirm the exact Vercel project, environment and domain in the dashboard before changing anything.

## Important application invariants

- **Never rate-limit legitimate order submission.** The repository's approved product rule explicitly forbids order throttling. Do not create a WAF rate-limit rule that matches customer checkout/order-submit requests, Next.js Server Action requests used to submit an order, or a broad route pattern that may include them.
- Do not block customer menu reads, QR/session validation, order-status polling, bill/receipt access, or staff kitchen/cashier activity with a generic low threshold.
- Existing database-level QR/session throttles and tenant-safe authorization remain authoritative for application semantics. Edge controls are supplementary, not a substitute.
- Keep Preview/Staging and Production rules scoped and tested independently. A Preview result does not prove production behavior.
- Start with observation/logging where the selected rule type supports it. Never move directly to a broad block/challenge rule.
- Do not use country blocks, broad ASN blocks, or IP allowlists as a shortcut; legitimate mobile networks, shared IT-park Wi-Fi and customers may share egress IPs.
- Do not log request bodies, QR/session tokens, auth cookies, guest notes, payment data, or secret headers while investigating abuse.

## Route inventory and treatment

The following routes are from the repository's FEATURE-INVENTORY.md. This table is an operator's starting map; re-check current route code before creating a rule.

| Route | Traffic / sensitivity | Initial edge treatment |
|---|---|---|
| /api/health | Low-detail readiness probe | Keep public response low-detail/no-store; don't use it as sole monitoring or block legitimate checks |
| /api/tts | Authenticated kitchen TTS relay; external provider cost/latency | Candidate for a narrow, monitor-first abuse rule after confirming the route's shared tenant counter and role validation; don't block normal multi-device kitchen use |
| /menu/orders/status | Guest polling endpoint | Do not apply a low per-IP limit; shared Wi-Fi and several guest screens can create legitimate bursts |
| /t/[token] | Guest QR/table-token flow | Preserve existing QR/session guard and token validation; avoid generic IP limits that block a busy restaurant |
| /auth/confirm | Auth callback | Do not challenge/block expected provider callbacks; validate callback origins and safe redirects in the app |
| /api/admin/renew-trial | Privileged operator endpoint | Preserve strong server-side secret/authorization; any edge rule is defense-in-depth and must not replace application auth |
| /dashboard/outlet, /dashboard/outlet/new | Authenticated staff/owner mutations | Preserve role checks, tenant scoping and RLS/RPC invariants; never rely on WAF for authorization |
| /dashboard/reports/export | Authenticated export | Monitor expensive/repeated requests; protect with existing staff authorization and bounded export size/time |

**Coverage limitation:** The customer order submit path uses server actions/database RPCs and is not necessarily represented as a simple named route in the route-handler inventory. Before any WAF rate-limit rule, trace the actual checkout POST and Next.js action request shape in a non-production browser session and explicitly exclude it from the rule.

Supabase Auth, PostgREST, Storage and Realtime requests sent directly from the browser to the Supabase project domain do not traverse the Vercel project Firewall. Secure them with Supabase Auth, RLS, grants, RPC boundaries, quotas and provider-level controls. A Vercel route rule does not secure a request that goes directly to Supabase.

## Configuration sequence

### 1. Capture a baseline

In the Vercel Dashboard, open the AutoDine project → Firewall/Monitoring.

Before changing rules:
- Confirm the project ID and production domain.
- Record the current rules and their order.
- Observe normal traffic during menu browsing, lunch rush, owner dashboard use, kitchen polling, cashier use and order submission.
- Record path, method, status, request rate and source classification only as available from safe edge telemetry.
- Do not capture payloads or tokens.
- Identify known provider callbacks and trusted health-check sources.

A minimum baseline should include a normal low-traffic period and a representative meal-time period. If no reliable baseline exists, do not enable rate-limit blocks yet.

### 2. Confirm default protection

Vercel documents platform-wide DDoS mitigation as enabled for all plans without configuration. Verify current project Firewall visibility and alert availability rather than assuming an attack has occurred.

### 3. Add narrow monitor-first custom rules

Only after baseline review:
- Create one narrowly-scoped rule at a time.
- Use the log/monitor action first when available.
- Match exact host, method and route; avoid broad wildcards.
- Treat /api/tts as a candidate for review because it calls an external speech provider; confirm the route's application-level shared limit before choosing any edge threshold.
- Leave /menu/orders/status, /t/[token], auth callback and checkout/order submission outside aggressive rate limits.
- Inspect false positives from shared public IPs, mobile carrier NAT and multiple devices within one restaurant.

Do not create an edge limit from a guessed threshold. Derive thresholds from measured legitimate peaks, account for burst allowance, then choose a rule threshold above the observed legitimate envelope.

### 4. Enforce gradually

After observing a rule:
- Review logs for legitimate traffic it would affect.
- Verify that no guest order/checkout, guest status, QR/session, or staff kitchen/cashier workflow is matched.
- Change one rule from log to challenge/block at a time.
- Monitor order completion, 4xx/5xx rates, status polling errors and support reports.
- Roll back immediately if legitimate ordering or staff operations are affected.

### 5. Configure alerts and ownership

Record:
- Who receives Firewall alerts.
- Who can disable/roll back a rule.
- Expected response window.
- How to capture a sanitized incident report.
- Which application metrics correlate with a Firewall event.

The /api/health endpoint is a low-detail diagnostic response, not an uptime monitor or alerting system.

## Cloudflare decision

Cloudflare may be evaluated for DNS management or a specific feature Vercel does not provide. Do not toggle Cloudflare's proxy/orange-cloud mode for the Vercel origin as part of this runbook.

Vercel advises against placing a reverse proxy in front of a Vercel deployment because it can reduce traffic visibility, client-IP accuracy and firewall effectiveness. Cloudflare is listed as a supported Verified Proxy Lite provider using CF-Connecting-IP, but Bot Management documentation also warns that reverse proxies can reduce bot detection accuracy. Any future proxied setup therefore needs:
- a Vercel Verified Proxy compatibility review;
- explicit client-IP provenance validation;
- DNS, TLS, cache and origin protection design;
- verification that the origin cannot be accessed in a way that bypasses the intended edge policy;
- non-production end-to-end tests of WAF, bot challenge, QR, checkout and staff flows;
- a rollback plan and owner approval.

If only DNS hosting is required, evaluate DNS-only configuration separately; that does not require proxying application traffic.

## Acceptance checklist

- [ ] Exact AutoDine Vercel project and domain confirmed.
- [ ] Existing Firewall rules exported/recorded before modification.
- [ ] Normal customer/staff meal-time traffic baseline captured.
- [ ] Vercel platform-wide DDoS and Firewall visibility confirmed.
- [ ] Each proposed custom rule has exact route/method scope and a measured threshold.
- [ ] Customer checkout/order-submit traffic explicitly excluded from rate-limit rules.
- [ ] Guest status polling and QR/session flows tested for false positives.
- [ ] Auth callback and provider callback paths remain functional.
- [ ] Rules observed in log/monitor mode before enforcement.
- [ ] A rollback owner and procedure recorded.
- [ ] No DNS, Cloudflare proxy, Vercel deployment or Supabase configuration was changed without separate approval.
