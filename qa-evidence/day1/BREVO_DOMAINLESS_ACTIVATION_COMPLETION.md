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

## Hosted activation — Preview live (2026-11-18)

Owner approved commit/push/PR (Brevo-only steps 1–3) plus a one-file
fix-up. Executed with secret scans clean and gates green; no merge, no
Production change, no force-push.

- **Commits/PR:** `1846863` feat(email) + `1cd7552` docs(qa) on remote tip
  `49669ff` (cherry-picked conflict-free; net diff verified pure Brevo),
  then fix-up `ab541ee` adding the `operationalIncidents` export the
  webhook route imports (its absence failed the first Preview build —
  root cause was a file-selection omission in commit 1, found in the
  Vercel build log and fixed with the exact +8-line hunk). PR **#191**
  (`arena/2670dd12-autodine` → `main`) OPEN, not merged.
- **Deployment:** `dpl_GnLaaimCs8H3DnUAr5UC7LBWr8M2` READY; branch alias
  `new-git-arena-2670dd12-autodine-iamjarvis9896-3988s-projects.vercel.app`
  assigned. Build/runtime env include the four Brevo variable **names**
  (values never read). Deployed receiver files hash-verified identical
  to the inspected worktree copies.
- **Protection finding:** an unauthenticated agent probe of the webhook
  URL was redirected to Vercel's "Protected Deployment" login —
  Deployment Protection (SSO) blocks Brevo's servers too. Owner
  generated a **Protection Bypass for Automation** secret. Protection
  stays ON; nothing was disabled.
- **Header feasibility (official Brevo API reference, 2026-11-18):**
  `POST /v3/webhooks` supports bearer auth (`auth {type, token}`) AND a
  custom `headers [{key, value}]` list on the same webhook. Safest
  configuration (both as explicit custom headers, so no behavior is
  assumed): `x-vercel-protection-bypass: <bypass secret>` for the
  Vercel edge + `Authorization: Bearer <BREVO_WEBHOOK_SECRET>` for the
  app. Vercel's docs recommend the header form over the query parameter;
  the query form is not used.
- **Receiver vs official Brevo payload docs:** every documented payload
  `event` value (`request`, `delivered`, `deferred`, `soft_bounce`,
  `hard_bounce`, `spam`, `unique_opened`, `opened`, `invalid_email`,
  `blocked`, `error`, `unsubscribed`, `proxy_open`,
  `unique_proxy_open`, `click`) is in the receiver's fixed vocabulary;
  subscription names differ (`invalid`, not `invalidEmail`; `error`
  documented as a payload but absent from the create-API enum) —
  checklist D2 and runbook §3 corrected. **Batched webhooks must stay
  OFF** (receiver takes one object per POST; arrays → 400). Receiver
  contract: no secret configured → 503; wrong/missing credential → 401
  generic; bad JSON/unknown event → 400; body >64 KB → 413; GET → 405;
  success → 200. Failure classes dedupe into one incident per class.
- **Webhook live (2026-11-18, owner-confirmed):** webhook created with
  both headers, batched off; Brevo's test event returned **HTTP 200** —
  bypass header, bearer credential and receiver processing all proven
  against the live Preview. Wrong-secret/missing-secret refusals are
  unit-proven and re-checkable by the owner with bogus credentials
  (checklist Step E); the 503 no-secret path stays untested live by
  design (never unset production-grade config to test it).
- **Still pending:** controlled email tests to owner-controlled
  mailboxes only (test-send, staff invitation, signup/resend/reset,
  reply handling) with Brevo logs + actual inbox as proof. **No email
  has been sent or received yet; delivery is NOT claimed.**
- **Root cause of the Auth-mail failure (2026-11-18, from hosted logs):**
  the first guided signup used an address already registered
  (unconfirmed, 2026-11-11, workspace included) — duplicate signup is an
  enumeration-safe no-op, correctly showing the generic page. The resend
  then exposed the real defect: `autodinetest` Auth log shows
  `POST /signup` and `POST /resend` → **500 `525 "5.7.1 Unauthorized IP
  address"`** — Brevo's SMTP relay rejects Supabase's egress IPs, which
  are not in the Brevo account's authorized-IP list. GoTrue rolls the
  signup back (no user, no `confirmation_sent_at` stamp) and the app
  logs only `{status: 500, code: 'unknown'}`. The new redirect entry is
  exonerated (Auth config reload at 16:49 changed nothing; the failing
  endpoints are exactly the two that send mail). SMTP credential type
  and sender match are still untested — the IP wall rejects first.
  **Smallest fix (owner, Brevo dashboard): allow all IPs / deactivate IP
  authorization for SMTP** (Settings → SMTP & API → SMTP → Authorized
  IPs); Supabase publishes no fixed Auth egress IP to whitelist, and
  the SMTP key remains the sending gate. No credentials rotated, no
  Production touched.
- **First verified Auth delivery (2026-11-18):** owner approved and
  executed the single Brevo change — deactivated "Blocking unauthorized
  IP addresses" for **SMTP keys only** (API-keys row untouched, no
  credential changes). Send-again to the exact stored address then
  dispatched: `confirmation_sent_at` **2026-11-18 12:24 UTC** (relay +
  SMTP credentials + sender all accepted), email received in the owner
  mailbox's **Spam** folder (domainless-sender placement; inbox
  placement awaits domain authentication, register B7), link clicked →
  `email_confirmed_at` **2026-11-18 12:25 UTC**. Two process lessons
  recorded: duplicate signup is a silent no-op (use send-again or a
  fresh address), and Auth returns a silent 200 for send-again to any
  address that is not an unconfirmed user — only the DB stamps
  (`confirmation_sent_at`/`updated_at`) tell the truth. **Claimed:
  Auth confirmation mail, Spam placement. Not yet claimed: any API-path
  mail (test-send, staff invitation), recovery mail, inbox placement.**

## Silent-failure fix — Auth mail failures are now operator-visible (2026-11-18)

Owner directed that every failure class hit during activation be fixed
so it cannot silently happen to a real user. Code-level result (app
repo only; no dashboard, credential, Production, or user-facing
behaviour change):

- **Problem:** when Brevo rejected Supabase's egress IPs (`525`), every
  signup/send-again/reset failed invisibly — the visitor correctly saw
  the generic anti-enumeration page, and the only evidence was a lone
  `console.*` line (signup did not even log: its Auth error was silently
  swallowed on the way to the pending page).
- **Fix (`app/auth/actions.ts`):** every Auth mail failure now also
  reports a deduped incident to the shared `operationalIncidents`
  tracker (the same surface as `staff_invitation_email_failed` and the
  Brevo webhook failure classes): kinds `signup_confirmation_email_failed`,
  `signup_confirmation_resend_failed`, `password_reset_email_failed`,
  `password_update_failed`, plus `signup_workspace_creation_failed` and
  `signup_rollback_failed` for the post-Auth signup path. Operators see
  a rising count in the `[autodine:alert]` log line and on the
  owner/manager ops incident surface (`/api/ops/incidents`, with the
  optional alert-webhook forward). A provider-wide breakage (another
  525, a revoked key, a dead SMTP config) now opens one visible incident
  on the first affected user instead of failing silently for days.
- **Safety invariants (unit-proven):** user-facing output is byte-for-byte
  what it was (anti-enumeration preserved); incident summaries carry only
  the fixed kind + numeric status — never an address, tenant id, or raw
  provider message; a 429 (expected throttling) and the
  enumeration-protected existing-email response are NOT reported, so the
  signal stays meaningful; reporting itself is wrapped so it can never
  break the visitor flow.
- **Not code-fixable, recorded honestly:** Supabase's silent 200 for
  send-again to a non-unconfirmed address is upstream anti-enumeration —
  only `auth.users` stamps distinguish a real dispatch (checklist/runbook
  keep that verification step); Spam placement of the domainless sender
  remains owner-side domain authentication (register B7).
- **Validation:** `app/auth/actions.test.ts` 24/24 (6 new
  operator-visibility tests: provider failure reported, transport
  failure reported, success/429/existing-email not reported, no private
  text in incident or log lines, workspace failure reported with clean
  rollback); full unit suite 2,545 passed / 223 skipped / 0 failed;
  typecheck + ESLint clean. **Clean-tree verification (the lesson of the
  first Preview build failure, applied):** the exact committed subset
  (auth actions + incident registry + ops incident route + staff
  team-actions, with tests) was built in a pristine worktree at the
  branch base — 55/55 focused tests, typecheck clean, `next build`
  green — before pushing to `arena/9b120325-autodine`. No Production
  change, no merge performed by the agent.
- **Deployed (2026-11-18):** commits `d679a9e` (fix) + `e9b247d` (docs)
  on `arena/9b120325-autodine`, PR **#192** open (not merged). Preview
  deployment `dpl_FL8jz6dsh4gQrLzvnMBij8MDc2QH` **READY**; branch alias
  `new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app`.
  The incident-visibility fix is therefore live on that Preview; the
  earlier Brevo-code Preview (`dpl_GnLaaimCs8H3DnUAr5UC7LBWr8M2`, PR
  #191) remains the deployment where the confirmation mail was verified.
