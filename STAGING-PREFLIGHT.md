# Existing staging: read-only preflight

> **Current instruction boundary (Arena date 2026-11-06 UTC):** All hosted Staging statuses and actions recorded below are historical claims, not fresh verification or authorization. The current user direction supersedes any older “approved staging upgrade” text: Staging is NO-GO and may receive only authorized read-only metadata/catalog inspection until operator acceptance, recovery evidence, and migration gates are satisfied. No hosted system was accessed in this continuation. Production remains read-only. See `RELEASE-BLOCKER-REPORT.md` for the current blocker register.

## Latest verified readiness result

Staging-only deployment **dpl_58628RrxJGGsoiKctrUasMsuKMNP**, commit **8fd6e027f0a98a072066f3226cb4a7c6603ffbae**, is READY. A fresh authorized page fetch of `/api/health?check=8fd6e02` returned **`ok:true`**, credentials accepted and all five operational probes applied. The initial identical-URL refetch returned the fetcher's older cached `checkedAt` payload; a revision-specific query confirmed the fresh deployment. Token omitted from this record deliberately.

Latest full local suite: **1,931 passed / 21 native cases skipped**; native suite separately **21/21 passed**, **56 clean migrations**. Reproduced historical staging-bundle plus follow-up upgrade also passes 21 native tests. Cold physical restore reverified after the change: 35 tables/23 orders/1 payment/2 invoices, original disposable source removed, exact fingerprint/privilege comparison passes. Production unchanged. Direct sandbox interactive Chromium remains network-blocked; homepage/login fetches and health are not a substitute for actual login/order browser workflows. A network-enabled browser runner with secure test-only fixture credentials is required for those workflows; no need to remove Vercel protection.

## Shareable-access follow-up and readiness correction

User-provided shareable access successfully opened the staging homepage through the managed page fetcher. Do not store/share the access token in Git or logs. Direct sandbox Chromium navigation failed with `ERR_CONNECTION_CLOSED` (sandbox outbound host restrictions), so interactive browser tests remain unverified; do not ask the user to disable protection to solve a sandbox network limitation.

Authenticated shareable fetch of `/api/health` exposed a **real readiness bug**: database credentials accepted and basic schema reachable, but settlement/invoice/payment-receipt zero-row reads returned `unknown`. Their service-role table SELECT grants were deliberately revoked by existing financial security migrations. Fix: **catalog-only `operational_schema_readiness()`**, executable only by service_role, returning fixed existence/RPC-grant booleans without reading tenant financial rows or granting access to those tables. Applied as a separate staging migration; no production change. Fresh native replay: **56 migrations / 21 tests passed**. New native assertion checks service-role health succeeds while invoice table SELECT and anonymous probe execution remain denied.

## Latest deployment and verification evidence

- App commit `fb0439723c5eae51d5109587b02f4691a41ae0fb` deployed successfully as **preview**, target null / environment preview / state READY, on the existing Hobby plan. No production promotion/domain update.
- Deployment ID: `dpl_CxN8dfaN4RrgnSXkvFmyDi8uMS3u`.
- Stable staging URL: `https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app`.
- Immutable URL: `https://new-qm0h8wvf8-iamjarvis9896-3988s-projects.vercel.app`.
- Staging Auth site URL and exact preview-origin allowlist updated; localhost retained. Email confirmation remains enabled. No test email was sent and no production Auth settings changed.
- **Hosted SQL smoke passed**, using synthetic fixtures inside a rolled-back transaction: authoritative ₹250 pricing (₹125 × 2), direct financial update denied under authenticated role, manual settlement retry creates exactly one payment, issued receipt retry returns the same ID, staff voice budget succeeds. Test fixture profile/tenant/menu/order/payment/invoice rows were rolled back. This is **SQL/RPC evidence**, not a real Auth login/HTTP/browser flow. An initial smoke query had a test-variable ambiguity (`code`), fixed to `v_code`; no product fix was needed.
- Full local suite: **1,930 passed / 20 native cases skipped** (those native cases passed separately). Typecheck/lint/build passed.
- GitHub CI run **42567533471: success**, all four jobs including actual PostgreSQL **15/17/18** clean migration/native-boundary/**logical dump/restore** jobs. This supersedes earlier “remote CI / logical restore unrun” statements for the tested fixture workload. Workflow runs `READINESS_VERIFY_RESTORE=1` and fails on a failed dump/restore fingerprint comparison. Detailed archived log download was blocked by sandbox network; job/step success retrieved from GitHub API. Do not claim production backup/PITR recovery.
- External HTTP fetch of `/api/health` was redirected to **Vercel SSO login**. Existing deployment protection was **not disabled or bypassed**. Therefore hosted health/authenticated browser tests remain **unverified, blocked on authorized automation/shareable-preview access**. Build READY is not HTTP health PASS. Do not create a secret bypass route in the application.
- Vercel selected Node 26 from the existing `engines >=22` range; build passed, but CI/local tests use Node 22. Pin a reviewed runtime before release to avoid uncontrolled future-major drift; no production project runtime setting was changed.

## Approved staging upgrade — latest state supersedes preflight findings below

User subsequently approved option A: reviewed staging migrations/test fixtures and a free nonproduction preview, no existing-data reset/delete, no production operations. Reproduced the observed scaffold baseline locally and ran the exact generated forward-upgrade artifact: **20/20 native tests passed**.

Applied the 49 pending source migrations to `autodinetest` as one transactional connector migration, from a pinned Git commit `14a9391ef29e5c35323d3676f5e2844a5935b32b`, SHA-256 `d55a5828bb4771c671cc4c4cbd5dd1922d143a259eb75374bc27cb160e21c1db`. Original source hashes are recorded in `supabase_migrations.arena_staging_upgrade_manifest`, separate from historical ledger entries; no history reset/repair was performed. A temporary HTTP extension fetched the public pinned artifact, checksum was checked before execution, and the extension was removed in the transaction. Native proof is in `/tmp/staging-bundle-test.log`.

Post-upgrade connector verification: **49 manifest entries; 33 public tables; 0 restaurants / 0 orders preserved**; receipt and staff-TTS functions present; `restaurant-assets` exists; anonymous legacy ordering and arbitrary limiter execution both false; temporary HTTP extension removed. This is actual hosted staging schema evidence, not full Auth/Storage/browser certification.

Vercel existing project `new` has **branch-specific preview-only** test project URL/key/server credential, fresh QR signing secret, live mode, and expected-project guard configured for `arena/3711df6a-autodine`. Paid Gemini/Groq keys are blanked for this branch. Automatic deployment of this branch is explicitly disabled in `vercel.json` until the manual preview build is requested. Generic/production variables were not updated. The repository branch was pushed to make immutable artifacts available. App preview URL/build verification and hosted fixtures are the next actions; do not read the historical findings below as the post-upgrade state.

## Permission boundary (historical preflight)

User selected **read-only inspection** for `autodinetest` and indicated there is currently **no staging app URL**. No hosted SQL mutation, migration, Auth setting change, test-account creation, email send, bucket creation, fixture write/delete or deployment was performed. Production project was not queried for application data or modified. No API keys were retrieved.

## Observed metadata (not guesses)

Target: `autodinetest`, ref `juwyhslzchjevqkdvwjm`.

- Hosted PostgreSQL engine: 17; native CI matrix includes 15/17/18, remote jobs not yet executed.
- **7 migration history entries**, with generated versions differing from repository filenames. History includes an `autodine_local_test_scaffold` entry. It is not equivalent to the 55-migration clean native replay.
- **16 public tables**, all reporting RLS enabled. RLS-enabled alone does not certify correct policy/role behavior.
- Existing `place_public_order` has the old four-argument signature. Required current functions `mark_order_session_paid`, `close_order_session_and_issue_receipt`, `set_order_line_quantities`, `hit_rate_limit`, `table_order_activity`, `reserve_staff_tts_attempt` were absent from the inspected function list.
- `place_order(text,text,jsonb,text)` remains executable by both anon and authenticated. The local hardening that revokes it is **not deployed** to this project. Do not expose this staging as a production-ready ordering service.
- No rows returned from `storage.buckets`; required asset bucket is not provisioned in this inspected project.
- Auth `site_url`: `http://localhost:3000`; additional redirect allowlist empty. Email auth and signup enabled; email confirmation required. No custom SMTP host configured; email-send limit reports 2. This is not external delivery verification.
- No app staging URL supplied; browser→hosted Auth/REST/Storage/Realtime E2E cannot be run under the current read-only permission.

Only schema/config metadata was inspected; customer rows were not read.

## Safe plan, not executed against hosted resources

1. Preserve the read-only boundary until explicit hosted-write permission is supplied. No automatic migration repair, reset, push, regrant, schema reset or production deployment.
2. Review scaffold DDL and actual schema against clean replay. Prefer a separately authorized disposable database/project or a reviewed forward-only reconciliation; do not infer applied migrations solely from migration name text.
3. In that authorized target, replay schema/default-grant changes and verify legacy revoke, issued-document guards, order/session/payment RPC signatures, TTS budget, asset bucket and Storage role policies.
4. Build a separate **nonproduction** app from this branch with its own staging-only Supabase variables, canonical URL and `AUTODINE_MODE=live`. Never reuse production service keys. A paid deployment/resource requires separate approval.
5. Add only the exact staging auth callback origins; do not weaken production allowlists. Confirm email delivery mechanism/approved test inboxes before sending test mail. Do not disable confirmation merely to make tests green.
6. Seed isolated owner/manager/kitchen/cashier/viewer accounts and uniquely namespaced tenant fixtures. Configure the test suite's documented `E2E_*` values securely outside Git/chat.
7. Execute all skipped integration suites, persistence/relogin, cross-role/tenant denials, network retries, Storage publishing/removal, Realtime, staff-only voice plus real-device fallback, receipt print/PDF/share. Retain results and cleanup only known fixture identifiers.
8. Validate hosted backup/PITR, platform Auth/Storage recovery, realistic HTTP load/soak and external monitoring independently of local PostgreSQL tests.

## Newly verified locally

`npm run test:recovery:cold` creates a fresh private PostgreSQL cluster, replays all **55 migrations**, runs **20 native regression tests** including 40 concurrent staff voice-budget requests (exactly 30 admitted, 10 rejected), captures populated-table/policy/function-grant fingerprints, shuts down cleanly, copies a physical backup, **deletes the original temporary cluster**, restores from the backup, restarts on a new loopback port, and checks data/RLS/table grants/function privileges. Temporary clusters are cleaned up automatically.

Latest successful drill: **35 tables, 23 orders, 1 payment, 2 invoices recovered**, exact content fingerprints preserved; recovery phase **913 ms** for tiny fixtures. This is genuine **local cold physical recovery evidence**, not pg_dump/PITR, online backups, cloud restore, zero-downtime recovery, real RPO/RTO or Supabase service recovery. The logical dump/restore CI job remains unrun.

```sh
READINESS_PG_BIN=/path/to/matching/postgres/bin npm run test:recovery:cold
```

Requires `initdb`, `postgres`, `pg_ctl`; refuses to accept an existing data directory or database URL. Full local Supabase services remain untested here: Docker is unavailable, and emulated platform schemas are not the real Auth/Storage/Realtime services.

## Secure network-enabled browser runner prepared

Added `.github/workflows/staging-e2e.yml`, isolated fixture provisioner, share-access global setup and `playwright.staging.config.ts`. Hard-pinned to approved staging endpoints; five negative guard tests/typecheck/lint passed. Requires repository Actions secrets `AUTODINE_STAGING_SERVICE_ROLE_KEY` and `AUTODINE_STAGING_SHARE_URL`. Current GitHub connection still returns **403 Resource not accessible by integration** for Actions-secret management. Missing secrets fail before fixture writes, never masquerade as a passing/skipped browser run. Setup: `scripts/staging/RUNNER-SETUP.md`. No tokens/keys are committed. Synthetic fixture data is retained by UUID namespace for inspection, not destructively auto-cleaned. This runner's existence is not hosted browser verification evidence.

Actual hosted runner attempt: [42569092107](https://github.com/aryanp685/autodine/actions/runs/42569092107), commit `1e4018e`. **Failed at required-secrets preflight**; fixture creation and real browser steps explicitly skipped. No new persistent fixtures/users were created by this run. This is a configuration block, not a product browser failure or a passing E2E result. Actions-secrets API still returns permission 403; repository owner must grant permission or add the two named secrets securely in GitHub settings.


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


## Previously skipped coverage now executed: 26/26 hosted pass

Actions run [42587290727](https://github.com/aryanp685/autodine/actions/runs/42587290727),
test/fixture commit `4c52b66`, against staging app `7039c8c`:
**26 passed, 0 failed, 0 skipped, 0 flaky**, approximately 422 seconds.
This supersedes the earlier three-skip result for this curated integration suite only.

- Other-tenant bill: provisioned a real second restaurant/menu/table and order through
  guest session/order RPCs. Verified the order exists through its guest credential, then
  tested the first restaurant's owner gets “Bill not found” and no bill sheet. The owner
  was never granted membership in the second tenant.
- QR lifecycle: permanent printed cards have revocation, not an expiry column. Replaced
  the obsolete “expired card” assumption with two real tests: a deliberately revoked card
  is refused; an independently expired database session attached to a LIVE card is refused
  at checkout even when its browser cookie claims a future expiry. No clock manipulation
  or production expiry-policy change.
- UPI: fixture uses synthetic `autodine-synthetic@invalid` (not a payment destination).
  Guest UPI QR/self-claim UI was intentionally removed from the current product; tests
  assert it remains absent. Staff selects the exact order and records **UPI ₹125**.
  Separate authenticated fixture-owner reads verify exactly one recorded UPI payment of
  12,500 paise and a persisted paid order; guest reload confirms paid status. Reads stay
  tenant-scoped; service-role financial SELECT grants remain unchanged. No real transfer,
  gateway activation, bank settlement/reconciliation or provider-verification claim.
- Supplemental payment receipts require an already-issued invoice. The initial expanded
  run (42586240678: 25 pass / 1 fail / 0 skip) correctly exposed an invalid unconditional
  receipt-link expectation; changed the test to verify the actual stored payment rather
  than invent an invoice or misrepresent a counter payment as provider confirmation.

Staging config now requires all adversarial fixture environment values before running,
so missing fixtures cannot silently reinstate these skips. New fixture users/tenants/rows
are retained by isolated run namespace; existing data and production remain untouched.
Typecheck/lint and six runner safety/redaction regressions passed. No app/schema change
was needed in this follow-up; no production deployment or paid resource was created.
