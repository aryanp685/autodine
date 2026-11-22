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

## ★ ONE CONSOLIDATED OWNER SESSION (2026-11-16) — do everything below in one sitting

Supersedes the per-item sequencing in the tiers below (details stay there).
Verified baseline for this session: branch `arena/2670dd12-autodine`, HEAD
`d8d0e52` (= release candidate `5b8a447` + 2 doc commits), full local battery
green (2448 unit tests passed / 0 failed; typecheck, lint, build, migration
chain 92, `verify:release` 28/28, backup selftest ALL PASS, DR 16/16,
D2 ACL 2/2). B5 CLOSED. B3 branch-scoped `readable-secret` entry deleted by
owner and confirmed gone (2026-11-16 metadata re-check: no `readable-secret`
flag on any of the 17 env entries). **Production remains NO-GO** until the
gates in Session C close.

### Session A — Vercel (project `new`, one visit, ~20 min, all free)

`vercel.com` → team `iamjarvis9896-3988's projects` → project `new` →
**Settings → Environment Variables**. Do all of these *before* any redeploy,
so one redeploy carries them all:

| # | Key | Action | Type | Target |
|---|---|---|---|---|
| A-1 (B2) | `ADMIN_SECRET` | Edit existing → fresh `openssl rand -hex 32` (password manager only) | Sensitive (already) | Production (already) |
| A-2 (B3) | `QR_VERIFICATION_SECRET` ×2 | Edit Production and Preview entries to **two different** fresh `openssl rand -hex 32` values | Sensitive (already) | Production / Preview (already) |
| A-3 (A4) | `AUTODINE_CRON_SECRET` + `CRON_SECRET` | Add **both**, **same** fresh `openssl rand -hex 32` value | Sensitive | Production only |
| A-4 | (decision) | `ADMIN_SECRET` stays Production-only (recommended) — no Preview/Dev admin tool | — | — |

Then: **do not redeploy yet** unless you are approving the release deploy
itself — env edits are inert until the next Production deployment, and that
deployment is a separately approved act. When you do redeploy, afterwards run
(from your machine, values never in chat): B2 checks (old → 401; new +
non-existent restaurant → 400), A4 checks (no header → 401; correct Bearer →
200 `staleAfterMinutes:15`). Report status codes only.
Parallel-safe: A-1/A-2/A-3 are independent. Sequence-bound: all verifications
come after the one redeploy. Rollback for every row: re-edit to the previous
value from your password manager and redeploy (keep old values until the new
ones verify, then delete them).

### Session B — Supabase (two projects, one visit, ~15 min, free, read-only)

1. **Production `autodine-production` (`bdbaqpevwmgdvghszjno`) → SQL Editor
   → + New query** — confirm the project name twice before running. Run
   probe 1, export the grid; new tab, probe 2, export. SELECT-only:

   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('operational_schema_readiness','guard_restaurant_billing_configuration','audit_restaurant_account_reassignment','immutable_restaurant_account_link','public_restaurant_profile','account_can_write');
   ```

2. **`autodinetest` (`juwyhslzchjevqkdvwjm`)**: nothing required. (Optional,
   same visit: Authentication → SMTP stays untouched until Session C email
   approval.)
Return: both exports (versions/names only, no secrets, no row data) + run
timestamp. Arena then reconciles against the 92-migration manifest
(76 legacy · 9 branch-set pending B1 · 7 GST/IRP NOT AUTHORIZED — any of the
7 appearing is stop-the-line) and returns the D1–D7 delta. **B1 migration
approval is decided only after that reconciliation, in the same reply
thread** — the 9-file branch set, in order, is:
`20261112000200, 20261112000300, 20261112000400, 20261112000500,
20261112000600, 20261112000700, 20261115000100, 20261115000200,
20261115000300` (filename order; owner-operation
`20261110000501_revoke_supabase_admin_client_defaults.sql` stays separate
and is never auto-applied; rollback = restore-from-backup, hence Session C
backup first).

### Session C — external providers & paid gates (one decision block, approvals collected once)

Nothing below is pre-approved by this packet; give one yes/no per line:

| # | Gate | Selected architecture / procedure | Verified cost (2026-11-16, third-party pricing reports — re-check at purchase) | Unknown |
|---|---|---|---|---|
| C-1 (A2/D1/D2) | Backup/DR | **Selected:** external encrypted logical backup (`scripts/backup/*`, selftest ALL PASS locally) → private **Backblaze B2** bucket, scheduled runner (GitHub Actions or small VM), retention **14 daily / 8 weekly / 6 monthly**, passphrase only in password manager (never in Vercel/GitHub app env), restore **only** to an isolated non-production target; Supabase Pro daily backups as second layer if/when Pro is bought. **Deferred:** Supabase PITR (finer RPO) until pilot revenue justifies it | B2 ≈ $0.006–0.007/GB-mo, 10 GB free tier; this DB is far below 1 GB → effectively **₹0–100/mo** [2](https://devopsboys.com/blog/cloudflare-r2-vs-aws-s3-vs-backblaze-b2-2026) | Exact B2 bill; VM cost if used (GitHub Actions within free quota = ₹0) |
| C-2 | PITR (optional upgrade) | Supabase Pro $25/mo + PITR add-on **$100/mo per 7-day window** [1](https://backupdrill.com/compare/supabase-pitr) [3](https://www.bytebase.com/blog/supabase-vs-aws-pricing) | Known-approximate; confirm in dashboard | — |
| C-3 (A3) | Alerting | `AUTODINE_ALERT_WEBHOOK` + `BACKUP_ALERT_WEBHOOK` → a chat webhook you actually read (code complete, unit-tested); uptime monitor on `/api/health` (BetterStack/UptimeRobot free tier); **one real test alert to one named human phone** | Free tiers exist | Paid tiers if outgrown |
| C-4 (A5) | Email | Resend → verify domain → SPF/DKIM/DMARC → Supabase **staging first** SMTP (host `smtp.resend.com`, user `resend`, key as password) + raise GoTrue limit → one confirmation + one reset + one invite to an authorized mailbox → production repeat only after release approval. Rollback: revert SMTP to platform default in the same dashboard screen | Resend Free 3,000/mo (100/day cap), Pro $20/mo 50k [1](https://smtpedia.com/platforms/resend/pricing/) | Domain cost if not owned (₹800–1,500/yr class) |
| C-5 (C1) | Billing | **Stay disabled.** If activated later: Razorpay (₹0 setup/AMC, ~2% + 18% GST per domestic txn, ~3% international [1](https://scalesaathi.in/guides/razorpay-charges/)); Cashfree = comparable MDR class. KYC: PAN, GSTIN (if any), bank proof, business registration, authorised-signatory ID — confirm exact list at onboarding. Adapter = days of engineering against the existing `BillingProvider` interface; sandbox certification first; offline sandbox in repo already passes | Per-transaction % only | Negotiated rates; adapter effort |
| C-6 (C2/C3) | GST/IRP | Adviser engagement + written per-tenant mode decisions before any code/migration; the 7 Phase B migrations remain **NOT AUTHORIZED**; no IRP provider; applicability (₹5 cr AATO) fails closed | — | Adviser fees; GSP annual fee |
| C-7 (D4) | Domain/DNS | Register apex (e.g. `autodine.in`) → Vercel Domains → DNS at registrar → `NEXT_PUBLIC_SITE_URL` update **as part of the approved release deploy**, never before | ₹800–1,500/yr (registrar-dependent, unverified) | Exact registrar price |
| C-8 (Qty) | Quantity >99 | **Recommendation: Option A — keep the cap at 99** (see register §G evidence: DB `least(greatest(qty,1),99)`, cart `MAX_QTY=99` + tests, and the kitchen announcer only speaks numbers 0–99, so raising breaks TTS; no recorded business need). Decision needed in writing; no code change under Option A | Free | — |

### Evidence to return (one message, no secret values ever)

1. Session A: "done + timestamp" per row; B2 two status codes (401/400);
   A4 two status codes (401/200).
2. Session B: two probe exports + run timestamp.
3. Session C: one yes/no per line (C-1…C-8); for C-1 after setup, the
   P1–P6 record from `docs/pitr-verification-procedure-2026-11-14.md`
   adapted to the B2 drill (backup timestamp, restore target, duration,
   fingerprint counts match, retention set).
4. Anything that fails: the exact error class, never a value.

Arena then: reconciles A1, updates D1–D7/B1, re-verifies env metadata,
re-runs `npm run verify:release`, and issues the updated GO/NO-GO. Local
commands behind this packet (all green 2026-11-16): `npm test`
(2448 passed/212 skipped), `npm run typecheck`, `npm run lint`,
`npm run build` (demo-build env), `npm run migrations:verify`,
`npm run sql:check`, `npm run design:check`, `npm run test:backup`,
`npm run test:dr`, `npm run test:d2`, `npm run test:staging:guards`,
`npm run isolation:verify`, `npm run verify:release`.

---

## Tier 1 — do this week (free, closes real risk)

### B5 — Rotate the exposed review credentials · **DONE 2026-11-16**
**Done:** owner completed `docs/credential-exposure-remediation-2026-11-14.md`
§4 — C1 old share link dead (404/Protected/Revoked; Vercel API confirms the
deployment is gone) and C2 closed by Option A (all four
`*@autodine-review.test` accounts deleted; old password rejected for all four;
current staging alias working). Arena verified read-only: `auth.users` count
for that domain = 0, tracked-tree scan clean, `verify:release` 28/28,
staging guards 25/25, no staging suite dispatched. Full record: §5.1 of the
remediation doc.
**Cost:** free (spent). **Blocks:** nothing — this gate is cleared. History
rewrite remains optional and was not performed.

### B2 — `ADMIN_SECRET` review & rotation
**Inspected (2026-11-16, metadata only):** exactly one entry — `sensitive`,
**[production] only**, no `readable-secret` flag; absent in preview/development
(so there is nothing to "rotate in Preview": the admin tool is production-only
until you decide to add distinct preview/dev values). Sole consumer is the
trial-renewal tool (`lib/admin-auth.ts` → `admin_set_subscription`); no other
env var grants admin. Dashboard steps, interruption analysis and the
no-real-renewal verification (old → 401; new + non-existent restaurant → 400)
are in the owner-action register (B2).
**You do:** Vercel → project `new` → Settings → Environment Variables →
Production → `ADMIN_SECRET` → Edit → fresh `openssl rand -hex 32` (≥32 chars,
else fail-closed) → save → redeploy Production **only on your release
approval** (rotation is inert until redeploy).
**Arena verifies:** metadata (updated-at/type/targets) + your two reported
status codes. No value is ever printed or pasted.
**Cost:** free. **If skipped:** stale admin credential window persists.
**Blocks:** security hygiene gate.

### B3 — `QR_VERIFICATION_SECRET` review & rotation
**Correction (2026-11-16, code-verified):** this secret does not sign printed
QR codes — QR verification is DB-token based (`table_qr_codes.public_token`).
Its only consumer is the staff-invite rate-limit salt
(`lib/server/staff-invite-rate-limit.ts`). Rotating it therefore does **not**
invalidate any printed QR; it only resets invite-attempt hash buckets. The
earlier "QR tokens minted before rotation will fail" / "forged QR material"
wording is withdrawn.
**You do:** Vercel → project `new` → Settings → Environment Variables → find
the `QR_VERIFICATION_SECRET` entry scoped to branch `arena/3711df6a-autodine`
(metadata check 2026-11-16: type `encrypted`, flagged **`readable-secret`**;
the production and preview-wide entries are `sensitive`, unflagged; none for
development). Delete that branch entry if the branch is dead, or re-save it as
**Sensitive**; rotate production + preview to fresh distinct sensitive values
(`openssl rand -hex 32`); redeploy on the approved schedule.
**Arena verifies:** metadata re-check (no `readable-secret` flag remains;
entries sensitive/distinct); staging smoke: one invite attempt + one QR scan
behave as before. Full detail in the owner-action register (B3).
**Cost:** free. **If skipped:** a readable (decryptable-by-dashboard-viewers)
copy of the invite-salt secret persists on a stale branch scope.
**Blocks:** security hygiene gate.

### A4 — `AUTODINE_CRON_SECRET` + scheduler
**Verified (2026-11-16):** `vercel.json` holds exactly one daily cron
(`30 1 * * *` → `/api/cron/escalate`); the route fails closed (unset → 503,
wrong Bearer → 401, correct → 200; offline tests pass). Metadata check:
**neither `AUTODINE_CRON_SECRET` nor `CRON_SECRET` is set in any
environment** — hosted escalation is currently inert (503) by design.
**You do:** (1) Generate a fresh random secret (e.g. `openssl rand -hex 32`),
store it in your password manager; (2) Vercel → project `new` → Settings →
Environment Variables → Add **both** `AUTODINE_CRON_SECRET` and `CRON_SECRET`
with that **same** value, each **Sensitive**, target **[production]** only
(Vercel Cron auto-sends only the `CRON_SECRET` name; the route accepts both —
see register A4); (3) redeploy Production on your approval and
confirm the cron `30 1 * * *` is listed under Cron Jobs (it is declared in
`vercel.json`, Hobby-legal). (4) If you want escalation checks more often
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
