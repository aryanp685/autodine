# Owner closure package — every remaining action, executable (2026-11-14)

Companion to `docs/owner-action-register-2026-11-14.md` (the index) and
`docs/execution-report-2026-11-14.md` (the baseline). This file turns each
remaining register item into steps you can execute and verification that can
run afterwards. **Nothing here was executed. No production access was made.**

Order = urgency. "Arena verifies" steps are read-only (repo/CI/Vercel metadata
or checks you explicitly authorize); "You do" steps need your account, purchase
or decision. Costs marked *unknown* are genuinely unquoted — check current
pricing before approving.

---

## Tier 1 — do this week (free, closes real risk)

### B5 — Rotate the exposed review credentials · CRITICAL
**You do:** full sequence in `docs/credential-exposure-remediation-2026-11-14.md`
§4 (Vercel confirm/revoke share on the deleted review deployment; delete or
reset passwords of the four `*@autodine-review.test` staging accounts; habit
check for password reuse).
**Arena verifies:** tree/history grep shows no retired literals (done for tree;
re-run after your action); deployment remains 404; reviewer sign-in with the old
password fails (you confirm).
**Cost:** free. **If skipped:** any repo reader can sign in to staging as any
review role and bypass the preview wall (staging data only; production unaffected).
**Blocks:** security sign-off; nothing else technically.

### B2 — `ADMIN_SECRET` review & rotation
**You do:** Vercel → project `new` → Settings → Environment Variables →
Production → inspect `ADMIN_SECRET`: if set, rotate (generate new random value,
update, redeploy Production only when you approve release; until then rotate in
Preview). If unset, decide whether any admin endpoint is reachable and set one.
Confirm no other env var grants admin.
**Arena verifies:** admin routes return 401/403 to a bad token (offline route
test exists in `e2e`/`lib/*.test.ts` — CI green); after your rotation,
`grep` the built repo for the old value's shape? (cannot — value unknown);
instead: you attempt one authorized admin call with the old secret → expect
401.
**Cost:** free. **If skipped:** stale admin credential window persists.
**Blocks:** security hygiene gate.

### B3 — `QR_VERIFICATION_SECRET` review & rotation
**You do:** Vercel → Environment Variables → Production → find
`QR_VERIFICATION_SECRET`. Confirm it is **not** exposed to `NEXT_PUBLIC_*`
(it is not, by CI guard). If it is flagged "readable"/"sensitive-off" in the
dashboard, or older than 12 months, or was ever pasted into chat/tickets:
rotate it (update env → redeploy). Note: QR tokens minted before rotation
will fail verification — acceptable if no live printed QR uses it yet
(pre-launch: none do).
**Arena verifies:** after rotation you mint+verify one QR through the app
(or staging admin) — expect success; CI guard `deployment-isolation` green;
`/verify` route unit tests pass (they do; do not re-run unless asked).
**Cost:** free. **If skipped:** forged QR verification material possible if the
value ever leaked.
**Blocks:** security hygiene gate.

### A4 — `AUTODINE_CRON_SECRET` + scheduler
**You do:** (1) Generate a fresh random secret (e.g. `openssl rand -hex 32`);
(2) Vercel → Settings → Environment Variables → Production → set
`AUTODINE_CRON_SECRET`; (3) Confirm Production cron `30 1 * * *` exists (it does
— `vercel.json`, Hobby-legal). (4) If you want escalation checks more often
than daily: create an external HTTPS scheduler — either a scheduled GitHub
Actions workflow calling `https://<domain>/api/cron/escalate` with header
`Authorization: Bearer <secret>`, or a free cron service. Hobby Vercel cannot
run sub-daily crons — do not re-add one to `vercel.json`.
**Arena verifies:** after you set it: one authorized call with the secret
returns 200 (you run it, or authorize me); `get_deployment` shows the cron
registered; unauthorized call returns 401; missing secret would return 503
(fail-closed proof exists in route tests, CI green).
**Cost:** free (GitHub Actions within quota) or provider-dependent (unknown).
**If skipped:** escalation alerts silently never fire.
**Blocks:** escalation monitoring for launch.

### A1 — Fresh production ledger probe (read-only)
**You do:** from an authorized machine (or the Supabase SQL editor) run, against
`bdbaqpevwmgdvghszjno`, **read-only**:
`select version, name from supabase_migrations.schema_migrations order by version;`
and `select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('operational_schema_readiness','guard_restaurant_billing_configuration','audit_restaurant_account_reassignment','immutable_restaurant_account_link','public_restaurant_profile','account_can_write');`
and the D1–D7 probes in `docs/production-release-baseline-2026-11-14.md` §3–4.
Paste the output (no row data, names only) into a file attached to the release
record — never into chat.
**Arena verifies:** reconciliation against `docs/migration-manifest-2026-11-14.md`:
all versions ≤ boundary present/absent as expected; the 9 branch-set files
absent (unless you authorized B1); GST/IRP seven absent. I produce the delta
table; you approve the apply plan.
**Cost:** free. **If skipped:** §2 of the release prep cannot be executed safely —
the "28-migrations-behind" baseline is three weeks stale.
**Blocks:** everything in the release sequence.

---

## Tier 2 — before any production release gate is signed

### A2/D1/D2 — Backup & PITR (the release blocker)
**You do:**
1. Choose destination: (a) Supabase Pro PITR on `bdbaqpevwmgdvghszjno`
   (Dashboard → Database → Backups), or (b) external encrypted dump to
   Backblaze B2 / Cloudflare R2 via `scripts/backup/*` on a host you control
   (scheduled). Exact price for (a): **unknown** — check the plan page; B2/R2
   free allowances typically cover small DBs (verify current limits).
2. Generate `AUTODINE_BACKUP_PASSPHRASE` (keep in password manager; **never**
   in Vercel/GitHub secrets shared with the app env — backup runner only).
3. Schedule the backup runner (GitHub Actions scheduled workflow or VM cron)
   with `AUTODINE_BACKUP_SOURCE_URL` (read-only connection), passphrase, and
   `BACKUP_ALERT_WEBHOOK`.
4. **Restore drill (D2):** restore the latest backup to an **isolated
   non-production** target (new Supabase project `autodine-restore-drill` or a
   local embedded cluster) per `docs/pitr-verification-procedure-2026-11-14.md`
   (P1–P6). Never into production, never over staging.
5. Record: backup timestamp, restore duration, fingerprint match (tables/
   policies/functions counts), retention window, RPO/RTO you accept.
**Arena verifies:** after the drill, run `npm run test:dr` locally with the
drill archive (16/16 expected); reconcile the drill fingerprints against the
manifest; review your P1–P6 record for completeness. (I cannot open your
databases.)
**Cost:** unknown (Pro plan exact price not visible from here); drill compute
minimal. **If skipped:** data loss is unrecoverable; NO-GO stands.
**Blocks:** release §2 step 1; launch.

### B1 — Approve + apply the branch migration set (post-A1 only)
**You do:** after A1, approve application of the 9 branch-set migrations
(`20261112000200` … `20261115000300`) in filename order, **excluding** the 7
GST/IRP files. Execution path: `supabase db push` from an authorized machine,
or SQL editor, with a verified backup first (A2). Each step: apply → verify
health → record ledger high-water.
**Arena verifies:** post-apply, you run (or authorize me to run) the catalog
probes: `guard_restaurant_billing_configuration` + trigger present;
`service_role` EXECUTE = false on trigger functions;
`audit_restaurant_account_reassignment` ledger exists; invite fix present;
`/api/health` ok:true. Replay stays green in CI.
**Cost:** free. **If skipped:** production keeps known P0 authorization gaps
(D1, D6) and the invite fall-through bug.
**Blocks:** security sign-off for launch.

---

## Tier 3 — commercial & operational prerequisites

### A3 — Alert webhook + human recipient test
**You do:** pick a log drain + uptime monitor (BetterStack / Axiom / Logtail —
free tiers exist, limits unknown; verify). Create an incoming webhook to a
channel you actually read (Slack/Discord/phone-bridge). Set
`AUTODINE_ALERT_WEBHOOK` and `BACKUP_ALERT_WEBHOOK` on Vercel (Production)
and in the backup runner. Point the monitor at `https://<domain>/api/health`,
alert after 2 consecutive failures. Then fire **one real test** (stop the
staging app? No — call the monitoring test endpoint or trigger a backup
selftest failure) and confirm a human phone buzzed.
**Arena verifies:** `lib/incident-notify.ts` unit tests green (CI); after your
test, the webhook URL receives the `[autodine:alert]`-prefixed payload
(you confirm or authorize me to inspect delivery logs); monitor history shows
the synthetic failure and recovery.
**Cost:** free tier likely; paid upgrades optional (unknown). **If skipped:**
silent outages; staff discover downtime from customers.
**Blocks:** launch acceptance.

### A5 — Resend (or alternative) + Supabase SMTP
**You do:** (1) Create Resend account (or Brevo/Postmark — interchangeable);
verify your sending domain; publish SPF/DKIM/DMARC records at your DNS;
(2) Supabase staging → Authentication → SMTP: host smtp.resend.com, port 465/587,
user `resend`, password = API key; sender e.g. `noreply@<domain>`; (3) raise the
GoTrue rate limit above the 2/hr default; (4) with an authorized test mailbox:
send one confirmation, one password reset, one staff invite; redeem the invite;
(5) repeat on production only after release approval; (6) record message IDs
in the release record.
**Cost:** Resend free tier 3,000 emails/mo *(verify current)*; domain
registration if absent (unknown, ₹800–1,500/yr class, unverified); DNS free.
**If skipped:** owners cannot reset passwords; invites die; support implodes on
day one. **Blocks:** staff onboarding; owner recovery.
**Arena verifies:** staging auth-acceptance probes green (already, synthetic);
after your config, you paste message IDs; I check they show "delivered"/
"opened" in the provider dashboard only if you share screen/exports — I cannot
open them otherwise.

### C1 — Billing provider selection & certification
**You do:** choose INR provider (Razorpay is the incumbent for Indian UPI/cards;
Cashfree/PhonePe alternatives). Onboard: business KYC, merchant account, API
keys, webhook secret → set `BILLING_PROVIDER=razorpay` + `BILLING_WEBHOOK_SECRET`
on **staging first**; keep `AUTODINE_BILLING_SANDBOX` semantics intact; keep
production **off** until certification. Contract an adapter for the existing
`BillingProvider` interface (someone must write it — likely days of work); run
provider-sandbox certification with synthetic cards; then decide production
activation in writing. Until then, pay-at-counter is the only money model —
that is an accepted limitation, not a bug.
**Cost:** KYC free; per-transaction fees per provider (unknown — published rate
cards, typically ~2% + GST for UPI/cards; verify); adapter engineering days.
**If skipped:** no online subscription sales; launch as pay-at-counter only.
**Blocks:** online revenue — not launch.

### C2/C3 — GST adviser & GST/IRP authorization
**You do:** (1) Engage a CA/tax adviser: composition vs regular, 5% (no ITC) vs
specified premises 18%, place-of-supply, e-invoice turnover threshold for your
volumes, treatment of the ₹999/₹2,699/₹3,699 plans' subscription invoices;
(2) per-restaurant GST mode decision (never a silent default); (3) if e-invoice
applies: choose a GSP (ClearTax/Masters India class), sign the agreement
(annual fee, **unknown**), NIC sandbox credentials, certification, then
production activation — each of these is a separate written approval;
(4) separately authorize (or don't) the 7 Phase B files listed in
`docs/migration-manifest-2026-11-14.md` and the owner-operation file under
`supabase/owner-operations/`.
**Cost:** adviser fees (unknown); GSP subscription (unknown, recurring);
certification time (weeks-months).
**If skipped:** no GST tax invoices (legality depends on your registration and
thresholds — the adviser decides you must do this, or explicitly don't).
**Blocks:** GST invoicing only; launch as non-GST scope is legitimate.

### D4 — Domain & DNS cutover
**You do:** register/choose apex (e.g. `autodine.in`); Vercel → Domains → add;
set A/ALIAS + CNAME at registrar; verification TXT if challenged; then update
`NEXT_PUBLIC_SITE_URL`/`SITE_URL` (Production) and `NEXT_PUBLIC_AUTODINE_DEPLOY_ENV=production`;
redeploy **only with release approval** (this step is part of the release, not
pre-release); SSL is automatic (Let's Encrypt via Vercel); confirm DKIM/SPF/DMARC
for the sending domain (aligns with A5).
**Cost:** domain ₹800–1,500/yr (unverified); DNS free. **If skipped:** preview
URLs leak into emails/receipts; deliverability and brand suffer.
**Blocks:** public launch (obviously) — not staging.

### Decision — quantity greater than 99 (product, business)
**The question:** `20261021000005_public_place_order.sql` documents quantities
bounded 1–99, but the implementation **caps** any quantity above 99 at 99.
Capping may be intentional. Choose, in writing:
- **Option A (keep cap):** no code change; document the actual contract;
  kitchen sees max 99 per line; simplest; some guest confusion possible.
- **Option B (reject >99):** change public-order validation to refuse the
  submission with a clear message; stronger contract honesty; guests editing a
  cart with >99 need guidance; requires a code change + test updates (I can
  do this on approval).
- **Option C (raise the bound):** e.g. 1–500; changes UI hints, kitchen
  expectations, and validation everywhere; needs explicit business reason.
**You decide; I implement and test on your word** (Option B ≈ 1 focused
commit + suite updates; I will not pick one myself).
**If never decided:** behavior stays cap-at-99 (current, documented, safe).
**Blocks:** nothing technically; blocks product-spec sign-off.

---

## Tier 4 — dispositions

### PR #181 — decide, never merge blindly
**State:** OPEN; CI green (2026-11-13); head `arena/01715497-autodine`; **its
unique code content (owner-only billing UI/actions + test) is already on this
branch**; unique doc-redaction content is superseded by `1193327`. Its DB guard
ships here renumbered at `20261115000200`.
**Recommended:** close with a comment citing supersession — after you confirm
no doc delta matters to you. If you merge instead: production deploys on merge;
requires the full release gate and your written approval.
**Cost:** free either way. **Blocks:** nothing; keeps history legible.

### GST/IRP authorization record
**You do, once:** write into the release record either
"Phase B (7 files B1–B7) is NOT AUTHORIZED; do not apply" or attach dated
authorizations per file. **Absent an explicit document, the default is closed.**

---

## Verification commands you can paste to me after acting

For each item you complete, tell me (or paste): A1 → ledger dump file
(names only); A2 → P1–P6 record; A3 → monitor screenshot/log of one test
alert; A4 → the 200 response of your authorized cron call; A5 → message IDs
+ delivery status; B2/B3 → "rotated at <timestamp>"; B5 → done sign-off.
I will then reconcile against `docs/migration-manifest-2026-11-14.md`,
re-run `npm run verify:release`, and update the GO/NO-GO section of
`docs/execution-report-2026-11-14.md` accordingly — without dispatching any
workflow.
