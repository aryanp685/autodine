# AutoDine website readiness audit

**Checked:** 2026-11-07

**Source:** active branch `arena/e9e78732-autodine`, commit `5f645e16c4009964ce8ba8023dd0cc3e7d24a02d`

**Purpose:** distinguish what is tested from what is merely implemented, and list the decisions/work needed before claiming every live flow is ready.

## Executive finding

The repository has broad application code and good automated coverage, but the current evidence does **not** justify saying every production workflow is “100% workable.” The green browser suite is explicitly built in **demo mode without a database**. A separate isolated workflow now proves the actual QR-throttle path against disposable PostgreSQL/PostgREST, and the four PostgreSQL throttle regression cases pass. Most other real-account integration specs require an environment and credentials that the ordinary workflows do not provide, so those real-service flows are not verified by the green demo-mode suite.

No production integration test, production-data read, order, payment, migration, or deployment change was performed as part of this audit.

## Verified evidence

- CI run [42398905155](https://github.com/aryanp685/autodine/actions/runs/42398905155): typecheck, lint, design-system guard, SQL syntax check, Vitest, and production build all passed.
- Browser run [42398905281](https://github.com/aryanp685/autodine/actions/runs/42398905281): **111** Playwright tests passed in a demo-mode build with no database. This is meaningful UI/navigation/responsive evidence, not proof of live database or provider behavior.
- Isolated database/browser run [42398905075](https://github.com/aryanp685/autodine/actions/runs/42398905075): the dedicated runner exercised the existing PostgreSQL throttle integration suite and both real-browser throttle tests using a throwaway local PostgreSQL 17.11 database, local PostgREST, synthetic fixtures, and Chromium. Its result gate requires **2 browser tests passed, 0 skipped, 0 failed**. Evidence is retained as a 30-day workflow artifact.
- The full Vitest result was **1,887 passed, 4 database-gated skipped** when run without `THROTTLE_DB_URL`; the isolated runner subsequently executed those four throttle DB cases against its disposable database.

## Flow-by-flow status

| Area | What is present / proven | What is not yet proven or resolved |
|---|---|---|
| Public marketing and responsive UI | 111 browser checks across the demo build; route and responsive test files exist. | Those checks do not attach real tenant data or authenticate a real account. Current site copy is internally inconsistent (see below). |
| Guest QR → menu → cart → checkout → order | UI, unit, and in-process flow tests exist; the real QR throttle path is browser-tested with PostgreSQL. | The isolated real-DB browser workflow currently proves throttling, not the entire real guest order lifecycle through database pricing, order persistence, kitchen, bill, and settlement as one browser journey. |
| Staff login, invites, roles, dashboard | Auth/action and screen tests exist; real deployment integration specs exist. | Real-account specs require `E2E_BASE_URL` and owner/guest credentials; the ordinary CI job does not provision those. Signup, email confirmation, password recovery, and invitation delivery therefore need a non-production integration run before claiming they work end to end. |
| Kitchen, cashier, table/session operations | Screen/action tests and demo browser flows exist; local SQL migrations and several database regressions are tested. | A complete synthetic multi-user real-DB browser journey across scan → order → kitchen transition → counter settlement → final bill/session close is not covered by the current dedicated runner. |
| Menu editing, import, translation, branding, outlets | Components/actions and unit/browser contracts exist. | Provider-dependent AI and real multi-tenant persistence are not proved by demo-mode UI tests; run against isolated services and synthetic tenants or clearly mark unavailable integrations. |
| Bills, invoices, print/share | Receipt rendering, print/PDF parity and invoice tests exist. Browser/OS printing is the approved model. | Physical browser/OS/printer behavior and live invoice data have not been independently verified here. Do not add printer hardware integrations without approval. |
| Payments and subscriptions | Counter settlement is implemented. Payment-schema/CSP/environment-check remnants exist. | No Razorpay initiation, verification, or webhook routes were found under `app/api/`; no online-payment control was found in Settings. README nevertheless advertises these flows. Treat gateway payment and plan purchase as unavailable/out of scope; customer ordering stays pay-at-counter. |
| GST | Current live model uses an explicit restaurant rate and has safe handling for missing/malformed configured rates; demo values are illustrative only. | Tax policy is not adviser-approved. Current implementation does not establish IGST, inclusive pricing, item-specific classifications/rates, exemptions, or place-of-supply behavior. These are not to be guessed or enabled. |
| Database/security | Migrations replay on the disposable harness; RLS/security contracts and targeted throttle/idempotency regressions exist. | `npm run sql:check` parses DDL; it does not prove every live RLS policy, permission, auth edge, or cross-tenant boundary. The local scaffolds are explicitly approximations, not a production clone. |
| Production configuration/operations | `/api/health`, `env:check`, CSP, auth, and deployment-related code exist. | This audit did not inspect production secrets or run against production. A staging/branch smoke test using synthetic data is needed to verify deployment configuration without touching production data. |

## High-priority findings

### 1. Demo fallback is implicit when Supabase is unconfigured

`lib/supabase/env.ts` deliberately tolerates missing configuration, and its callers can render fictional sample data. The comments say the fallback is a pilot convenience and should be removed once the database is live. `GET /api/health` correctly reports an unconfigured deployment as not ready, but the application can still render demo-mode screens. There is also an intentional public read-only sample at `/demo/menu`.

**Recommended resolution:** allow demo data only in local development or an explicit preview/demo deployment; fail closed in production if required Supabase configuration is missing or invalid. Keep `/demo/menu` only if it remains clearly labelled and read-only; it must never substitute for a real restaurant. Because this changes production failure behavior, confirm this policy before implementation.

### 2. README and operator/payment claims are stale or unsupported

`README.md` still calls the product an early-stage prototype “not ready to accept real customer orders,” and advertises Razorpay verification/webhook routes plus an owner switch for online payments. The current route inventory contains no `/api/payments/razorpay/*` handlers and the Settings screen has no such switch. `AGENTS.md` says P2–P10 are complete, customer ordering is pay-at-counter only, and no payment-mode selector/gateway may be enabled. Correct the README to the actual, verified capability; do not enable or advertise an absent/locked payment flow.

The same README points operators to `docs/SETUP.md` and `docs/DEMO.md`, but both files are ignored by `.gitignore` and are absent from the checkout. A clean clone therefore lacks that referenced setup/demo runbook. Publish a safe setup guide with no secrets or production-only SQL, or remove the dead links.

### 3. “Green CI” has two distinct meanings

The ordinary Playwright run explicitly builds without a database and tests demo-mode screens. The dedicated local PostgreSQL workflow proves the throttle path and its four DB regressions; it does not make every test in `e2e/integration/` live. Those other specs have explicit environment-dependent skips. A launch report must name which workflow and environment passed rather than describing all integration as verified.

## Recommended sequence

1. **Decide GST handling (no rate/policy change until approval):** see the three options in the response accompanying this audit. Record the decision and the adviser-approved policy before implementation.
2. **Approve production demo policy:** default production to fail-closed on missing Supabase configuration; reserve fictional fallback data for explicit local/preview mode. Decide whether the public read-only `/demo/menu` stays.
3. **Fix documentation/copy conflicts:** align README, pricing/terms/privacy copy, and operator setup instructions with the locked pay-at-counter model, actual plan availability, and GST gate. Do not advertise a gateway or tax flow that is not approved and verified.
4. **Expand real-service integration coverage using only disposable local/branch services:** synthetic owner and guest accounts; guest QR → order → kitchen → cashier settlement → bill/invoice/session close; RBAC/invites and tenant-isolation checks; menu publish/import/translation/outlet persistence. No production data or production integration tests.
5. **Run a non-production staging acceptance checklist:** verify the intended build, environment flags, auth/email configuration, storage/AI/provider integrations that are in scope, health endpoint, and rollback plan. This is separate from the local automated suite and needs a designated non-production environment.
6. **Resolve repository housekeeping:** open PR #88 (last updated 2026-10-23) has a dirty merge state. Its proposed 350 ms retry/health changes are superseded by current `main` (which has the 400/1200 ms retry path and credential health probe); confirm it is superseded and close or otherwise disposition it. No open GitHub issues were found.

## GST decision options

- **A — Freeze current behavior (recommended immediately):** keep the existing explicit configured-rate path unchanged; this is a software-behavior choice, **not** a claim that the tax policy is legally approved. Do not add rates, inclusive/exclusive defaults, IGST, item classifications, or new invoice tax claims. Keep missing/invalid configuration fail-closed and wait for adviser approval before expanding.
- **B — Adviser-approved policy, then implement:** obtain written rules for registration/state, intra/inter-state place of supply, inclusive/exclusive prices, item classifications/rates, exemptions, discounts, rounding, effective dates, invoice wording/series, and historical corrections. Implement only those rules with SQL and invoice/cart/order regression tests.
- **C — Temporarily gate GST-dependent documents/flows more strictly:** prevent tax-sensitive invoice issuance/checkout where the current known rules are insufficient. This changes financial behavior and may block operations, so it requires explicit approval before implementation; it must not invent a substitute tax rule.

**Recommendation:** choose A now, start the adviser review for B, and use C only if the adviser or operator decides the current limited tax path cannot remain active. No GST code or production behavior was changed by this audit.
