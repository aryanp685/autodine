# Consolidated owner-action register — 2026-11-14

> **2026-11-14 post-staging update:** every item here is now expanded into
> exact steps, costs (known vs unknown), consequences, and post-action
> verification in `docs/owner-closure-package-2026-11-14.md` (ordered by
> urgency: Tier 1 free/risky-first → Tier 4 dispositions). The full migration
> accounting is in `docs/migration-manifest-2026-11-14.md` (92 migrations +
> 1 owner-operation). The credential exposure is scoped and remediated
> (working-tree) in `docs/credential-exposure-remediation-2026-11-14.md`.
> **B5 is CRITICAL-OPEN until rotation + verification complete.**

**Every action in this register is owner-only.** Each needs an account,
purchase, credential, approval, or physical presence the agent cannot supply.
Nothing here was performed. Ordering is by launch-blocking criticality, not by
convenience. Costs marked "unknown" are genuinely price-unverified — check the
provider's current pricing before committing.

Format: action → why → where (dashboard path) → cost → consequence if skipped
→ blocks → verification step.

---

## A. Release-blocking (must be done before/during release)

### A1. Production migration ledger fresh read-only probe
- **Why:** the 2026-11-14 listing ended at `20261112000100`; that is a listing boundary, not a completeness proof. Every release step assumes known drift D1–D7.
- **Where:** Supabase dashboard → project `bdbaqpevwmgdvghszjno` → Database → Migrations; or `supabase migration list --linked` from an authorized machine.
- **Cost:** free.
- **Consequence:** applying Batch A blind can double-apply renames/guards; incident risk on money paths.
- **Blocks:** the entire §2 sequence in `docs/production-release-prep-2026-11-14.md`.
- **Verify:** written ledger dump (names + order) attached to the release record; reconciled against `supabase/migrations/`.

### A2. Production backup / PITR verification (backup gate)
- **Why:** there is no verified hosted backup destination; rollback is impossible without one. Local restore drills do not count.
- **Where:** Supabase dashboard → project → Database → Backups (PITR if plan permits); or external dump to B2/R2 per `docs/backup-restore-runbook.md`.
- **Cost:** PITR requires Supabase Pro (paid, exact price unknown — check current plan pricing); external B2/R2 bucket ≈ free–few USD/month (unknown, provider-dependent); passphrase free.
- **Consequence:** an unrecoverable production mistake; NO-GO for launch stands.
- **Blocks:** release §2 step 1; the entire launch.
- **Verify:** run `docs/pitr-verification-procedure-2026-11-14.md` checkpoints P1–P6; record the restore-drill result and retention window.

### A3. Alert path: log drain + uptime monitor + one human phone
- **Why:** launch without paged alerts = silent outage; venue Wi-Fi + Realtime dependency guarantees degradation events.
- **Where:** Vercel project → Settings → Log drains (pick provider, e.g. BetterStack/Axiom); monitor `GET /api/health`; set `AUTODINE_ALERT_WEBHOOK`/`BACKUP_ALERT_WEBHOOK` on Vercel (Production env).
- **Cost:** BetterStack/Axiom free tiers exist; likely ₹0–500/month (unknown).
- **Consequence:** outages discovered by customers; slow incident response.
- **Blocks:** launch acceptance; post-release checklist.
- **Verify:** one real test alert fires, reaches the human, and is acknowledged; log attached to release record.

### A4. Cron secret + external scheduler
- **Why:** `/api/cron/escalate` fail-closes without `AUTODINE_CRON_SECRET`; Vercel Hobby allows only the daily `30 1 * * *` cron (re-adding sub-daily breaks deployment).
- **Where:** Vercel → Environment Variables (Production) set `AUTODINE_CRON_SECRET` to a fresh random value; if sub-daily escalation is needed, an external HTTPS scheduler (GitHub Actions scheduled workflow calling the endpoint with the secret, or cron-job.org/similar) — paid/free depending on provider (unknown).
- **Cost:** free (GitHub Actions within quota) or Vercel Pro if cron cadence needs it (paid, price unknown).
- **Consequence:** escalation alerts never fire; or deployment refusal if Hobby cron limits are violated.
- **Blocks:** escalation monitoring for launch.
- **Verify:** trigger the cron once with the secret and observe a 200; confirm unauthorized callers get 401; confirm missing secret yields 503.

### A5. Auth email: provider activation (Resend or alternative) + Supabase SMTP
- **Why:** password reset / staff invites are unreliable on the platform default sender (2/hr GoTrue limit). Launch without email = owners can be locked out.
- **Where:** decide provider (Resend / Brevo / Postmark / SendGrid); verify domain; SPF/DKIM/DMARC at DNS; Supabase dashboard → Authentication → SMTP Settings (staging `juwyhslzchjevqkdvwjm` first); raise GoTrue rate limit; Vercel env unchanged.
- **Cost:** Resend free tier 3,000/mo (verify current); domain already owned? (unknown); DNS changes free.
- **Consequence:** invite/reset flows effectively dead; support burden; risk of lockout at the worst time.
- **Blocks:** staff onboarding at launch; owner account recovery.
- **Verify:** with an authorized test mailbox: one confirmation email delivered, one password reset delivered, one invite redemption end-to-end on staging; then repeat once on production after release approval.

### A6. Staging billing sandbox rehearsal authorization (optional pre-launch)
- **Why:** the sandbox provider (`BILLING_PROVIDER=sandbox` + `AUTODINE_BILLING_SANDBOX=1`) exists but has never been rehearsed hosted; exercising it de-risks the webhook path.
- **Where:** Vercel preview/staging env (NOT production); `docs/subscription-billing-2026-11-10.md` + `docs/external-services-readiness-2026-11-14.md`.
- **Cost:** free (sandbox; no money moves).
- **Consequence:** first real webhook processed untested in production.
- **Blocks:** nothing (feature is off in production regardless); de-risks A7.
- **Verify:** synthetic checkout → webhook → entitlement flip observed on staging; logs show signature verification; zero live charges.

---

## B. Security hardening (P0, release batch #1–#10 in the prep doc)

### B1. Approve production application of branch migration set
- **Why:** D1–D7 drift: production lacks `immutable_restaurant_account_link`, owner-billing guard, account-reassignment audit, invite fall-through fix, trigger-EXECUTE revocation. Direct `restaurants.account_id` UPDATE is possible today.
- **Where:** Supabase dashboard → SQL editor or `supabase db push` from authorized machine, in the order in `docs/production-release-prep-2026-11-14.md` §2 (steps 1–6 and #1–#10). See `docs/production-only-migrations-2026-11-14.md` for per-file classification.
- **Cost:** free.
- **Consequence:** known authorization-boundary gaps remain open in production.
- **Blocks:** security sign-off for launch.
- **Verify:** post-apply catalog probe: trigger present, EXECUTE revoked for service_role/anon/authenticated, audit table exists and records a synthetic reassignment; `/api/health` ok:true.

### B2. `ADMIN_SECRET` rotation
- **Why:** pre-existing operational secret; rotation cadence is owner policy; rotation is risk-free if staged.
- **Where:** Vercel → Environment Variables (Production); rotate, redeploy, then verify admin-gated endpoints reject the old value.
- **Cost:** free.
- **Consequence:** stale credential exposure window persists.
- **Blocks:** security hygiene (not a hard launch gate).
- **Verify:** old secret rejected (401), new secret accepted; no request errors in first hour.

### B3. `QR_VERIFICATION_SECRET` review (readable-secret flag)
- **Why:** the secret gates QR verification; if flagged readable anywhere it must be regenerated and the flag cleared.
- **Where:** Vercel → Environment Variables; confirm server-only scope; if flagged, rotate and update verifiers.
- **Cost:** free.
- **Consequence:** forged QR verification material possible if the value leaks.
- **Blocks:** security hygiene (recommended pre-launch).
- **Verify:** fresh QR mint + verify round-trip works; old material rejected after rotation.

### B4. Supabase service-role / secret key hygiene check
- **Why:** legacy service_role keys bypass RLS; confirm the production project uses new `sb_secret_*` keys where supported and that no key appears in client bundles.
- **Where:** Supabase dashboard → Settings → API; Vercel env audit; `npm run lint`/`deployment-isolation.mjs` already guards the bundle.
- **Cost:** free.
- **Consequence:** full-database compromise if leaked.
- **Blocks:** security sign-off (recommended pre-launch).
- **Verify:** CI isolation guard green; key names match expectations; no secret-like strings in built assets.

---

### B5. Rotate the staging review credentials (leaked in Git history) — **CRITICAL-OPEN**
**Full scope, exposure map, rotation sequence and verification: `docs/credential-exposure-remediation-2026-11-14.md`. Do not reuse the retired values anywhere.**
- **Why:** the 2026-11-11/2026-11-12 docs committed a Vercel `_vercel_share` token and the shared password of the four synthetic staging review accounts. They are redacted from the working tree as of 2026-11-14, but **Git history retains them** — redaction is not remediation.
- **Where:** Vercel → deployment → Share → regenerate the link (or delete/recreate the share); Supabase dashboard → Authentication → Users on `juwyhslzchjevqkdvwjm` → reset passwords for owner/manager/kitchen/cashier@autodine-review.test.
- **Cost:** free.
- **Consequence:** anyone with repo read access can open the protected review deployment and sign in as any review role (staging data only; production untouched).
- **Blocks:** nothing production-side; do before sharing the repo more broadly.
- **Verify:** old share link returns "Protected Deployment"; old passwords rejected; new credentials reach an authorized reviewer only.

## C. Commercial / GST (separately authorized; likely post-launch)

### C1. Billing provider selection & certification (Razorpay or other INR provider)
- **Why:** online plan sales cannot be offered; `getBillingProvider()` always returns null by design.
- **Where:** provider onboarding (KYC, merchant account); adapter to the existing `BillingProvider` interface; certification against provider sandbox.
- **Cost:** provider account fees/KYC free; transaction fees per provider (unknown); engineering time for the adapter (days).
- **Consequence:** subscription revenue unavailable; pay-at-counter remains the only model.
- **Blocks:** online subscriptions — NOT required for a pay-at-counter launch.
- **Verify:** sandbox end-to-end: checkout → webhook → entitlement; then a written activation decision.

### C2. GST mode decision per tenant + adviser sign-off
- **Why:** tax rates/composition/ITC treatment are legal positions, not code choices; receipts are NOT GST tax invoices today.
- **Where:** CA/tax adviser; then per-restaurant GST mode in settings post-authorization.
- **Cost:** adviser fees (unknown).
- **Consequence:** incorrect GST collection; penalties; customer-facing tax documents invalid.
- **Blocks:** GST invoicing — NOT required if launching without GST tax invoices (explicitly out of scope today).
- **Verify:** adviser sign-off document; per-tenant mode set (never a silent default); sample bill reconciles.

### C3. GST/IRP migration authorization (Phase A/B) and e-invoice certification
- **Why:** 7 GST/IRP migration files exist but are NOT AUTHORIZED; e-invoicing legally required only above turnover thresholds for B2B.
- **Where:** Supabase (apply ONLY with written authorization); GSP (e.g. ClearTax/Masters India) sandbox → production; NIC IRP certification.
- **Cost:** GSP subscription (₹-unknown, typically annual, thousands of ₹); adviser fees; possible months of certification.
- **Consequence:** non-compliance for in-scope businesses; or over-engineering if out of scope.
- **Blocks:** e-invoicing/IRN — explicitly NOT required at launch; launch as non-e-invoice scope.
- **Verify:** each migration applied under separate authorization with replay+suite; NIC sandbox IRN generated for a synthetic B2B invoice; production activation separately approved.

### C4. Credit/debit notes UI decision
- **Why:** DB + actions exist; no UI; partial notes unsupported by design.
- **Where:** product decision; then scoped UI work (owner/manager role-gated).
- **Cost:** engineering time (unknown).
- **Consequence:** corrections to issued GST documents require full-document notes.
- **Blocks:** nothing at launch.
- **Verify:** UI ships with role-gate tests + adviser review of reason codes.

---

## D. Operations & DR

### D1. Backup destination + hosted scheduler
- **Why:** `scripts/backup/*` is implemented and selftested but has no destination; a backup that never runs does not exist.
- **Where:** B2 or R2 bucket (private, lifecycle rules); host cron (GitHub Actions scheduled workflow or a small VM) with `AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `BACKUP_ALERT_WEBHOOK` pointing at an **isolated non-production restore target** for drills.
- **Cost:** B2/R2 free tier likely sufficient initially (unknown); VM ~free–₹500/month.
- **Consequence:** data loss unrecoverable; backup alerts meaningless.
- **Blocks:** backup gate (A2 depends on this).
- **Verify:** one full scheduled run observed; restore into the isolated target drills green; alert fires on a forced failure.

### D2. Hosted PITR restore drill (real, not local)
- **Why:** local cold/physical drills passed; hosted PITR has never been exercised.
- **Where:** per `docs/pitr-verification-procedure-2026-11-14.md` (P1–P6) against the production project with owner present.
- **Cost:** PITR restore is included with Pro plan; possible compute cost during drill (unknown).
- **Consequence:** RPO/RTO unknown; launch with no recovery story.
- **Blocks:** backup gate.
- **Verify:** checkpoints P1–P6 recorded with timestamps and fingerprint match.

### D3. Uptime monitor + status page (external)
- **Why:** customers and staff need a truthful source during incidents.
- **Where:** BetterStack/UptimeRobot etc. pointed at `https://<domain>/api/health`; status page optional.
- **Cost:** free tiers available (unknown limits).
- **Consequence:** support burden during outages; no SLO evidence.
- **Blocks:** launch acceptance (recommended).
- **Verify:** monitor shows live data; one simulated failure pages the owner.

### D4. Domain + DNS (if not already on a custom domain)
- **Why:** production must serve from `autodine.in` (or chosen apex); email DKIM/SPF/DMARC depend on the same zone.
- **Where:** Vercel → Domains → add domain; set A/ALIAS/CNAME at registrar; then `NEXT_PUBLIC_SITE_URL`/`SITE_URL` update + redeploy.
- **Cost:** domain registration ₹800–1,500/yr (unknown); DNS free.
- **Consequence:** Vercel preview URLs leak into emails/links; brand/deliverability suffer.
- **Blocks:** public launch (obviously), email activation (A5).
- **Verify:** HTTPS green on apex; `/api/health` ok:true on the domain; email auth checks pass (mail-tester or equivalent).

### D5. Incident ownership + runbook adoption
- **Why:** `docs/backup-restore-runbook.md`, `OPERATIONS-READINESS.md` exist; no named human is on call.
- **Where:** pick the on-call human; document escalation path in the release record; link `[autodine:alert]` prefix convention.
- **Cost:** free.
- **Consequence:** alerts fire into the void.
- **Blocks:** launch acceptance.
- **Verify:** on-call reachable by phone; ack flow tested once.

---

## E. PR #181 disposition (no merge without your explicit decision)

- **State:** OPEN, CI green (2026-11-13), head `arena/01715497-autodine`, base `main`, mergeable UNKNOWN, never merged or modified by this branch.
- **What it is:** owner-only billing-configuration UI/actions + DB guard + readiness doc updates. Its guard file collided with this repo's `20261112000200_immutable_restaurant_account_link.sql`; this branch carries the same guard at `20261115000200` (service_role EXECUTE also revoked).
- **What it does NOT do:** enable GST, change receipts, touch snapshots.
- **Decision needed:** close as superseded (recommended — its useful content ships via this branch's `20261115000200` + owner-billing UI already on this branch? VERIFY first: confirm which settings/actions.ts changes, if any, are missing from this branch before closing), or merge (would deploy production on merge — requires full release approval).
- **Verify before closing:** diff PR #181's `settings/actions.ts` + `SettingsScreen.tsx` against this branch; any unique fix must be ported or explicitly dropped by you.

---

## F. Cost summary (honest ranges)

| Item | Cost class |
|---|---|
| Domain + DNS | paid, low (annual) |
| Supabase Pro (PITR) | paid (exact price unknown — check dashboard) |
| Backup destination B2/R2 | free–low monthly |
| Uptime/log provider | free tier likely; low monthly |
| Resend (email) | free tier likely sufficient (verify limits) |
| External scheduler | free (GitHub Actions) or Vercel Pro (paid) |
| GST/IRP GSP + adviser | paid, potentially recurring annual |
| Billing provider (Razorpay) | KYC free; per-transaction fees |
| Vercel Pro (if cron cadence or limits require) | paid (unknown) |

Unknowns are genuinely unknown from this workspace; do not treat the ranges as
quotes. Get current pricing from each provider before approving spend.

## G. Product decision required

### Quantity > 99 in guest orders
`20261021000005_public_place_order.sql` documents a 1–99 bound; the implementation caps at 99. Decide: keep cap (Option A), reject >99 (Option B — I can implement on word), or raise the bound (Option C — needs business reason). See `docs/owner-closure-package-2026-11-14.md` Tier 3. Decision pending; current cap preserved; do not "fix" silently.
