# AUTODINE — BREVO PROVIDER SELECTION & COMPLETE AUTH EMAIL IMPLEMENTATION

Date: 2026-11-16 · Branch `arena/2670dd12-autodine` (sandbox HEAD `d8d0e52`) · `main` untouched.
Boundaries honored: Brevo is the only provider introduced (owner decision); no account created, no API/SMTP key requested, read, or printed; no hosted setting changed; no email sent to any address; no deployment, commit, push, merge, or production activation. All delivery exercises used a knowingly fake key locally and could not deliver anything.

## Verdict

**Implementation complete in code; real delivery pending owner credentials.** The Resend adapter has been migrated to Brevo behind the existing provider boundary (no caller rewrites), a verified Brevo delivery-webhook receiver now exists, and every authentication email workflow is implemented on the unchanged Supabase Auth architecture and pinned by tests. What cannot exist yet — a Brevo account, a verified sender, keys, hosted SMTP, a real delivered email — is itemized as exact owner actions (B1–B7). **Branded production delivery must not be claimed** until a domain is purchased and authenticated (B7); the owner has no domain yet, by their own statement.

## 1. Inspection and caller classification (Part 1)

Every email-sending call site in the repository, classified:

| # | Caller | Flow | Transport after this change |
|---|---|---|---|
| 1 | `createInviteAction` (`app/(staff)/dashboard/settings/team-actions.ts`) | Staff invitation (optional recipient; copy-link fallback) | **App → Brevo API** via `sendEmail('staff_invitation', …)` |
| 2 | `scripts/email/send-test-email.ts` (`npm run email:test-send`) | Operator deliverability smoke test (not a request path) | **App → Brevo API** via `sendEmail('test', …)` |
| 3 | `signUpAction` (`app/auth/actions.ts`) | Owner first-time signup → confirmation mail | **Supabase Auth** (`auth.signUp` + `emailRedirectTo`); Brevo via hosted SMTP setting |
| 4 | `resendSignupConfirmationAction` | Secure resend of signup confirmation | **Supabase Auth** (`auth.resend`) |
| 5 | `joinSignUpAction` (`app/join/actions.ts`) | Staff invitee signup → confirmation mail returning to the invitation | **Supabase Auth** (`auth.signUp`, `next=/join/<code>`) |
| 6 | `requestPasswordResetAction` | Forgot password → recovery mail | **Supabase Auth** (`auth.resetPasswordForEmail`) |

Non-sending consumers (verified, unchanged): `/auth/confirm` (PKCE `code` + `token_hash` completion for signup/recovery/invite destinations), `updatePasswordAction`, `signInAction`, `acceptInviteAction` (DB redemption after confirmed sign-in). There are **no** `inviteUserByEmail`/`generateLink` callers — GoTrue's invite/magic-link templates remain unused, as before. Existing safeguards preserved throughout: enumeration-safe signup/resend/reset responses, PKCE same-browser recovery state, 15-minute recovery-cookie permission, role/tenant checks in the invitation actions, honest outcome copy.

## 2. Brevo implementation (Part 2) — actual code changes

| File | Change |
|---|---|
| `lib/email/provider.ts` | **Rewritten adapter**: `ResendProvider` → `BrevoProvider` on the same boundary (`getEmailProvider`/`sendEmail`/outcome contract untouched for callers). `POST https://api.brevo.com/v3/smtp/email`, `api-key` header, sender parsed to Brevo `{email, name}`, `tags: [autodine_<kind>]`. Key/secret never logged; recipient never logged. |
| `lib/email/brevo-webhook.ts` | NEW: payload classification (fixed vocabulary only; recipient/subject/links discarded) + constant-time bearer/custom-header credential verification. |
| `app/api/email/brevo/webhook/route.ts` | NEW: delivery webhook receiver. Fail-closed 503 without `BREVO_WEBHOOK_SECRET`; 401 wrong credential; telemetry + deduped incidents; GET 405. |
| `lib/email/templates.ts` | Staff invitation HTML made responsive (viewport meta, fluid `width:100%`/max-width container, box-sizing). Text/escaping unchanged in behavior. |
| `scripts/email/send-test-email.ts` | Controlled test-send now documents/drives the Brevo config (`BREVO_API_KEY`, exit codes unchanged). |
| `scripts/verify-external-services-config.mjs` | Brevo shape checks: `AUTODINE_EMAIL_PROVIDER` (=brevo), `BREVO_API_KEY` (`xkeysib-`), `AUTODINE_EMAIL_FROM`, `BREVO_WEBHOOK_SECRET`; SMTP expectations re-pointed at Brevo relay/SMTP key. |
| `scripts/hosted-verification/preflight.mjs` | Email package now tracks Brevo env names; verdict still `OWNER-ACTION-REQUIRED` (all UNSET — truthful). |
| `.env.example` | Brevo variable block, incl. API-key vs SMTP-key distinction. |
| `docs/operations/BREVO_EMAIL_RUNBOOK.md` | NEW operations runbook (account, temporary sender, env matrix, SMTP, webhook, domain/DNS, limits, rollback). Resend runbook + prior evidence marked SUPERSEDED. |
| `docs/operations/email-templates/*.html` | Auth templates wrapped in a responsive container; transport note added (content/link shape unchanged). |
| Register/status | `MASTER_OWNER_ACTION_REGISTER.md` 2.1 rewritten as Brevo B1–B7; `MASTER_EXECUTION_STATUS.md` updated. |

**Adapter decisions that matter:**
- **Explicit, fail-closed selection.** Selected provider, if named via `AUTODINE_EMAIL_PROVIDER`, must be `brevo`; the API key must carry `xkeysib-`; the sender must parse. A leftover `RESEND_API_KEY` is **ignored on purpose** (unit-pinned) — an unselected provider can never send by accident.
- **Idempotency.** One UUID per logical send in the body's `headers.idempotencyKey`, reused across retries (Brevo processes one send per key inside its ~15-minute TTL). Brevo's `duplicate_parameter` answer on a retry is treated as *the original send accepted* — delivered, never a second send, never miscounted as failure. The app's retry window is seconds (3 attempts, 300 ms base backoff, 8 s timeout), far inside the TTL.
- **Failures and rate limits.** 429 (rate/daily-quota) and 408/5xx/network/timeout retry within the bounded budget; other 4xx (bad key, unverified sender, bad recipient) fail on attempt 1. `delivered` means Brevo accepted (HTTP 201); final mailbox delivery arrives asynchronously via webhook (§3).
- **Server-side only.** `BREVO_API_KEY` is read from server env in one module; nothing email-related is `NEXT_PUBLIC_`; the webhook secret likewise. No key, recipient, subject, or message id appears in any log line, response, or test artifact.

## 3. Delivery webhooks

Brevo **does not sign** webhook payloads (no HMAC exists). The receiver therefore uses Brevo's documented alternatives: the webhook is created with **Bearer auth** (or the custom header `x-autodine-webhook-secret`) carrying `BREVO_WEBHOOK_SECRET`, compared in constant time (length-hidden via hashing). Events are **observations, never authorization**: `delivered` moves a telemetry counter; `hard_bounce`/`invalid_email`/`blocked`/`error` raise a deduped `email_delivery_failed` incident; `spam` raises `email_spam_complaint` (critical); opens/clicks/deferrals are observed only. Nothing in a payload can change an account, membership, or bill, so the worst case of a forged-but-secret-bearing call is a spurious warning. Parser + route tests prove wrong/missing credentials record nothing and responses/logs contain no payload PII.

## 4. Authentication workflows (Part 3) — implemented and tested

Supabase Auth architecture unchanged (GoTrue sends; app completes at `/auth/confirm`). Added this run: verified-login tests, reset-completion tests, invitee-signup tests. Focused battery: **11 files / 107 tests, all passing.**

| Flow | Where | Pinned behavior (evidence) |
|---|---|---|
| First-time signup | `signUpAction` | Workspace created before pending screen; enumeration-protected retries create no second workspace (`actions.test.ts`) |
| Email verification | `/auth/confirm` | PKCE `code` (+ `sb_flow_id`) and `token_hash` signup links complete to the fixed dashboard; pending-email cookie cleared (`route.test.ts`) |
| Secure resend verification | `resendSignupConfirmationAction` | Identical `requested` result for success/429/provider/transport failure; no provider wording or account state leaks (`actions.test.ts`, `server.pkce.test.ts`) |
| Verified account login | `signInAction` | Role-home landing, safe same-origin `next`, off-site `next` refused, one vague bad-credentials sentence (`actions
...[truncated 4477 chars]