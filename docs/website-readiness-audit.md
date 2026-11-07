# AutoDine website readiness audit

**Original audit:** 2026-11-07 · branch `arena/e9e78732-autodine` at `d9d56d6`

**Status update:** 2026-11-08 · implementation is pushed through `95957c7`; CI, hermetic browser E2E, and isolated PostgreSQL browser E2E all pass. Live-schema comparison remains blocked by unavailable non-production Supabase service.

**Purpose:** distinguish what is tested from what is merely implemented, and identify safe next steps before claiming every live flow is ready.

## Executive finding

The repository has broad application code and good automated coverage, but the available evidence does **not** justify saying every production workflow is “100% workable.” The ordinary browser suite is explicitly built in demo mode without a database. A separate isolated workflow proves the QR-throttle path against disposable PostgreSQL/PostgREST, and its four PostgreSQL throttle regression cases pass. Other real-service flows remain unverified by that demo-mode suite.

The six approved follow-ups are implemented where safe: production fails closed on missing Supabase public config; local demo is explicit; CI has a separate test-only opt-in; canonical operator docs are tracked; and disposable DB/browser coverage runs only against synthetic local services. The first pushed run exposed that `NODE_ENV` is replaced at test-build time and that shared Supabase env code must not enforce server-only policy in the browser. Both were fixed in `95957c7`. The rerun passed CI, the hermetic browser job, and the isolated PostgreSQL/PostgREST browser workflow. The non-production Supabase project is inactive and its migration-history request timed out, so schema-fidelity comparison remains blocked. The user's GST decision is Option A: preserve the existing explicit configured-rate path, with no tax-policy expansion. This is not legal/adviser approval.

No production integration test, production-data read, order, payment, migration, or deployment change has been performed for these follow-ups. Production remains out of bounds for testing.

## Previously verified evidence

- CI run [42398905155](https://github.com/aryanp685/autodine/actions/runs/42398905155): typecheck, lint, design-system guard, SQL syntax check, Vitest, and production build passed on the earlier baseline.
- Browser run [42398905281](https://github.com/aryanp685/autodine/actions/runs/42398905281): the workflow enumerated **111** Playwright tests in a demo-mode build; environment-dependent integration cases are skipped without credentials. The 2026-11-08 rerun below reports the exact split: 64 passed, 47 skipped. This is UI/navigation/responsive evidence, not proof of live database or provider behavior.
- Isolated database/browser run [42398905075](https://github.com/aryanp685/autodine/actions/runs/42398905075): exercised the PostgreSQL throttle suite and both real-browser throttle tests against throwaway PostgreSQL 17.11, local PostgREST, synthetic fixtures, and Chromium. The result gate requires **2 browser tests passed, 0 skipped, 0 failed**.
- A full Vitest run on the earlier baseline reported **1,887 passed, 4 database-gated skipped** without `THROTTLE_DB_URL`; the isolated runner subsequently executed those four cases against its disposable DB.

These are historical checks on earlier code, not verification of the current working-tree changes.

**Current verification (2026-11-08):** local `npm test` — **1,892 passed, 4 DB-gated skipped**; `typecheck`, `lint`, `design:check`, `sql:check`, and the explicit test-only production build passed. Hosted reruns after `95957c7` all passed: CI [42403049630](https://github.com/aryanp685/autodine/actions/runs/42403049630), hermetic browser E2E [42403049557](https://github.com/aryanp685/autodine/actions/runs/42403049557), and isolated PostgreSQL/PostgREST browser E2E [42403049543](https://github.com/aryanp685/autodine/actions/runs/42403049543). The hermetic browser job had **64 passed, 47 skipped** (the credential-dependent cases are not live-service evidence); the isolated workflow passed its **2 browser tests** plus four PostgreSQL regression cases.

## Flow-by-flow status

| Area | What is present / proven | What is not yet proven or resolved |
|---|---|---|
| Public marketing and responsive UI | Route/responsive tests exist; latest hermetic browser job passed 64 tests. | Tests do not attach real tenant data or authenticate a real account; 47 credential-dependent tests skipped. |
| Guest QR → menu → cart → checkout → order | UI/unit/in-process flow tests exist; the QR throttle path is browser-tested with PostgreSQL. | The isolated DB browser workflow does not prove the entire guest order lifecycle through persistence, kitchen, bill, and settlement in one real-DB journey. |
| Staff login, invites, roles, dashboard | Auth/action and screen tests exist; real deployment integration specs exist. | Real-account specs require `E2E_BASE_URL` and account credentials. Signup, confirmation, recovery, and invitation delivery still need an approved non-production integration run. |
| Kitchen, cashier, table/session operations | Screen/action tests and demo browser flows exist; local SQL migrations and targeted DB regressions are tested. | A complete synthetic real-DB browser journey across scan → order → kitchen → counter settlement → bill/session close is not covered by the current dedicated runner. |
| Menu editing, import, translation, branding, outlets | Components/actions and unit/browser contracts exist. | Provider-dependent AI and real multi-tenant persistence are not proved by demo-mode UI tests. |
| Bills, invoices, print/share | Receipt rendering, print/PDF parity, and invoice tests exist. Browser/OS printing is the approved model. | Physical browser/OS/printer behavior and live invoice data have not been independently verified. Do not add printer hardware integrations without approval. |
| Payments and subscriptions | Counter settlement is implemented. Historical payment-schema remnants remain. | No Razorpay initiation, verification, or webhook routes exist under `app/api/`; no online-payment control exists in Settings. Gateway payment and plan purchase are unavailable/out of scope; customer ordering stays pay-at-counter. |
| GST | Current live model uses an explicit restaurant rate and safe handling for missing/malformed configured rates; demo values are illustrative only. | Policy is not adviser-approved. Do not guess or enable IGST, inclusive pricing, item-specific classifications/rates, exemptions, or place-of-supply rules. Preserve Option A. |
| Database/security | Migrations replay on the disposable harness; RLS/security contracts and targeted throttle/idempotency regressions exist. | `npm run sql:check` parses DDL; it does not prove every live RLS policy, permission, auth edge, or cross-tenant boundary. Local scaffolds are approximations, not a production clone. Schema-fidelity comparison against an authorized non-production source is pending; production must not be substituted. |
| Production configuration/operations | `/api/health`, `env:check`, CSP, auth, and deployment-related code exist. The guard, explicit local demo, GitHub-only `VERCEL_ENV=test` build opt-in, and tightened CSP now pass unit/build checks. | No production secrets or data were inspected. A non-production smoke test is still needed; schema comparison is blocked by the inactive test project. |

## Approved follow-ups and outcomes

1. **No implicit demo fallback — implemented and tested:** production requires the public Supabase URL/key; local development requires `AUTODINE_DEMO_MODE=true`. The named `/demo/menu` remains a read-only, clearly labelled sample, not an ordering fallback.
2. **Narrow test-only exception — implemented and tested:** CI jobs set the explicit flag and `VERCEL_ENV=test`; the code additionally checks GitHub Actions and CI. Production Vercel builds do not qualify.
3. **Documentation/config cleanup — implemented:** root README and tracked `docs/SETUP.md` describe actual limits; `.gitignore` exposes canonical docs; unsupported gateway setup copy and Razorpay CSP allowances are removed. GST remains frozen under Option A.
4. **Disposable integration coverage — verified:** isolated workflow [42403049543](https://github.com/aryanp685/autodine/actions/runs/42403049543) passed both browser throttle tests and all four PostgreSQL regressions against disposable local services. The hermetic browser job [42403049557](https://github.com/aryanp685/autodine/actions/runs/42403049557) passed 64 UI tests and skipped 47 credential-dependent cases. A full staff→kitchen→cashier→session-close journey remains unproven; production was not substituted.
5. **Verification — passed:** local Vitest 1,892 passed and 4 database-gated skipped; typecheck, lint, design, SQL syntax, and explicit test-only build passed. The hosted CI job [42403049630](https://github.com/aryanp685/autodine/actions/runs/42403049630) passed after the client/server guard correction in `95957c7`.
6. **Housekeeping/schema fidelity — verified but not changed:** PR #88's retry portion is duplicated by the current 400/1200 ms retry path, but its additional `credentialProbe` health field is not present in current code. Therefore the PR is **not wholly superseded**; it remains open and was not merged or closed. The only non-production Supabase project found is inactive, has no branches, and its migration-history request timed out. No schema comparison was possible; production was not used.

## GST decision (locked)

**Option A — freeze current behavior.** Keep the existing explicit configured-rate path unchanged. This is a software-behavior choice, **not** a claim that the tax policy is legally approved. Do not add rates, inclusive/exclusive defaults, IGST, item classifications, exemptions, or new invoice tax claims. Keep missing/invalid configuration fail-closed and wait for adviser approval before expanding.
