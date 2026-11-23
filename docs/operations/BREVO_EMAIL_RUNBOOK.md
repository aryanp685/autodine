# AutoDine — Brevo Email Operations Runbook

**Provider decision (owner, 2026-11-16): Brevo is AutoDine's transactional email provider. Free plan first (300 sends/day). No other email provider is to be introduced without approval.** The earlier Resend plan (`docs/operations/EMAIL_DELIVERABILITY_RUNBOOK.md`) is superseded by this document.

**Domain state: the owner has no custom domain yet.** Everything in §1–§4 works without one. Branded production delivery does **not** exist until §5 is completed after a domain purchase — nothing in §1–§4 should be described as branded delivery.

**Activation status (2026-11-16):** owner has created the Brevo credentials (API key `AutoDine-Preview`; SMTP username + SMTP key — values held only by the owner, never in chat/git). Step-by-step owner execution: `docs/operations/BREVO_ACTIVATION_OWNER_CHECKLIST.md`. Agent-side hosted configuration performed: Vercel Preview `AUTODINE_EMAIL_PROVIDER=brevo` (plain, non-secret; set via connector, verified). Everything else is owner-dashboard work (secrets) plus one deployment gate: the Brevo code is uncommitted and no deployment may happen without explicit approval, so no live send/receive verification has occurred yet — delivery must not be claimed until Step E of the checklist completes.

---

## 0. How email flows (two transports, one provider)

| Flow | Sender of record | Transport | Configured where |
|---|---|---|---|
| Staff invitation email, deliverability test | `AUTODINE_EMAIL_FROM` | App server → **Brevo API** (`POST https://api.brevo.com/v3/smtp/email`, `api-key` header) via `lib/email/provider.ts` | Vercel env (§3) |
| Signup confirmation, confirmation resend, password recovery, invitee signup confirmation | Supabase Auth sender | Supabase Auth (GoTrue) → **Brevo SMTP relay** (`smtp-relay.brevo.com`) | Supabase dashboard per project (§4) |
| Delivery/bounce/spam events | Brevo → app | Webhook `POST /api/email/brevo/webhook` (bearer-secret checked) | Brevo webhook + Vercel env (§3) |

The two Brevo credentials are **different**: the **API key** (`xkeysib-…`) is for the API; the **SMTP key** is for the relay. Neither works in the other's place, and neither ever goes in chat, git, or client code.

## 1. Brevo account + temporary sender (no domain yet)

1. Sign up at `brevo.com` (Free plan, no card). Verify the account email if asked; enable MFA.
2. **Settings → Senders, Domains, IPs → Senders → Add a sender**: From name `AutoDine`, From email = an owner-controlled mailbox you can read. Brevo emails a **6-digit verification code** to that address; enter it in Brevo. The sender is now *verified*.
3. Create the API key: **Settings → SMTP & API → API keys → Generate API key**, name it for its consumer/environment (e.g. `autodine-app-preview`). Copy it once — Brevo shows it only at creation; a lost key is revoked and regenerated. You will paste it into Vercel in §3, never anywhere else.
4. (For §4) On the **SMTP** tab of the same page, note the **SMTP login** (shown there) and **Generate SMTP key**, named e.g. `autodine-supabase-test`. Copy once for the Supabase dashboard.

**Temporary-sender limitations (read before testing):**
- A verified single mailbox proves Brevo *can* send from that address; it does **not** authenticate a domain. Free-mailbox domains (Gmail/Yahoo/Outlook) **cannot** be domain-authenticated at all.
- Brevo warns that mail from an unauthenticated/free sender domain may be **sender-replaced** (sent via a Brevo domain), rejected, or spam-foldered by Gmail/Yahoo/Microsoft. Expect inconsistent inbox placement.
- Therefore: use this sender **only** for controlled tests to owner-approved mailboxes. Staff invitations to real staff and all customer-facing sending wait for §5.

## 2. Local smoke test (before touching any deployment)

With the values only in your shell (never committed):

```bash
AUTODINE_EMAIL_PROVIDER=brevo BREVO_API_KEY='xkeysib-…' \
AUTODINE_EMAIL_FROM='AutoDine <your-verified-sender>' \
  npm run email:test-send -- --to <your own mailbox>
```

Exit 0 + `outcome:"delivered"` + the message in the mailbox + Brevo **Transactional → Logs** showing it = the API key and sender work. Shape-check any candidate config first with `node scripts/verify-external-services-config.mjs`.

## 3. Deployment configuration (Preview/non-production first)

Vercel → project **`new`** → Settings → Environment Variables, **Preview** target (Production only at the separate launch gate):

| Variable | Value | Type |
|---|---|---|
| `AUTODINE_EMAIL_PROVIDER` | `brevo` | plain |
| `BREVO_API_KEY` | the §1 API key for this environment | **Sensitive** |
| `AUTODINE_EMAIL_FROM` | `AutoDine <verified sender>` (later: `AutoDine <invites@your-domain>`) | plain |
| `AUTODINE_EMAIL_REPLY_TO` | *Optional.* `AutoDine <support mailbox>` — where staff-invitation replies should land. Unset: replies go to the `AUTODINE_EMAIL_FROM` mailbox (in this phase, your verified mailbox — usually what you want). A malformed value disables the provider (fails closed), so typo carefully | plain |
| `BREVO_WEBHOOK_SECRET` | `openssl rand -hex 32` output — invent it here, reuse in Brevo below | **Sensitive** |

Redeploy Preview (env applies to new deployments), then:

**Webhook (Brevo dashboard):** create a **Transactional** webhook pointing at `https://<existing app origin>/api/email/brevo/webhook` with **Bearer auth** token = the same `BREVO_WEBHOOK_SECRET` (or a custom header `x-autodine-webhook-secret` with that value). Subscribe: `delivered`, `hardBounce`, `softBounce`, `deferred`, `spam`, `blocked`, `error`, `invalidEmail`, `unsubscribed`. Brevo does not sign payloads; this shared secret + the receiver's fixed-vocabulary handling is the protection, so keep the secret long and private.

## 4. Supabase Auth mail via Brevo SMTP (test project first)

Per project — settings never carry across projects. Start with the non-production project `juwyhslzchjevqkdvwjm`:

1. **Authentication → Emails → SMTP Settings → Enable custom SMTP.**
   Sender email = the §1 verified sender (later `accounts@your-domain`); Sender name `AutoDine`.
   Host `smtp-relay.brevo.com` · Port `587` (STARTTLS; `465` SSL also works) · Username = Brevo **SMTP login** · Password = Brevo **SMTP key** (not the API key). Save.
2. **Authentication → Rate Limits:** enabling custom SMTP raises the email cap from the platform **2/hr** to 30/hr; set it deliberately for testing.
3. **Authentication → URL Configuration:** Site URL + redirect allow-list must include the exact app origin you test from (the existing `*.vercel.app` deployment origin). Auth links are built from the request origin and return to `/auth/confirm`; an origin missing here is the classic "link lands nowhere".
4. **Authentication → Emails → Templates (optional polish):** paste `docs/operations/email-templates/confirmation.html` / `recovery.html` (subjects in-file). Defaults also work; never hand-edit `{{ .ConfirmationURL }}`.
5. Test with controlled mailboxes only: signup → confirmation link → dashboard; resend confirmation; forgot password → reset link → new password → sign-in; staff invite → join signup → confirmation → sign-in → accept. Production project `bdbaqpevwmgdvghszjno` repeats this only under the separate production-activation approval (and after the `mailer_autoconfirm` decision).

## 5. Later: custom domain purchase + authentication (branded delivery)

1. Buy the domain at any registrar (owner action). In Brevo: **Settings → Senders, Domains, IPs → Domains → Add a domain** — enter the exact domain your senders will use (root domain, or a subdomain such as `updates.<domain>` if you prefer mail reputation separated; senders must then be `@updates.<domain>`).
2. Brevo shows the DNS records to add **at your domain's DNS host** (registrar/Cloudflare; exact names/values from Brevo — copy/paste):
   - **Brevo code** — `TXT`, host = the domain (`@`), value = Brevo's code (proves ownership).
   - **DKIM** — either 1 `TXT` or 2 `CNAME` records (`brevo1._domainkey…`, `brevo2._domainkey…`) with Brevo's values (signs the mail).
   - **DMARC** — `TXT` at `_dmarc`, value like `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` (use Brevo's exact value; if a DMARC record already exists, keep **one** record and merge the `rua` tag). Start `p=none`; tighten after clean reports.
   - No separate SPF record is added on Brevo's shared sending setup unless Brevo's screen shows one (e.g. dedicated IP); add exactly what Brevo displays — nothing more, nothing guessed.
3. Back in Brevo click **Authenticate this email domain**; wait for propagation (minutes to 48h) until DKIM + DMARC show green for the domain.
4. Create senders on the domain (`invites@…`, `accounts@…`), then update: `AUTODINE_EMAIL_FROM` (Vercel, per target), the Supabase SMTP sender (per project), and repeat §2 + §4 tests. Only now is delivery "branded": From addresses on your domain, DKIM/DMARC aligned.

## 6. Limits, monitoring, troubleshooting

- **Free plan: 300 emails/day total** (API + SMTP share the account quota). A 429 from the API is retried briefly by the app, but a spent daily quota is a plan limit, not an outage — Brevo's dashboard shows usage.
- Monitoring: Brevo **Transactional → Logs/Statistics**; app logs `[autodine:email]` (send outcomes + webhook events, fixed vocabulary only); Settings → Operations delivery counters and incidents (`email_delivery_failed`, `email_spam_complaint` from webhooks; `staff_invitation_email_failed` from send failures). Suppressions are automatic in Brevo — never re-mail a suppressed address through another tool.
- Invitation says "not connected" → env missing/wrong target/pre-dates redeploy. API 401 → wrong/revoked API key. API 400/403-class → unverified sender. Auth mail missing but API mail fine → SMTP not enabled on *that* project, SMTP key vs API key mix-up, or the 2/hr platform cap. Confirmation link fails on a second device → known PKCE same-browser behavior documented in `app/auth/confirm/route.ts`, not a Brevo fault.
- **Rollback** is subtraction: unset the Vercel env (invitations return to copy-link, honestly) and/or disable custom SMTP (Auth falls back to the platform sender at 2/hr). Revoke a leaked key in Brevo first, then rotate it in the one place it lives.
