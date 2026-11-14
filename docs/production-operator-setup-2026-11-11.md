# Production operator setup — 2026-11-11

> **Status updated 2026-11-12 from the hand-off report.** This checklist predates the reported production rollout and must not be used to rerun migrations. A local production-dump restore rehearsal is recorded as complete; production backup/PITR settings remain unverified. SMTP/email delivery and its rate limit remain pending. The hand-off report is the latest recorded source; this branch did not re-query production.

The remaining operator setup items require Supabase/provider dashboards. Do not
put SMTP credentials in chat or configure delivery until explicitly requested.
The migration plan and deployment rows below are historical, not pending actions.

Target project: **`autodine-production`**, ref `bdbaqpevwmgdvghszjno`, live at
`https://new-alpha-five-43.vercel.app`.

---

## Part A — Backups and PITR (required before any production migration)

Why this comes first: Batch A revokes grants and replaces function bodies. A
later forward migration cannot undo a revoked grant. If something goes wrong,
the only way back is a restore.

**Do not write new backup commands — this repository already has a vetted one:**

→ **[`PRODUCTION-BACKUP-RUNBOOK.md`](../PRODUCTION-BACKUP-RUNBOOK.md)**

Follow it end to end. It is deliberately stricter than a plain `pg_dump`:

- it runs the dump and the restore inside Docker containers, so no unsupported
  client has to be installed locally;
- it uses the **session pooler** (port 5432) or a direct connection, never the
  transaction pooler (6543), which `pg_dump` does not work correctly through;
- it restores into a **network-isolated disposable container**, so a restore
  test can never reach production;
- it asks for only sanitised results back — never passwords, connection strings,
  dump contents or customer records.

Two things the runbook says that are worth repeating here:

- A successful restore is **not guaranteed** on vanilla PostgreSQL. Supabase
  extensions, managed schemas and roles referenced by policies may need a
  compatible isolated Supabase environment. If the restore fails, stop and
  report the sanitised first error — do not add exclusions to force a success.
- The dump does **not** cover Storage objects, provider configuration or Edge
  Function secrets.

### Also check platform backups

Dashboard → **autodine-production** → **Database** → **Backups**

- [ ] Are daily backups enabled, and what is the retention?
- [ ] Is PITR offered on this plan? (It is a paid-plan feature. If the project
      is on the free plan it will not be available, and the runbook dump above
      is your only safety net.)

If PITR is available, enable it **and rehearse one restore** before saying yes.
A PITR setting you have never restored from is not a backup.

### Confirm back to me

Send only high-level results — no passwords, no connection strings, no dump
contents:

- [ ] The runbook dump completed, and `pg_restore --list` produced a non-empty
      listing (a few-hundred-byte file is a failed dump, not a backup)
- [ ] The isolated restore either succeeded, or failed with a sanitised error I
      can look at
- [ ] Daily backups and PITR status noted above

This was the safeguard for the pre-rollout checklist. The later 2026-11-12 hand-off records the rollout as complete; any future production mutation still requires a current backup/recovery check and separate approval.

---

## Part B — Transactional email (fixes password reset and staff invites)

### The problem, measured

Production auth configuration:

| Setting | Value | Consequence |
|---|---|---|
| `smtp_host` | `null` | No custom SMTP; falls back to the platform sender |
| `rate_limit_email_sent` | `2` | **2 emails per hour** |
| `mailer_autoconfirm` | `true` | Signup needs no email, so signup works |

Signup works. **Password reset and staff invitations both need an email that is
rate-limited to two per hour.** For one restaurant that is survivable; for real
customers it is not.

### B1. Recommended order: do staging first

Configure SMTP on **`autodinetest`** (`juwyhslzchjevqkdvwjm`) first and tell me
when it is done. I can then exercise the reset and invite flows end to end on
staging and show you real evidence before anything touches production.

### B2. Configure custom SMTP

Dashboard → **Project Settings** → **Authentication** → **SMTP Settings**

- [ ] Enable **Use Custom SMTP**
- [ ] Host, port, username, password from your provider
- [ ] Sender email on a domain you control, with SPF and DKIM configured
- [ ] Save, then use **Send test email**

Any SMTP provider works — Resend, Brevo, Postmark and SendGrid are all
reasonable; use whichever you already have. Typical settings are port **587**
with STARTTLS, or **465** with implicit TLS.

### B3. Raise the email rate limit

Dashboard → **Authentication** → **Rate Limits** → email sending

- [ ] Raise it well above `2`

**Custom SMTP alone does not raise GoTrue's own send limit.** These are two
separate settings and both are needed. This is the step most likely to be
missed.

### B4. Then decide about email verification (your call, not mine)

Production has `mailer_autoconfirm: true`, which means **addresses are never
verified** — anyone can sign up with an address they do not own.

Once email delivery works you will probably want to turn this off. I have left
it alone deliberately: it changes behaviour for everyone who signs up
afterwards, so it is a product decision, not a bug fix. Say the word and I will
change it.

---

## Summary

| Item | Owner | Latest recorded status |
|---|---|---|
| A — production dump / isolated local restore | operator | **Local dump and restore rehearsal recorded complete; current provider backup/PITR settings still unverified** |
| B — SMTP + email rate limit | operator | **Pending by instruction** |
| Batch A (27 migrations) | engineering | **Reported complete in 2026-11-12 hand-off; do not rerun from this checklist** |
| Deploy application | engineering | **Reported complete in 2026-11-12 hand-off; do not redeploy from this checklist** |
| Batch B (`restaurants_member_only`) | engineering | **Reported complete in 2026-11-12 hand-off; do not rerun from this checklist** |
