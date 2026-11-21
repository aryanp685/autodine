# Final hosted acceptance — 2026-11-15 batch (supersedes the PARTIALLY EXECUTED verdict)

**Branch:** `arena/9b120325-autodine` · **HEAD after this batch:** `95666ae` · worktree clean · pushed.
**Scope held:** staging `juwyhslzchjevqkdvwjm` only; production `bdbaqpevwmgdvghszjno`
never queried for writes, never deployed to, never migrated; no merges; no paid
service activation; synthetic data only; no secret values read, printed or stored;
GST/IRP **not** applied anywhere; no grants changed; preview `ADMIN_SECRET`
remains absent; Resend not activated; `[autodine:alert]` remains a log-line
format, not an external notifier.

This document supersedes `docs/hosted-synthetic-acceptance-2026-11-15-result.md`
(which remains as the historical PARTIALLY EXECUTED record).

## 0. Branch/worktree repair incident (this batch, resolved)

The session workspace had been re-materialized over a fresh clone whose shallow
boundary sat at the branch base `b866601`, diverging from the remote branch tip
`de3e167`. Local HEAD had been advanced to `82b9567` (b866601 + the staging-e2e
annotation patch) and a push of it was **rejected non-fast-forward** (remote
`arena/9b120325-autodine` remained `de3e167` throughout — nothing was lost).
The worktree was verified **byte-identical to `de3e167` for 912 of 913 files**
(only `.github/workflows/staging-e2e.yml` differed, by exactly this batch's
pach). Repair: local branch re-set to `de3e167` (mixed reset, worktree kept);
patch re-committed as `df358ca` and pushed normally. Local-only backup branch
`backup-pre-repair-82b9567` retains the abandoned commit. No force-push, no
reset of remote state, no file deletion.

## 1. Hosted staging-e2e workflow — runs and findings

Runner: `.github/workflows/staging-e2e.yml` (`workflow_dispatch`; secrets
`AUTODINE_STAGING_SERVICE_ROLE_KEY` + `AUTODINE_STAGING_SHARE_URL` are present —
the "Require secrets" step passed every run; the values are unreadable from
here, by design and by HTTP 403 on the secrets API).

| Run | Result | What happened |
|---|---|---|
| 43685429125 | failure | Provision failed at exit 1; annotations carried only the exit code (runner diagnostics were not yet surfaced). |
| 43685793739 | failure | With `df358ca` in place the runner's generic, pre-redacted diagnostic reached annotations: provision died at the **other-tenant order** — `place_public_order` called with an authenticated client → by-design `42501 permission denied` (migration `20261110000800`: guest entrypoint is `place_public_order_attempt`; the inner function is `service_role`-only). Same defect class as `add173f`. Fixed in `232b3e7`. |
| 43685943454 | failure | Provision **succeeded end-to-end** (synthetic Auth user via GoTrue Admin API, profile, two tenants, menus, items, tables, QR cards, revoked card, expired session, **other-tenant order placed through the attempt wrapper**, real password sign-in verified). Browser step refused at global setup: `GET {base.origin}/api/health` did not return `200` + `{ok:true}` — the pinned `3711df6a` preview origin is **404 "Deployment not found"** (connector-confirmed). Counts step published `{expected:0,unexpected:0,flaky:0,skipped:0}` and failed the run (fail-closed: zero executed tests is not a pass). |
| 43686359156 | failure | After owner-approved re-pin (`95666ae`): provision gate **failed closed** with `Missing approved staging endpoint/credentials/share access; refusing fixture writes.` — the `AUTODINE_STAGING_SHARE_URL` secret still targets the old (or otherwise non-matching) origin. **Zero fixture writes occurred.** |

Fixture pollution note (staging, synthetic only): one **partial** synthetic
namespace (run 29381019-57ac-…; restaurant `c6078caf-e571-…`, through the
menu/table/QR steps) and one **complete** synthetic namespace from run
43685943454 are retained by the runner's keep-for-inspection design. No
existing or production tenant data was touched. The recorded
`STAGING_FIXTURE_IDS` lines carry UUIDs only.

### What is blocked and exactly what unblocks it

Hosted browser suites (guest-order-flow, cashier-flow, kitchen-flow,
security-flow), hosted health verification, and any hosted Realtime socket
check are **NOT EXECUTED**. The blocker is singular and owner-side:
regenerate the `AUTODINE_STAGING_SHARE_URL` repository secret to a Vercel
share link for `https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app`
(branch alias, READY preview `dpl_6GwsqB5HEmBo77JWmM68aWP1MWkh`, commit
`232b3e7`). I cannot read, set or rotate Actions secrets (HTTP 403). After the
secret is regenerated, re-dispatching `staging-e2e.yml` runs the full browser
acceptance. I made no edit that could make a mismatched secret pass the gate.

## 2. What this batch executed on staging (evidence, not claims)

- **GoTrue Admin user creation + real password sign-in** for the synthetic
  fixture owner — verified by run 43685943454 step 7 (step completed; a real
  `signInWithPassword` round-trip is part of the script and gates the step).
- **Full synthetic fixture graph** including a second tenant with no membership,
  its order placed via `place_public_order_attempt`, and `get_public_order`
  verification with the guest token — same run.
- **Reads via the authorized connector**: `restaurants` column inventory (30
  cols); `information_schema` NOT NULL audit for the nine fixture tables (no
  missing-column defect — the failure was the RPC contract, not schema);
  `list_migrations` (11 ledger rows); `arena_staging_upgrade_manifest` (50
  rows); 42/42 public tables `relrowsecurity=true`; 91 SECURITY DEFINER
  functions with ACLs; `report_sales` ACL and body; GST catalog absence.
- **Auth configuration updated** (owner-authorized 2026-11-15): `site_url` →
  `https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app`;
  `uri_allow_list` → the same origin + `/**`. Nothing else was intended to
  change. See **incident** below.
- **S0–S5 report_sales rehearsal** on staging (2026-11-15, prior batch,
  evidence `docs/report-sales-staging-rehearsal-2026-11-15-result.md`) remains
  valid: `report_sales` is owner/manager-only internally, grants exactly
  `{authenticated, service_role, postgres}` EXECUTE, anon/public EXECUTE none.

### Incident: auth-config side effect (must be read)

The `update_auth_config` call returned a config in which five fields had moved
from their previous values to `null`:
`rate_limit_email_sent` 2 → null, `security_captcha_provider` `hcaptcha` →
null, `sms_provider` `twilio` → null, `sessions_inactivity_timeout` 0 → null,
`sessions_timebox` 0 → null. `mailer_autoconfirm` stayed `false`, signup
stays enabled, `jwt_exp` 3600, refresh-token rotation enabled — those are
unchanged. The connector tool exposes no fields for the five nulled values, so
**I could not restore them**; the update itself was what dropped them. If the
project had tuned any of those five (esp. `rate_limit_email_sent = 2`), the
owner should re-set them in the Supabase dashboard (Auth → Rate Limits /
Sessions / Bot & Abuse Protection). This is reported here because the batch
constraints forbid silently weakening rate limits; the pre-update values are
recorded above for exact restoration. No other auth setting differs.

- **GST**: not applied to staging (nor production). Staging carries **none** of
  the 7 GST/IRP migrations, and 26 further repo migrations (33 total missing vs
  the 89 repo migrations) — see
  `docs/gst-staging-application-plan-2026-11-15.md` for the exact sequence,
  pre-flight capture plan, rollback posture, and the synthetic test plan to run
  after a **separate explicit authorization**. IRP fail-closed behavior is
  preserved; no real IRN/GSP/GSTN interaction occurred; no GSTIN was used.

## 3. Local/CI evidence (NOT hosted staging evidence)

Branch pushes this batch: `de3e167..df358ca..232b3e7..95666ae`. On `95666ae`:

- CI (vitest suite incl. `lib/staging-runner.test.ts`,
  `app/api/health/route.test.ts`, `lib/monitoring-incidents.test.ts`):
  **success** (run 43686337087)
- E2E (browser, isolated local database): **success** (43686337082)
- Throttle browser E2E: **success** (43686337047)
- `node scripts/staging/verify-acceptance-env.test.mjs`: 7/7 pass locally.
- Prior disposable-stack run (43683792570, unchanged): 89/89 migrations,
  5000 synthetic sessions fail=0, kitchen Realtime 1500/1500, `overallFailures=0`
  — a disposable local stack, **never** hosted staging/production evidence.

No claim in this document substitutes local/CI results for hosted staging.

## 4. Security review (item 7) — results

No grant, role, policy or function was changed in this batch.

- **`report_sales` grants (staging live catalog):** EXECUTE exactly
  `{authenticated, service_role, postgres}`; `prosecdef=true`; `stable`;
  tenant boundary enforced inside the body (`is_member` → now owner/manager
  after S4's `20261112000300`). `service_role` EXECUTE is **pre-existing**
  (Supabase default) and is **legitimate**: server-side service paths
  (service-key handlers) call this for back-office/reporting needs; the S4/S5
  rehearsal deliberately preserved it. Removing it would break service-side
  reporting with no tenant benefit (service_role is not issued to clients).
  `authenticated` EXECUTE is likewise intended (members call it signed-in;
  body enforces membership/role). `anon`/`public` hold nothing. **Decision:
  keep as-is; no change.**
- **SECURITY DEFINER inventory (91 functions, staging):** service_role-only set
  is correctly restricted (`place_public_order`, `place_public_order_core*`,
  `settle_online_payment`, `begin_online_payment`, `record_counter_payment`,
  `admin_set_subscription`, `record_subscription_payment*`, `expire_subscriptions`,
  `claim_account_trial`, `create_account_with_restaurant`, `stamp_guest_verification`,
  payment/webhook/billing guards, `issue_payment_receipt_after_invoice_payment`);
  `issue_closed_session_receipt` is **postgres-only** (good). Guest-reachable
  functions are deliberately `anon+authenticated` (`place_public_order_attempt`,
  `open_table_session`, `verify_table_qr_with_code`, `call_waiter`,
  `claim_upi_payment`, `cancel_order`, `set_order_line_quantities`,
  `get_public_order`, `public_upi_details`, `read_shared_restaurant_invoice`,
  `current_qr_verification…` helpers) with internal token/session/UUID checks
  and rate limits.
- **PUBLIC-EXECUTE definers** (`is_member`, `has_restaurant_role`,
  `can_manage_restaurant`, `current_restaurant_ids`, `restaurant_can_write`,
  `restaurant_is_active`, `counter_claims`, `public_restaurant_profile`,
  `public_qr_intro`, `public_upi_details`, `ensure_table_qr_code`,
  `rls_auto_enable`, `new_invite_code`, `protect_*`): these are the standard
  RLS-recursion-avoidance helpers used by policies. They take UUIDs and return
  booleans/existence — no row data is exposed beyond membership/existence
  facts a caller already must possess to ask meaningfully. The `protect_*` are
  trigger functions (not directly callable via SQL at all). **No change
  warranted; do not revoke without a full policy replay test.**
- **RLS:** 42/42 public tables have RLS enabled (`force_rls=false` — table
  owner bypass remains, as usual for Supabase projects; the app roles are not
  table owners).
- **Tenant isolation:** cross-tenant synthetic proof ran as part of fixture
  provisioning (second tenant created without owner membership; its order
  placed guest-token-only; reads scoped by token). Negative-cross-tenant
  browser assertions (`security-flow.spec.ts`) are CI-tested but **not
  executed on hosted staging** (browser leg blocked).
- **report_sales drift note:** `20261112000300` is the only S4-applied file;
  the `service_role` EXECUTE clause is untouched; nothing else in the grants
  picture moved.

## 5. Monitoring (item 6) — internal vs external, honestly

- **Internal alert generation: implemented and CI-tested.**
  `GET /api/health` (`app/api/health/route.ts`, `force-dynamic`, booleans/
  fixed words only) emits a structured `[autodine:alert]` line on failure via
  `formatHealthAlertLine` (`lib/monitoring-incidents.ts`). Kitchen Realtime
  degradation is accepted by `POST /api/ops/realtime-alert` (same-origin
  checked, kitchen-roles only, rate-limited via `hit_rate_limit` 6/10 min) and
  emits `formatIncidentLogLine` (`kitchen_realtime_degraded` → `acknowledged`/
  `resolved`) using an in-memory `InMemoryIncidentTracker` (dedup per server
  instance; the structured log line is the durable record).
- **Incident acknowledgement:** modeled in-process (`open → acknowledged →
  resolved` transitions, `list_*` read-back) and covered by
  `lib/monitoring-incidents.test.ts` (runs in CI, green). There is **no
  persistent store** for incidents and **no dashboard**; acknowledgement is an
  in-process state plus the log stream.
- **External notification delivery: NOT AVAILABLE.** Resend is unactivated; no
  webhooks/pager/email sink is configured for these lines; `deliverWithRetry`
  exists as a bounded-backoff helper that reports `{delivered, attempts}` and
  never throws — **callers must not infer delivery**, and nothing in this repo
  currently wires it to an external channel. `[autodine:alert]` is a log
  prefix a log-drain can page on; no log drain is configured or verified for
  staging in this batch.
- **Staging health endpoint (`/api/health` on the approved preview):
  NOT VERIFIED LIVE** — the hosted browser leg (which gates on it) is blocked
  on the share-secret regeneration, and the sandbox has no direct HTTPS egress.
  CI covers the route's behavior; hosted verification remains open.

## 6. Auth (item 3) — status on staging

Verified live: GoTrue Admin user creation (synthetic, `email_confirm: true`
for the test user only — **no autoconfirm enabled**, no rate limit touched
except the nulling incident disclosed in §2), password sign-in for the fixture
owner, `current_verification_code` read as authenticated, invite machinery
present (`create_staff_invite`, `preview_staff_invite`, `revoke_staff_invite`;
`restaurant_invites`) untested on hosted staging.
Signup is enabled (`disable_signup=false`), email external auth enabled, phone
disabled, anonymous users disabled, mailer autoconfirm **false**, OTP 8 chars,
`mailer_otp_exp=3600`, JWT `3600`, refresh rotation on (reuse interval 10s).
Redirect allow-list **now** contains exactly the current branch alias (the
two stale aliases `01715497`/`3878e9b8` were replaced per owner authorization —
they were dead previews).
Not executed on hosted staging: email-confirmation delivery flows, invitation
accept round-trips, password reset, token-expiry boundary — all require either
(a) the browser leg (blocked) or (b) a monitored synthetic inbox; email
delivery itself requires Resend activation, which was **not** approved.

## 7. Realtime (item 4)

Disposable local stack only: kitchen Realtime 1500/1500 events across three
waves, clients=20, p95 227 ms (run 43683792570). Hosted staging Realtime
(socket-level, disconnect/reconnect, duplicate-announcement prevention) —
**NOT EXERCISED** (blocked with the browser leg). `20261021000010_realtime_orders.sql`
and the kitchen announcement claim/record RPCs exist on the staging bundle and
the claim tables have RLS; the hosted path stays unproven.

## 8. Customer-to-invoice (item 2) — status

Executed hosted: synthetic QR/session creation path incl. revoked card and
database-expired session fixtures, public order placement with idempotency
(attempt wrapper, guest token), other-tenant isolation fixture — all inside
run 43685943454's provision step. **Not executed on hosted staging:** full
guest journey via browser, kitchen push to screen, waiter alert path, cashier
settlement, concurrent-payment protection, session closing, invoice
immutability assertions, payment receipts, Owner/Manager/Kitchen/Cashier RBAC
matrix via UI. All are covered by CI browser/integration suites on the local
stack (green on `95666ae`) — **hosted evidence does not exist yet** and will
be produced by the dispatch after the share secret is regenerated.

## 9. Remaining external dependencies (all owner-side or third-party)

1. `AUTODINE_STAGING_SHARE_URL` regeneration for the current branch alias
   (unblocks §1/§4/§6/§7/§8). I cannot do this (Actions secrets: HTTP 403).
2. Auth dashboard re-check/restore of the five nulled fields (§2 incident).
3. Authorization decisions on the staging migration gap (33 files missing,
   `docs/gst-staging-application-plan-2026-11-15.md`) — GST apply is **not**
   authorized and must not happen without it.
4. Resend/log-drain/webhook activation for external paging (not approved; not
   required for internal alert generation to be correct).
5. Staging Auth email round-trips (signup confirmation/invites/reset) — need a
   monitored synthetic inbox; Resend unactivated.
6. `staging-e2e.yml` push trigger still lists only `arena/3711df6a-autodine`
   (deliberately unchanged); dispatch manually. Say the word to review the
   trigger policy (it would run on every push to this branch then).

## 10. Counts (hosted staging)

| Workstream | Executed | Passed | Failed | Skipped | Not run |
|---|---|---|---|---|---|
| Staging access/secrets/permission inspection | ✔ | n/a | Actions secrets API 403 (GitHub-side) | — | — |
| Customer-to-invoice | fixtures+order yes (2 runs) | fixtures ✔ | 1 RPC-contract defect (fixed `232b3e7`) | browser suites skipped | full journey |
| Auth | sign-in ✔, config ✔ | 2 | 0 | — | email flows |
| Realtime | disposable only | local 1500/1500 | — | — | hosted |
| GST & invoice | inspection only | n/a | — | — | apply+tests (not authorized) |
| Monitoring | code+tests+catalog | CI green | — | — | staging /api/health live |
| Security review | catalog audit ✔ | n/a (no changes) | — | — | — |
| Final regression | CI/E2E/Throttle on `95666ae` | all 3 ✔ | — | — | — |

## 11. Branch, HEAD, worktree

`arena/9b120325-autodine` @ **`95666ae`** (`staging runner: re-pin approved preview to the current branch alias`),
pushed; worktree clean; local-only backup `backup-pre-repair-82b9567` (never
pushed, holds the abandoned pre-repair commit). CI/E2E/Throttle green on
`95666ae`. No merges to `main` were made or requested. **Stop after this batch.**
