# AUTODINE — MASTER HOSTED VERIFICATION RUNBOOK

One coordinated package for every hosted check that stands between the current NO-GO and a launch decision. Each package is tagged:

- **[LOCAL]** — executable in this repo/sandbox today, no credentials.
- **[OWNER-CREDS]** — needs credentials/presence only the owner can supply.
- **[OWNER-AUTH]** — needs a separate explicit authorization naming the project/environment and scope; *preparing* it (this runbook) is not performing it.

**First step for every session:** `node scripts/hosted-verification/preflight.mjs` (also `npm run hosted:preflight`, and `--json` for machines) — read-only; prints SET/UNSET by name (never values), live PR/workflow/run state, and a per-package verdict. Presence is not validity; validity is not delivery. A verdict of READY-TO-AUTHORIZE means *the inputs are in place and a human must now authorize the hosted run* — never *this was verified*. When GitHub refuses a read, the answer is UNKNOWN, never "absent". Every package below still ends in its own authorized hosted run with evidence filed under `qa-evidence/`.

---

## Package 1 — B2 backup + artifact verification [OWNER-CREDS → OWNER-AUTH]

**Prereqs:** private B2 bucket; bucket-scoped application key (read/write, that bucket only); repo secrets `AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` (optional `B2_ENDPOINT`). Confirm names read-only: `node scripts/verify-external-services-config.mjs` (shape) + preflight (presence).
**Local rehearsal [LOCAL]:** `npm run test:dr` (78/78) and `npm run test:backup` prove the pipeline offline; Mode A uses a hermetic `pg_dump` stub locally — the real custom-format round trip is CI-only. Both hosted workflows now install and **verify the PostgreSQL 17 client** (`.github/actions/postgres-client`) before use, because a custom-format dump written by a newer `pg_dump` carries an archive format the older `pg_restore` refuses outright ("unsupported version"). The backup and the drill must therefore pin the *same* major version; both pin 17, matching the drill's `postgres:17` container.
**Hosted run [OWNER-AUTH]:** dispatch *Hosted backup (B2)* (name-registered on `main`). 
**Accept only if:** run output shows `uploaded:true, verified:true` (SHA-256 of artifact == manifest == `x-amz-meta-sha256` HEAD), manifest archived as a run artifact, counts + `financialSpotChecks` present in the manifest (pre-contract backups must be re-taken).
**File as evidence:** run URL + manifest + accept line in `qa-evidence/`. Anything less is "attempted", not "verified".

## Package 2 — Disposable hosted restore rehearsal [OWNER-AUTH]

**Prereqs:** Package 1 accepted; the drill registered **by name**. The defect is real and still open on `main`: the job-level `env:` block of `.github/workflows/hosted-restore-drill.yml` used the `runner` context, which GitHub Actions does not expose there, so the workflow never registered — `gh workflow list` shows it only as a file path (`.github/workflows/hosted-restore-drill.yml`) next to the name-registered `Hosted backup (B2)`. PR #190 fixes it (the `DRILL_DIR` and the two preserved report paths become the workspace-relative `.restore-drill`); the fix is **not merged**, so the preflight still reports the defect. After it merges, confirm `gh workflow list` shows the drill by name.
**Hosted run [OWNER-AUTH]:** dispatch the restore-drill workflow against the Package-1 backup. Disposable target only — never Production, never Staging data.
**Target guard (enforced in code, not by convention):** `scripts/backup/restore-logical.mjs` and `scripts/backup/verify-restored-db.mjs` share one guard (`scripts/backup/lib-restore-target.mjs`). Loopback only by default; a hosted target needs an explicit scratch opt-in **and** an approved project ref that the target's own ref must match; a Production project is refused outright and no flag unlocks it; a hosted target whose ref cannot be determined fails closed. Refusals name the host and project ref only — never the URL, the user name or the password. A drill therefore cannot be pointed at Production, and Production restore stays a separate explicit design rather than something a drill implies.
**Accept only if:** workflow green AND the verification report compares schema fingerprint, table/row counts and financial sums (`payments_amount_paise`, `subscription_payments_amount_paise`) with zero unexplained deltas; cleanup of the disposable target confirmed.
**RPO/RTO evidence:** RPO is bounded by cadence (daily schedule → ≤24 h of data at risk; PITR, if chosen in Package 3, tightens this); **RTO is currently UNMEASURED** — the rehearsal's wall-clock duration (dispatch → green verified report) is the first honest RTO number; record it, and set the launch RTO target from it, not before it.

## Package 3 — PITR / recovery evidence (alternative/complement) [OWNER-CREDS]

**Decision first:** Supabase PITR (paid, near-continuous) vs B2 logical backups (implemented, ~₹0–40/mo). They are not exclusive; PITR without an off-platform copy is not a DR strategy.
**Local [LOCAL]:** `node scripts/verify-pitr-checklist.mjs --template > pitr-evidence.json`, then `--check <filled-file>` validates a completed P1–P6 evidence file offline (recomputes any named artifact's SHA-256).
**Accept only if:** the checklist passes every required checkpoint AND a human signature per `docs/pitr-verification-procedure-2026-11-14.md` is attached — the script is the checklist, not the signature.

## Package 4 — Auth email + Brevo deliverability [OWNER-CREDS → OWNER-AUTH]

> **Provider is Brevo, not Resend.** The Resend-era guidance in this package is superseded and must not be followed: the app activates **only** Brevo (`AUTODINE_EMAIL_PROVIDER=brevo`), a leftover `RESEND_API_KEY` is ignored on purpose, and `RESEND_API_KEY` is **not** a required environment name anywhere. Owner steps are B1–B7 in `docs/operations/BREVO_EMAIL_RUNBOOK.md`; the activation state is `qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md`.

**Prereqs:** deployment env `AUTODINE_EMAIL_PROVIDER=brevo` + `BREVO_API_KEY` + `AUTODINE_EMAIL_FROM` + `BREVO_WEBHOOK_SECRET` (`lib/email/provider.ts`; shape-checked by `scripts/verify-external-services-config.mjs`). Supabase Auth custom SMTP configured against Brevo's relay (`smtp-relay.brevo.com:587`, SMTP login + **SMTP key** — a different credential from the API key) **Staging-first** (`juwyhslzchjevqkdvwjm`), with GoTrue rate limits raised from the 2/hr platform default (owner register A5).
**Brevo Authorized IPs (the trap that cost a day):** Brevo → Settings → SMTP & API → SMTP → **Authorized IPs** must allow all IPs / be deactivated for this project. Supabase Auth has no fixed egress IP, so with the restriction on, *every* Auth mail fails at the relay with `525 5.7.1 Unauthorized IP address` (GoTrue 500 on `/signup` and `/resend`, signup rolled back, nothing stamped). Do not re-enable the IP block to "test" this. The SMTP key stays the gate.
**Webhook:** a Brevo **Transactional** webhook to `/api/email/brevo/webhook` with **both** headers — `x-vercel-protection-bypass` (the Vercel Protection Bypass for Automation secret, or Brevo's POST never reaches the app) and `Authorization: Bearer <BREVO_WEBHOOK_SECRET>` — and **batched webhooks OFF** (the receiver takes one JSON object per POST; arrays are refused with 400). Verified live 2026-11-18: Brevo's test event returned HTTP 200.
**Domainless is the current phase:** no domain is purchased yet, so delivery is from a domainless sender and lands in **Spam**; inbox placement awaits domain authentication (runbook B7). Branded sending must not be claimed before B7.
**Hosted run [OWNER-AUTH]:** from the deployed environment, with a controlled mailbox: (1) signup confirmation delivered; (2) password reset delivered and completed (same-browser; the cross-device PKCE limitation is documented in `app/auth/confirm/route.ts`); (3) one staff invitation delivered; (4) force one provider retry (e.g. transient 500 via a scratch key) — **exactly one** email arrives (Batch 4 idempotency key); (5) kill the key once — UI + server show the honest failure, `[autodine:alert] staff_invitation_email_failed` appears in logs, invitation link still works. Steps 1–3 (test-send, staff invitation, recovery mail) are still unproven; only the Auth confirmation mail is claimed delivered so far.
**Silent-failure visibility (added 2026-11-18):** every Auth mail failure also raises a deduped operator incident — `signup_confirmation_email_failed`, `signup_confirmation_resend_failed`, `password_reset_email_failed`, `password_update_failed`, plus `signup_workspace_creation_failed` and `signup_rollback_failed` — visible in `[autodine:alert]` log lines and on the owner/manager ops incident surface (`/api/ops/incidents`). A rising count means mail is broken for real users *right now* even though visitors see normal pages. Summaries carry only the fixed kind and a numeric status — never an address, a tenant id or a provider message — and a 429 (expected throttling) and the enumeration-protected existing-email response deliberately raise nothing.
**Accept only if:** all five observations recorded with timestamps; then repeat once on Production after release approval.

## Package 5 — Realtime multi-device verification [OWNER-AUTH]

**Prereqs:** Staging project with seed restaurants A and B; three devices (guest phone, kitchen tablet, cashier desktop); alert sink from Package 7 configured to receive the degradation signal.
**Hosted run [OWNER-AUTH]:** place orders on A from the guest device; advance on A's kitchen; settle on A's cashier. Mid-service, disable connectivity on A's kitchen device ≥90 s, then restore. Throughout, B's devices stay open.
**Accept only if:** A's kitchen falls back to polling during the outage (no frozen board), exactly one sustained-degradation alert fires (~60 s) and one recovery signal after restore; B never renders an A row (and vice versa); guest status reaches its terminal state; no duplicate ticket transitions from reconnect replays.

## Package 6 — Guest QR-to-receipt browser E2E (hosted stack) [OWNER-AUTH]

**Prereqs:** the 49 `e2e/integration/**` specs and the `disposable-supabase-e2e-load` CI workflow (provisions Auth/Storage/Realtime/Postgres + synthetic fixtures). Unavailable in this sandbox — **no Docker daemon** (`docker unavailable`); that is the exact environmental blocker, not a code gap.
**Hosted run [OWNER-AUTH]:** one owner-dispatched CI run on a disposable environment.
**Accept only if:** fully green (the project runs with `retries: 0` by design — a flake is a finding, not a rerun). Local substitutes already green and *not* interchangeable: demo browser suite 67/67, disposable-PostgreSQL integration 222/222.

## Package 7 — Monitoring, alert delivery + recovery [OWNER-CREDS → OWNER-AUTH]

**Prereqs:** log drain (e.g. BetterStack/Axiom) with a rule on the `[autodine:alert]` prefix; uptime monitor on `GET /api/health`; `AUTODINE_ALERT_WEBHOOK` pointed at a human-reachable endpoint (owner register A3/D3/D5); cron secrets already configured (register A4 — live 401/200 proof rides on the next authorized Production redeploy).
**Local [LOCAL]:** instrumentation is unit-proven (Batches 4–5): kinds `kitchen_realtime_degraded`, `staff_invitation_email_failed`, `billing_webhook_{record,apply}_failed`, health-failure lines; dedupe/recovery semantics in `lib/monitoring-incidents.test.ts`; ops console lists/acks both trackers. Auth-mail/workspace failures added 2026-11-18: `signup_confirmation_email_failed`, `signup_confirmation_resend_failed`, `password_reset_email_failed`, `password_update_failed`, `signup_workspace_creation_failed`, `signup_rollback_failed` (`app/auth/actions.test.ts`, operator-visibility describe block).
**Hosted run [OWNER-AUTH]:** trigger one real degradation (Package 5's outage doubles as the trigger), one email failure (Package 4 step 5), confirm each pages the human, is acknowledged in the ops console (or via webhook ack), and clears on recovery.
**Accept only if:** alert → human → acknowledge → resolve all observed with timestamps; no PII/secrets in any delivered payload (fixed vocabulary only, by construction and by test).

## Package 8 — Preview/Staging isolation [LOCAL → OWNER-AUTH]

**Local [LOCAL]:** `node scripts/verify-preview-isolation.mjs` (offline matrix + `--file` vetting of candidate env files, names only) and `lib/supabase/deployment-isolation.ts` (build/server refuse non-production deployments pointed at Production `bdbaqpevwmgdvghszjno`).
**Hosted [OWNER-AUTH]:** after any env change, re-run the `--file` vetting on the exact file to be applied and attach its verdict; a Preview build pointed at Production must fail to build — that failure is the pass condition.

---

**Sequencing:** 1 → 2 closes the backup gate. 4 and 7 can proceed in parallel on Staging. 5 rides on 7's sink. 6 is independent CI evidence. 3 is a decision, taken any time, that changes 1–2's cadence claims. 8 is a standing guard, re-run on every environment change.
