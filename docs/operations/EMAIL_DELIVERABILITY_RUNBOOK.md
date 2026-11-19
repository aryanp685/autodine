# AutoDine — Email Deliverability Operations Runbook

> **SUPERSEDED (owner decision, 2026-11-16): Brevo is the selected email provider, not Resend.** Use `docs/operations/BREVO_EMAIL_RUNBOOK.md` and `qa-evidence/day1/BREVO_AUTH_EMAIL_IMPLEMENTATION.md`. This document is retained as the record of the earlier Resend plan; do not follow its E1–E8 steps.

**Status (2026-11-16): code-ready, hosted activation NOT started.** Every code path below exists and is locally verified. No Resend account, domain, API key, SMTP setting, or deployment env var exists yet — §3 is the exact owner sequence that creates them, §4 proves delivery with real mail. **Nothing in this runbook counts as delivered until the §5 completion criteria are all checked with real evidence.**

Companion evidence: `qa-evidence/day1/EMAIL_DELIVERABILITY_IMPLEMENTATION.md` (inspection + validation record for Master Run 3).

---

## 1. How AutoDine sends email (two separate paths — both must work)

| Path | What it sends | How it sends | Configured where |
|---|---|---|---|
| **App mail** | Staff invitations (Settings → Team), deliverability test | `lib/email/provider.ts` → Resend HTTPS API, `Idempotency-Key` per logical send, 3 bounded retries, outcome telemetry | Vercel env: `RESEND_API_KEY` + `AUTODINE_EMAIL_FROM` (server-side only, never `NEXT_PUBLIC_`) |
| **Auth mail** | Signup confirmation, password recovery (and GoTrue's invite/magic-link templates, unused by the app today) | Supabase Auth (GoTrue) → custom SMTP | Supabase dashboard per project: Authentication → Email → SMTP Settings |

Key facts established by inspection (2026-11-16, read-only):

- The **only** app-mail caller is `createInviteAction` (`app/(staff)/dashboard/settings/team-actions.ts`); without a provider it honestly degrades to the copy-the-link flow and reports `not_configured` — nothing pretends to have sent.
- `/auth/confirm` completes both link shapes Supabase can produce (PKCE `code`, or `token_hash` + `type`), for `flow=signup` and `flow=recovery`.
- **Neither** Supabase project (`juwyhslzchjevqkdvwjm` test, `bdbaqpevwmgdvghszjno` production) has custom SMTP today (`smtp_host` etc. all null), and both still have the platform email rate limit **`rate_limit_email_sent = 2`/hour**. Auth mail is effectively unusable at any real volume until §3 step E5 lands.
- **No** Vercel env target (production / preview / development) has `RESEND_API_KEY` or `AUTODINE_EMAIL_FROM`. App mail is `not_configured` everywhere.
- Hosted Auth templates are Supabase's defaults (subjects and bodies uncustomized in both projects). Branded replacements are prepared in `docs/operations/email-templates/` (step E6).
- Vercel has **no custom domain**; the product is reachable on `*.vercel.app` origins. A sending domain does **not** need to be the web domain — see E2.

## 2. Provider decision: Resend (already implemented; re-evaluated 2026-11-16)

The adapter targets Resend's REST API with no SDK dependency; swapping providers later means replacing one class (`ResendProvider`), not call sites. Current published pricing (resend.com/pricing, checked 2026-11-16):

| Plan | Price | Volume | Daily cap | Domains | Notes |
|---|---|---|---|---|---|
| Free | $0 | 3,000/mo | **100/day** | 3 | Sending pauses at cap (no overage); 30-day log retention; 1 webhook endpoint; SMTP relay included |
| Pro | $20/mo | 50,000/mo | none | 10 | Overage $0.90/1,000; 5 webhook endpoints |
| Scale | $90/mo | 100,000/mo | none | 1,000 | Dedicated IP add-on available |

- **Production suitability:** DKIM/SPF/DMARC authentication, automatic suppression lists, bounce details and delivery webhooks are included on every tier; the free tier's hard constraint is the **100 emails/day cap**, not features. For a single-restaurant pilot (a handful of staff invites + auth mail per day) Free is sufficient; upgrade to Pro when daily sends approach ~80/day or a second sending domain is needed.
- **Region:** pick the region closest to recipients when adding the domain (for Indian recipients, Resend's Tokyo region is the nearest offered).
- **SMTP for Supabase Auth** (Resend's own Supabase guide): host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key. One key can serve both paths, but this runbook deliberately uses **separate, sending-only keys per consumer and per environment** so a leak or rotation never crosses environments.

## 3. Owner activation sequence (exact steps)

> Rules for every step: secret values are typed only into the Resend / Vercel / Supabase dashboards — never into chat, git, or a ticket. Report back only "done" plus non-secret facts (domain name, which env targets, timestamps). Steps E1–E7 are **non-production** (Preview + test project). E8 (Production) is a separate approval gate.

### E1 — Create the Resend account
1. Go to `resend.com/signup`, create the account with an owner-controlled mailbox (this mailbox is also the only address Resend lets you test-send to before a domain is verified — remember which one it is).
2. Confirm the account email if Resend asks. No card is required on Free.
3. *(Optional but recommended)* enable MFA on the account.

### E2 — Add and verify the sending domain
You must own a domain. It does **not** need to be attached to Vercel or host the app.
- **If you own a domain:** use a subdomain for mail, e.g. `updates.<yourdomain>` (Resend recommends a subdomain so mail reputation stays separate from the root domain).
- **If you own no domain:** buy one first at any registrar (e.g. Cloudflare or Namecheap) — a purchase is an owner action; nothing else in this step can proceed for real recipients until it exists. Interim testing to the E1 account mailbox only is possible via Resend's shared `onboarding@resend.dev` sender (account-mailbox recipients only; skip to E3/E4 with that sender, then redo E4–E5 once the domain verifies).

Steps:
1. Resend dashboard → **Domains** → **Add Domain** → enter `updates.<yourdomain>` → choose the region nearest your recipients → **Add**.
2. Open the domain's **Records** tab. Resend lists the exact records; typically:
   - DKIM: `TXT` at `resend._domainkey.updates.<yourdomain>` (long key value Resend generates)
   - SPF: `MX` at `send.updates.<yourdomain>` and `TXT` at `send.updates.<yourdomain>` (`v=spf1 include:amazonses.com ~all`)
   - DMARC: `TXT` at `_dmarc.<yourdomain>` → `v=DMARC1; p=none;` (start at `p=none`; tighten to `quarantine`/`reject` after a week of clean reports)
3. Add each record **exactly as shown** (copy/paste) in the DNS panel of wherever the domain's DNS is hosted (registrar or Cloudflare). If a record is offered as a CNAME anywhere, do **not** enable proxying (Cloudflare orange cloud off).
4. Back in Resend, wait for the domain status to turn **Verified** (often <15 min; can take up to 72 h). If it stalls past 72 h, use **Restart verification**. Public visibility can be checked at `dns.email`.

### E3 — Create API keys (sending-only, one per consumer)
Resend dashboard → **API Keys** → **Create API Key** for each (permission: **Sending access**, domain: restrict to `updates.<yourdomain>`):
1. `autodine-app-preview` — for the Vercel Preview app mail path.
2. `autodine-supabase-test-smtp` — for the test Supabase project's Auth SMTP.
3. *(Later, at E8)* `autodine-app-production` and `autodine-supabase-prod-smtp`.

Copy each key once, straight into its destination in E4/E5. Keys are shown only at creation; a lost key is revoked and re-created, never recovered.

### E4 — Configure the app path (Vercel, Preview first)
Vercel → project **`new`** → Settings → Environment Variables:
1. `RESEND_API_KEY` = the `autodine-app-preview` key · type **Sensitive** · targets: **Preview** (add Development too if you run `vercel dev`).
2. `AUTODINE_EMAIL_FROM` = `AutoDine <invites@updates.<yourdomain>>` · targets: **Preview** (+ Development as above).
3. Redeploy the Preview deployment (env changes apply to new deployments only).

Do **not** set the Production target yet (E8). Before redeploying, shape-check locally without sending anything: put candidate values in a shell and run `node scripts/verify-external-services-config.mjs` — every line should read PASS.

### E5 — Configure Auth mail (Supabase **test** project `juwyhslzchjevqkdvwjm`)
Dashboard → Authentication → Email → **SMTP Settings**:
1. Enable custom SMTP. Sender email: `accounts@updates.<yourdomain>`; Sender name: `AutoDine`.
2. Host `smtp.resend.com` · Port `465` · Username `resend` · Password = the `autodine-supabase-test-smtp` key · Admin email = your owner mailbox. Save.
3. Authentication → **Rate Limits**: raise **email sent** from `2` to `30`/hour for testing (the platform 2/hr cap applies until custom SMTP is saved; the limit stays whatever you set, so set it deliberately; revisit at E8).
4. While here (ties into staging-isolation action O-B3): Authentication → URL Configuration — the test project is still pinned to one historical preview URL. Set **Site URL** and **Redirect URLs** to the current preview origin(s) you will test from, or confirmation/reset links will land on a dead deployment.

### E6 — (Recommended) Brand the Auth templates
Authentication → Email Templates. For **Confirm signup** and **Reset password**, set the subjects and paste the bodies from `docs/operations/email-templates/confirmation.html` and `recovery.html`. The defaults also work — links are identical (`{{ .ConfirmationURL }}`) — so this is polish, not a blocker. Do not hand-edit the link URL.

### E7 — Run the controlled tests (§4), test environment only
All of §4 against **Preview + test project + your own controlled mailbox**. File results in the evidence document. Only when §5 passes there does E8 get scheduled.

### E8 — Production activation (SEPARATE approval — do not fold into E1–E7)
Repeat with production-scoped values: `autodine-app-production` key + `AUTODINE_EMAIL_FROM` on the Vercel **Production** target only; `autodine-supabase-prod-smtp` key + SMTP + a deliberate rate limit in **`bdbaqpevwmgdvghszjno`**; confirm `mailer_autoconfirm` posture (open item O-B5 — production currently auto-confirms, which changes what confirmation mail even does there); branded templates; then §4 T2–T4 against a controlled mailbox on the production origin. Customer-wide sending stays off until this gate is explicitly approved.

## 4. Controlled test procedures (owner-approved test addresses only)

| # | Test | Steps | Pass evidence |
|---|---|---|---|
| T1 | Provider smoke (app path) | In a shell with the **Preview** key/from values: `npm run email:test-send -- --to <your mailbox>` | Exit 0, `outcome:"delivered"`; email in inbox; Resend dashboard → Emails shows it `delivered` |
| T2 | Staff invitation | On the Preview deployment: Settings → Team → invite **your own** address | Mail arrives from `invites@updates.…`; link opens the join page; redemption succeeds once; second open is refused |
| T3 | Signup confirmation | On the Preview deployment: sign up with a controlled address | Confirmation arrives from `accounts@updates.…`; link lands on `/auth/confirm?flow=signup` and through to the dashboard signed in |
| T4 | Password recovery | Request a reset for that account | Recovery mail arrives; link lands on `/auth/confirm?flow=recovery`; new password saves; sign-in with it works |
| T5 | Failure + retry behaviour | (a) Unit proof already exists (`lib/email/provider.test.ts`: 500/429 retried ×3 with **one** Idempotency-Key, 403 not retried). (b) Live negative check, Preview only: temporarily set a **revoked/wrong** key on the Preview target, redeploy Preview, rerun T1 | (b) Exit 1 with `failed`; a `staff_invitation_email_failed`-class incident/log line appears; restore the correct key and rerun T1 green. Duplicate suppression: provider-side, via the 24 h `Idempotency-Key` — Resend shows one email per logical send |
| T6 | Monitoring visibility | After T1–T5: check (i) Resend dashboard delivery events, (ii) deployment logs for `[autodine:email]` lines, (iii) Settings → Operations delivery counters (`/api/ops/incidents` snapshot), (iv) the incidents list | A delivered **and** a failed attempt are each visible in at least the log + telemetry; the failure raised an incident a human can acknowledge |

Notes:
- **Cross-device caveat (known, documented in `app/auth/confirm/route.ts`):** with the default `{{ .ConfirmationURL }}` (PKCE) templates, the link must be opened in the same browser that requested it — the verifier is a cookie. Test T3/T4 in one browser; if cross-device opening matters, switching templates to the `token_hash` form is a separate, deliberate change (the confirm route already handles it).
- Never test with a customer's address. Every recipient in §4 is an owner-controlled mailbox.

## 5. Completion criteria (all required — Master Run 3 definition)

- [ ] A controlled real email is **received** in a real inbox (T1, and T2 for the product flow)
- [ ] Authentication links work end-to-end (T3 confirmation, T4 recovery)
- [ ] Retries are verified (T5: unit proof + live negative check; one Idempotency-Key per logical send)
- [ ] Duplicate suppression verified (one delivery per logical send in the Resend log)
- [ ] Failure monitoring is operational (T6: failure visible + incident raised)
- [ ] Preview/Staging proven **separately** from Production; Production stays untouched until E8 approval

## 6. Monitoring, limits, troubleshooting

**Day-to-day monitoring (once live):** Resend dashboard (delivered / bounced / complained, suppression list is automatic — never mail a suppressed address from another tool); Vercel function logs filtered on `[autodine:email]`; Settings → Operations counters (per-instance, reset on restart — the log line is the durable record). Optional later: a Resend webhook (`email.delivered`, `email.bounced`, `email.complained` — 1 endpoint on Free) once a receiving endpoint exists; none exists today, so do not register one pointing nowhere.

**Limits that will bite first:** Free plan **100/day** cap (sending pauses) → upgrade trigger ≈80 sends/day sustained or a second domain; Supabase Auth rate limit stays at whatever E5/E8 set — auth spikes (many signups/hour) will 429 there first.

| Symptom | Likely cause | Fix |
|---|---|---|
| Invitation says "Email is not connected" | `RESEND_API_KEY`/`AUTODINE_EMAIL_FROM` unset or malformed on that target; or deployment predates the env change | Verifier script locally; check target + redeploy |
| T1 exit 1, status 403 | Sending from an unverified domain, or key restricted to another domain | Re-check E2 status; key's domain restriction (E3) |
| T1 exit 1, status 401 | Wrong/revoked key | Revoke + recreate (E3), update the one env var |
| Auth mail never arrives, app mail fine | SMTP not enabled on **that** project, or Auth rate limit still 2/hr | E5 per project — settings do not carry across projects |
| Confirmation link lands on a dead/wrong deployment | Project Site URL / redirect allow-list points elsewhere | E5 step 4 (test) / production allow-list tightening (O-B3) |
| Link works on desktop, fails from phone mail app | PKCE same-browser binding (see §4 note) | Expected with default templates; token_hash template change is the deliberate fix |
| Mail lands in spam | Missing/!verified DMARC, brand-new subdomain | Confirm E2 records; start `p=none`, warm up with low volume, tighten later |

## 7. Rollback

Email is fail-closed and honest at every layer, so rollback is subtraction: remove the Vercel env vars (app mail returns to the copy-link flow and says so) and/or disable custom SMTP in the Supabase project (Auth falls back to the platform sender with its 2/hr cap). No data migration, no code change, no user-facing breakage beyond the honest "not connected" message. Revoke any leaked key in Resend first, then rotate.
