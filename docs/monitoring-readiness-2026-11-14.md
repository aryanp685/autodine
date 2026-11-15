## 2026-11-14 update — provider-independent incident core is built

`lib/monitoring-incidents.ts` now provides the missing middle layer between
signal and provider: signal validation (fixed vocabulary, control-char
stripping, length caps), an in-memory incident tracker with duplicate
suppression by an opaque in-memory key (never logged), open →
acknowledged → resolved transitions with a terminal resolved state,
per-instance sweep of stale resolved incidents, a stable `[autodine:alert]`
JSON log-line formatter (`incident_opened|repeated|reopened`,
acknowledge/resolve, `health_check_failed`), and `deliverWithRetry` —
bounded exponential backoff, never throws, reports attempts honestly.

Wired application failure paths (safe, additive):

1. `POST /api/ops/realtime-alert` — on `degraded` opens/repeats a
   per-instance incident and logs `incident_opened|incident_repeated`;
   on `recovered` resolves the live incident and logs `incident_resolved`.
   The old `[autodine:realtime-alert]` line is RETIRED in favour of the
   single `[autodine:alert]` prefix (no hosted alert rule existed; nothing
   was verified end-to-end against any provider).
2. `GET /api/health` — when the deployment is not ready, emits ONE
   `[autodine:alert] {"event":"health_check_failed","severity":"critical",…}`
   line carrying booleans and fixed-vocabulary probe results only.

Still true: nothing was configured, no provider was chosen, no external
delivery was observed or claimed. Acknowledgement/resolution endpoints for
staff are NOT wired to any UI; the tracker is in-memory per instance, so
structured log lines remain the durable record. External delivery, paging
and acknowledgement remain owner decisions below.

# Monitoring readiness — signals the app emits, and what only the owner can provision (2026-11-14)

**Status: preparation only.** Nothing was configured, no provider was chosen,
no hosted setting was read or changed. Locally verified 2026-11-14:
`lib/monitoring-incidents.test.ts` 16/16, `app/api/ops/realtime-alert/route.test.ts` 5/5,
`lib/realtime-alerts.test.ts` 10/10 and `lib/realtime-monitor.test.ts` 3/3,
`app/api/health/route.test.ts` 2/2 —
signal validation, dedup/reopen, ack/resolve transitions, `[autodine:alert]`
line shape, `deliverWithRetry` backoff, and both wired call sites. The
`[autodine:alert]` prefix is the single stable alert key; no hosted rule
exists yet. The plan label on the Vercel project is
Hobby/legacy per prior read-only inspection; exact entitlements below are
**UNVERIFIED** and must be confirmed in the dashboard before relying on them.

## What the app already emits (source-verified)

| Signal | Where | Shape |
|---|---|---|
| Health | `GET /api/health` | public, `no-store`, 200/503; booleans only (`ok`, configured/server/browser, trial days, `operational` map, `checkedAt`). Never any keys, ids or tenant data. |
| Kitchen Realtime chain | `POST /api/ops/realtime-alert` (kitchen roles, same-origin, rate-limited 6/10min/restaurant) | structured `[autodine:alert]` line via `formatIncidentLogLine`: `{event: incident_opened\|incident_repeated\|incident_reopened\|incident_resolved, incidentId, kind, severity, state, count, summary}`. No tenant/user ids, URLs or free-text errors. |
| Health not-ready | `GET /api/health` | one `[autodine:alert]` line `{event: health_check_failed, severity: critical, …}` — booleans and fixed-vocabulary probe results only (`formatHealthAlertLine`). |
| Route errors | server error hook + `X-Request-ID` header | route templates and error digests only; support correlation id. Log-site redaction review already flagged in OPERATIONS-READINESS.md. |
| Realtime | Supabase Realtime channels per outlet | client-side reconnect counters are surfaced in the kitchen UI and via the alert endpoint above. |

## What no code can provide — owner decisions required

1. **Uptime check** on `https://<host>/api/health` (HTTP 200 expected).
   1–5 minute cadence; alert on two consecutive failures. Any provider
   works (Healthchecks.io, Better Stack, UptimeRobot, Vercel Checks, …).
2. **Log/alert destination for the `[autodine:realtime-alert]` prefix.**
   If the plan supports Log Drains, drain to the chosen sink and alert on the
   prefix; if not (likely on Hobby), the fallback is: Vercel runtime logs
   reviewed in dashboard + the health check above as the paging signal.
   **A monitoring design that assumes a paid entitlement is not a design.**
3. **Alert recipient and severity routing**: who gets paged for
   `kitchen_realtime_degraded` (service degradation) vs health 503
   (deployment unusable). One owner name minimum, with a second contact.
4. **Thresholds**: health 503 > 2 consecutive probes; realtime degraded > 5
   minutes; 5xx/503 rate if the platform exposes it. Do not set thresholds
   before there is a traffic baseline — record the baseline first.
5. **Digest**: a weekly 10-minute review (health history, realtime alerts,
   failed order attempts visible in logs, deployment list).

## Staging rehearsal of monitoring (allowed; hosted staging only when authorized)

Once staging SMTP/rehearsal work is authorized: point the uptime check at the
staging host for 48h, trigger the kitchen degraded path once by revoking a
test channel, confirm the log prefix lands where the owner chose, restore.
Evidence: provider screenshot + log excerpt with identifiers redacted.

## Explicit non-goals

- No synthetic monitoring that writes orders/payments; probes must be reads
  only (`/api/health`, public pages).
- No alerting content with tenant names, emails, tokens or order data.
- No claiming a hosted monitoring state from this document.
