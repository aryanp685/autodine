# AutoDine edge-security review runbook

**Evidence cutoff (Arena's authoritative task date):** 2026-11-06 UTC
**Status:** review-only guidance; no Vercel Firewall/WAF rule is recommended, created, or changed. This document does not authorize a Production or Preview configuration change.
**Chronology:** Vercel/PR #184 metadata dated 2026-11-13 is future-dated relative to this cutoff and is not treated as current configuration or readiness evidence; see the [complete report](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md).
**Related:** [Infrastructure architecture](infrastructure-architecture.md), [complete hardening report](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md), [Feature inventory](../FEATURE-INVENTORY.md), [`AGENTS.md`](../AGENTS.md)

## 1. Current position

The connected Vercel surfaces identify a project but do not expose the actual Firewall/WAF rule inventory, effective DDoS/bot settings, rate-limit entitlement/rules, request logs, or a reliable traffic baseline. Mark each as **UNVERIFIED**. Do not describe a provider default or a product-plan label as proof of AutoDine's current protection.

No custom rule or threshold can be justified from the available evidence. Do not add a broad `/api`, `/dashboard`, or IP-based limit. Do not use an edge rule to compensate for application/database authorization. Production remains read-only and Staging remains **NO-GO** until the separate approvals and release gates in `AGENTS.md` are satisfied.

## 2. Invariants that must survive any future rule

- **Never rate-limit legitimate order submission.** Preserve guest checkout, accepted new orders, valid idempotent retries, and the existing server-price/session/tenant checks. The submit action is a Next.js Server Action, not necessarily a simple route path; do not infer its full match from the page URL.
- Do not apply a guessed low threshold to guest menu reads, QR/session flows, order-status polling, kitchen activity, cashier settlement, invoices, or provider callbacks. Shared restaurant Wi-Fi and mobile-carrier NAT can group many legitimate users behind one public IP.
- Preserve server-side role checks, tenant boundaries, RLS, grants, and RPC authorization. A WAF block or challenge is supplementary, never the authorization control.
- Do not record request bodies, bearer tokens, guest notes, Auth cookies, payment details, or secret headers in an incident note. Use approved provider consoles for sensitive evidence and keep only the minimum sanitized metadata needed.
- Do not assume that a Preview-only rule is harmless or isolated. Prove its exact environment scope and action before using it.

## 3. Route and workflow map

This table is a starting map from the current source inventory, not a traffic baseline. Recheck the implementation and exact Vercel match syntax before any future rule proposal.

| Surface | Current source controls / expected traffic | Edge posture from this review |
|---|---|---|
| Guest order submit (`/menu/checkout` page → `app/menu/checkout/actions.ts`) | Next.js Server Action; database validates tenant, verified session, server-side price, idempotency, and order state. Order submission is intentionally uncapped. | **Explicitly exclude** from order-rate rules. Do not assume a URL-only matcher isolates it from other Server Actions. |
| `/menu/orders/status` | Token-scoped status POST; GET is rejected; no-store responses. Active guests poll while an order is open. | No low per-IP threshold. Avoid blocking valid retries or multiple guests sharing a venue network. |
| `/t/[token]` and `/t/[token]/code` | Public QR-card lookup and rotating verification-code flow; session minting/verification has database controls. Forwarded-IP hashes are abuse hints, not identity. | Preserve the existing DB rules; no duplicate guessed edge budget. |
| `/dashboard/orders`, `/cashier`, `/kitchen` | Authenticated operational views with polling/Realtime fallback. Expected refresh and staff actions can produce bursts. | No broad staff-path limit. Do not treat expected polling or a shared outlet network as abuse. |
| `/dashboard/reports/export` | Owner/Manager-only route and `report_sales()` RPC; CSV is no-store and the order detail list is bounded. | Candidate for measurement if telemetry later shows resource pressure; role and database controls stay authoritative. No threshold selected. |
| `/api/tts` | Authenticated kitchen speech route with application-side user/restaurant budget in source; external provider latency/cost. | Measurement candidate only. Verify actual role and shared-budget behavior, traffic, and false positives before proposing any edge control. |
| `/api/billing/webhook` | Current provider adapter is absent; route fails closed with 503 before consuming the body. Future provider callbacks may retry. | No custom callback block or guessed body limit. Before provider enablement, confirm provider and platform body-size contracts, signature/replay behavior, and callback retry expectations. |
| `/auth/confirm` and Auth actions | Public callback/recovery/signup flows with redirect and identity checks in source; hosted Auth protections are not verified. | Do not challenge/block a broad auth path without successful non-production callback/recovery tests and an explicit owner decision. |
| `/api/health` | Low-detail readiness endpoint; response is not a monitoring system or a complete service test. | Do not use it as the only health/attack signal or create a rule from it alone. |

Supabase Auth, PostgREST, Storage, and Realtime calls may go directly to the Supabase project rather than through the Vercel application host. A Vercel edge rule does not automatically cover those requests.

## 4. Read-only review before proposing a rule

The following steps require an authorized project owner/operator. They are not completed by this runbook and are not authorization to change settings.

1. **Prove target identity.** In the Vercel Dashboard, confirm the exact team, project ID, production domain, environment, and deployment. Do not rely on a branch name or an old deployment listing. The provider metadata reviewed for this report was temporally inconsistent with the authoritative task date.
2. **Capture current configuration.** Record/export the existing rule inventory, order, environment scope, action, and relevant product entitlement using the approved dashboard. If any field is not visible, leave it **UNVERIFIED**.
3. **Establish a safe baseline.** Collect aggregate path/method/status and latency/rate distributions for representative quiet and meal-time periods. Use provider-safe telemetry; avoid payloads, raw bearer credentials, customer data, or secrets. Include expected QR scans, shared Wi-Fi, guest status polling, kitchen/cashier refresh, report exports, Auth retries, and any provider retries.
4. **Map real requests.** Trace the actual Server Action request shape and route overlap in a synthetic non-production browser session. Verify what an edge rule would match; do not infer that a page path maps only to one action.
5. **Check false positives.** Include shared restaurant NAT/Wi-Fi and mobile-carrier NAT, multiple staff screens, guest retries, hidden-tab wakeups, and provider callback retries. Derive thresholds from a measured legitimate envelope and agreed burst allowance; do not invent a number.
6. **Decide whether an edge control is needed.** First fix application authorization or data-boundary defects in source/database design. An edge rule cannot repair the confirmed broad `authenticated` SELECT permission on `public.orders`.

If no reliable baseline, safe route match, owner, and rollback path are available, stop at read-only evidence gathering; do not add a rule.

## 5. Conditional change process

Only after a separate explicit authorization for a named environment and control:

1. Preserve the current rule state and exact rollback instructions.
2. Use one narrow host/method/path rule at a time. Use an observation/log action only if the dashboard proves that mode has no blocking/challenge effect and is scoped to the intended environment.
3. Keep guest order submission and valid retries out of rate-limit matches. Avoid broad path wildcards and per-IP blocks as a substitute for measured abuse evidence.
4. Validate the exact rule against synthetic guest ordering, status polling, QR verification, staff kitchen/cashier operation, report export, Auth callback, and (if configured) provider delivery in an isolated non-production environment.
5. Compare sanitized success/error/latency metrics and expected work completion before any enforcement transition. A passing Preview is not Production evidence.
6. Enforce only after the owner accepts measured false-positive risk. Record the exact change, approver, environment, rollback owner, and success criteria.
7. Roll back the specific new rule immediately if legitimate checkout/orders, QR/session entry, staff operations, Auth recovery, or provider delivery are affected. Do not restore or rewrite unrelated rules.

No environment or action type has been demonstrated safe for a Vercel rule in this review. The steps above are a future gated procedure, not a current recommendation.

## 6. Client-IP and proxy prerequisites

`lib/ip-hash.ts` currently chooses the first value in `x-forwarded-for`, falls back to `x-real-ip`, then uses `unknown`; the chosen value is salted and hashed. This helper feeds abuse-friction budgets. It does not authenticate a person or prove the address is trustworthy.

Before any F6/IP-key change or an edge rule that depends on client IP:

- establish whether traffic reaches Vercel directly or through another trusted proxy;
- record the actual proxy chain and which hop overwrites or appends each header;
- validate header behavior on an authorized non-production request path, without treating client-supplied values as identity;
- verify Vercel Verified Proxy support and the project's plan/configuration if a proxy is involved;
- test shared-NAT and retry cases so legitimate guests are not denied.

Vercel's request-header documentation describes proxy-dependent client-IP behavior and treats `x-vercel-forwarded-for` and `x-real-ip` as equivalent rather than independent proof sources. The actual AutoDine ingress/proxy configuration remains **UNVERIFIED**. Do not blindly swap or combine headers.

## 7. Cloudflare and additional proxying

No Cloudflare proxy integration was found in repository configuration, and the connected Cloudflare surface is unavailable for this review. Do not change DNS, proxy/orange-cloud state, TLS mode, or nameservers here. If an owner later proposes a proxy, separately validate the supported Vercel proxy mode, client-IP provenance, origin reachability, caching, TLS, and bot/firewall visibility on a non-production hostname before approval.

## 8. Acceptance record

Before recording a future edge change as complete, attach sanitized evidence for:

- [ ] Exact project, domain, deployment, and environment.
- [ ] Current rule inventory and plan/feature entitlement.
- [ ] Representative aggregate baseline and shared-IP false-positive review.
- [ ] Exact match and action tested against real request shapes in non-production.
- [ ] Guest order submit and idempotent retry explicitly excluded and verified.
- [ ] QR/session, status polling, kitchen/cashier, Auth, and provider paths tested where applicable.
- [ ] Owner-approved threshold, enforcement action, success criteria, and false-positive risk.
- [ ] Named rollback owner and exact rollback procedure.
- [ ] No customer data, secret, request body, or bearer token copied into the report.

Current result: none of these change-acceptance checks has been completed for a custom Vercel Firewall/WAF rule. See the [complete infrastructure hardening report](AUTODINE-COMPLETE-INFRASTRUCTURE-HARDENING-REPORT.md) for all release blockers and evidence limits.
