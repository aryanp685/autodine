# AutoDine — Phase 1 Vercel edge-security discovery and route audit

- **As of:** 2026-11-06 UTC
- **Branch / base / HEAD:** `arena/fee715c2-autodine` / `b80ab3c50c3c5067130cde40b2757eb07e15fe7e` / `b80ab3c50c3c5067130cde40b2757eb07e15fe7e`
- **Scope:** Phase 1 only. Read-only Vercel discovery, source-level audit of every App Router page and handler plus all Server Action modules, traffic/false-positive analysis, and a bounded rule recommendation. No Vercel setting, Production, application, database, or provider change was made.

## Executive decision

**Phase 1 source audit: COMPLETE. Vercel security settings: PARTIALLY VERIFIED / BLOCKED BY CONNECTOR VISIBILITY. Release: NO-GO.**

- The connected Vercel project and recent Production/Preview deployment records are identifiable. The plan label is Hobby. A verified project-domain record returned by the read-only query is `new-alpha-five-43.vercel.app`; pagination/completeness of that domain listing was not established.
- The connector does **not** expose Firewall/WAF rule inventories, DDoS or bot-control state, edge rate-limit entitlements/rules, request logs, or request analytics. Those controls remain **UNVERIFIED**, not presumed enabled or disabled.
- Project metadata reports `features.webAnalytics: false` and Speed Insights `hasData: false`. A deployment metadata record contains an Analytics ID, but no event counts or ingestion evidence. There is no usable traffic baseline.
- Repository headers and application/database safeguards are documented below as **source evidence only**. No Production or Preview response was fetched, so deployed headers and effective hosted controls remain unverified.
- The source audit found several review items—not demonstrated hosted exploits—including the report export/RPC role mismatch, menu AI actions without an explicit owner/manager check or shared app budget, ineffective subscription-history row limits, account-member billing visibility, guest order bearer-token URL exposure, and a conditional unbounded webhook-body read if billing is later configured. All are documented with evidence limits and owner decisions below.
- **Rule recommendation: none at this time.** No numeric threshold or block/challenge rule can be justified without traffic distributions, rule entitlement, and false-positive measurements. No Preview monitor-only rule was created; the connector cannot prove that a proposed action is genuinely non-blocking or isolated from Production.
- No tests, load/burst tests, signed-callback probes, live route tests, or HTTP header probes were run. No route or control is claimed tested because code exists.

## 1. Evidence boundary and verified deployment context

### Vercel project and environments

Read-only Vercel connector results identify project `new` (`prj_S6aU68euwLsJsaEdzolSdsJHSyS7`) in team `iamjarvis9896's projects` (`team_7gd7FaGtAHNWuqrtvIKfccW8`), framework Next.js. The returned deployment plan label is `hobby` (Hobby/legacy label). The project-domain list contains `new-alpha-five-43.vercel.app`, marked verified. Product-by-product eligibility on that plan is not established by these fields.

| Target | Latest record returned | Branch / commit evidence | Region and conclusion |
|---|---|---|---|
| Production | `dpl_A1NyA7YuU9Phz3yU1KGuh7iYzVHy`, `READY` / `PROMOTED`; deployment URL `new-7obfpm8ig-iamjarvis9896-3988s-projects.vercel.app` | `main`, `b80ab3c50c3c5067130cde40b2757eb07e15fe7e` | `bom1`; metadata evidence only, not a live response test |
| Preview | `dpl_GGtL3E2et23na2ZB9nBrQonH3Apm`, `READY` / `STAGED`; deployment URL `new-ml1ew729y-iamjarvis9896-3988s-projects.vercel.app` | PR #184 branch `arena/infrastructure-architecture-20261113`, commit `9ab65fd84d17b8446d62ceaf9c74258ed8bffc2b` | `bom1`; **not** the active branch's Preview. No active-branch Preview was identified in the recent returned page; this is not proof none exists in the full history. |

Vercel timestamps returned for these records convert to **2026-11-13 UTC**, seven days after this report's authoritative cutoff of 2026-11-06 UTC. They are future-dated provider observations and cannot establish which deployment was current as of the cutoff; the timestamp discrepancy remains unresolved. Preserve the values as query output only, not reliable as-of-cutoff evidence. The returned Preview record is for a different branch regardless of this clock discrepancy.

Project settings and deployment metadata previously returned conflicting Node major-version values (`24.x` at project settings versus `26.x` in deployment metadata). Effective deployed runtime remains **UNVERIFIED**; it is not material to the edge-rule recommendation.

### Firewall, WAF, DDoS, bots, rate limits, and plan

| Control | Evidence/status |
|---|---|
| Firewall rule inventory, match scope, action, and environment | **UNVERIFIED** — no connector tool exposes these fields. |
| WAF rules and enforcement mode | **UNVERIFIED** — no rule list, action, scope, or mode returned. |
| DDoS protection state/events | **UNVERIFIED** — no project/account state or telemetry returned; no default is inferred. |
| Bot protection | **UNVERIFIED** — capability, entitlement, mode, and rules not returned. |
| Vercel edge rate limiting | **UNVERIFIED** — capability/entitlement and effective keys, windows, thresholds, actions, and monitor mode not returned. |
| Plan | Hobby label observed. Exact entitlement to any of the above controls remains **UNVERIFIED**. |
| Vercel request/traffic logs | No inspection tool is available through this connector. |

The project response was not treated as a full security-settings inventory: the connector result is not an authoritative Firewall/WAF dashboard view. No edge rule was created, edited, enabled, disabled, simulated, or tested.

### Analytics and baseline

- The project feature metadata says Web Analytics is disabled (`webAnalytics: false`); deployment metadata also contains an Analytics ID. No request/visit/event counts, collection confirmation, or analytics-panel view is available. Treat the mixed metadata as **no operational analytics baseline established**.
- Speed Insights is present in metadata but `hasData: false`.
- No historical or current request counts, path/method distributions, p95/p99 rates, 4xx/429/5xx rates, origin response latency, shared-IP profile, or provider retry profile were obtained.
- Analytics state is not evidence of security controls. Nothing here verifies Firewall/DDoS/bot decisions.

### Direct HTTP and header probes

No Production or Preview HTTP request was made. This workspace's permitted outbound hosts do not include the Vercel deployment host, and the Vercel connector only returns metadata; therefore a safe response-header request could not be performed here. No status code, redirect, CSP, cache header, WAF response, or live application behavior is inferred.

Source configuration on the active branch:

- `next.config.mjs` declares global `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, and a restrictive `Permissions-Policy`.
- `proxy.ts` and `lib/csp.ts` build a per-request nonce CSP for matched document routes and add `X-Request-ID`. Its matcher excludes `/api`, Next static assets, and optimized images. The CSP is source evidence, not an observed response.
- `vercel.json` sets `regions: ["bom1"]`; it does not declare a Firewall/WAF policy.
- `lib/security-headers.test.ts` checks a source value; it does not prove deployed headers.
- No explicit `Strict-Transport-Security` header is declared in `next.config.mjs`, `proxy.ts`, or `vercel.json`. Whether Vercel supplies HSTS or enforces HTTPS redirects for the deployed host was not probed; do not treat this source search as proof that the live response lacks HSTS.
- Next Server Actions have a configured 6 MB body cap. This is an application/framework request-size guard, not a Vercel Firewall rule. It is lower than the 8 MB image-capture validator accepted by some menu/brand extraction actions; the effective request-size interaction has not been exercised. A multipart Server Action with a valid 6–8 MB image may be rejected before its action-level validation.

## 2. Route audit method and common boundaries

The active checkout contains **42 `page.tsx` routes, 11 `route.ts` handlers, 19 Server Action modules, and one static Metadata Route (`/manifest.webmanifest`)**. This is a source inventory, not proof that the deployed build contains the same version or that its migrations have been applied. Page routes below are GET document requests (with the framework's normal HEAD behavior where applicable). The manifest is a separate public static metadata response. Each Server Action is a Next.js POST/action-protocol request; it is not an independently defined REST endpoint.

`proxy.ts` refreshes the Supabase session and redirects signed-out requests for `/dashboard`, `/kitchen`, `/cashier`, and `/bill`. It does **not** perform role authorization; route layouts, data loaders, action guards, RLS, grants, and RPC checks provide those boundaries. `/api` is excluded from the proxy matcher, so API handlers must authorize themselves. The staff outlet cookie is a preference: `getStaffContextDetailed()` resolves it only against the caller's actual memberships and otherwise picks a valid outlet.

Role notation in the page matrix: **O** owner, **M** manager, **C** cashier, **K** kitchen. “No app budget found” means no source-level request throttle was found for that page; it does not mean Vercel has no control. Database controls and limits listed here are source/migration evidence only, not proof they are live in the hosted database.

## 3. Page route-by-route matrix (42)

| Page URL | Method, authentication, and tenant boundary | Existing limits, traffic, abuse risk, and false-positive impact |
|---|---|---|
| `/dashboard/display` | GET; proxy session check; page resolves selected staff outlet; `current_verification_code` checks membership/role in SQL (O/M/C/K). | Operator kiosk during service; no page request budget found. A broad limit can hide the rotating guest code from legitimate diners. |
| `/cashier` | GET; proxy + `RoleGate` O/M/C; cashier loader scopes orders to the selected outlet. | Live money queue; cashier refresh is about 20 s. No edge/app page budget found. Blocks can delay payment recording and show stale balances. |
| `/dashboard/branding` | GET; proxy + branding `RoleGate` O/M; scoped staff loader. | Owner/manager occasional reads; no page limit found. A block prevents branding review but not current storefront operation. |
| `/dashboard/branding/preview` | GET; same O/M gate; menu and brand draft/assets are resolved in the current tenant context. | Preview-only human workflow; draft IDs are not authorization. No page budget found. A rule can block draft review; avoid assuming a query ID is a security key. |
| `/dashboard/menus/import` | GET; proxy + menus `RoleGate` O/M; staff context and selected outlet. | Human-triggered import screen; parsing/AI/upload work is in separate Server Actions. No page budget found. Blocking navigation blocks menu onboarding. |
| `/dashboard/menus` | GET; proxy + menus `RoleGate` O/M; menu editor loader uses selected outlet. | Ordinary editor navigation; no request limit found. A path rule can affect many unrelated save, publish, undo, and import actions posted to this page. |
| `/dashboard/menus/translate` | GET; menus `RoleGate` O/M; translation source read scoped to staff outlet. | Occasional operator screen, with external AI only on a Server Action. No page limit found; false positives prevent review/translation, not guest ordering. |
| `/dashboard/menus/translate/print` | GET; menus `RoleGate` O/M; print data uses the same staff menu scope; language is a query parameter. | Human print/export use; no page limit found. Avoid treating print requests as an attack burst without a baseline. |
| `/dashboard/orders` | GET; proxy + dashboard/orders `RoleGate` O/M/C; tenant-bound staff data. | Operational queue; owner refresh defaults to about 45 s and pauses in hidden tabs. A limit can hide new orders or stale the ledger. |
| `/dashboard` | GET; proxy + dashboard `RoleGate` O/M/C; selected outlet. | Overview refresh defaults to about 45 s and pauses in hidden tabs. No edge/app page limit found; blocking harms the owner/cashier view. |
| `/dashboard/invoices` | GET; dashboard gate plus `getInvoiceHistory()` explicitly permits O/M/C; queries are scoped to current outlet and capped at 100 closed sessions. | Occasional finance-history reads; bounded list is an application query limit, not a rate limit. A false positive delays invoice reconciliation. |
| `/dashboard/reports` | GET; reports layout is O/M; page data uses selected outlet. The SQL `report_sales()` function itself checks membership, not the page's O/M role. | Screen range is clamped to 366 local days and lists 100 orders. No page budget found. Direct export/RPC role and resource exposure is detailed in §6; do not treat the layout as the handler's authorization. |
| `/dashboard/subscription` | GET; dashboard parent allows O/M/C; state/history/payment RPCs scope to an account reached through the caller's outlet membership. Provider UI is disabled in current source. | Occasional billing reads; the caller requests 50 history/payment rows, but the SQL `LIMIT` follows JSON aggregation and does not bound the underlying rows (see F5). No page limit found. Confirm whether account billing history is intentionally visible to all account members, including cashier. |
| `/dashboard/subscription/receipt/[id]` | GET; dashboard parent allows O/M/C; `account_receipt()` returns a receipt only if the caller belongs to an outlet in that account. | Immutable receipt, no request budget. The SQL comment says account owner but function checks membership; confirm intended role visibility. No cross-account access was evidenced in source. |
| `/dashboard/settings` | GET; proxy + settings `RoleGate` O/M; settings/team loaders use current tenant. | Human operator reads; no page budget found. Broad blocking stops settings and staff onboarding. |
| `/dashboard/tables` | GET; proxy + tables `RoleGate` O/M; current outlet. | Occasional table/QR management; QR operations have database checks but page reads have no rate budget. Blocking disrupts printing, code rotation, and service setup. |
| `/kitchen` | GET; proxy + kitchen `RoleGate` O/M/K; current outlet. | Live preparation board; realtime normally, 30 s fallback while live and 5 s polling while degraded. A rule risks food-preparation delays; do not count this expected polling as abuse. |
| `/admin/renew-trial` | GET page is public and contains an operator form; the side-effecting API/action requires the admin bearer secret. No tenant is selected from the page. | Rare operator use; no page/action rate budget found. The POST is secret-protected (see handler/action rows); challenge/block can prevent a support operation. |
| `/bill/[id]` | GET; proxy requires a session; `getBillData()` filters by current outlet. It has no explicit app role gate; payments RLS is O/M/C. | Private bill contains customer/payment data; dynamic and not indexed. No page budget found. Kitchen-role access can fail at the finance query; role behavior needs isolated test, not an edge workaround. |
| `/demo/menu` | GET; public demo/sample content, no tenant or authenticated data. | Human/demo traffic; no request budget found. Broad challenge/rate controls can break demo and buyer review. |
| `/forgot-password` | GET; public Auth form, no tenant. | Human recovery flow; request action invokes Supabase Auth. Hosted Auth send/abuse limits are not inspected. False positives lock out recovery or stop reset emails. |
| `/invoice/[id]` | GET; loader requires signed-in staff and filters invoice/lines/receipts to selected outlet; database finance policies limit reads to O/M/C. | Sensitive immutable receipt, not indexed/dynamic. No page budget found. Broad controls can block cashier print/share work. |
| `/invoice/payment/[id]` | GET; signed-in staff and selected-outlet filter; finance RLS applies. | Private payment acknowledgement, not indexed/dynamic; no page budget found. Blocking it can prevent a cashier proving payment. |
| `/join/[code]` | GET; invite code is not sufficient to reveal a preview: the SQL preview requires a signed-in user; anonymous users get the signup/login path. Tenant and role come from the hashed invite record, not caller IDs. | Invitation preview is database-budgeted per actor and actor+code; signup/accept actions also have hashed IP/code budgets. Shared office/mobile IPs can hit legitimate onboarding budgets; no edge threshold proposed. |
| `/join` | GET; public; normalizes and redirects only to the same-site invite path. | Low-cost landing/redirect; no app budget found. A block prevents staff onboarding. |
| `/login` | GET; public Auth form; no tenant. | Human sign-in; Auth provider abuse settings are unverified. Blocking/overly narrow rules can lock out all staff. |
| `/menu/cart` | GET; public restaurant slug, published menu and table access resolved server-side; browsing allowed after a live QR scan, checkout still requires the verified session. | Guest browsing/checkout; no read budget found. Any broad limit can strand guests and delay orders. |
| `/menu/checkout` | GET; public; tenant from slug and server-validated table/card state; code gate is shown before an order can be written. | High-value guest journey; no page rate budget. False positives block checkout; never infer that a page GET equals a submitted order. |
| `/menu/item` | GET; public; selected restaurant/menu/item is checked against published menu and table/card access. | Guest menu navigation; no read budget found. Rate controls can block item details or add-to-cart. |
| `/menu/order` | GET; order is read through slug + short code + guest bearer token (`?s=…&code=…&t=…`); dynamic/no-store data loader and DB token match scope the read. | Guest order screen; status refresh is POST/body-based, but the initial page credential is in the URL. URL/history/access-log exposure is a source-level review item; global strict-origin referrer policy reduces cross-origin referrer detail but does not remove local logs/history. No request budget found. Blocking harms order visibility/change/cancel. |
| `/menu/orders` | GET; public screen uses the guest's own browser-stored order list; order details are opened through each order's own token. | Guest return-to-order workflow; status polling is about every 10 s while active, backs off to 60 s on failures, sleeps while hidden and stops terminal orders. Do not throttle this expected polling. |
| `/menu` | GET; public published menu by slug; active restaurant/card/session checks are server/database-derived; no staff login required. | Guest and QR-scan traffic; no page read budget found. Shared restaurant Wi-Fi/NAT is normal; broad IP caps can deny a whole dining room. |
| `/` | GET; public static landing page; no tenant. | Human/search traffic; no app limit found. Blocking affects discovery/demo. |
| `/pricing` | GET; public static content; no tenant. | Human/search traffic; no app limit found. Blocking affects evaluation; commercial wording needs owner approval. |
| `/privacy` | GET; public static content; no tenant. | Human/legal-page traffic; no app limit found. Blocking prevents access to privacy terms. |
| `/receipt-share/[token]` | GET; public 43-character bearer token is hashed before the read; SQL returns only the linked unexpired, unrevoked invoice. No tenant ID is accepted from the caller. | DB budget is 60 reads per token-derived key per 60 s; link lasts 24 h and is revocable. Several recipients can legitimately share one link; an additional per-IP edge cap can false-positive. Token is a bearer secret in the URL. |
| `/reset-password` | GET; public route, but password update requires an Auth session and recovery-state cookie. | Human recovery; no app rate limit found. Supabase Auth settings are unverified; overblocking prevents account recovery. |
| `/signup/confirmation-pending` | GET; public guidance page; may read a short-lived pending-email cookie, but no tenant lookup. | Low-cost page after signup; no limit found. Blocking strands the confirmation flow. |
| `/signup` | GET; public owner signup form; provisioning is through Auth/server actions, not a page GET. | Human signup; no source app IP budget found for owner signup. Hosted Auth controls unknown; broad blocking stops legitimate workspace creation. |
| `/t/[token]/code` | GET; public QR token is validated; `public_qr_intro` resolves the live card/table before showing code-verification flow. The code is not issued by the page. | Human verification form; failed attempts are limited by the DB function (see action matrix). IP fingerprint is a caller-supplied forwarded-header hash and is not a strong identity. False positives can affect diners behind shared Wi-Fi. |
| `/t/problem` | GET; public fixed explanation selected from an allowlisted reason. | Low-cost error state; no rate budget found. Blocking hides the reason a QR journey failed. |
| `/terms` | GET; public static legal content; no tenant or authentication. | Human/legal-page traffic; no app limit found. Blocking prevents access to terms. |

## 4. Route-handler and metadata-route matrix (11 `route.ts` handlers + 1 metadata route)

| Endpoint | Method(s), auth, tenant boundary | Existing limits, expected traffic, abuse risk, and false-positive impact |
|---|---|---|
| `/dashboard/outlet/new` | POST only; proxy session + same-origin check; `getStaffContextDetailed()` and `create_outlet()` derive owner/account; database enforces owner, slug and plan allowance. | Input/name/slug validation and account outlet cap, but no request throttle. Rare owner operation; edge false positives stop adding an outlet. |
| `/dashboard/outlet` | POST only; proxy session + same-origin; switch target must be one of caller's memberships; safe local return path; writes preference cookie only. | No app limit found; low-impact repeated switch requests. Blocking prevents outlet switching, not cross-tenant access. |
| `/dashboard/reports/export` | GET; session/staff context and selected outlet; type is summary/orders/items; response is `no-store`. **No explicit O/M role check** in the handler/loader. | Range up to 366 days in app; fixed `orderLimit: 10_000`; items export includes lines. Can be materially heavier than page read. Direct route + SQL membership authorization are broader than `/dashboard/reports`' O/M layout. A path-only block may also hit legitimate accountants; see §6. |
| `/api/admin/renew-trial` | POST; `Authorization: Bearer …` checked before body parse; action revalidates secret; service-role function receives exact restaurant name. | JSON parser caps body at 8 KB; input is validated. No app rate limit found. Very high-impact but secret-protected and rare; do not blanket-block the operator without owner approval. |
| `/api/billing/webhook` | POST provider callback; raw body signature/freshness (5-minute window), event schema/amount validation and replay key; fails closed when provider unconfigured. GET returns 405. | No app/IP throttle or explicit streaming/body-size cap found. When provider is unconfigured it returns 503 before reading the body; if later configured, `request.text()` buffers the full raw body before signature verification. Provider retries are expected; no callback allowlist, payload-size contract, or effective platform cap was verified. Never challenge, CAPTCHA, or block this endpoint from an unmeasured/guessed IP threshold. |
| `/api/health` | GET public, no-store; fixed readiness fields and backend probes; no tenant or secret in the response by source. | No app limit found; monitoring cadence unknown. Public repeated probes can consume backend reads, but an arbitrary block can break uptime checks. Baseline first. |
| `/api/ops/realtime-alert` | POST; same-origin, bounded JSON, signed-in staff with O/M/K; restaurant key is server-derived. | DB budget 6 per restaurant per 600 s; budget failure is 503, over-budget is a quiet 204. Expected only on kitchen realtime degradation/recovery. A stricter edge rule can suppress the one operational alert; no external alert delivery is assumed. |
| `/api/tts` | POST; JSON parser 8 KB; signed-in O/M/K; current outlet derived server-side. No `GET` path. | Text max 1,000 characters; DB budget 30/user and 300/restaurant per 600 s before external synthesis; synthesis timeout 20 s. Cost/availability risk is bounded in app; false positives silence kitchen voice (browser fallback exists). |
| `/auth/confirm` | GET Auth callback; validates PKCE `code` or allowed `token_hash`/type with Supabase Auth, then safe-local redirect. No tenant ID is trusted. | One-time/expiry checks belong to Auth. No app rate limit found; email/link callbacks and recovery must not be challenged or broadly blocked. Hosted Auth callback behavior remains untested. |
| `/menu/orders/status` | POST only; slug + code + UUID bearer token in bounded JSON body; DB `get_public_order()` returns a narrow status snapshot only on a full match. GET returns 405. No cookie authorization. | No explicit endpoint budget found. Expected poll is ~10 s active with exponential backoff and terminal stop. A cap that counts legitimate guest polls can make an active order appear unavailable. |
| `/t/[token]` | GET QR entry; validates public token, resolves a live card in `public_qr_intro`; in scan modes, `open_table_session()` creates an expiring token and sets a cookie. | DB scan-mode limits: 10 opens/card/hour and 20 opens/card+IP/hour; refusals mint/log no session. Code-mode scans are menu-only. IP hash is caller-supplied/forgeable; per-card serialization and limits remain the primary source controls. Shared-IP edge caps risk denying an entire venue. |
| `/manifest.webmanifest` (metadata route, not a `route.ts` handler) | GET static manifest from `app/manifest.ts`; no authentication, tenant, or user data. | `force-static` product metadata only; no app-level rate budget is defined. Low-cost public read; a broad block breaks installability but does not grant application access. |

## 5. Complete Server Action module review (19 files)

All below are Next Server Action **POSTs**, not separate REST methods. Next routes actions through page/action protocol; path/method-only matching may group several unrelated actions. Do not put a Vercel rate rule on a staff page path without verifying the actual matching behavior and proving it will not block saves, payments, imports, or other forms.

| Server Action module and exported action families reviewed | Auth/tenant and existing limits | Abuse and false-positive assessment |
|---|---|---|
| `app/(staff)/cashier/actions.ts` — `recordPaymentAction` | Staff context, O/M/C role, order query scoped to selected restaurant, atomic `record_counter_payment()` RPC; client supplies UUID idempotency key, not amount. | No request limiter found; legitimate retry is idempotent. Do not throttle payment submission or its retries. |
| `app/(staff)/dashboard/actions.ts` — `markSessionPaidAction`, `checkoutSessionAction` | Staff context, O/M/C role, UUID validation; atomic DB RPC resolves session/tenant and issues immutable receipt. | No app rate limit found; money/close operations are high-consequence and retries/duplicate taps must remain safe. |
| `app/(staff)/dashboard/branding/actions.ts` — logo/banner upload and removal | Staff context, O/M only; database and Storage paths scoped to restaurant; image MIME/size checks (logo 2 MB, banner 4 MB), Storage adds another 4 MB ceiling. | No action throttle found. Next body cap 6 MB. Broad blocking prevents real brand updates; no high-volume asset baseline exists. |
| `app/(staff)/dashboard/menus/actions.ts` — select/create/delete/restore menu/category/item; save/add items; availability; publish; variants/add-ons; reorder; bulk add; description/translation generation and save; dish-photo upload/remove | `currentRestaurant()` resolves member and selected outlet. Most writes rely on tenant-scoped predicates plus RLS; menu/category/item writes require O/M at DB policy. Bulk/text validators cap import data (20,000 chars, 60 categories, 400 items); dish image max 4 MB. The generation actions resolve membership and tenant but do **not** explicitly require O/M before provider calls; each accepts up to 50 targets (up to five 10-item model calls) and no shared app/provider budget was found. | Potential authenticated-member AI-cost surface if direct action invocation is possible; page layout alone is not an action guard. Verify/fix role gate and budget at action layer before any edge proposal. A generic POST rule here can block routine edits and legitimate AI review. |
| `app/(staff)/dashboard/menus/brand-actions.ts` — photo extraction, asset upload, create draft, publish/rollback, design, announcement/ordering updates, `newImportIdAction` | `manageContext()` requires O/M and selected tenant for sensitive operations. Brand extraction has a **process-local** 10 s per-restaurant cooldown, not a distributed quota; image/PDF validator allows up to 8 MB/3 pages. Draft IDs/asset paths are re-scoped to tenant. `newImportIdAction` only returns a UUID. | AI/cpu/storage risk is partly bounded by image and application checks but no shared budget exists. A process-local cooldown may vary across instances; false positives can stop legitimate rapid re-tries. Next 6 MB body cap may reject otherwise validator-valid 6–8 MB captures before action code runs. |
| `app/(staff)/dashboard/menus/import-actions.ts` — create imported menu, preview pasted text, photo extraction, attach crops | Preview is pure deterministic parsing, no auth/db/provider, max 20,000 chars. Create requires staff context and tenant; writes rely on owner/manager RLS; sanitization caps 60 categories/400 items. Photo extraction explicitly O/M and 8 MB validation, but no shared request budget. Crop attach explicitly O/M, scopes menu/items, caps each crop at 600 KB and takes at most 60. | Photo import can incur provider cost; no distributed ceiling found. 6 MB Next Server Action body cap may be below the image validator/aggregate crop envelope. Edge filtering risks valid menu onboarding/uploads. |
| `app/(staff)/dashboard/settings/actions.ts` — save details, guest verification setting, tax | `requireEditor()` checks O/M; selected restaurant from membership; input validation and DB/RLS final check. | No request rate limit found. Legitimate owner setup/tax correction must not be blocked. |
| `app/(staff)/dashboard/settings/team-actions.ts` — create/revoke invite, remove member | `requireEditor()` O/M; DB repeats role, target restaurant, role hierarchy and last-owner rules. Invite create/revoke itself has no shared rate budget identified; **signup/accept/preview/redemption** budgets are separate. | No external email send from these actions. Invite minting is a privileged operator action. Avoid applying the signup/accept IP thresholds to owners creating/revoking links. |
| `app/(staff)/dashboard/share-actions.ts` — create/revoke invoice share link | Staff context and O/M/C role; DB RPC scopes invoice/link to the tenant; 24-hour random bearer token, only hash persisted. | No creation throttle found. Public read side has 60/token-derived key/60 s. Several recipients can legitimately open one link; an additional edge cap risks disclosure workflow. |
| `app/(staff)/dashboard/tables/actions.ts` — add/activate table, rotate/revoke QR, rotate verification code | Staff context/current tenant; role is UI-gated O/M and database grants/RPCs provide final protection; seats bounded 1–50, table IDs and RPCs scoped. | No explicit request budget found. Blocking can prevent opening a table, refreshing a printed QR, or rotating the guest code. |
| `app/(staff)/kitchen/actions.ts` — order/waiter announcement claims/results, resolve waiter call, advance/confirm/reject table/order | Staff context; ticket movement requires O/M/K; waiter-call operations allow O/M/K/C; DB rechecks tenant/role and uses compare-and-set/idempotent claims. | No edge/action rate limit found. Calls correlate to orders/tables and are operationally time-sensitive; do not throttle the kitchen board's expected announcements or responses. |
| `app/admin/renew-trial/actions.ts` — `renewTrialAction` | Shared admin secret validated in action and API route; service-role RPC, bounded input, exact matching. No browser user/tenant identity substitutes for secret. | No app rate limit found; high-consequence and rare. No secret was requested or read during this audit. |
| `app/auth/actions.ts` — signup, resend confirmation, sign-in/out, password reset, password update | Public Auth actions or authenticated/recovery-cookie update; safe redirects and generic messages; Supabase Auth is the identity/rate-limit authority. No app-level IP budget found in this module. | Hosted Auth CAPTCHA/send/credential-stuffing limits are unverified. Any broad rule risks lockout, email enumeration/abuse trade-offs, or recovery failure. |
| `app/join/actions.ts` — accept invite, signup through invite | Accept requires signed-in user; signup validates input. Shared DB budgets are hashed: signup 12/IP/hour and 5/IP+code/hour; accept 30/IP/15 min and 10/IP+code/15 min. SQL also budgets preview 30/actor/hour + 12/actor+code/hour and redemption 12/actor/hour + 5/actor+code/hour. Failures fail closed. | Shared public/corporate Wi-Fi can aggregate legitimate onboarding. IP hash uses forwarded headers, which source code explicitly treats as forgeable; IP budgets are a brake, not strong identity. Avoid duplicating them with arbitrary edge thresholds. |
| `app/menu/checkout/actions.ts` — `placeOrderAction` | Public guest action; restaurant slug and table session resolved server-side; order prices/tenant/session/idempotency enforced in DB. Invalid/expired session fails closed. | **No submission throttle should be added.** Migration `20261110000800_remove_order_submission_caps.sql` removes order caps while preserving session validation/idempotency. Compatibility handling for an old `rate-limited` DB error remains in source. Legitimate new orders and valid retries are explicitly protected from edge throttling. |
| `app/menu/order/actions.ts` — guest cancel and edit quantities | Guest bearer token scoped to order; `cancel_order()` and `set_order_line_quantities()` recheck DB state, timing, kitchen state, quantity, and token. | No app request budget found; valid correction/cancel and retry are expected. Blocking can strand a guest with an incorrect or unwanted order. |
| `app/menu/waiter-actions.ts` — `callWaiterAction` | Verified table-session cookie; UUID request key; SQL resolves table/restaurant and makes request idempotent. | SQL allows one open call/table, coalesces repeat request key, and imposes a 30 s recent-call cooldown. No app/IP limit. Additional limits can suppress a genuine service request. |
| `app/orders/actions.ts` — staff cancellation | Staff context and current-restaurant order lookup; `cancel_order()` rechecks membership and financial/prep constraints. | No app throttle found. A legitimate staff cancellation must not be blocked; paid/served orders are refused by business rules. |
| `app/t/[token]/actions.ts` — `verifyTableCodeAction` | Public QR token + six-digit rotating code; session cookie only written after DB `verify_table_qr_with_code` returns success; same-site safe redirect. | DB limits 5 attempts per QR/IP window and blocks for 15 min; 20 wrong codes across addresses rotate the restaurant code. Caller-supplied forwarded-IP hash is forgeable. False positives affect diners sharing venue Wi-Fi; do not add an edge cap to code attempts. |

### Application/database limits: not Vercel limits

- QR scan-mode session admission is serialized per card and capped at **10 opens/card/hour** and **20 opens/card+IP/hour**. The IP hash is a hint supplied from a forwarded header; the QR/card cap and database state are stronger than that IP component.
- QR code verification: after **5 attempts** for a QR/IP, blocks for **15 minutes**; **20 wrong codes across addresses** in the code window rotate the restaurant code. Existing DB control, not a Vercel setting.
- Staff invite attempts use the actor/IP/code budgets listed in the action matrix. Database errors fail closed.
- Shared invoice read: **60/token-derived key/60 s**. A 24-hour link is revocable, and only its digest is stored.
- TTS: **30/user/600 s** and **300/restaurant/600 s** before external synthesis. Realtime alert: **6/restaurant/600 s**.
- Waiter calls: one open call/table plus **30 s** recent-call cooldown and request-key idempotency.
- Menu and image limits are payload/business validation; 6 MB Server Action body cap is framework behavior. None of these proves a Vercel edge control is enabled.
- Guest order submission is intentionally exempt from rate limiting. Do not rate limit order placement, valid idempotent retries, QR/session verification, guest status polling, kitchen/cashier operations, or provider callbacks without separate owner authorization and a proven business-safe alternative. No such alternative is proposed here.

## 6. Source-level review findings and owner decisions

### F1 — Report export/RPC authorization is broader than the reports screen (high-priority review)

`/dashboard/reports` is protected by a `RoleGate` for O/M, but `GET /dashboard/reports/export` calls `getReportsScreenData()` without an O/M role check; the Route Handler does not render through the page layout. `getStaffContextDetailed()` establishes a member and outlet, and SQL `report_sales()` uses `is_member(p_restaurant_id)` (any member) rather than the screen's O/M role. The route therefore appears reachable to authenticated members beyond the screen's role set if they call it directly. The export fixes the order-list limit at 10,000; the `items` export requests line data, which the SQL function caps at 20,000 rows. The SQL function clamps a caller-provided `p_order_limit` only at zero; it has no upper bound for a direct authenticated RPC call, although it caps the time range at 400 days.

**Evidence boundary:** source-only; no hosted role/RLS/PostgREST request was run.

**Owner decision:** confirm intended report visibility (O/M as the UI says, or all staff). If O/M is intended, add an action/route and SQL authorization regression in the normal approved code workflow before considering edge controls. Do not use a WAF rule as an authorization patch.

### F2 — Menu AI Server Actions have no explicit role or shared cost budget

`generateDescriptionsAction` and `generateTranslationsAction` call `currentRestaurant()` and scope reads to the member's selected outlet, but unlike the page layout they do not explicitly require O/M before calling the external AI helper. Payloads are capped at 50 targets (up to five batches of ten); no shared application quota was found. Most menu writes are protected by tenant predicates and owner/manager RLS, but that does not bound the AI cost of these read-and-generate actions.

**Evidence boundary:** source-only; the Server Action invocation path and hosted provider controls were not probed.

**Owner decision:** confirm intended roles and budget for generation. Prefer explicit role/tenant and provider-budget controls at the action layer; broad path/method edge controls would collide with ordinary menu saves and other actions.

### F3 — Order bearer credential appears in the order-page query string

`/menu/order` accepts `t` as the guest token used for reading, changing, and cancelling a private order. The separate polling endpoint correctly carries that credential in a POST body, but the initial order-page link carries it in the URL. The global source Referrer-Policy reduces cross-origin referrer leakage; it does not remove browser history or server/access logs. No deployed logging/analytics behavior was checked.

**Owner decision:** confirm this is an accepted link design or review a follow-up to reduce URL/log exposure. No change was made in Phase 1.

### F4 — Subscription visibility is tenant/account-member scoped; confirm role intent

Subscription state/history/payment RPCs check membership in an outlet linked to the account; receipt reads check membership in any outlet for that account. `/dashboard/subscription` sits under a dashboard layout that permits O/M/C. This is tenant/account scoped in source, but not owner-only read access. The feature inventory describes account-member reads and owner-only changes; the SQL comment for `account_receipt()` says “for the owner” while the function checks membership. **No cross-account access was demonstrated.** Confirm whether cashier/member visibility is intended; no billing provider is configured in the current source flow.

### F5 — Subscription history `p_limit` does not bound rows before aggregation

`account_subscription_history()` and `account_payment_history()` take `p_limit` and the page passes 50, but the SQL applies `LIMIT` after a single `jsonb_agg(...)` result. That limits the aggregate's one output row, not the rows fed into the aggregation, so the requested 50-row cap is ineffective. Both functions still scope data to the caller's account via restaurant membership; this is a potential response-size/query-cost issue as history grows, not evidence of cross-account access. No volume or hosted query-cost data was available.

**Owner decision:** confirm expected history retention and response shape. If a code change is separately approved, move the limit into a subquery before aggregation and add a disposable-DB regression that inserts more than 50 rows. No code or migration change was made in this Phase 1 audit.

### F6 — IP-derived application budgets are not an authenticated identity

`lib/ip-hash.ts` explicitly notes that `x-forwarded-for` is a header and can be forged; QR scan and code-verification budgets hash this input. Invite budgets also derive a hash from forwarded headers. These are useful friction controls but are not a replacement for QR/session/token, user, or tenant checks. Do not assume that a Vercel IP key will align with them until the effective proxy/header contract is measured.

### F7 — Billing webhook body is read without an application-level bound

When billing is unconfigured, `/api/billing/webhook` returns 503 before consuming the request body. If a provider is later configured, the route calls `request.text()` to buffer the entire raw body before signature verification; this route contains no explicit streaming byte cap. Vercel's effective request-size ceiling and the future provider's maximum event size were not verified, so this is a conditional source-level resilience concern, not a demonstrated current exploit.

**Owner decision:** before enabling a provider, confirm its documented event-size ceiling and the platform request cap, then set a compatible raw-body bound and test valid/retried signed events plus oversized bodies. Do not add an arbitrary edge threshold or challenge provider callbacks as a substitute.

## 7. False-positive and threshold analysis

A meaningful rate threshold requires observed baseline by path/method/status and time-of-day, plus the affected customer population. None is available. Therefore there is no p95/p99, burst factor, false-positive rate, shared-NAT profile, or expected 429 rate to support a numeric threshold. No numbers are invented here.

Highest false-positive hazards found in source:

1. **Dining-room NAT/shared Wi-Fi:** many guests at one restaurant share an egress IP; a public-IP threshold can reject unrelated cards and guests.
2. **Expected polling:** guest status every ~10 s while active (backoff to 60 s on failure, hidden-tab sleep, terminal stop); owner refresh ~45 s; cashier ~20 s; kitchen 30 s during live mode or 5 s when degraded. These are designed traffic, not an attack signal.
3. **Order/session/callback invariants:** orders and valid idempotent retries are intentionally uncapped; session/code attempts and invite/share access have their own DB semantics; Auth confirmation and billing webhook deliveries can be retried. Challenge/block can corrupt customer flows or prevent a provider event from arriving.
4. **Server Action path overlap:** a rule on a dashboard page/method can include multiple menu, table, settings, and upload actions. The connector exposes no request trace to validate match granularity.
5. **Business workflow:** a broad `/dashboard` or `/api` rule can interrupt cashier settlement, kitchen ticket movement, owner setup, and support renewal. Static/public/legal routes and the demo have no source-level app budgets and should not inherit an arbitrary blanket rule.
6. **Resource-heavy reads/uploads:** report exports and AI/image actions deserve measurement, but route-specific roles, payload caps, application quotas, and the 6 MB framework body cap must be assessed first. The 8 MB capture validator versus 6 MB action cap is a potential legitimate-upload failure, not a reason to add an edge rule.

### Narrow-rule decision

**No Vercel rule or numeric threshold is recommended from the available evidence.** Candidate surfaces for future *measurement only* are the report export, TTS relay, health probe, and provider-backed menu/brand actions. A later rule proposal would need route/method-specific normal traffic, status/latency/cost distribution, provider retry behavior, shared-IP examples, and tests proving business flows still succeed. That future measurement is not an approved rule.

No Preview monitoring rule was created. Consider Preview-only observation only if the Vercel Dashboard proves the selected action is genuinely log/monitor-only (no block, challenge, rate response, or inherited Production scope) and the test paths are synthetic. This connector cannot verify that mode, so even Preview monitoring is **not configured or recommended yet**.

## 8. Testing evidence, gaps, rollback, and approvals

### What was done

- Read-only Vercel project/domain/Production/Preview metadata queries; no configuration or deployment API was called.
- Static enumeration and source review of 42 pages, 11 `route.ts` handlers, the separate static `/manifest.webmanifest` Metadata Route, and all 19 `use server` modules; page/handler counts reconciled in `FEATURE-INVENTORY.md`.
- Read relevant source for `proxy.ts`, `next.config.mjs`, CSP/security headers, staff role layouts/context, reporting, subscription, guest order/session flows, server-side rate budgets, and the corresponding migrations.
- No Production or Preview application request, no response-header probe, no DB query/RPC, no auth event, no email, no payment event, and no synthetic traffic was sent.

### Not run / not established

- No automated test suite or build was run as part of this read-only audit; no application code was changed. Existing tests such as `app/api/admin/renew-trial/route.test.ts`, `app/api/ops/realtime-alert/route.test.ts`, `app/api/tts/route.test.ts`, `app/menu/orders/status/route.test.ts`, `app/auth/confirm/route.test.ts`, `app/t/[token]/route.test.ts`, `lib/db/reports.test.ts`, and database integration suites were identified by name/source but are **not claimed passing here**.
- No local disposable-Postgres/RLS test was run for report export roles, direct `report_sales()` upper bounds, or account-receipt role intent.
- No live edge/WAF/DDoS/bot/rate-limit status, traffic analytics/logs, Production/Preview headers, provider callback behavior, Auth protections, or user-facing false positives were verified.
- No threshold/burst test, shared-Wi-Fi test, full E2E, performance test, recovery exercise, or rollback test was run.

### Rollback

No settings or rules changed, so there is nothing to roll back. No Vercel deployment was created. The documentation changes on this branch do not alter running code. If a separate, explicitly approved future task changes a rule, first capture/export the pre-change environment-scoped rule state; keep a rule ID and evidence of its exact action/match; test only on an isolated Preview if (and only if) log-only behavior and environment isolation are proven; immediately disable the new rule and restore the saved state on any legitimate 403/429/challenge, lost callback, or workflow regression. Production changes remain out of scope here and require separate explicit authorization.

### Owner approvals/evidence still needed

1. Vercel project owner: read-only Dashboard evidence for actual Firewall/WAF rules, actions, match scope, DDoS/bot settings, rate-limit entitlement/keys/windows, and environment scope; redact secrets and customer/request data.
2. Vercel project owner: confirm Web Analytics and Speed Insights state and provide safe aggregate request/status/latency data for a representative period; no request bodies or raw customer data.
3. Product/security owner: confirm report-export role contract, direct report RPC authorization and maximum export payload, subscription billing visibility, and the `/menu/order?t=` bearer-link design.
4. Operations owner: confirm realistic service hours, normal kitchen/cashier polling, guest shared-NAT examples, provider retry expectations, and acceptable false-positive/error budget before thresholds are proposed.
5. Explicit owner approval for any Vercel Preview or Production rule change. None was given or inferred in Phase 1.

## 9. Evidence trace

- Active source checkout: `b80ab3c50c3c5067130cde40b2757eb07e15fe7e`; local modifications are documentation-only (`FEATURE-INVENTORY.md`, `RELEASE-BLOCKER-REPORT.md`, this report).
- Vercel read-only calls: project `new`/`prj_S6aU68euwLsJsaEdzolSdsJHSyS7` (`get_project` request `081d5e68-4639-4c72-873d-5f3691bacbd8`); project-domain list (`73b6b900-d67b-46c8-a15d-2fdd0def501f`); Production deployment listing (`b2a784ce-589a-4f3b-bec8-8e40c08ad380`); Preview deployment listing (`996d2495-31a6-4fa1-83a5-ba23862699d5`). Connector does not expose Firewall/WAF/bot/rate-limit or request-analytics inspection.
- Relevant active-branch sources: `proxy.ts`, `next.config.mjs`, `vercel.json`, `lib/csp.ts`, `lib/security-headers.test.ts`, `lib/db/staff.ts`, `components/owner/RoleGate.tsx`, `lib/db/reports.ts`, `app/(staff)/dashboard/reports/export/route.ts`, `app/manifest.ts`, subscription helpers/migrations, `app/menu/order/page.tsx`, `app/menu/orders/status/route.ts`, all `app/**/route.ts` files, all 19 Server Action modules, and relevant rate-limit migrations.
- `docs/infrastructure-architecture.md` and `docs/edge-security-runbook.md` are **not** in this active checkout. They were read earlier as unmerged PR #184 proposal/context only; they are not evidence of active source or hosted Vercel state.

---

**Phase 1 conclusion:** the route/action source review is complete, but the requested hosted edge settings and traffic baseline cannot be verified through the available Vercel interface. Keep all Vercel controls marked **UNVERIFIED**, do not deploy or configure a rule, and keep the release **NO-GO** pending owner-readable evidence and the role/resource findings above.