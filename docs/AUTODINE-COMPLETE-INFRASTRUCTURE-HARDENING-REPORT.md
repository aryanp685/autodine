# AutoDine complete infrastructure and security hardening report

**Assessment cutoff (Arena's authoritative task date):** 2026-11-06 UTC
**Active branch:** `arena/fee715c2-autodine` · **base commit:** `b80ab3c50c3c5067130cde40b2757eb07e15fe7e`
**Decision:** overall release **NO-GO** · Staging **NO-GO** · Production **read-only**
**Scope:** source and local-test hardening review, read-only hosted catalog metadata, review of PR #184 proposals, and assessment of conflicting date metadata. No deployment or hosted configuration/data change was made. This is not release or deployment authorization.

## Executive assessment

AutoDine's current source uses a Next.js App Router application hosted through Vercel with Supabase for PostgreSQL, Auth, REST/RPC, Storage, and Realtime. The source inventory does not justify adding a separate app server, queue, or worker. No Vercel Firewall/WAF rule or numeric threshold is recommended because the available provider surfaces do not show the rule inventory, effective protections, request logs, analytics, or a false-positive baseline.

Several targeted source fixes are included in this change set: report exports have Owner/Manager authorization at both the route and database RPC; menu description/translation Server Actions authorize Owner/Manager before reading targets or calling AI helpers; subscription plan/cancellation/payment actions repeat Owner-only checks; the subscription UI route is Owner/Manager-gated; a malformed guest-order UUID is rejected before the database RPC; and forward migrations bound the report order list and apply subscription-history limits before JSON aggregation. These changes are verified only with local unit tests and disposable PostgreSQL replay.

A separate, important database-boundary finding is confirmed by **read-only Production catalog queries**: RLS is enabled (not forced) on `public.orders`, and `authenticated` has `SELECT` on every column, including payment amounts and `guest_token` (a guest bearer credential). Its `orders_staff_read` policy scopes rows by restaurant membership, not by staff role. `anon` also retains table/column SELECT ACLs, but has no SELECT RLS policy and does not bypass RLS; no anonymous row access was demonstrated. The Cashier ledger's safe projection is **not** a database finance or guest-token boundary. We changed no hosted grants/policies: Owner, Manager, Cashier, and Kitchen share the `authenticated` database role, and a narrow privilege change could break legitimate cashier, bill, or settlement reads without a replacement role-aware database API.

Subscription pages are now route-gated to Owner/Manager, matching the shell navigation. However, direct database reads for subscription state/history/payments/receipts remain account-member-scoped. The intended role boundary for those direct reads still needs an owner/product decision; a page layout is not a database boundary. No cross-account access was demonstrated.

The remaining release blockers include the confirmed broad `orders` read (including the stored guest bearer token), unresolved subscription read-role scope, unverified Vercel edge controls and ingress, no traffic baseline, guest bearer-token exposure in order URLs, no configured billing provider/body-size contract, unresolved Realtime health details, and unverified hosted backup/PITR/recovery objectives. No release or pilot gate is cleared by this report.

## 1. Scope, evidence, and safety boundary

### Evidence used

| Evidence type | What was reviewed | What it does not prove |
|---|---|---|
| Repository source | Active branch working tree based on `b80ab3c50c3c5067130cde40b2757eb07e15fe7e`; current routes, layouts, Server Actions, SQL migrations, tests, deployment/source configuration, and existing readiness documents. | Does not prove hosted deployment version, live headers, provider settings, or migration parity. |
| Local tests | Full Vitest, disposable embedded PostgreSQL migration replay, typecheck, lint, DDL syntax, design-system check, and diff check. | Does not prove Vercel behavior, a full Supabase HTTP/PostgREST deployment, production load/capacity, or recovery. |
| Hosted Supabase catalog | Read-only Production privilege/policy/function metadata queries to project ref `bdbaqpevwmgdvghszjno`, including relation RLS flags and API-role bypass flags (requests `a7aa38ee-acdc-427a-8e85-1a02d9245016` and `d12dbcf7-69d7-44a-b85b-2b93f44ef6a3`); no application tables/rows were selected. | Does not replace a role-by-role HTTP/PostgREST test or prove a complete exploit path. No DDL/DML/RPC/migration ran on a hosted project. |
| Vercel connector | Project and deployment metadata; project/plan labels. | Firewall/WAF/DDoS/bot/rate-limit settings, traffic, analytics, deployed headers, and active-branch runtime remain unverified. |
| Provider documentation | Vercel request-header and reverse-proxy documentation. | Does not establish AutoDine's actual ingress/proxy chain or project entitlement. |
| PR #184 | Read PR #184's proposed `docs/infrastructure-architecture.md` and `docs/edge-security-runbook.md` at head `9ab65fd84d17b8446d62ceaf9c74258ed8bffc2b`; a read-only GitHub query returned OPEN, draft=true, mergeable=MERGEABLE, with provider timestamps on 2026-11-13. | Both the returned state and timestamps are recorded as query observations; the future-dated provider timestamps cannot establish PR state as of the 2026-11-06 cutoff. PR content is a proposal, not active-branch source or proof of hosted configuration. It was not merged in this work. |

No Production rows, customer data, secrets, API-key values, provider payloads, or access tokens were queried or printed. No Production or Staging schema/configuration was changed. The only hosted SQL executed for this review was read-only catalog inspection. All migration execution was in disposable local PostgreSQL.

### Date and document reconciliation

The assessment cutoff is **2026-11-06 UTC**, the authoritative task date for this review. Vercel deployment metadata and PR #184 provider timestamps report **2026-11-13**; a hand-off document is dated **2026-11-12**; and the working tree contains `20261112000300_report_sales_export_authorization.sql` and `20261112000400_bound_subscription_history.sql`. Each date is after the assessment cutoff and therefore anomalous/future-dated relative to it—not evidence of a later current state. The returned PR state and provider metadata are retained only as observations; they do not establish the PR/deployment state as of the cutoff. The hand-off is also for another branch, and the migration is local source that was replayed only on disposable PostgreSQL. This documentation reconciles the cutoff by preserving those artifacts as out-of-cutoff observations; the underlying timestamp discrepancy remains unresolved and must be explained before any of them is used as current release evidence. The active branch working tree based on the commit above is the source used for this report.

- `PHASE-1-VERCEL-EDGE-SECURITY-DISCOVERY.md` is a Phase 1 snapshot at base `b80ab3c50c3c5067130cde40b2757eb07e15fe7e`; its “no Phase 2+ code/tests” statements remain historical, not current.
- `RELEASE-BLOCKER-REPORT.md` now has a current active-branch section above its historical Phase 1/Phase 6 records. Older branch, deployment, or approval entries below it do not authorize current production operations.
- `FEATURE-INVENTORY.md` was reconciled for the report role checks, subscription route gate, guest-order UUID validation, and confirmed `orders` database grant. Other entries remain acceptance dependencies, not claims of full live verification.
- `PHASE-2-PRODUCTION-PREFLIGHT.md` contains a historical statement about prior Production rollout authorization. It is not authorization for this continuation; Production remained read-only here.
- `PHASE-3-HOSTED-BASELINE.md`, `docs/autodine-handoff-report-2026-11-12.md`, and the Production migration ledger are dated/branch-specific records. The reported manual deployment and later deployment-hold removal were not actions in this continuation; current deployment and migration parity were not rechecked.
- `PHASE-7-RECOVERY-RPO-RTO.md`, `PRODUCTION-BACKUP-RUNBOOK.md`, and `docs/production-saas-readiness-audit.md` correctly preserve substantial recovery/hosted-evidence limitations, but their older source/test snapshots must not be treated as current counts. This continuation's tests are listed in §8; hosted recovery remains unverified.
- `docs/preview-isolation.md`, `docs/SETUP.md`, `AGENTS.md`, and the approved account-level subscription rules remain the operational constraints. No environment-isolation bypass or product/tax rule was added.

## 2. Architecture and hosted status

### Architecture decisions

- Keep the existing Next.js/Vercel + Supabase architecture. No independent production worker/queue is present in the checked source inventory. Order/kitchen updates use Realtime with polling fallback; subscription expiry uses PostgreSQL scheduling.
- Do not add an API gateway, reverse proxy, Redis/PGMQ queue, app container, Kubernetes, Cloudflare proxy, DNS change, or new hosted service without a concrete measured requirement and separate approval.
- Keep Production as the only environment permitted to use the Production Supabase project. Preview, Development, CI, and local runs must follow `docs/preview-isolation.md`.
- Treat application projections, row-level policies, table/column grants, and RPC authorization as separate controls. A UI field list does not restrict what an authenticated caller can query directly.

The architecture record is in [`docs/infrastructure-architecture.md`](infrastructure-architecture.md); the conservative edge procedure is in [`docs/edge-security-runbook.md`](edge-security-runbook.md).

### Vercel edge, headers, and ingress

- Source declares security headers in `next.config.mjs`; `proxy.ts` and `lib/csp.ts` build nonce CSP for matched document routes. `/api` is outside the proxy matcher. No Production or Preview response was fetched, so deployed response headers and redirects remain **UNVERIFIED**.
- The Vercel connector does not expose a Firewall/WAF rule inventory, effective DDoS/bot settings, rate-limit entitlement/rules, request logs, or request analytics. The project metadata's Hobby/legacy label does not resolve feature entitlement. Do not state that custom Firewall/WAF protection is enabled or disabled.
- Project feature metadata reported Web Analytics disabled and Speed Insights without data, while a deployment record included an Analytics ID. No event counts/ingestion were available; there is no operational request baseline.
- A returned Preview record belonged to PR #184, not the active branch. The limited deployment listing does not prove an active-branch Preview does or does not exist.
- Provider metadata records dated 2026-11-13 are future-dated relative to the authoritative 2026-11-06 cutoff. The reported Production deployment/region/commit cannot be treated as the current deployed release or as evidence of the state at the cutoff.
- No numeric edge threshold, block, challenge, country, ASN, or IP rule is recommended. It would be unsupported without exact match visibility, baseline distributions, shared-IP analysis, plan proof, and false-positive tests.
- Vercel documentation notes that client-IP attribution and firewall visibility depend on proxy placement and describes equivalent request-IP headers. AutoDine's actual ingress/proxy chain is unverified. No IP header fallback was changed.

### Supabase, migration, and recovery status

Connected project metadata names a Production project in `ap-south-1` and a test-named project in `ap-northeast-2`, both PostgreSQL 17.11; the repository's `vercel.json` selects `bom1`. These are metadata/source facts, not a measured connection route, latency guarantee, or approved Staging topology. Supabase health summaries showed top-level services as active/healthy while nested Realtime fields reported `db_connected=false`, `replication_connected=false`, and `connected_cluster=0`. This discrepancy remains unresolved and is not classified as either an outage or proof of healthy Realtime.

The Supabase connector did not expose a usable backup/PITR/retention inventory. No hosted backup, dump, restore, or restore target was used. Numeric RPO/RTO remain **UNKNOWN**. The local cold-recovery suite is synthetic and cannot close the hosted recovery gate.

No current Production migration-ledger query was made in this continuation. Historical preflight, hand-off, and migration-reconciliation documents are not combined into a new claim of Production parity. The new local-only subscription-history migration described below has **not** been applied to any hosted project.

## 3. Confirmed finance-data boundary: `public.orders`

### Read-only Production catalog finding

Read-only catalog requests `a7aa38ee-acdc-427a-8e85-1a02d9245016` and `d12dbcf7-69d7-44a-b85b-2b93f44ef6a3` against Production project ref `bdbaqpevwmgdvghszjno` inspected the `public.orders` relation flags, role flags, table/column ACLs, and RLS policies—not order rows. They returned:

- `public.orders` is owned by `postgres`; `relrowsecurity = true` and `relforcerowsecurity = false`. The `anon` and `authenticated` roles are neither superusers nor `BYPASSRLS`; `service_role` has `BYPASSRLS = true`. RLS is therefore enabled for ordinary `anon` and `authenticated` API roles, but not forced against the table owner or the privileged service role.
- Both `anon` and `authenticated` have non-grantable table-level `SELECT`, plus column-level `SELECT` on all 25 current `orders` columns. This includes `payment_status`, `guest_token`, and the amount fields (`subtotal_paise`, `discount_paise`, `tax_paise`, `total_paise`).
- Neither `anon` nor `authenticated` has table-level `INSERT`, `UPDATE`, or `DELETE`. `authenticated` has a single column-level `UPDATE` grant for `prep_status`; no other client column update was returned. This matches the write boundary in `20261109000400_order_write_boundary.sql`. `service_role` has broader internal privileges.
- The only SELECT policy is `orders_staff_read`, for `{authenticated}`, with `restaurant_id IN (SELECT current_restaurant_ids())`. `current_restaurant_ids()` selects restaurant IDs by `auth.uid()` membership and does not filter membership role. There is no `anon` SELECT policy in the Production policy inventory.

### Intended behavior, effective grant, and remaining decision

The initial migration enables RLS and describes anonymous access as order insertion through the validated security-definer function, with no direct anonymous order reads. The current `anon` SELECT ACL is nevertheless present; with RLS enabled, a non-bypass `anon` caller, and no applicable SELECT policy, this catalog evidence does **not** show that anonymous callers can read order rows. It is an unnecessary/broader-than-needed ACL under the source comment's least-privilege wording and could become relevant if an anon policy is later added. The repository does not explicitly revoke `SELECT` on `orders` from `anon`; the later `20261110001220_revoke_client_bypass_privileges.sql` explicitly preserves ordinary table DML/SELECT defaults.

For authenticated callers, the table grant and RLS policy permit membership-scoped staff reads, but the policy does not distinguish Owner, Manager, Cashier, or Kitchen. So a member in any of those roles can read every `orders` column through an authenticated query, including finance data and the stored `guest_token`. That token is used as a guest bearer credential alongside the restaurant slug and order code; possession may allow a caller to use guest-facing order endpoints within their remaining state/time rules. No HTTP/PostgREST call, order-row read, token use, or guest endpoint request was attempted; this is a risk inferred from the inspected Production ACL/policy and the source token contract, not a demonstrated exploit.

The Cashier order-page loader currently selects only `id, code, table_id, prep_status, placed_at`, then maps an allowlist into the UI. That is useful minimization for that page, but it is **not** a database finance or guest-token boundary. A direct authenticated table read is not constrained to the UI projection.

Do not “fix” this with a blanket table SELECT revocation or by assuming column grants distinguish staff roles: they all use PostgreSQL's `authenticated` role, and other cashier/bill/invoice flows legitimately require some financial reads. The intended role-by-role finance and guest-token read contract needs an owner/product/security decision. A safe database boundary should remove guest credentials from general member reads and provide purpose-specific role-aware access (for example, carefully scoped read RPCs/views plus an audit of every caller), with synthetic role/PostgREST regression tests. Separately confirm whether the residual `anon` SELECT ACL should be revoked in a forward migration; no hosted grant or policy was changed in this review.

## 4. Source hardening delta and findings

| Area | Current implementation / change | Evidence and remaining limit |
|---|---|---|
| F1 — report export authorization | In this change set, the CSV handler checks the trusted selected-outlet role before loading data; `report_sales()` independently requires Owner/Manager. The handler requests at most 10,000 order details and exports no-store. | The route regression and disposable-PostgreSQL SQL role/limit suite are covered by the validation below. This does not close the broader direct `public.orders` table SELECT finding in §3. |
| F2 — menu AI actions | `generateDescriptionsAction` and `generateTranslationsAction` now require Owner/Manager before reading menu targets or calling the AI helpers. Input remains capped at 50 targets; Owner/Manager calls remain in the established flow. | Added Server Action role regressions; Cashier/Kitchen are denied before a menu query or provider call. No shared app-wide AI budget was found; do not invent one. Provider costs/controls were not tested here. |
| Guest order token shape | `getOrderScreenData()` now rejects a malformed UUID-shaped token before creating the Supabase client or calling `get_public_order`. | Added a loader regression proving no client/RPC call for malformed input. Existing slug/code/token ownership and URL contract remain unchanged. This does **not** remove the bearer token from `/menu/order?s=…&code=…&t=…`, browser history, or possible server logs. |
| Subscription actions and route | Owner-only guards now precede plan, request/withdraw cancellation, and retry actions. A subscription layout admits Owner/Manager, matching the shell's `MANAGE` links; the role allowlist has a regression. The SQL cancellation/withdraw RPCs already independently require Owner. | No provider exists, so provider-dependent operations still fail closed. The route test pins the allowlist; no deployed role request was tested. Direct subscription read RPCs and table RLS still accept account members; see §5. |
| F5 — subscription history pagination | New forward migration `supabase/migrations/20261112000400_bound_subscription_history.sql` selects the newest `p_limit` rows in a subquery before JSON aggregation, for subscription events and payment history. It retains the default/minimum semantics, membership checks, JSON shape, and grants; no arbitrary maximum was added. The UI passes 50, but the direct RPC argument still has no absolute upper bound, so this limits aggregation to the caller's requested value rather than a fixed server ceiling. | The disposable DB regression inserts 60 synthetic rows and verifies exactly the newest 50 for each history RPC. It also confirms account membership and owner-only cancellation behavior. The absolute maximum remains an open hardening decision; the source migration was not applied to a hosted database. |
| F6 — client IP hash | No header behavior changed. The helper trusts the first `x-forwarded-for` hop, then `x-real-ip`, then `unknown`; it hashes address plus caller-provided salt. Comments/tests treat it as an abuse hint, not identity. | Actual Vercel ingress/trusted proxy configuration is unverified. Do not change headers or apply IP blocks until the trust chain and shared-NAT effects are established. |
| F7 — webhook body size | No body-size limit was invented. The webhook checks provider configuration before reading the body; the current provider adapter returns `null`, so the route fails closed with 503 before `request.text()`. | If a provider is later enabled, `request.text()` is unbounded in source. Provider event-size and platform request-size contracts are unknown. Confirm both before selecting a compatible streaming cap and test signed retries/oversize behavior. |

## 5. Subscription read-role boundary

The visible dashboard navigation has Subscription in the Owner/Manager `MANAGE` role set; the shared dashboard parent also admits Cashier because Orders/Invoices live below it. A specific subscription layout has now been added to make direct page/receipt navigation match the Owner/Manager link contract. Owner-only actions repeat their server-side role check, and cancellation RPCs enforce Owner in SQL.

The database read boundary is different: Production catalog results show `authenticated` SELECT grants on `subscription_events`, `subscription_payments`, and `subscription_receipts`, with member-scoped RLS policies. The `account_subscription_state`, `account_subscription_history`, `account_payment_history`, and `account_receipt` security-definer functions check membership/account linkage, not an Owner/Manager role. A cashier who directly calls those authenticated APIs can therefore retrieve account-level billing information in the current schema, even though the page route is gated. No cross-account access was demonstrated.

The source history contains both account-member-read language and Owner/Manager-only navigation/copy. The precise data-role contract must be confirmed before tightening RLS/function visibility. If Owner/Manager-only reads are approved, the change must cover direct table policies and all four RPCs (not only the UI), with synthetic role tests. The related `accounts`/`restaurant_access()` reads also support plan-gated staff operations and must be audited before changing their policy. No SQL read-role policy was changed in this pass.

## 6. Guest, IP, and webhook resilience

### Guest bearer token

The token in the initial order-page query is a credential for reading/changing/cancelling a guest order. The status poll uses a POST body and rejects GET; the initial order link still places the token in the URL. `Referrer-Policy: strict-origin-when-cross-origin` is source-configured, but deployed headers and access-log behavior were not checked. The UUID precheck prevents malformed-token `22P02`; it does not mitigate token exposure. Any redesign must preserve the current guest-link/ownership contract and needs an explicit product decision.

### IP-derived budgets

The `x-forwarded-for` value can be forged unless the actual trusted proxy overwrites/normalizes it. The source helper's per-salt hash is not authentication. These budgets are supplemental friction to QR/session/token controls. Never use an IP-only edge rule to refuse order submission or a legitimate guest retry.

### Billing webhook

The current app has no provider adapter, and the webhook route fails closed before reading a request body. If a provider is enabled later, raw-body buffering via `request.text()` has no application-level byte cap. The compatible event maximum, Vercel/platform request cap, signature/replay behavior, and retry contract have not been verified; no arbitrary size cap or callback block was added.

## 7. Review of PR #184

A read-only `gh pr view 184` query returned PR #184 (`arena/infrastructure-architecture-20261113`, head `9ab65fd84d17b8446d62ceaf9c74258ed8bffc2b`) as **OPEN**, **DRAFT**, and **MERGEABLE**, with `createdAt=2026-11-13T17:50:21Z` and `updatedAt=2026-11-13T17:52:27Z`. Those timestamps are future-dated relative to this report's 2026-11-06 assessment cutoff, so the query cannot establish PR state as of that cutoff. The returned state is retained only as an observation, not treated as current release/deployment evidence. PR #184 was not merged or used as hosted evidence. The proposed documents are useful as a prompt to retain the current managed architecture and avoid an idle queue, but several statements must not be copied as current AutoDine facts:

- The proposal says Vercel's platform edge/firewall and DDoS protection are already included/enabled. Available project metadata does not show the effective rule inventory, entitlement, action, or telemetry; this report leaves them **UNVERIFIED**.
- A Hobby/legacy plan label alone does not prove entitlement to a specific WAF, rate-limit, or bot feature.
- The PR's region and deployment statements rely on dated metadata; current routing/deployment was not freshly established and provider timestamps conflict with the authoritative task date.
- Queue/PGMQ/Vercel Queue/Daemon discussions are future options only; no current queue/worker is needed or installed.

Corrected active-branch architecture/runbook documents were created without merging PR #184: [`docs/infrastructure-architecture.md`](infrastructure-architecture.md) and [`docs/edge-security-runbook.md`](edge-security-runbook.md).

## 8. Verification performed

| Check | Result |
|---|---|
| `npm test -- --reporter=dot` | **2,185 passed, 148 skipped** across 200 files (194 passed files, 6 skipped). Skipped tests are not passes. The run followed the final subscription-screen authorization regression additions. |
| Focused UI/action suite | **111 passed across 9 files**, including Orders, subscription UI/actions (owner withdrawal and manager denial), menu AI actions, guest-token validation, subscription route gate, report-export handler, and report loader regressions. |
| `npm run test:db:embedded` | Re-run after the latest source changes: **148 passed across 6 files**; disposable PostgreSQL replayed **79 migrations**; subscription-history and report-sales integrations passed. Synthetic local-only data was used. No hosted migration ran. |
| `npm run typecheck` | Passed after the final UI/test changes. |
| `npm run lint` | Passed after the final UI/test changes. |
| `npm run sql:check` | Passed its DDL/parser checks. This command explicitly does not validate function bodies, RLS behavior, or hosted parity; the embedded replay is the local runtime SQL evidence. |
| `npm run design:check` | Passed. |
| `git diff --check` | Passed after the final documentation edits. |

No browser E2E, optimized build, live Production/Preview HTTP/header probe, non-production hosted end-to-end run, Vercel rule simulation, load/soak test, hosted backup/PITR inspection, or hosted restore was run in this continuation. The Production metadata query was read-only catalog inspection only.

## 9. Release gates and owner decisions still required

1. **Orders finance and guest-token visibility:** decide the role-by-role `orders` read contract, including whether any staff role may retrieve `guest_token`; keep guest credentials out of general member reads. Design role-aware database/API access that preserves required Owner/Manager reports and authorized cashier bill/settlement flows; do not treat the page projection as a fix. Separately decide whether to revoke the current `anon` SELECT ACL (no anon SELECT policy exists).
2. **Subscription read visibility and RPC ceiling:** confirm whether account-level billing amounts/history/receipts are intended for every account member or only Owner/Manager. If narrowed, update RLS and all direct RPCs and test the direct PostgREST boundary, not just route layouts. Separately decide a server-enforced maximum for history RPCs: the UI requests 50, but direct callers can pass a larger `p_limit` today.
3. **Vercel edge:** owner-readable evidence for actual project/environment rules, entitlements, actions, and aggregate traffic/status/latency baseline. No thresholds until representative normal traffic and false positives are measured.
4. **Ingress/IP:** confirm actual direct/proxied topology, trusted-header behavior, and the deployed request-IP contract before changing F6 or using IP-based edge rules.
5. **Guest-token URL:** product/security decision on query-string bearer credential exposure; preserve guest ownership and support behavior in any follow-up.
6. **Provider callback:** before enabling billing, verify provider's event-size/retry/signature contract and platform request limits, then implement/test a compatible bounded raw-body read. No provider is configured today.
7. **Hosted health and recovery:** investigate the nested Realtime health discrepancy; obtain current backup/PITR/retention visibility, an approved isolated restore target and successful restore drill, then set owner-approved RPO/RTO. Never use Production for the restore test.
8. **Release acceptance:** verify current migration parity, isolated guest-to-staff E2E, runtime headers, performance/soak, rollback, operator ownership, and required approvals. A green local suite is not a pilot/release gate.
9. **Chronology:** obtain an authoritative explanation/verification for provider and repository artifacts dated 2026-11-12/13, which are future-dated relative to the 2026-11-06 cutoff. Do not use their deployment or PR status as current release evidence until the timestamp/state discrepancy is resolved.

## Final decision

The local code/test work is useful hardening, not a release authorization. Keep Production read-only, Staging **NO-GO**, and the release **NO-GO**. Do not deploy, merge PR #184, apply the new migration to a hosted project, or modify Vercel/Supabase configuration without separate explicit authorization and the required release/recovery gates.
