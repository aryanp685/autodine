# Email & monitoring readiness — what is tested, what is prepared, what only the owner can switch on (2026-11-15)

**Status: preparation only. NO provider was activated, NO credential was read, NO hosted setting was changed.** Nothing in this document certifies delivery, paging or uptime for any hosted environment. The staging browser evidence (run `43709710950`) exercises application flows; it does not send or receive a real email and does not trip a real alert.

## 1. What the repository proves today (tests, all green on this branch)

| Flow (code path) | Proof | Count |
|---|---|---|
| Signup — enumeration-safe confirmation response, PKCE handling, rollback path redacts provider details | `app/auth/actions.test.ts` | green (in the 2,334-test unit run) |
| Password recovery — same safe-error discipline; reset send/set paths log fixed vocabulary only | `app/auth/actions.test.ts` | green |
| Staff invite redemption (expired/redeemed status handling, the staging-corrected RPC) | `lib/team-invite.test.ts`, `lib/team-invite-attempt-budget.test.ts`, `lib/db/redeem-staff-invite-fix.test.ts` (+ DB integration suite `20261115000100`) | 27/27 in this batch's focused run |
| Incident core — signal validation, dedup/reopen, ack/resolve transitions, `[autodine:alert]` line shape, `deliverWithRetry` bounded backoff (never throws) | `lib/monitoring-incidents.test.ts` | green |
| Realtime degradation alert route — same-origin, role-gated, rate-limited | `app/api/ops/realtime-alert/route.test.ts`, `lib/realtime-alerts.test.ts`, `lib/realtime-monitor.test.ts` | 18/18 in this batch's focused run |
| Incident acknowledge/resolve API — owner/manager only, same-origin, 403 for kitchen/cashier, 409 across instances | `app/api/ops/incidents/route.test.ts` | 27/27 (with invite suites) |
| `/api/health` — public, fixed vocabulary, 503-on-fail, emits one `health_check_failed` alert line | `app/api/health/route.test.ts` | green |

Total in the focused run for this document: **55/55** (auth/health/realtime) + **27/27** (incidents + invites). The whole unit suite (2,334 passed / 198 skipped at b916e99) must pass again at this branch's final HEAD — see the final gate results in `docs/p0-remediation-2026-11-15.md`.

## 2. What exists but is NOT activated (code only, fail-closed)

- **Email delivery** rides Supabase Auth (confirmation + recovery). SMTP is a **hosted setting**, not app code — enabling Resend (or Brevo/Postmark/SendGrid) changes the Supabase project configuration only. No app change is required or expected.
- **`BACKUP_ALERT_WEBHOOK`** is read by the backup pipeline when set; delivery was never observed (no endpoint exists).
- **Alert delivery interface**: `deliverWithRetry` (in `lib/monitoring-incidents.ts`) is the bounded-backoff sender; routes use it. It exists, is tested, and is wired to **zero external endpoints** today.
- **Monitoring**: `/api/health`, `[autodine:alert]` log lines, the incident registry and the incidents API are live in code; nothing anywhere pages a human yet. No uptime check, no log drain, no alert rule exists.

## 3. Prepared procedures (owner executes or authorizes; not executed here)

### 3.1 Offline config validation (safe, no network)

`node scripts/verify-external-services-config.mjs` — checks the SHAPE of the
invoking shell's environment: `RESEND_API_KEY` prefix, `SMTP_HOST/PORT/USER/PASS/FROM/SECURE`
well-formedness, `BACKUP_ALERT_WEBHOOK` https shape. Never prints values, never
sends anything; exits 1 only on malformed **set** keys. Run it on the exact host
or secret store that will hold the credentials before activating.

### 3.2 SMTP/Resend delivery test (staging first, always)

1. Owner picks provider + sender identity (domain they control). Record DKIM/SPF/DMARC verification state.
2. `scripts/verify-external-services-config.mjs` passes on the host that will hold the key.
3. Supabase Auth (staging `autodinetest` first): enable custom SMTP — host/port/user/pass, sender name + address per `docs/resend-auth-readiness-2026-11-14.md` (port 465 implicit TLS or 587 STARTTLS).
4. Delivery test: two synthetic signups + one recovery request to **authorized test mailboxes only**; observe delivery; confirm the browser flow end-to-end; record timestamps and outcomes — never addresses, tokens or SMTP responses with credentials.
5. Record the result in the ops record; only then may the same checklist run for production under its own authorization.

### 3.3 Backup alert delivery test

1. Choose the webhook destination and store it as `BACKUP_ALERT_WEBHOOK` on the backup host (not in the app, not in this repo).
2. Force one failure deliberately on the disposable drill (selftest already proves the failure path: tampered file → webhook POST attempted). Point at a real endpoint you control and observe one alert arrive; then unset or point at the real one.
3. Record observation; "configured" never counts as "proven".

### 3.4 Monitoring go-live (staging rehearsal, then production)

1. Uptime check on `/api/health` at the chosen cadence; alert on 2 consecutive failures.
2. Alert recipient + severity routing (realtime-degraded vs health-503), one primary + one backup human.
3. Observe one test `[autodine:alert]` line arrive end-to-end (trigger the kitchen degraded path on staging per `docs/monitoring-readiness-2026-11-14.md`); acknowledge it through `POST /api/ops/incidents`; resolve it.
4. Only then enable the production check, under the same authorization that releases the deploy.

## 4. Honest classifications

- **TESTED (repo):** everything in §1 — local/unit/disposable-PG evidence only.
- **IMPLEMENTED-NOT-ACTIVATED:** custom SMTP path, backup webhook, alert delivery sender, incidents API, health alert line.
- **OWNER-ACTION (blocks launch):** provider decision + DNS, staging SMTP activation + delivery test, alert webhook proven end-to-end, uptime check with a routed human recipient, P1–P6 of `docs/pitr-verification-procedure-2026-11-14.md` (machine-checkable via `npm run pitr:check`).
- **UNPROVEN ANYWHERE:** hosted email delivery; hosted alert delivery; hosted uptime; hosted incident paging. No claim is made.

## 5. Failure handling already in the code (verified)

- Safe provider errors: auth paths log `{name, status, code}` only; user-facing messages are generic; enumeration-safe responses.
- `deliverWithRetry`: bounded exponential backoff; never throws; reports attempts honestly (log line states outcome, not success theater).
- Incident registry: duplicate suppression by opaque in-memory key; open→acknowledged→resolved with terminal resolved; 409 on cross-instance ack/resolve rather than a silent wrong-instance success; 403 for non-owner/manager roles; same-origin enforced.
- `/api/health`: 503 + one alert line; no tenant data, booleans and fixed vocabulary only.

## 6. What this document does NOT authorize

Production Auth/SMTP changes; provider purchases; domain verification; enabling any webhook; DNS edits; real customer mailboxes; treating any item in §2 as "live". Each is a separate owner authorization with its own evidence.

---

## Addendum (same day, this branch): the fail-closed pieces now exist in code

The §2 items "email delivery (transactional)" and "alert delivery interface" are no longer prose — they are implemented, unit-tested, unarmed.

- **Transactional email**: `lib/email/provider.ts` (Resend HTTPS adapter behind `getEmailProvider`; both `RESEND_API_KEY` and `AUTODINE_EMAIL_FROM` required, malformed values fail closed to `not_configured`), `lib/email/templates.ts` (staff invitation template, HTML-escaped, control-char stripped), wired into `app/(staff)/dashboard/settings/team-actions.ts` — an owner/manager may optionally email an invitation link (`email` field on the invite form). Outcomes are reported in the notice exactly as they happened: emailed / not connected / address refused / failed — never "sent" unless the provider accepted it. Signup and password recovery remain Supabase Auth's mail (hosted setting; unchanged). Delivery was never exercised against a live provider here; nothing claims it was.
- **Alert delivery**: `lib/incident-notify.ts` posts the fixed, tenant-free vocabulary (kind/severity/state/count/summary) to `AUTODINE_ALERT_WEBHOOK` (HTTPS only) on incident opened/reopened/escalated/acknowledged/resolved and on `/api/health` failure. Bounded retry (3 attempts, backoff), outcome logged as `alert_delivery`, never throws, unset webhook = zero network calls. `/api/ops/incidents` gained an `escalate` action (owner/manager; open→critical; idempotent — never pushed twice). `/api/ops/realtime-alert` pushes on open/reopen only.
- **Scheduled escalation**: `/api/cron/escalate` (Vercel Cron via `vercel.json`) escalates open, unacknowledged incidents older than 15 minutes. Fails closed: no `AUTODINE_CRON_SECRET`/`CRON_SECRET` → 503; wrong token → 401. Per-instance (in-memory registry); the log remains the durable record. The Vercel Hobby plan refuses any sub-daily schedule at deploy time (verified: commit 7772ade was refused before build with "Hobby accounts are limited to daily cron jobs"), so `vercel.json` declares a daily 01:30 UTC sweep. Tighter cadence needs either a Pro plan (owner purchase decision) or any external HTTPS scheduler hitting the endpoint with the bearer token (e.g. a cron service) — the endpoint and its auth are cadence-agnostic.
- **Visibility**: Settings → Operations (owner/manager) lists this instance's live incidents with acknowledge / resolve / escalate; shows the webhook outcome verbatim.
- **Backup verification & DR objectives**: `scripts/backup/verify-backup-file.mjs` (magic + manifest sha256 + full decrypt + payload sanity) and `scripts/backup/check-dr-objectives.mjs` (newest backup vs `--rpo-minutes`; optional `--restore-report` parsed for `elapsedMs` vs `--rto-minutes`; webhook alert on miss). `scripts/d2/verify-acl-posture.mjs` runs the D2 §3 probes read-only post-release (`--print-sql` for the SQL-editor path) and was proven on disposable PG 17. `npm run test:dr`, `npm run test:d2` added; both wired into CI.

**Still true:** no provider activated, no credential read, no hosted setting changed, no email or webhook ever observed in transit. Resend/domain activation, Supabase custom-SMTP enablement, `AUTODINE_ALERT_WEBHOOK` and `AUTODINE_CRON_SECRET` set on the deployment, and the §3.4 go-live remain owner actions.
