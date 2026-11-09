# AutoDine — production-readiness handoff

## Latest live staging correction verified

User-provided shareable access opened staging homepage/login. It exposed a health bug caused by legitimate service-role financial-table restrictions. Fixed using a server-only catalog RPC (no tenant data reads and no widened financial grants), applied only to staging and redeployed commit `8fd6e02`. Fresh authorized health fetch now returns **`ok:true`, credentials accepted, all operational probes applied**. Local full suite **1,931 pass / 21 native skips**, native suite **56 clean migrations / 21 pass**, cold recovery reverified. Direct sandbox Chromium is blocked by outbound network restrictions; actual hosted login/order browser flows remain unverified and need a network-enabled authorized runner. Share token is not stored in Git.

## Latest evidence: hosted preview + CI recovery

Preview for commit `fb04397` is **READY**, staging-only, no production promotion. Stable URL and verification details: [STAGING-PREFLIGHT.md](STAGING-PREFLIGHT.md). Hosted rollback-only SQL smoke passed pricing, denied direct money writes, settlement idempotency, durable receipt retry and staff TTS quota. GitHub run **42567533471 passed**, including **PG 15/17/18 populated logical dump/restore** jobs; older “logical restore unrun” wording below is historical and superseded for that isolated fixture workload. Local full suite now **1,930 passed / 20 native tests skipped**, native tests separately passed.

**Remaining immediate blocker:** preview requests redirect to existing Vercel SSO protection, including `/api/health`. We did not disable/bypass that protection. No hosted browser/login/email flow is certified. Authorized shareable-preview/automation access is required to continue browser tests. No external paid service enabled and no production environment/data/deployment changed.

## Latest approved staging execution

User approved staging-only changes. The existing `autodinetest` forward upgrade is now **applied and verified**: 49 pending source migrations, 33 public tables, current receipt/TTS functions and Storage bucket present, legacy anonymous order/limiter access revoked, empty tenant/order counts preserved. Exact scaffold→upgrade artifact passed 20 native tests first. Branch-specific preview credentials/isolation and paid-AI disablement configured; production untouched. See [STAGING-PREFLIGHT.md](STAGING-PREFLIGHT.md) for pinned source/hash and chronology. Session branch now pushed for the approved nonproduction work; earlier “no push/no hosted modification” statements describe the earlier snapshot, not this new approval. Browser integration/commercial readiness is not implied by applying schema.

## Decision: NO-GO for an unrestricted commercial launch

Local implementation and verification substantially improved; this is **not** a claim that every control is production verified, that paid integrations work, or that 5,000 concurrent users are supported. No production deployment, production data change, push, or paid service activation was performed. Work remains on `arena/3711df6a-autodine`.

### Follow-up: approved staff-only TTS contract

Payment/subscription and tax/GST decisions are deferred at the user's request, not completed. Staff-only Hindi relay is now implemented: unauthenticated/nonmember/no-database requests cannot reach the provider; active restaurant is server-resolved; fixed, shared SQL budgets apply per authenticated user (30/10 minutes) and restaurant (300/10 minutes), with membership checks in SQL. Failed/missing budget checks fail closed; public demo retains existing device-speech fallback. Local TTS access/route tests: **30 passed**. Native replay now includes **55 migrations, 19/19 native tests passed**, including denied cross-tenant/anonymous budgets and exhaustion. External voice audibility/provider availability remains unverified. These newer results supersede the earlier native counts below; browser figures below predate this follow-up.

Connected Supabase metadata lists `autodine-production` and `autodinetest`; no production data changed. Exact staging selection and deployed test URL must be confirmed before creating/deleting any hosted fixtures. PostgreSQL CI matrix now includes 15/17/18 (observed hosted engine is 17), not remotely executed.

### Read-only staging and recovery follow-up

Existing staging was inspected **read-only**, per latest instruction; no staging app exists yet. It is schema-incomplete (7 history entries, 16 public tables, old order signature, required current functions missing, no asset bucket), and its legacy order entrypoint is still publicly executable. Auth redirects remain localhost; custom SMTP is absent. No hosted modifications or test emails were performed. See [STAGING-PREFLIGHT.md](STAGING-PREFLIGHT.md).

A separate **local cold physical backup/recovery drill now passed**: new isolated cluster → 55 migrations → **20/20 native tests** → clean shutdown → physical backup → original temporary cluster deleted → restore on a new port → exact content/RLS/grant verification. Recovered **35 tables, 23 orders, 1 payment, 2 invoices**; tiny-fixture recovery phase 913 ms. New concurrency assertion: 40 independent voice-budget clients admit exactly 30/reject 10. This supersedes earlier “no successful local restore” wording **only for cold physical recovery**; logical dump/PITR/cloud Auth/Storage recovery remains unverified. Payment/subscription and tax/GST scope remains intentionally deferred.

### Evidence from this session

| Gate | Actual result | What it does NOT prove |
|---|---|---|
| TypeScript, ESLint, design gate, diff whitespace | PASS | Live integrations |
| Unit/component/route suite | **1,913 passed; 18 skipped**, 157 passing files / 2 skipped | Mocked services are not real Auth/Storage/Realtime |
| Native database suite | **54 migrations replayed into an empty random local database; 18/18 tests passed** | Supabase platform services, deployed schema equivalence |
| Production Next.js build | PASS | Deployment configuration correctness |
| Browser suite | **64 passed; 47 skipped; 0 failed; 0 flaky**, 183.2 seconds | Skipped live/deployment cases; Firefox/Safari; real printer output |
| DDL syntax gate | PASS | Function bodies/policies; those are separately exercised by native PostgreSQL |
| Bounded local PostgreSQL workload | 16 simultaneous clients; 16 same-key submissions yield 1 order; 16 distinct keys yield 16 orders; one sitting | HTTP throughput, production latency, 5,000 users |
| Dependency audit, earlier session gate | 0 known production advisories at audit time | Absence of vulnerabilities or future advisories |
| Backup/restore | Safe disposable drill implemented and wired into CI; **NOT executed successfully here** | Recovery readiness or RPO/RTO |

The 18 native cases skipped by the ordinary unit command were run separately and passed. The 47 browser skips are **not passes**. Browser coverage combines demo/responsive workflows and integration cases that require explicit disposable deployment/account configuration. One previous browser run had a 30-second full-page screenshot timeout on the five-width landing sweep; the multi-width case now has an explicit 90-second budget. The fresh full run passed with no retries/flakes. Earlier broken Chromium launch/stale server attempts are not product verification evidence.

The final browser run exercised the prior built frontend; subsequent source changes added server-side table activity aggregation, expanded the live missing-database guard to `/bill`, and strengthened native tests. Those changes passed typecheck/unit/build/native gates; their authenticated browser integration remains unverified.

## Implemented fixes, with local evidence

1. **Clean migration replay:** reconstructed missing payment audit ledger DDL and `payments.recorded_by` dependency. Fresh schema replay no longer relies on locally invented application-table scaffolds. **The backdated restoration migration requires deployed migration-history/schema review before any production application.**
2. **Money write boundary:** direct order financial updates and item mutations denied; kitchen only gets preparation-column updates with forward-only/hold-confirmation checks. Public legacy ordering and caller-selected arbitrary rate budgets revoked. Native role/tenant/privilege tests pass.
3. **Double collection:** manual sitting settlement refuses pending online payment attempts. Native settlement idempotency and authorization tests pass.
4. **Issued receipt integrity:** source financial amounts/identifiers/cancellation and dish edits cannot mutate a sitting with an issued invoice. Unpaid-issued receipt regression passes; normal preparation/payment progress is not frozen.
5. **Zero-quantity item deletion:** fixed a real positive-quantity constraint failure by deleting zero-quantity lines before updating positive quantities. Invalid, duplicate, unknown, or cross-order line identifiers rejected atomically. Native regression passes.
6. **Request safety:** bounded streamed JSON parser, object/type checks for TTS/admin/order-status endpoints. Malformed/null/nonstring and oversized payload handling covered locally.
7. **Readiness:** operational schema checks, credential distinctions, no-store health responses, HTTP 503 while unready. Explicit `AUTODINE_MODE=live` refuses operational demo fallback when the database is missing. This flag must actually be configured for a live deployment.
8. **Read correctness under PostgREST row caps:** kitchen tickets/items and daily dashboard orders/payments page explicitly; dish reads batch identifiers to avoid oversized URL lists; payment day attribution uses received time with a legacy creation-time fallback. Overlarge per-query views fail explicitly rather than silently truncate. Floor-plan order counts/last activity aggregate inside RLS-preserving SQL, verified across tenants. “Last scan” renamed “Last order”: no scan timestamp was being measured.
9. **Error/recovery UX:** generic report export error instead of raw DB exception; root-layout error recovery with a payment/order retry warning; server request-error hook records route templates/error identifiers without request URLs/cookies/body; HTML responses receive a generated request ID. This is basic structured logging, **not** a configured alerting/monitoring service.
10. **Storage URL handling:** malformed percent-encoding/traversal rejected rather than crashing image removal; regression tests pass. Local Storage upload ceiling aligned with the existing 4 MB bucket contract. File-byte content inspection remains absent.
11. **Landing/auth:** preserved light forest/brass refresh, more visible café hero background, honest illustrative product UI, responsive/reduced-motion behavior and form validation. Native and browser checks complement—not replace—live auth verification.
12. **Operator trial renewal:** preserved stricter input handling and error paths with tests; no actual restaurant trial was renewed in production.
13. **Continuous verification:** added `npm run test:db`, loopback-only random database creation/cleanup, PostgreSQL 15/18 CI jobs, optional populated dump/restore fingerprint drill. **The new GitHub job has not run remotely.**

## Feature-level classification

| Area | Implemented + locally verified | Still externally unverified / incomplete |
|---|---|---|
| Public landing/auth forms | Render/navigation/validation, light responsive shell | Real signup confirmation, SMTP delivery, recovery redirect/PKCE, relogin persistence |
| Owner onboarding/outlets | Existing auth/onboarding/outlet code and unit tests retained | Real Auth→profile→membership→outlet→relogin transaction; partial-account cleanup in real service |
| Tables/QR/guest verification | Native durable sessions, tenant isolation, guest ordering/dedup, summary RLS | Printed QR on real devices, real Supabase scan/rate-limit path end-to-end |
| Menu/variants/add-ons/import/branding | Existing server-pricing/schema and component/parser tests; demo import contract | Real Storage policies/uploads/cache, byte-level validation, full save/publish/relogin against disposable Supabase |
| Cart/checkout/incremental orders | Existing calculations and retry/dedup tests; native shared sitting and concurrent submission | Full HTTP/network-drop/reconnect flow with real Auth/REST/Realtime deployment |
| Kitchen/KOT/waiter/voice | Forward transition/confirmation security, announcement mocks/dedup; demo board interactions | Multi-device Realtime, audible Hindi device/autoplay behavior, physical KOT/thermal print |
| Counter/manual payments | Role/tenant guards, one-payment retry, pending-online refusal; demo settling | Full authenticated browser settlement, concurrent settlement/cancel/invoice interleavings; device/printer |
| Invoices/receipts | Immutable invoice retry and issued-source freeze; UI/share/print code tests | Real browser print/PDF/download/share behavior with persisted invoices; physical output |
| Reports/dashboard | Report/calculation tests, safer export errors, paginated daily financial reads | Large realistic dataset HTTP performance, export network failure, complete chart reconciliation in live stack |
| Staff invites/roles | Existing DB/UI checks and local security coverage | Real invite mail/redeem/revoke/relogin, all cross-role browser workflows |
| Trials/plans | SQL expired-trial refusal and operator renewal tests | Commercial subscription purchase, renewals, webhooks and billing reconciliation |
| Online payments | Guarded service boundaries and simulated failure handling | Provider credentials, supported commercial integration, callback signatures/replay/refund/reconciliation; not launch-certified |
| Discounts/GST | Snapshot display of recorded discount amounts; receipt is explicitly **NOT A GST TAX INVOICE** | Approved discount creation/authorization/audit/refund rules and actual end-to-end operator workflow; approved GST rules and implementation |
| Deployment/ops | Build, safe readiness and CI/drill code | Applied deployment settings, real alerts, verified backups/restore/RPO/RTO, load evidence |

## Specific remaining blockers and decisions

### External evidence/access required

- A **disposable, nonproduction Supabase environment** with Auth, Storage and Realtime, plus seeded owner/manager/kitchen/cashier/viewer accounts and `E2E_*` settings. Current 47 browser skips must not be relabelled verified. Do not point test accounts at production.
- Transactional email delivery and approved auth redirect allowlists: signup, forgotten-password, staff invitation and reset/relogin need real delivery verification.
- External Hindi relay uses Microsoft's reverse-engineered Read Aloud endpoint, with no published support commitment. The sandbox's permitted network cannot reach it; actual attempts produced TLS/network failures and exercised honest fallback. Test real Android/iOS/desktop speakers/autoplay, or obtain approval for a supported replacement. No paid replacement was enabled.
- Payment-provider sandbox/merchant capabilities, verified callbacks and duplicate/out-of-order event tests; real online collection is not certified by local mocks.
- Real hosted deployment, custom domain/HTTPS/cache/environment checks, real-device print/share/PDF and physical printer acceptance.
- Matching `pg_dump`/`pg_restore` or the CI PostgreSQL container. They are absent locally; GitHub binary download redirected to a blocked host. Therefore the new recovery drill has **no successful local restore result**. Run it, retain evidence, then separately prove provider backup/PITR recovery in an authorized staging target.

### Requirement/security/financial decisions intentionally not invented

- The original schema defaults new restaurants to the pilot's **5% tax**; owner settings can change it. No existing tenant or default tax policy was silently rewritten. Approve a neutral onboarding default/configuration requirement and tax/GST/legal rules before commercial use. A receipt disclaimer is not legal tax compliance.
- Approve complete discount authorization, rounding, tax allocation, refunds/voids/credit-note behavior; showing snapshot fields does not prove a usable discount workflow.
- Decide and validate monetization/subscription enforcement, pricing, collection and grace-period behavior. Trial SQL is not a subscription product.
- TTS staff-only contract was approved and is now implemented with fixed shared user/restaurant budgets (see follow-up). Hosted migration, signed-in browser/device acceptance and provider audibility still require staging verification.
- Review whether all existing staff financial read permissions match the approved role matrix. Narrowing access without that matrix may remove intended workflows.
- Counter-payment versus sitting/invoice lock-order interleavings are not certified by the guest-order concurrency test. Add deterministic payment/cancel/close concurrency tests and resolve any deadlock before high-concurrency rollout. No claim of zero deadlocks is made.

### Scale / remaining implementation work

No 5,000-user capacity claim. Existing local sample is 16 SQL clients; last duplicate-submission P95 was **72 ms** under local concurrent test/build activity, not an HTTP SLA. Some other loaders still use bounded/unpaged PostgREST reads (e.g. active-session relationship reads); perform a realistic high-volume inventory and SQL aggregation/pagination pass. Long-lived tenant history, table counts, item counts, Realtime subscribers, rate-limit store cleanup and serverless concurrency must be included in staging load tests. Current board read safety cap is 20,000 rows per paged query; this is an explicit limit, not capacity proof.

## Reproduce and operate safely

See [OPERATIONS-READINESS.md](OPERATIONS-READINESS.md) for exact local/CI commands, migration review, recovery drill, monitoring and go-live gates. See [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md) for the repository route inventory and its verification limits.

Session evidence logs were produced under `/tmp/readiness-{unit,build,db-test,sql}.log` and `/tmp/readiness-browser-results.json`; these are ephemeral local evidence, not committed artifacts. Browser screenshots live in ignored `responsive-artifacts/`. Preserve desired evidence outside Git before discarding the workspace. No secrets or database dumps are committed.

## Hosted browser runner execution attempt

Secure runner implemented on session branch (commit `1e4018e`), with fixed staging guards, private auth state and credential-free public artifacts. Five negative guard regressions/typecheck/lint passed. Run **42569092107** failed at required-secrets preflight: actual fixtures/browser steps did not run. Required repo secrets: `AUTODINE_STAGING_SERVICE_ROLE_KEY`, `AUTODINE_STAGING_SHARE_URL`. Integration returns permission **403** for managing them. Owner action required; no credentials should be supplied in chat or public workflow inputs. No hosted E2E success is claimed, and production remains untouched.


## Updated hosted evidence — supersedes the missing-secrets blocker

The owner configured both repository secrets. Hosted preflight, dependency installation,
fixture provisioning, real Supabase Auth password login and protected-preview browser
access now pass. The earlier missing-secret failure above is historical, not a current
request for credentials or reconnection.

- Run [42570801317](https://github.com/aryanp685/autodine/actions/runs/42570801317):
  7 passed, 3 failed, 15 reported skipped after the configured early-stop budget.
- Updated stale label, order-code, bill-marker and total-row assertions against actual UI.
  Each integration suite now receives an isolated QR card so they do not consume the
  same per-card scan budget. Production rate limits were not relaxed.
- Run [42571371134](https://github.com/aryanp685/autodine/actions/runs/42571371134),
  commit `65500a1`: **13 passed, 3 failed, 9 reported skipped**, stopped at three failures.
  Remaining observed failures: reorder offer absent after ordering; duplicate initial
  kitchen-status text in a test locator; kitchen cancellation not reflected on the guest
  page within the test's remaining timeout. The latter needs product/polling investigation,
  not a weaker assertion or an assumption of success. Unexecuted tests are not passes.
- Local full suite: **1,937 passed, 21 native database tests skipped** (native evidence
  is tracked separately); typecheck/lint passed. Six runner safety/redaction regressions pass.
- Synthetic Auth users/tenant fixtures remain intentionally retained by namespace. No
  existing tenant reset, financial-grant broadening, production change or paid activation.

Hosted E2E is **not green**. Still outstanding: remaining browser failures and explicitly
unconfigured adversarial fixtures, audible/provider/device-print acceptance, realistic
HTTP load and payment/cancel/close interleavings. Tax/GST and subscriptions remain deferred
by the owner. No 100% readiness or 5,000-user capacity claim.


## Confirmation-flow failures fixed and hosted regression green

Supersedes the failed-browser status above for the configured guest/kitchen/cashier/security
suite. App commit `7039c8c` deployed only to the isolated staging preview:
`dpl_87atekZiQzhtvpPtVXrgk7yEScvY` (READY; stable branch alias assigned).
Test revisions through `fad1afb` verified in Actions run
[42584676317](https://github.com/aryanp685/autodine/actions/runs/42584676317):
**22 passed, 0 failed, 3 skipped, 0 flaky**, approximately 386 seconds.
Secret preflight, real Auth provisioning, protected-preview access, browser workflows and
redacted diagnostics all succeeded.

Root causes and fixes:
- Reorder offer read remembered cart only on mount, before CartProvider hydrated and
  ClearCartOnOrder saved it. Re-read after cart readiness/count changes. Lifecycle test
  proves immediate offer, restored quantities and preservation of a new cart when opening
  a historical order.
- Editable new orders had no status refresh, so kitchen start/cancellation could remain
  stale. Mount credentialed status polling for editable orders too; refresh server props
  only when status/confirmation/payment state changes. Unchanged polls preserve unsaved
  edits. Reuse bounded/backoff/visibility-aware polling; stop on unmount/terminal status.
- Scope kitchen assertions to current header status, not all labels in the progress track.
  Bring the observed page to the foreground instead of defeating hidden-tab polling rules.
- Audio button names are “Kitchen audio on/off” (long descriptions are titles). Wait for
  a completed announcement before counting utterances: sentence segments are not duplicate
  announcements. Assert exactly one completed log entry before stability/reload checks.
- Scope security amount checks to the bill total row. Replace obsolete Orders-tab navigation
  on confirmation with a unique-note order count on the real staff board, verified again
  after reload and matched to the guest's returned code.

Validation: **1,941 local tests passed, 21 native database tests skipped**, four new mounted
React lifecycle regressions passed, typecheck/lint/production build passed. Native database
and restore evidence remain separate. jsdom is a development-only lifecycle test dependency.

Three hosted skips remain explicit: no other-tenant bill fixture, no expired QR fixture,
and no configured UPI details. This green result does not certify those cases, audible paid
provider output, physical printers, broader integration suites, HTTP capacity or the deferred
commercial/tax requirements. Production and existing tenant data remain untouched; only new
namespaced disposable fixtures were created and retained.
