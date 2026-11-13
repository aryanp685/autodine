# Phase 7 — repository and local verification (Phase 4)

**Phase 4 status: LOCAL VERIFICATION COMPLETE FOR THE CHECKS BELOW; HOSTED/PILOT ACCEPTANCE NOT ESTABLISHED.** All commands ran against this checkout using local, synthetic/demo, or disposable loopback services only. No Test/Staging/Production database, deployment, secret, customer data, or real payment was used.

**Task date:** 2026-11-06 UTC (Arena). Runtime output was dated 2026-11-13 UTC; this clock discrepancy is unresolved. These repository/local checks do not decide a time-sensitive hosted behavior.

## 1. Repository gates

| Check | Result | Boundary |
|---|---|---|
| `npm run typecheck` | **PASS** — `tsc --noEmit` exited 0. | Source type check only. |
| `npm run lint` | **PASS** — ESLint exited 0. | Static lint only. |
| `npm run design:check` | **PASS** — design-system budgets: hex colours 5/5, glass 2/2, off-scale font sizes 0/0. | Repository design constraints only. |
| `npm run sql:check` | **PASS as a static checker** — exited 0 and parsed the eligible DDL fragments. | The tool itself states that function bodies, policies and `ENABLE ROW LEVEL SECURITY` are stripped/not validated. Do not call this complete SQL/security validation. Native database replay and catalog tests are separate evidence. |
| `npm test -- --reporter=default` | **PASS with explicit skips** — 188 test files passed, 5 skipped; 2,152 tests passed, 130 skipped out of 2,282; exit 0. | The 130 skipped database integration tests were run separately against disposable embedded PostgreSQL (below). Skips are not hosted acceptance. |
| `npm run build` through `npm run e2e:local` | **PASS** — Next.js 16.4.2 optimized production build, TypeScript, and 25 static pages completed in explicit demo-test mode. | `AUTODINE_TEST_DEMO_BUILD=true`, `VERCEL_ENV=test`; no deployment, hosted config, or Production build promotion. |

## 2. Disposable local database evidence

- `npm run test:db:embedded`: **130/130 tests passed across five files**, replaying all **77 repository migrations** on fresh disposable loopback PostgreSQL 17.11. This includes the DB-integration tests skipped in the ordinary no-database Vitest invocation. No hosted database was used.
- `READINESS_PG_BIN="$PWD/node_modules/@embedded-postgres/linux-x64/native/bin" npm run test:recovery:cold`: **67/67 local PostgreSQL tests passed** (62 readiness + 5 throttle). The synthetic cold physical-copy/recovery verified fingerprints after deleting the original disposable cluster: 77 migrations, 45 tables, 117 synthetic orders, 20 payments, 10 invoices; measured local recovery phase 1,470 ms. Method, metric limits, and open RPO/RTO/hosted backup gates are detailed in [`PHASE-7-RECOVERY-RPO-RTO.md`](PHASE-7-RECOVERY-RPO-RTO.md).
- `env -u RECONCILE_PG_ADMIN_URL npm run db:reconcile`: **local reconciliation harness completed**. It contacted no hosted database, replayed a 45-file historical-fixture baseline plus 32 fixture-derived files to match the local 77-file chain, passed 33 classifier self-test states (0 wrong verdicts) and 27 synthesized drift states, and preserved six representative synthetic financial/order row counts in its populated-upgrade check. This is validation of local tooling and a historical shape, not a fresh hosted classification. Full interpretation and hosted blockers are in [`PHASE-7-MIGRATION-RECONCILIATION.md`](PHASE-7-MIGRATION-RECONCILIATION.md).

## 3. Browser checks — hermetic demo only

The build and demo browser run used the repository's local Next.js server and bundled Chromium. The test build had no Supabase connection/configuration; sample records and simulated interactions were labelled demo/sample/local-only. No live guest order, staff write, payment, hosted Auth user, or customer workflow occurred.

A first broad `npm run e2e:local` run discovered 113 tests: **63 passed, 49 skipped** (database-backed integration project), and one desktop-rail geometry assertion failed on its first attempt and passed on the configured retry. A separate no-retry run of that single desktop assertion passed. Because the broad invocation included skips and surfaced a retry/flake, it is not counted as a strict all-pass gate.

Then the exact hermetic project set documented in `.github/workflows/e2e.yml` was run with **retries disabled**, JSON evidence, and the repository's result assertion:

```bash
GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test \
PLAYWRIGHT_JSON_OUTPUT_NAME=playwright-report/results.json \
bash scripts/e2e/run-with-bundled-chromium.sh \
npx playwright test \
  --project=desktop --project=phone --project=guest --project=staff \
  --project=brand --project=responsive --retries=0 --reporter=list,json
node scripts/e2e/assert-playwright-results.mjs playwright-report/results.json 64
```

**Observed result: 64/64 passed, 0 skipped, 0 unexpected, 0 flaky.** This is a clean hermetic browser/demo check at the current repository commit. It is not the database-backed integration suite, hosted E2E, a real-device/printer test, or operational acceptance. The 49 integration browser flows were **not** executed against a local Supabase stack or a hosted target in this phase.

## 4. Scope, source changes and disposition

- Application source, migrations, tests, hosted database/configuration, Vercel deployment and customer data were **not changed** by these verification runs. The Phase 7 changes in this branch are documentation only; the generated Next build and Playwright output are ignored workspace artifacts.
- The local commands verify the checkout at HEAD `9ac2b22c698b639f8fe82e8981e5182b86b7dc75`. Existing untracked `AUTODINE-LAUNCH-READINESS-REPORT.md` was preserved unchanged.
- `scripts/phase3/staging-baseline.json` remains protected; SHA-256 `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`.
- No hosted ACL/migration/security finding is remediated by a passing local test. Account-link immutability, client/default ACL cleanup, migration version/history reconciliation, accepted Test/Staging mapping, full hosted RPC evidence, provider backup/restore and RPO/RTO, Auth/domain, monitoring, and pilot-owner decisions remain open.

**Phase 4 outcome:** local repository/build/database/recovery/browser checks listed above pass, with the stated scope boundaries. Release remains **NO-GO**; Production remains read-only and no Test/Staging writes are authorized by this evidence.
