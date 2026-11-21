# Resend + Auth (email) readiness — what is needed, what is not decided (2026-11-14)

**Status: preparation only.** No provider was selected, no credential was read,
no DNS record was created, no hosted Auth setting was inspected or changed.
This document is the checklist for the owner's decision and the follow-up
authorized run. It claims nothing about the hosted projects.

## What the repository already has (source-verified, not hosted-verified)

- Signup/resend are enumeration-safe by design: generic confirmation-pending
  responses, opt-in PKCE verifier retention, `sb_flow_id` correlation on the
  confirm callback. Covered by unit tests; **no hosted email path has run.**
- Staff invites are manually shared links, not email. Only owner-signup
  confirmation and password recovery go through Auth email.
- `supabase/config.toml` enables email confirmations for local Auth only.
- No code in the app calls a mail API directly. All deliverability lives in
  the hosted Supabase Auth configuration. Choosing Resend changes hosted
  settings only — **no application code change is required or expected.**

## Decision the owner must make (one line each)

1. Provider: **Resend** (already named in the programme) — confirm or replace.
2. Sender identity: the from-domain (e.g. `mail.<domain>`) and the from-address
   (e.g. `AutoDine <noreply@mail.<domain>`). Must be a domain the owner controls.
3. Target project first: **staging only** (`autodinetest`,
   `juwyhslzchjevqkdvwjm`). Production follows only after staging passes and a
   separate production authorization is given.
4. CAPTCHA/abuse: enable or consciously waive (record the reason).

## What the owner (or an authorized session) then does, in order

1. **Resend side**: create the domain, add the DNS records Resend issues
   (DKIM; SPF alignment per Resend's instructions; DMARC recommended at
   `p=none` to start, tighten later). Verify the domain shows "verified".
   Create an API key scoped to sending only. Do not paste the key into chat;
   store it as an environment secret at the point of use.
2. **Supabase Auth (staging)**: enable custom SMTP
   - host `smtp.resend.com`, port `465` (implicit TLS) or `587` (STARTTLS),
   - user `resend`, password = the Resend API key,
   - sender name `AutoDine`, sender email = the verified from-address above.
3. **Auth templates**: confirm the confirmation/recovery templates point at the
   staging site URL with `/auth/confirm`, and that the redirect allowlist
   permits the callback with the `sb_flow_id` query parameter (narrowest
   viable entry, e.g. `https://<staging-host>/auth/confirm*` only if
   wildcards are supported, otherwise the exact origin + path).
4. **Rate limits**: read and record the hosted email-send/OTP limits; set a
   sane resend cadence; confirm the 429 path renders generically in the UI.
5. **End-to-end proof (staging)**: two independent synthetic signups in a real
   browser; both confirmation mails arrive; same-browser confirm works;
   cross-device link still lands on the pending/expired guidance, not an
   enumeration oracle; expired/reused link behaves; resend throttles without
   leaking account existence. Record evidence (timestamps, outcomes), not
   addresses or tokens.

## Explicit non-goals / standing constraints

- No production Auth change now; it is a separate, separately-authorized step.
- No code changes to the signup/resend/confirm flows are implied. If step 5
  finds a defect, that is a separate reviewed change.
- No address lists, no marketing mail; transactional auth mail only.
- Password recovery rides the same SMTP and must be re-verified after any
  provider change.

## Gate to call this done

Staging: custom SMTP on Resend with verified domain; confirmation and
recovery both delivered and confirmed in a real browser; allowlist and rate
limits recorded; evidence filed. Then — and only then — the same checklist
repeats for production under its own authorization.
