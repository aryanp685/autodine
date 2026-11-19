# AUTODINE — PHASE 5 LOCAL EVIDENCE (browser, isolated DB, realtime, multi-device, session expiry, cron, alert sink)

**Date: 2026-11-19.** This record states exactly what was verified locally,
what could not be verified locally and why, and what is waiting on the owner.

**The rule this record follows:** a hosted run that has not happened is
`BLOCKED — OWNER AUTHORIZATION REQUIRED`. It is never `PASS`. A suite that
cannot run in this environment because its dependency is unreachable is
`BLOCKED — ENVIRONMENT`, which is a different thing and is labelled as such.

**No hosted state was changed to produce this record.** No deployment, no
workflow dispatch, no hosted DDL/DML, no migration, no fixture, no backup or
restore dispatch.

---

## 1. The summary

| # | Phase 5 item | Local status | Hosted status |
|---|---|---|---|
| 5.1 | Browser (Playwright E2E) | **BLOCKED — ENVIRONMENT** (Chromium unreachable) | **BLOCKED — OWNER AUTHORIZATION REQUIRED** |
| 5.2 | Isolated database | **PASS** (local, disposable) | n/a — it is a local property |
| 5.3 | Realtime / reconnect | **PASS** (local, unit) | **BLOCKED — OWNER AUTHORIZATION REQUIRED** (two-device) |
| 5.4 | Multi-device | **PASS** (local, unit + integration) | **BLOCKED — OWNER AUTHORIZATION REQUIRED** |
| 5.5 | Session expiry | **PASS** (local, unit + integration) | **BLOCKED — OWNER AUTHORIZATION REQUIRED** |
| 5.6 | Cron | **PASS** (local, unit) | **BLOCKED — OWNER AUTHORIZATION REQUIRED** (live codes) |
| 5.7 | Alert sink | **PASS** (local, unit) | **BLOCKED — OWNER AUTHORIZATION REQUIRED** (a real page) |

**Nothing here is `PASS` for a hosted system.** The local column records
that the code path is implemented and locally exercised; the hosted column
records the run that has not been authorized.

---

## 2. Browser — 5.1 — BLOCKED — ENVIRONMENT

**What exists.** `playwright.config.ts` defines **7 projects** (desktop,
phone, guest, staff, brand, responsive, integration) over `e2e/`, with a
`webServer` on `127.0.0.1:3100`. The suite collects **113 tests in 16
files**:

```
$ npx playwright test --list
...
Total: 113 tests in 16 files
```

The collection is a real check: every spec file parses, every project
selector matches a spec, and every test name is present in the report.

**Why it cannot run here.** The runner needs a Chromium binary. There is no
Chromium on this machine, and it cannot be installed:

```
$ bash scripts/e2e/check-chromium-runtime.sh
Playwright Chromium is not installed: /home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
```

and the download host is not reachable from this sandbox:

```
$ curl -sS https://cdn.playwright.dev/
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to cdn.playwright.dev:443
```

**Consequence.** The browser suite is `BLOCKED — ENVIRONMENT` locally. It
runs in CI (`.github/workflows/e2e.yml`, `staging-e2e.yml`), and the hosted
run is `BLOCKED — OWNER AUTHORIZATION REQUIRED` — see
`MASTER_BLOCKER_REGISTER.md` B7. **It is not PASS.**

**What was NOT done to work around this.** No test was deleted, skipped or
weakened to make the suite look green. No spec was marked `test.skip`.

---

## 3. Isolated database — 5.2 — PASS

The isolated-database path is real and is the backbone of the Phase 7
suites.

- `scripts/local-pg/with-embedded-postgres.mjs` starts an **embedded
  PostgreSQL** on a random loopback port with a random password, exports
  `READINESS_PG_ADMIN_URL`, and **deletes the data directory when the
  command exits**. It reaches nothing hosted.
- `npm run test:db:integration` → **10 files, 212 tests, all passed**
  against a disposable cluster:
  `phase0-security` (25), `readiness` (62), `report-sales` (26),
  `restaurant-account-link` (8), `subscription-billing` (41) and the rest.
- `npm run test:staging:seed-demo-db` → **1/1 passed**: the demo seed
  creates only its own restaurant and touches no other tenant, proved on a
  real database with a second restaurant standing in for a real customer.
- `npm run test:db:logical-restore` → `LOCAL_LOGICAL_RESTORE_VERIFIED`
  (`pgVersion 17`, `migrations 98`, `tables 48`, `policies 59`,
  `functions 163`, `productionBackupClaim false`).

---

## 4. Realtime and reconnect — 5.3 — PASS locally, BLOCKED hosted

**What exists.** `lib/realtime-monitor.ts` tracks the channel's health and
emits exactly the signals the operator surface needs:

| Behaviour | Where | Test |
|---|---|---|
| A transient outage falls back to polling and raises **no** alert | `onStatus` → `onDelivery('polling')`, alert only after the threshold | `realtime-monitor.test.ts` |
| A sustained outage raises **one** degradation alert, then **one** recovery with the duration | `alertSent` guard + `degradedAt` | `realtime-monitor.test.ts` |
| A board that closes while degraded sends **no** recovery | `dispose()` clears the state | `realtime-monitor.test.ts` |
| A signal is accepted only in its fixed vocabulary | `parseRealtimeSignal` | `realtime-alerts.test.ts` |
| Throttling is scoped to the authenticated restaurant, with no identity in the signal | `realtimeAlertRateKey` | `realtime-alerts.test.ts` |
| The server endpoint refuses a cross-origin signal, an unauthenticated caller and a non-kitchen role | `app/api/ops/realtime-alert/route.ts` | `route.test.ts` (5 tests) |

**An honest note about what the product actually does.** The kitchen board
does **not** use Supabase Realtime. `components/screens/KitchenScreen.tsx`
polls role-scoped server reads every five seconds, and the code says why:

> Tickets and waiter calls are fetched through role-scoped Server Component
> reads every five seconds; neither source table is published as a Realtime
> row stream.

The monitor and its endpoint are therefore a **complete, tested mechanism for
a Realtime-based board that this deployment does not currently use**. That is
a fact about the product, not a gap in it, and it is recorded here rather
than left to be discovered.

**Hosted.** The two-device proof needs two devices, a hosted environment and
one authorization. It is `BLOCKED — OWNER AUTHORIZATION REQUIRED` — see
`MASTER_BLOCKER_REGISTER.md` B8.

---

## 5. Multi-device — 5.4 — PASS locally, BLOCKED hosted

Two people can work in the same restaurant from different devices, and one
device can never see another restaurant's rows.

- The invitation flow (`app/(staff)/dashboard/settings/team-actions.ts`)
  creates a scoped invite, keeps the code in an **httpOnly** cookie and out
  of the URL, and refuses a role the caller may not grant — proven by 20
  tests.
- Tenant isolation is proved against a real database, not mocked:
  `lib/db/phase0-security.integration.test.ts` (25 tests) and
  `lib/db/restaurant-account-link.integration.test.ts` (8 tests) cover
  "a manager cannot modify another restaurant's row", "a bill belonging to
  another restaurant answers not found, never the bill", and the equivalent
  for receipts, menus and brand assets.
- The E2E layer has the matching browser assertions
  (`e2e/integration/security-flow.spec.ts`) — **BLOCKED — ENVIRONMENT**
  locally, for the reason in §2.

**Hosted.** The two-device observation is `BLOCKED — OWNER AUTHORIZATION
REQUIRED` — B8.

---

## 6. Session expiry — 5.5 — PASS locally, BLOCKED hosted

- The session is verified **server-side on every read**. `getUser()` is used
  everywhere; `getSession()` — which trusts the cookie without asking the
  server — appears **nowhere** in the application code.
- An expired or absent session is a first-class outcome, not an exception:
  `getStaffContextDetailed` returns `reason: 'signed-out'`, and the routes
  turn that into a **401** (`app/api/ops/incidents/route.ts`) or a redirect
  to `/login`.
- A **password reset is not a session**: `updatePasswordAction` requires the
  short-lived `RECOVERY_COOKIE` permission, refuses without it *before any
  Auth call*, and deletes it the moment the password is saved. A signed-in
  session alone can never replace a password.
- A reset is also a sign-out everywhere: the reset path calls `signOut()`
  afterwards, so the old password's sessions die with it.

**Hosted.** The live three-code check (no header → 401, wrong header → 401,
correct header → 200) needs a Production redeploy and one authorization. It
is `BLOCKED — OWNER AUTHORIZATION REQUIRED` — B9.

---

## 7. Cron — 5.6 — PASS locally, BLOCKED hosted

`app/api/cron/escalate/route.ts` — 4 tests. It fails closed with no secret
configured, refuses a wrong secret, and only escalates an incident that is
genuinely unacknowledged. The route is `runtime = 'nodejs'` and
`dynamic = 'force-dynamic'`, so it is never cached.

**Hosted.** The live status codes are `BLOCKED — OWNER AUTHORIZATION
REQUIRED` — B9.

---

## 8. Alert sink — 5.7 — PASS locally, BLOCKED hosted

`lib/incident-notify.ts` — 6 tests — POSTs a **fixed-shape, tenant-free**
payload to `AUTODINE_ALERT_WEBHOOK`, with a bounded retry that does not
repeat a permanent 4xx (a misconfiguration) but does retry 408/429/5xx and
transport failures. `app/api/health/route.ts` covers the health signal.

**What the sink carries:** incident id, kind, severity, state, count,
summary, timestamps. **What it never carries:** a dedup key, an email
address, a tenant id, an invite code, or provider text. The dedup key stays
in memory — `formatIncidentLogLine` does not print it, and
`notifyIncident` does not send it.

**Hosted.** Pointing the sink at a human endpoint and paging someone for
real is `BLOCKED — OWNER AUTHORIZATION REQUIRED` — B9.

---

## 9. What is NOT claimed here

- No hosted browser run, hosted multi-device observation, hosted realtime
  proof, live cron status codes or a real paged alert is claimed. Each is
  `BLOCKED — OWNER AUTHORIZATION REQUIRED`.
- The browser suite is not claimed to pass. It could not run here, and the
  reason is recorded in §2.
- The two local **skips** in the unit suite (221 skipped) are the
  PostgreSQL-gated integration files when no database is configured; the
  same files run green under `npm run test:db:integration` against a
  disposable cluster (§3).

---

## 10. Where the hosted runs are recorded

| Run | Owner action | Register row |
|---|---|---|
| Hosted browser E2E on a disposable environment | one authorization naming `disposable-supabase-e2e-load` | `MASTER_BLOCKER_REGISTER.md` **B7** |
| Two-device realtime / fallback / recovery observation | one authorization plus an observer | **B8** |
| Alert sink pointed at a human, one real page, plus the cron codes | one env var plus a redeploy | **B9** |
