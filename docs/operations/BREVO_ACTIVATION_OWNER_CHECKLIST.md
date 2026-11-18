# AutoDine — Brevo Activation: Owner Checklist (Preview + Test Project Only)

Companion to `docs/operations/BREVO_EMAIL_RUNBOOK.md`. Do these steps in order.
**Never paste either Brevo secret into chat, git, tickets, or screenshots.**
Nothing here touches Production: Vercel **Preview** target and Supabase project
`autodinetest` (`juwyhslzchjevqkdvwjm`) only.

## The two Brevo credentials — never interchange them

| Credential | Looks like | Used ONLY in | What breaks if swapped |
|---|---|---|---|
| **API key** (you named it `AutoDine-Preview`) | starts `xkeysib-` | Vercel `BREVO_API_KEY` (step B2) | Pasted into Supabase SMTP: Auth mail fails authentication |
| **SMTP key** | starts `xsmtpsib-` | Supabase SMTP **Password** field (step C2) | Pasted into Vercel: app sends fail (provider rejects non-`xkeysib-` keys / API refuses the SMTP key) |

The SMTP **username** is your Brevo SMTP login (shown on the same Brevo page as
the SMTP key). It is not a secret of the same class, but treat it as private too.

## Step A — Brevo dashboard (5 minutes)

- [ ] A1. **Settings → Senders, Domains & IPs → Senders**: confirm the sender
  you will send from shows **Verified**. If not: *Add a sender* → From name
  `AutoDine`, From email = a mailbox you control → enter the 6-digit code
  Brevo emails to that mailbox. **Write down the exact verified address** —
  steps B3 and C2 must use it character-for-character.
  *(A domainless verified mailbox sender is fully supported by AutoDine's
  configuration. Caveats: Brevo may sender-replace it, and Gmail/Yahoo/
  Microsoft may spam-folder it — fine for controlled tests, not for customers.)*
- [ ] A2. **Settings → SMTP & API → API keys**: confirm `AutoDine-Preview`
  exists. (If you ever lose its value: revoke it and generate a new one —
  Brevo shows a key only at creation.)
- [ ] A3. **Settings → SMTP & API → SMTP tab**: note the **SMTP login** and
  confirm your SMTP key exists (same regenerate rule).
- [ ] A4. On your own machine, generate the webhook secret and keep it in your
  password manager: `openssl rand -hex 32`. You will paste the same value
  twice (B4 and D2). Invent it; Brevo does not issue it.

## Step B — Vercel dashboard → project `new` → Settings → Environment Variables

Target **Preview** for every row. (Row B1 is already done — set by the agent
via the Vercel connector on 2026-11-16 and verified.)

- [x] B1. `AUTODINE_EMAIL_PROVIDER` = `brevo` — type **plain**, target Preview. ✅ done
- [x] B2. `BREVO_API_KEY` = value of the Brevo key `AutoDine-Preview` — type **Sensitive** ✅ owner-configured; verified present 2026-11-16 (names/targets only, value never read). Note: it is scoped to git branch `arena/2670dd12-autodine`, so it applies to this branch's Preview deployments — other branches' previews honestly report email not-connected.
- [x] B3. `AUTODINE_EMAIL_FROM` = `AutoDine <verified-sender>` using the exact
  address from A1 (or just the bare address) — type **plain** ✅ owner-configured; verified present (Preview target), value not read.
- [x] B4. `BREVO_WEBHOOK_SECRET` = the value from A4 — type **Sensitive** ✅ owner-configured; verified present (Preview target), value never read.
- [ ] B5. *Optional:* `AUTODINE_EMAIL_REPLY_TO` = e.g. `AutoDine <your support
  mailbox>` — plain. Unset means replies go to the B3 sender mailbox. *(Intentionally skipped by owner, 2026-11-16.)*

Do **not** add any of these to the Production target. That is step B6 in the
runbook and needs its own approval later.

## Step C — Supabase dashboard → project `autodinetest` ONLY

**Owner reports Step C complete (2026-11-16).** The agent has deliberately not
read the Auth config back: the config API returns the `smtp_pass` field, and
reading it would pull the SMTP secret into the agent conversation. The
controlled signup/resend test in Step E is the proof instead.
State before owner setup (verified read-only 2026-11-16): no custom SMTP (all SMTP fields
empty), email rate limit 2/hour, `mailer_autoconfirm` off, redirects allow only
`https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app/**`.

- [ ] C1. **Authentication → URL Configuration**: add
  `https://*-iamjarvis9896-3988s-projects.vercel.app/**` to **Redirect URLs**
  (keep the existing entry). Needed so Auth links work from any Preview branch.
- [ ] C2. **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
  - Sender email = the exact A1 verified address; Sender name = `AutoDine`
  - Host = `smtp-relay.brevo.com` · Port = `587`
  - Username = Brevo **SMTP login** (A3) · Password = Brevo **SMTP key** (A3)
    — *not* the `xkeysib-` API key. Save.
  - **Brevo Authorized IPs (learned the hard way, 2026-11-18):** Brevo →
    Settings → SMTP & API → SMTP → **Authorized IPs** must **allow all IPs
    / be deactivated** for this project. Supabase Auth sends from
    Supabase's cloud egress IPs (no fixed address exists to whitelist);
    with the restriction on, every Auth mail fails at the relay with
    `525 5.7.1 Unauthorized IP address` (GoTrue 500 on /signup + /resend,
    signup rolled back, nothing stamped). The SMTP key stays the gate.
    Since 2026-11-18 the app also raises an operator incident
    (`signup_confirmation_email_failed` and siblings — owner/manager ops
    incident surface + `[autodine:alert]` logs) on the first such
    failure, so a recurrence is visible immediately instead of silent;
    do not re-enable the IP block to "test" this.
- [ ] C3. **Authentication → Rate Limits**: set the email-sent limit to
  **30/hour** (the custom-SMTP starting ceiling).
- [ ] C4. *Optional polish:* **Authentication → Emails → Templates** — paste
  `docs/operations/email-templates/confirmation.html` and `recovery.html`
  (never edit `{{ .ConfirmationURL }}`). Supabase defaults also work.

## Step D — deployment + webhook

- [x] D1. ✅ **Done (2026-11-18, owner-approved).** Brevo commits pushed to
  `arena/2670dd12-autodine` (remote tip `ab541ee`), PR **#191** open (not
  merged), Preview deployment `dpl_GnLaaimCs8H3DnUAr5UC7LBWr8M2` **READY**.
  Branch alias confirmed live:
  `new-git-arena-2670dd12-autodine-iamjarvis9896-3988s-projects.vercel.app`.
  Vercel **Deployment Protection stays ON**; the owner generated a
  **Protection Bypass for Automation** secret (value owner-held only).
- [x] D2. ✅ **Webhook created by owner 2026-11-18; Brevo test event
  returned HTTP 200** — the correct-secret path through Deployment
  Protection (bypass header + bearer credential + receiver processing)
  is proven live. Remaining: controlled email tests (Step E).
  Configuration used (for the record) — **Brevo → Transactional → Settings →
  Webhooks → Add a new webhook** (newer UI: Settings/Integrations →
  Webhooks → Create webhook → Transactional). Exact values:
  - **URL** = `https://new-git-arena-2670dd12-autodine-iamjarvis9896-3988s-projects.vercel.app/api/email/brevo/webhook`
  - **Custom headers — BOTH are required** (Brevo supports sending several):
    1. `x-vercel-protection-bypass` = your Vercel Protection Bypass for
       Automation secret (lets Brevo's POST through Vercel's SSO wall;
       without it the app is never reached — verified by agent probe).
    2. `Authorization` = `Bearer <the A4 secret>` (identical value to B4 /
       `BREVO_WEBHOOK_SECRET`). If the form instead offers an
       Authentication method, choose **Bearer/Token** with the same value
       and keep header 1 as a custom header. Never put either secret in
       the URL.
  - **Events** (dashboard labels): Delivered, Hard bounce, Soft bounce,
    Deferred, Blocked, Spam, Invalid email, Unsubscribed — plus *Error*
    and *Sent* if offered. (API names, if you create it via API instead:
    `delivered`, `hardBounce`, `softBounce`, `deferred`, `blocked`,
    `spam`, `invalid`, `unsubscribed`, `request`. Note: the API enum has
    `invalid`, not `invalidEmail`, and no `error` — both payload kinds
    are still classified by the receiver.)
  - **Batched webhooks: OFF.** The receiver accepts one event object per
    POST; a batched array is refused (400) by design.
  - Save/Activate, then use Brevo's **Send test** (if offered) — the
    delivery log should show **HTTP 200**. A 401 means header 2's value
    differs from B4; a Vercel login/401 page means header 1 is missing
    or wrong.

## Step E — tell the agent "Preview configured"

Then the agent verifies, with evidence: local test-send honesty checks already
pass; on your confirmation, the controlled tests run against **owner
mailboxes only** — invitation delivery, reply-to, webhook auth (wrong secret
refused, real `delivered` event recorded), Auth signup/resend/reset round
trips, and failure handling. **Nothing is "delivered" until an email is
actually received and checked** — Brevo's Transactional logs plus your inbox
are the proof, and results go into
`qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md`.
