# Production-readiness continuation — 2026-10-28

## Verdict

**Not ready for live launch.** This reconciliation and its CI can validate code against synthetic/local fixtures, but they cannot verify production monitoring delivery, actual devices/printers, current hosted backups/PITR, or a recovery from a real backup. A green CI run is not a production-readiness approval and is not a limited-pilot safety case.

No production database was queried or changed, no restore was started, and no production deployment or merge to `main` was performed for this work.

## Realtime monitoring and alerting

The kitchen keeps its existing resilience behavior: Realtime subscriptions drive refreshes when connected; the UI polls every 30 seconds while live and every 5 seconds while degraded. A new client monitor waits 60 seconds of continuous `CHANNEL_ERROR`/`TIMED_OUT` before reporting a degraded signal, cancels the pending report if the socket recovers, and reports recovery only after a degraded alert was emitted.

`POST /api/ops/realtime-alert` accepts only the fixed `degraded`/`recovered` schema from same-origin requests authenticated as owner, manager, or kitchen staff. It uses the shared database rate limiter (6 events per restaurant per 10 minutes), emits privacy-minimized structured server logs with the stable prefix `[autodine:realtime-alert]`, and never logs restaurant/user IDs, order data, URLs, or free text. Polling remains the fallback if the alert endpoint is unavailable.

**This is an alert signal source, not confirmed alert delivery.** No Vercel log alert, log drain, paging integration, recipient, or live notification test is configured or evidenced. Before relying on alerts, approve the monitoring destination/recipients and thresholds, configure an alert on the structured `kitchen_realtime_degraded` event (and a recovery notice if desired), then send and acknowledge a synthetic test alert from a non-production deployment.

### Evidence boundary

- Unit tests cover the 60-second outage/recovery state machine, payload validation, authentication/role checks, same-origin enforcement, rate limiting, and privacy-minimized logging. Targeted Realtime tests passed 18/18 locally; the complete current-head CI unit suite also passed.
- On code revision `11ecf33` (the latest merge of `main` at the time of testing), GitHub Actions passed browser E2E (64/64), throttle browser E2E, the full CI suite, and clean-migration SQL boundary tests on PostgreSQL 15/17/18. This file was updated afterwards only to record the evidence. The CI jobs use synthetic/local fixtures; `sql:check` is DDL parsing only.
- The [`11ecf33` disposable Supabase E2E/load run](https://github.com/aryanp685/autodine/actions/runs/42662393252) passed 64 hermetic + 49 Supabase-backed browser tests, followed by synthetic load: 5,000/5,000 sessions, 5,000/5,000 orders, 1,000/1,000 app reads, 75/75 kitchen queries, and 1,500/1,500 Realtime events delivered across 20 clients; zero reported load failures. This is synthetic CI fan-out evidence only—not a production capacity result, external alert-delivery check, or production monitoring evidence.
- The [`11ecf33` Edge TTS smoke run](https://github.com/aryanp685/autodine/actions/runs/42662404666) confirmed the live voice catalogue (including the expected Hindi voices), and generated audio for plain text and sentence-terminator inputs. `break` and nested-`prosody` SSML probes were rejected after the stream closed before completion, including a retry. The workflow passed overall, but those SSML shapes remain an observed provider limitation; this does not test real devices, autoplay/unlock, room acoustics, or staff acceptance.
- Local disposable PostgreSQL validation does **not** contain Supabase Realtime. Production connection health, tenant coverage, external alert delivery/acknowledgment, alert fatigue, and on-call response remain unverified.

## Discounts and tax policy

Discount application remains disabled. `computeOrderTotals` rejects any positive discount until written financial approval; the public ordering and SQL write paths continue to create zero-discount orders, and receipt issuance retains its existing fail-closed guard for discounted historical rows. No dormant payment/database functions were removed.

Required written policy approval must specify, at minimum: permitted discount types and limits; who may grant each discount; item/ticket/bill scope; whether discounts alter taxable value and the applicable GST treatment; item-level rate handling and CGST/SGST/IGST treatment; rounding; invoice/receipt presentation; audit fields and immutability; and void/refund/correction behavior. No tax rates, authority rules, or arithmetic are inferred here. The frozen GST policy is unchanged.

## External access and approval still required

### Voice and real devices

Provide a non-production deployment and synthetic staff account, plus physical devices for the intended support matrix (at minimum the venue's Android tablet/phone and browser/OS version; include iOS/Safari only if it is in the supported matrix). A tester must verify Hindi/English speech clarity, correct voice selection, autoplay/unlock, muted/blocked audio, reconnect/replay, screen lock/backgrounding, volume, and fallback to device speech. This requires physical device and speaker access; browser simulation and TTS unit tests are not substitutes.

### Physical printing (P7 scope only)

Provide the actual receipt/KOT printer(s), connection type, paper width(s) (58 mm/80 mm/A4 as applicable), test venue, and the exact supported host OS/browser combinations. Use the browser's print dialog only. No print bridge, printer registration, or local print agent is in scope or approved. Verify alignment, clipping, scaling, duplicate-copy marking, paper handling, and the final rendered receipt against the on-screen bill using synthetic non-production orders.

### Current production backup/PITR evidence — read-only

Grant or arrange **read-only** visibility to the production Supabase project's Backups/PITR/retention settings for project `bdbaqpevwmgdvghszjno` (the production project ref already known to the team). Do not share credentials in chat. Capture redacted evidence of the current backup schedule, PITR enablement/window, retention, last successful backup/restore-point timestamp, project region/plan, and any gaps or warnings. Do not run queries, compare schemas, write data, or restore into production. This access is not currently available through the Supabase connector, so backup/PITR status remains unverified.

### Separate restore drill — explicit approval before execution

Before any restore, provide written approval naming a **separate isolated non-production target project** (project ref and owner), the approved source snapshot/restore point, allowed data handling/sanitization, the drill window, access scope, and cleanup/retention owner. The restore operation may mutate the target; no target has been approved or used. Production remains read-only and is never a restore target. The local CI dump/restore helper is not a substitute for a hosted PITR drill and is intentionally not enabled by the normal CI workflow.

## Other launch blockers and scope decisions

- Guest ordering remains pay-at-counter only; no guest online payment action is reintroduced. Staff may record a counter-verified cash/card/UPI payment.
- Quantity cap remains 99; GST Option A and frozen tax behavior are unchanged.
- Test-only project isolation must stay enabled; never direct tests, load, or schema checks at production.
- A disposable/CI load test measures only its synthetic environment and does not establish hosted capacity, availability, or a safe pilot envelope.
- The branch PR is for review only. Do not merge it or deploy it to production without a separate explicit approval.
