# AUTODINE — BREVO EMAIL ACTIVATION, DOMAINLESS PHASE: COMPLETION

Date: 2026-11-16 · Branch `arena/2670dd12-autodine`. Local changes only, uncommitted.
No Brevo account exists yet, so no real email could be sent and none was: every
live exercise used an absent or knowingly fake key. No API key was requested in
chat, no hosted setting was changed, nothing was deployed. **Branded delivery
is not claimed** — the owner has no custom domain (runbook B7 remains future).

## Phase A — inspection & reconciliation (nothing assumed)

- Re-read `BREVO_AUTH_EMAIL_IMPLEMENTATION.md`, `BREVO_EMAIL_RUNBOOK.md`,
  register 2.1, `MASTER_EXECUTION_STATUS.md`, then re-inspected the code on
  this branch. The prior implementation record is accurate; one gap was found
  and fixed (reply-to, §B2). Caller classification re-verified by grep:
  `sendEmail` has exactly **two** callers — `createInviteAction`
  (staff invitation) and `scripts/email/send-test-email.ts`. Auth mail is
  Supabase Auth's (`signUp`, `resend`, `resetPasswordForEmail`,
  join `signUp`); `/auth/confirm` completes PKCE `code` + `token_hash` links.
- **Live Vercel check (2026-11-16, names/targets/types only):** project `new`
  has **zero** email-provider variables in any target — no
  `AUTODINE_EMAIL_PROVIDER`, `BREVO_API_KEY`, `AUTODINE_EMAIL_FROM`, or
  `BREVO_WEBHOOK_SECRET` for Production, Preview, or Development. Hosted
  activation has not begun; the app therefore honestly reports invitations
  as *not connected* everywhere today, and there is no cross-environment
  email configuration that could bleed.
- **Supabase Auth (read-only, verified 2026-11-16 in the preceding staging
  task; unchanged since — no mutations in this program):** neither project
  has custom SMTP (`smtp_*` null), both cap platform mail at 2/hr, test
  `mailer_autoconfirm=false`, production `mailer_autoconfirm=true`
  (owner decision, register 2.9). One central Brevo account will serve the
  whole SaaS: tenants never see Brevo; the API path is tenant-free and the
  SMTP path is per-project dashboard config pointing at the same account.

## Phase B — verification results

| # | Check | Result |
|---|---|---|
| 1 | Brevo API integration | `POST https://api.brevo.com/v3/smtp/email`, `api-key` header only (test asserts no `Authorization`), `{sender, to:[{email}], subject, textContent, htmlContent, headers.idempotencyKey, tags:[autodine_<kind>]}`. Server-only env; nothing `NEXT_PUBLIC_*` (grep-clean). |
| 2 | Sender configuration | `parseEmailSender` accepts bare or `Name <addr>`, control-char-sanitized, ≤254 chars; unverified-sender class failures are permanent 4xx (no retry). |
| 3 | Idempotency & duplicates | One UUID per logical send, stable across retries; Brevo `duplicate_parameter` collapses to *delivered* (never a second send, never a failure). Pinned by tests incl. lost-response-then-duplicate. TTL documented inconsistently (15 vs 30 min) — design depends only on the shorter window; app retry window is seconds. |
| 4 | Retry / permanent failure | 429 + 408/5xx + network/timeout: 3 attempts, 300 ms base, 8 s timeout. Other 4xx: exactly 1 attempt. Outcomes are a closed vocabulary (`delivered/failed/not_configured/invalid_recipient`); `sendEmail` never throws. Test-send exercised live in all modes: no-config → exit 2; wrong provider name → `not_configured` exit 2; fake `xkeysib-` key → `failed, attempts:3` exit 1. |
| 5 | Webhook auth & events | Brevo sends no HMAC (official docs): receiver fails closed 503 without `BREVO_WEBHOOK_SECRET`, constant-time (hash-then-compare) bearer/`x-autodine-webhook-secret`, generic 401/400/413/405, 64 KB cap. Fixed event vocabulary; recipient/subject/message-id discarded at parse. `hard_bounce/invalid_email/blocked/error` → deduped `email_delivery_failed` (warning); `spam` → `email_spam_complaint` (critical); delivered/deferred/opens observed only. Events can never mutate account/membership/billing state. |
| 6 | Templates | Staff invitation: responsive HTML + plain text, every interpolation escaped (`escapeHtml`), control characters stripped, lengths capped. Auth templates (`docs/operations/email-templates/`) wrap responsively; both carry intact `{{ .ConfirmationURL }}` ×2; subjects in-file. |
| 7 | **Reply-to (gap found & fixed)** | Previously absent. Now `AUTODINE_EMAIL_REPLY_TO` (optional): parsed like the sender, sent as Brevo `replyTo`, malformed value fails the provider closed (never silently reroutes replies). Unset = replies go to the verified sender mailbox — correct for this phase. Added to provider + 2 tests, config verifier, `.env.example`, runbook §3. |
| 8 | Flows 1–5 (signup/verify, verified login, forgot/reset, invite/accept, resend) | All implemented on unchanged Supabase Auth; enumeration-safe identical responses for resend/reset (429 is the only distinguished case, and it is a site property, not an account property); invite-code IP budget + `rate_limited` states; expired/reused links route to honest re-request copy (confirm route). Focused battery: **8 files / 85 tests pass**. |
| 9 | Secrets/PII in logs | Grepped + test-pinned: log lines carry only fixed vocabulary, status, and Auth error codes. No recipient, subject, key, token, or message-id is logged anywhere (`safeErrorShape` in auth actions; fixed-vocabulary provider/webhook lines). |
| 10 | Environment separation | Fail-closed selection: non-`brevo` provider name → no provider; leftover `RESEND_API_KEY` ignored (unit-pinned); non-`xkeysib-` key → no provider. Per-target Vercel vars (runbook §3) keep Preview/Production credentials apart; Production activation stays a separate approval (B6). Deployment-isolation guards unchanged and green. |
| 11 | Rate limits | App: bounded retries above; provider 429 handled as transient; Brevo Free = 300 sends/day shared account quota (API+SMTP) — monitored in Brevo dashboard; Supabase platform cap 2/hr until owner enables custom SMTP per project (runbook §4 raises deliberately to 30/hr). Invitation failure raises deduped `staff_invitation_email_failed` incident. |
| 12 | UI states | Pending: `AuthSubmit`/`useFormStatus` (disabled + `aria-busy`) on signup/login/forgot/reset/resend forms. Sent/failed: invitation action returns five distinct honest sentences (emailed / not connected / address refused / send failed–copy link / copy link), never claiming delivery that didn't happen; auth flows show neutral "check your email" copy. |
| 13 | Observability | `[autodine:email]` structured lines (send + webhook), delivery telemetry counters, incident registry (deduped, fixed keys), ops incidents endpoint. Webhook `delivered` events are observations — a forged event that passed the secret could only move a counter or raise an acknowledgeable warning. |

## Missing product scope — explicitly NOT implemented

- **Order confirmation emails: do not exist.** No code sends guests any
  order-related mail.
- **Receipt / invoice emails: do not exist.** Receipts exist in-app
  (invoice share links); nothing emails them.
- **Customer notifications of any kind (order status, kitchen updates,
  offers): do not exist.** The only app-originated transactional mail is
  the **staff invitation**; the only other sends are Supabase Auth mails
  (signup confirmation, confirmation resend, password recovery, invitee
  signup confirmation) once SMTP is configured by the owner.
- Building customer email is a separate product decision (templates,
  consent/suppression handling, guest identity model) — not part of this
  activation and not claimed anywhere in the UI or docs.

## What remains owner-only (unchanged runbook B1–B6)

Brevo Free signup → verify one owner-controlled sender (6-digit code;
temporary-sender limits apply: possible sender-replacement/spam placement
at Gmail/Yahoo/Microsoft) → API key into Vercel **Preview** + webhook secret
(+ optional `AUTODINE_EMAIL_REPLY_TO`) → Brevo transactional webhook with
bearer secret → Brevo SMTP on the **test** Supabase project (SMTP login +
SMTP key — not the API key) + rate-limit raise + redirect allow-list →
controlled sends to owner mailboxes only → **Production (B6) is a separate
approval**, sequenced with the `mailer_autoconfirm` decision (register 2.9).
Domain purchase + authentication (B7) is required before any branded or
customer-facing sending and is not blocked by anything in this phase.

## Activation phase addendum (2026-11-16, later)

- Owner created the Brevo credentials (API key named `AutoDine-Preview`;
  SMTP username + SMTP key). Values were never requested, printed, or
  stored by the agent — names only.
- **Agent-configured (safe, non-secret):** Vercel project `new` →
  `AUTODINE_EMAIL_PROVIDER=brevo`, type plain, target **Preview** only
  (created via connector, response verified). Alone it activates nothing
  (provider still fails closed without key/sender) — by design.
- **Connector capability check:** the Supabase connector's
  `update_auth_config` exposes no SMTP fields, so Brevo SMTP on the test
  project is dashboard-only for the owner (it also requires the SMTP key,
  which the agent must never handle). The connector *could* set the test
  project's redirect allow-list (non-secret), but that remains a recorded
  owner decision (register 2.8) and is listed as checklist step C1 instead
  of being silently applied. Production was not accessed or mutated.
- Test project Auth re-verified read-only at activation time: no SMTP,
  2/hr email cap, autoconfirm off, single legacy Preview redirect origin —
  checklist steps C1–C3 are written against exactly this state.
- **Exact remaining blockers:** owner checklist steps A1 (verified sender),
  B2–B5 (Vercel secrets/sender), C1–C3 (test-project SMTP + rate limit),
  D1 (explicit deployment approval — code is uncommitted; no Preview can
  run it yet), D2 (Brevo webhook after deployment). Only then can Step E
  controlled verification run. **No delivery is claimed.**

## Validation (2026-11-16)

- Focused email/auth battery: 8 files / 85 tests passed.
- Full unit: 227 files / **2,539 passed / 0 failed** (baseline 2,537; +2 reply-to tests).
- `lint`, `typecheck`: exit 0. `build`: exit 0 (non-production target).
- `test:staging:guards` 31/31; `isolation:verify` PASSED.
- Config verifier: exit 0 (17 keys, Brevo group all UNSET — truthful; hosted activation not begun).
- Test-send: honest in all three modes (above). **No real email sent.**
