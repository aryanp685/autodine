# AUTODINE — MASTER HOSTED VERIFICATION RUNBOOK

One coordinated package for every hosted check that stands between the current NO-GO and a launch decision. Each package is tagged:

- **[LOCAL]** — executable in this repo/sandbox today, no credentials.
- **[OWNER-CREDS]** — needs credentials/presence only the owner can supply.
- **[OWNER-AUTH]** — needs a separate explicit authorization naming the project/environment and scope; *preparing* it (this runbook) is not performing it.

**First step for every session:** `node scripts/hosted-verification/preflight.mjs` — read-only; prints SET/UNSET by name (never values), live PR/workflow/run state, and a per-package verdict. Presence is not validity; validity is not delivery. Every package below still ends in its own authorized hosted run with evidence filed under `qa-evidence/`.

---

## Package 1 — B2 backup + artifact verification [OWNER-CREDS → OWNER-AUTH]

**Prereqs:** private B2 bucket; bucket-scoped application key (read/write, that bucket only); repo secrets `AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` (optional `B2_ENDPOINT`). Confirm names read-only: `node scripts/verify-external-services-config.mjs` (shape) + preflight (presence).
**Local rehearsal [LOCAL]:** `npm run test:dr` (50/50) and `npm run test:backup` prove the pipeline offline; Mode A uses a hermetic `pg_dump` stub locally — the real custom-format round trip is CI-only.
**Hosted run [OWNER-AUTH]:** dispatch *Hosted backup (B2)* (name-registered on `main`). 
**Accept only if:** run output shows `uploaded:true, verified:true` (SHA-256 of artifact == manifest == `x-amz-meta-sha256` HEAD), manifest archived as a run artifact, counts + `financialSpotChecks` present in the manifest (pre-contract backups must be re-taken).
**File as evidence:** run URL + manifest + accept line in `qa-evidence/`. Anything less is "attempted", not "verified".

## Package 2 — Disposable hosted restore rehearsal [OWNER-AUTH]

**Prereqs:** Package 1 accepted; PR #190 merged so the drill is registered **by name** (preflight shows it today only as a file path — that is the defect the PR fixes); post-merge, confirm `gh workflow list` shows the drill by name.
**Hosted run [OWNER-AUTH]:** dispatch the restore-drill workflow against the Package-1 backup. Disposable target only — never Production, never Staging data.
**Accept only if:** workflow green AND the verification report compares schema fingerprint, table/row counts and financial sums (`payments_amount_paise`, `subscription_payments_amount_paise`) with zero unexplained deltas; cleanup of the disposable target confirmed.
**RPO/RTO evidence:** RPO is bounded by cadence (daily schedule → ≤24 h of data at risk; PITR, if chosen in Package 3, tightens this); **RTO is currently UNMEASURED** — the rehearsal's wall-clock duration (dispatch → green verified report) is the first honest RTO number; record it, and set the launch RTO target from it, not before it.

## Package 3 — PITR / recovery evidence (alternative/complement) [OWNER-CREDS]

**Decision first:** Supabase PITR (paid, near-continuous) vs B2 logical backups (implemented, ~₹0–40/mo). They are not exclusive; PITR without an off-platform copy is not a DR strategy.
**Local [LOCAL]:** `node scripts/verify-pitr-checklist.mjs --template > pitr-evidence.json`, then `--check <filled-file>` validates a completed P1–P6 evidence file offline (recomputes any named artifact's SHA-256).
**Accept only if:** the checklist passes every required checkpoint AND a human signature per `docs/pitr-verification-procedure-2026-11-14.md` is attached — the script is the checklist, not the signature.

## Package 4 — Auth email + Resend deliverability [OWNER-CREDS → OWNER-AUTH]

**Prereqs:** verified sending domain (SPF + DKIM published, DMARC at least `p=none` monitoring); deployment env `RESEND_API_KEY` + `AUTODINE_EMAIL_FROM` (`lib/email/provider.ts:129-130`); Supabase Auth custom SMTP configured **Staging-first** (`juwyhslzchjevqkdvwjm`) with GoTrue rate limits raised from the 2/hr platform default (owner register A5). Shape-check offline: `node scripts/verify-external-services-config.mjs`.
**Hosted run [OWNER-AUTH]:** from the deployed Staging environment, with a controlled mailbox: (1) signup confirmation delivered; (2) password reset delivered and completed (same-browser; the cross-device PKCE limitation is documented in `app/auth/confirm/route.ts`); (3) one staff invitation delivered; (4) force one provider retry (e.g. transient 500 via a scratch key) — **exactly one** email arrives (Batch 4 idempotency key); (5) kill the key once — UI + server show the honest failure, `[autodine:alert] staff_invitation_email_failed` appears in logs, invitation link still works.
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
