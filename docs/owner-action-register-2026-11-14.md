# Consolidated owner-action register — 2026-11-14

> **2026-11-14 post-staging update:** every item here is now expanded into
> exact steps, costs (known vs unknown), consequences, and post-action
> verification in `docs/owner-closure-package-2026-11-14.md` (ordered by
> urgency: Tier 1 free/risky-first → Tier 4 dispositions). The full migration
> accounting is in `docs/migration-manifest-2026-11-14.md` (92 migrations +
> 1 owner-operation). The credential exposure is scoped and remediated
> (working-tree) in `docs/credential-exposure-remediation-2026-11-14.md`.
> **B5 is DONE (2026-11-16)** — C1 confirmed inert (404), C2 closed by
> Option A deletion of all four review accounts; verified in
> `docs/credential-exposure-remediation-2026-11-14.md` §5.1.

**Every action in this register is owner-only.** Each needs an account,
purchase, credential, approval, or physical presence the agent cannot supply.
Nothing here was performed. Ordering is by launch-blocking criticality, not by
convenience. Costs marked "unknown" are genuinely price-unverified — check the
provider's current pricing before committing.

Format: action → why → where (dashboard path) → cost → consequence if skipped
→ blocks → verification step.

---

## A. Release-blocking (must be done before/during release)

### A1. Production migration ledger fresh read-only probe — **EXECUTED 2026-11-16 (Arena, owner-authorized SELECT-only); reconciliation below; B1 decision still open**
- **Why:** the 2026-11-14 listing ended at `20261112000100`; that is a listing boundary, not a completeness proof. Every release step assumes known drift D1–D7.
- **Where (exact):** `supabase.com/dashboard` → confirm the project picker says **autodine-production** (`bdbaqpevwmgdvghszjno` — **not** `autodinetest`) → left nav **SQL Editor** → **+ New query** → paste probe 1 → **Run** → use the result grid's download/export to save CSV out-of-band; repeat for probe 2 in a second query tab. Both are `SELECT`-only (no writes, no locks of consequence, seconds to run). Alternative for probe 1 only: **Database → Migrations** list view — the SQL form is preferred because it is exportable verbatim. Arena does **not** execute production SQL.
- **Probe 1 — ledger:** `select version, name from supabase_migrations.schema_migrations order by version;`
- **Probe 2 — guard objects:** `select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('operational_schema_readiness','guard_restaurant_billing_configuration','audit_restaurant_account_reassignment','immutable_restaurant_account_link','public_restaurant_profile','account_can_write');` (exact text also in `docs/owner-closure-package-2026-11-14.md` Tier 1; D1–D7 follow-ups in `docs/production-release-baseline-2026-11-14.md` §3–4 only if Arena asks after seeing these two).
- **Hand-back:** attach both result files (names + versions only — they contain no secrets and no row data, but keep them in the release record, not chat) or paste the text of both grids. Note the run date/time alongside.
- **Cost:** free.
- **Consequence:** applying Batch A blind can double-apply renames/guards; incident risk on money paths.
- **Blocks:** the entire §2 sequence in `docs/production-release-prep-2026-11-14.md`.
- **Verify / reconciliation (Arena, on receipt):** name-based diff against the **92-migration manifest** (`docs/migration-manifest-2026-11-14.md`: 76 legacy-rollout reported-applied · 9 branch-set pending B1 · 7 GST/IRP **NOT AUTHORIZED** — any of those 7 present in the ledger is a stop-the-line finding); production-only console versions are expected and classified per `docs/production-only-migrations-2026-11-14.md` (never infer contents from version order — D4); probe 2 presence/absence maps to D1 (immutability), the owner-billing guard and the audit function. Output is a delta table + updated D1–D7 disposition; it authorizes nothing by itself.
- **RESULT (2026-11-16, Arena-executed under owner authorization, SELECT-only; project identity independently verified as `autodine-production`/`bdbaqpevwmgdvghszjno`, ACTIVE_HEALTHY):** ledger = **121 rows**. By version, **72 of 92** repo migrations are present; **49 rows are production-only console versions** (exactly the count classified in `docs/production-only-migrations-2026-11-14.md`). **Missing by version (20):** the **9 branch-set** files (`20261112000200`–`20261112000700`, `20261115000100`–`20261115000300`) · the **7 GST/IRP** files (`20261113000100`, `20261114000100`–`20261114000600`) — **absent as required, no unexpected GST/IRP application** · **4 pre-branch files requiring effect-level investigation** (`20261110000851 payment_audit_provider_actor`, `20261110000950 online_payment_attempt_uniqueness`, `20261110001210 checkout_outstanding_guard`, `20261110001220 revoke_client_bypass_privileges`): version-absent, but per D4 their *effects* may exist under console versions — **do not apply blind; catalog-effect probes (baseline §6) are the next authorized read-only step**. **Probe 2:** present = `account_can_write`, `operational_schema_readiness`, `public_restaurant_profile`; **missing = `immutable_restaurant_account_link` (D1 confirmed live), `guard_restaurant_billing_configuration`, `audit_restaurant_account_reassignment`** — all three ship in the 9-file branch set. No mutation SQL was executed.

### A2. Production backup / PITR verification (backup gate) — **B2 IMPLEMENTED 2026-11-16; credentials + hosted drill are the only remainder**
- **Why:** there is no verified hosted backup destination; rollback is impossible without one. Local restore drills do not count.
- **Progress (2026-11-16):** Backblaze B2 is the approved destination (an interim same-day R2 implementation was replaced wholesale on owner instruction). Upload path implemented and tested (`scripts/backup/upload-b2.mjs`, region-scoped SigV4 via `lib-b2.mjs`, SHA-256 manifest verification before/after transfer; B2 suite inside `test:dr` 24/24 incl. the published AWS signing vector and `us-west-004` credential-scope assertion). Disposable-environment drill executed 2026-11-16: full-chain logical restore verified (93 migrations, 48 tables/59 policies/162 functions, fingerprint identical), backup selftest ALL PASS, real artifact passed upload dry-run integrity verification, disposable targets destroyed. **Hosted upload and hosted restore drill have NOT happened — no R2 credentials exist anywhere available to Arena (checked by name/presence only).**
- **Exact remaining human action:** create one private B2 bucket + a bucket-scoped B2 application key (read/write) and place `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` in the backup host's secret store or as GitHub Actions secrets (never in git/chat). Then the first scheduled backup uploads and the hosted restore rehearsal (runbook acceptance criteria) can run.
- **Checkpoint 2026-11-16 (owner reported credentials provisioned on the backup host):** Arena re-verified from its sandbox — the variables are **not visible there** (process env, repo/home env files, and Vercel project env checked by name; GitHub Actions secrets API returns 403 to this integration), and an actual `run-scheduled --b2` attempt from the sandbox failed closed at the `backup` stage (`AUTODINE_BACKUP_SOURCE_URL` unset). The sandbox also cannot reach B2/PG endpoints directly. **Hosted upload therefore remains UNVERIFIED.** The first hosted run must execute on the backup host where the credentials live: `AUTODINE_BACKUP_SOURCE_URL=… AUTODINE_BACKUP_PASSPHRASE=… node scripts/backup/run-scheduled.mjs --out-dir <dir> --b2` — success is the printed `uploaded:true, verified:true` (SHA-256) plus a passed hosted restore rehearsal; file that output as evidence and this item closes.
- **Hosted path implemented 2026-11-16 (GitHub Actions, removes the backup-host dependency):** `.github/workflows/hosted-backup.yml` (dispatch + daily schedule; least-privilege; fail-closed secret gate; manifest archived as evidence) and `.github/workflows/hosted-restore-drill.yml` (disposable-container restore rehearsal with fingerprint/row/financial verification and unconditional cleanup), backed by `download-b2.mjs` and `verify-restored-db.mjs` (24/24 DR tests pass locally, incl. loopback-only refusal and mismatch detection). **Neither workflow has run yet.** Exact remaining human action: add these repository secrets (Settings → Secrets and variables → Actions) — `AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` — then dispatch *Hosted backup (B2)* once and *Hosted restore rehearsal (disposable)* once. The integration cannot provision these secrets (403); values must never enter git/chat.
- **Dispatch boundary verified 2026-11-16:** `gh workflow run hosted-backup.yml --ref arena/2670dd12-autodine` returns **HTTP 404** — GitHub dispatches (and schedules) `workflow_dispatch` workflows only from the repository default branch (`main`). The workflows currently exist only on `arena/2670dd12-autodine`. Landing them on `main` is therefore a prerequisite for any hosted run and needs its own owner authorization; until then no hosted backup/drill can start regardless of secrets.
- **Remote-retention hardening (2026-11-17, local commits on `arena/2670dd12-autodine`, unpushed):** `scripts/backup/prune-b2.mjs` enforces the 14 daily / 8 weekly / 6 monthly policy in B2 (`5f63e05`); the independently audited P1 fix (`8367c4d`) downloads and SHA-256-verifies every expiring artifact against its manifest + upload-time metadata before the first DELETE, and the follow-up hardening (`3a3cdc4`) adds a mandatory pre-delete HEAD recheck (TOCTOU window narrowed to one round-trip), a manifest-delete retry with named-orphan reporting, and S3 XML entity decoding for listed keys. Guarantees and the three accepted P2 limitations (no cross-process lock, orphan manifests, day-of-month week buckets) are documented in `docs/backup-restore-runbook.md`. DR suite 44/44, backup selftest ALL PASS, PG17 logical-restore verified, `verify:release` 28/28. The 21-file landing set is unchanged (all edits are inside already-counted files). **Owner actions unchanged:** bucket + key + six secrets + landing the files on `main` (below) still gate any hosted run. (Preservation note, 2026-11-17: the five local commit objects `5f63e05`…`5c752a9` were lost in an Arena sandbox reset; their exact final content was byte-verified against the pushed tip — 980/988 tree files identical, only the expected 10-file delta differed — and re-committed on this branch, so the hashes above are historical references; the live branch tip carries identical file contents.)
- **Restore-verification hardening (2026-11-17, on `arena/2670dd12-autodine`, follows the merged landing):** both backup formats now emit the full verification contract — `counts` + `financialSpotChecks` measured in the backup snapshot (`pg_dump` mode uses the same exported snapshot via `--snapshot`; previously pg_dump manifests had no counts, so a Mode A restore drill could exit 0 with every comparison skipped). `verify-restored-db.mjs` fails closed on missing/malformed evidence, enforces artifact↔manifest pairing (name + SHA-256) before connecting, and compares schema fingerprint, row counts and financial sums for real; the drill workflow derives the manifest from the artifact filename instead of selecting the pair independently. Local evidence: DR suite 50/50 (new `verify-restored-db.test.mjs` covers both formats, missing/mismatched evidence, pairing, loopback refusal on disposable embedded PG), backup selftest ALL PASS, PG17 logical-restore verified, lint/typecheck/build green. The real `pg_dump`/`pg_restore` round trip remains CI-only (no local binaries), as before. **Owner action:** these changes sit on the Arena branch and need a small follow-up landing PR to `main` before the first hosted rehearsal can rely on them; the already-merged workflows/scripts predate the contract.
- **Clean merge proposal (prepared 2026-11-16; NOT a whole-branch merge):** this branch is 51 commits ahead of `main` (app changes, docs, migration `20261116000100`) — merging it wholesale is not the safe path and no such PR was created. The workflows-only landing is **21 additive files** (`scripts/backup/` holds 19 `.mjs` files after the remote-retention addition), none of which exist on `main` (zero conflict surface): `.github/workflows/hosted-backup.yml`, `.github/workflows/hosted-restore-drill.yml`, and all 19 `scripts/backup/*.mjs` files at their reviewed states (17 pipeline + `prune-b2.mjs` remote retention and its tests) (workflows/B2 from `b1cc159` + `4252b44` as provider-swapped to Backblaze B2, plus the lazy-`pg`-import hardening of `verify-restored-db.mjs`) (cherry-pick source commits `b1cc159` + `4252b44` and the B2 provider-switch commit; the only external dependency is `pg`, already in `main`'s `package.json`; no `package.json` change needed). Human recipe: branch from `main`, copy/cherry-pick exactly these files, open a PR titled "Hosted backup + restore workflows (no app changes)", merge after review. **Merge side-effect the owner must authorize knowingly:** Vercel's production branch is `main` (verified via project link), so the merge triggers a Production *build/deploy of `main`'s existing app code* — the added files do not change app runtime (CI/backup scripts only), no migration is applied by merging, and the backup schedule activates in fail-closed mode (names missing secrets, touches nothing) until the six secrets exist. Branch protection on `main` could not be inspected (integration 403).
- **Where:** Backblaze dashboard → B2 (private bucket + bucket-scoped application key); pipeline per `docs/backup-restore-runbook.md` (B2 section). Supabase PITR remains an optional separate decision.
- **Cost:** B2 at AutoDine scale ≈ $0.01–0.04/month (first 10 GB free); passphrase free. PITR alternative requires Supabase Pro (paid).
- **Consequence:** an unrecoverable production mistake; NO-GO for launch stands; B1's backup precondition stays unmet.
- **Blocks:** release §2 step 1; the entire launch; migration batch §6A.
- **Verify:** first real upload prints `uploaded:true, verified:true` with matching SHA-256; hosted restore rehearsal passes every acceptance criterion in the runbook; PITR checkpoints P1–P6 only if the PITR route is chosen instead.

### A3. Alert path: log drain + uptime monitor + one human phone
- **Why:** launch without paged alerts = silent outage; venue Wi-Fi + Realtime dependency guarantees degradation events.
- **Where:** Vercel project → Settings → Log drains (pick provider, e.g. BetterStack/Axiom); monitor `GET /api/health`; set `AUTODINE_ALERT_WEBHOOK`/`BACKUP_ALERT_WEBHOOK` on Vercel (Production env).
- **Cost:** BetterStack/Axiom free tiers exist; likely ₹0–500/month (unknown).
- **Consequence:** outages discovered by customers; slow incident response.
- **Blocks:** launch acceptance; post-release checklist.
- **Verify:** one real test alert fires, reaches the human, and is acknowledged; log attached to release record.

### A4. Cron secret + external scheduler — **CONFIGURED 2026-11-16 (Arena via Vercel, owner-authorized: `AUTODINE_CRON_SECRET` + `CRON_SECRET`, same fresh value, Sensitive, Production-only, metadata-verified; effective on next Production deployment — redeploy and live 401/200 test NOT authorized/performed)**
- **Why:** `/api/cron/escalate` fail-closes without `AUTODINE_CRON_SECRET`; Vercel Hobby allows only the daily `30 1 * * *` cron (re-adding sub-daily breaks deployment).
- **Repo-side verification (2026-11-16):** `vercel.json` carries exactly **one** cron — `30 1 * * *` (daily 01:30 UTC) → `/api/cron/escalate` (also enforced by `verify:release`). Route (`app/api/cron/escalate/route.ts`): secret = `AUTODINE_CRON_SECRET` (fallback legacy `CRON_SECRET`), trimmed; **unset → 503, wrong/missing Bearer → 401**, correct → 200 `{scanned, escalated, staleAfterMinutes:15}`; constant-time-ish compare; scope is the in-memory incident registry of the serving instance (structured log remains the durable record). Offline route tests 2026-11-16: 503/401/200 paths pass (part of 28/28 targeted run).
- **Hosted inventory (Vercel metadata only, 2026-11-16):** **neither `AUTODINE_CRON_SECRET` nor `CRON_SECRET` exists in any environment** (production/preview/development) on project `new`. Hosted cron calls therefore currently receive 503 — escalation is inert, exactly the fail-closed posture, until the owner sets it.
- **Where:** Vercel → project `new` → Settings → Environment Variables → Add **two** entries with the **same** fresh value (`openssl rand -hex 32`, generate locally, store in password manager): `AUTODINE_CRON_SECRET` **and** `CRON_SECRET`, each type **Sensitive**, target **[production]** only — then redeploy Production on approval. Both names are required for the native job: Vercel Cron auto-sends only `Authorization: Bearer <CRON_SECRET>`, while the route checks `AUTODINE_CRON_SECRET` first and falls back to `CRON_SECRET` (`route.ts:37`); setting only the AUTODINE name leaves Vercel's own call at 401, setting only CRON leaves external callers without the canonical name. Do not add sub-daily entries to `vercel.json` on Hobby. If sub-daily escalation is later needed: external HTTPS scheduler (GitHub Actions scheduled workflow or cron service) calling the production URL with `Authorization: Bearer <same value>` — paid/free depending on provider (unknown).
- **Cost:** free (GitHub Actions within quota) or Vercel Pro if cron cadence needs it (paid, price unknown).
- **Consequence:** until set, escalation alerts never fire (incidents still logged + visible in Settings → Operations); wrong target (e.g. preview-only) leaves production at 503; setting it has no effect on any user flow.
- **Blocks:** escalation monitoring for launch.
- **Verify (owner-run after approval; Arena does not call production):** from the operator machine only, against the production domain: (1) no header → **401**; (2) wrong Bearer → **401**; (3) correct Bearer → **200** with `staleAfterMinutes:15` (expect `scanned:0, escalated:0` on a quiet system — 200 is the auth proof; never paste the command or value into chat, report status codes only); (4) confirm in Vercel → project `new` → Cron Jobs that the daily job is listed/enabled after the redeploy. Arena re-checks metadata presence/target/type only.

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

### B1. Approve production application of branch migration set — **RECOMMENDATION READY 2026-11-16 (catalog-effect probes executed; apply decision + backup gate still owner-held)**
- **Why:** D1–D7 drift: production lacks `immutable_restaurant_account_link`, owner-billing guard, account-reassignment audit, invite fall-through fix, trigger-EXECUTE revocation. Direct `restaurants.account_id` UPDATE is possible today (D1 reconfirmed by A1 probe 2, 2026-11-16).
- **Catalog-effect probe results (2026-11-16, production, read-only; detail in the manifest rows):** `20261110000851` **ABSENT** (live defect — apply) · `20261110000950` **PARTIAL** (older function bodies — apply via `CREATE OR REPLACE`) · `20261110001210` **RESOLVED: effect present, behaviour-identical** — full `pg_get_functiondef` comparison (identity re-verified immediately before the read) shows statement-for-statement identical logic, security settings and grant end-state; only comment wording differs, so **no reconciliation is required and the file stays out of the batch** · `20261110001220` **PARTIAL, unsafe verbatim** (MAINTAIN on 17 tables; superseded for production by `20261116000100`).
- **Evidence-backed recommendation:** first apply batch = **12 files in filename order** — `20261110000851`, `20261110000950`, then the 9 branch-set files (`20261112000200`–`20261112000700`, `20261115000100`–`20261115000300`), then the scoped ACL revision **`20261116000100_revoke_client_maintain_privileges`** (created 2026-11-16; production substitute for `20261110001220` — sequence revokes verified safe by definer-only consumption, fail-closed post-revoke check included; full-chain embedded-PG replay **212/212 integration tests passed**, logical-restore drill verified at 93 migrations) — executed only after (i) the backup gate (register A2/C-1) closes, (ii) preflight capture per `docs/production-release-baseline-2026-11-14.md` §6 (incl. `pg_get_functiondef` of every replaced function for rollback, and the orphan-`actor_id` data preflight that `20261110000851`'s FK validation will enforce), and (iii) explicit owner authorization naming project `bdbaqpevwmgdvghszjno` and this file set. **Held out:** `20261110001210` (resolved — effect already present and behaviour-identical; excluded to avoid a needless production write) and the original `20261110001220` (superseded for production by `20261116000100`; the `supabase_admin` owner-operation stays separate and manual). The full ordered packet, per-file rollback and failure criteria are in `docs/production-release-baseline-2026-11-14.md` §6A. **GST/IRP 7 remain NOT AUTHORIZED and were confirmed absent from production.**
- **Duplicate/ordering/rollback risks (assessed):** function files are `CREATE OR REPLACE` with identical signatures (no duplicate-object risk); hard dependency `00851 → 00950` (settlement inserts NULL actor) is satisfied by filename order; branch-set dependencies (`account_subscriptions` etc.) are present in the ledger (72/92 verified); rollback for replaced functions = pre-captured definitions, for `00851` = backup restore (hence the backup gate is non-negotiable); online payments stay provider-disabled throughout, so the payment-function replacements have no live-traffic window.
- **Where:** Supabase dashboard → SQL editor or `supabase db push` from authorized machine, in the order in `docs/production-release-prep-2026-11-14.md` §2 (steps 1–6 and #1–#10). See `docs/production-only-migrations-2026-11-14.md` for per-file classification.
- **Cost:** free.
- **Consequence:** known authorization-boundary gaps remain open in production.
- **Blocks:** security sign-off for launch.
- **Verify:** post-apply catalog probe: trigger present, EXECUTE revoked for service_role/anon/authenticated, audit table exists and records a synthetic reassignment; `/api/health` ok:true.

### B2. `ADMIN_SECRET` rotation — **CONFIGURED 2026-11-16 (Arena via Vercel, owner-authorized; effective on next Production deployment — redeploy NOT authorized/performed; post-deploy 401/400 verification still pending)**
- **Why:** pre-existing operational secret; rotation cadence is owner policy; rotation is risk-free if staged.
- **Repo-side inspection (2026-11-16, no value retrieved):** sole consumer is the trial-renewal tool — `lib/admin-auth.ts` (`isValidAdminSecret`, constant-time SHA-256 compare, fail-closed if unset/<32 chars, read at call time) gating `app/admin/renew-trial/actions.ts`, `app/admin/renew-trial/page.tsx` and `app/api/admin/renew-trial/route.ts` (`Authorization: Bearer …`, auth checked before body parse; action re-checks). Effect of the secret: service-role `admin_set_subscription` trial renewal (21 days, account-wide). No other env var grants admin; no `NEXT_PUBLIC_` exposure. Offline tests 2026-11-16: admin-auth + renew-trial action/route suites pass (part of 28/28 targeted run).
- **Hosted inventory (Vercel metadata only, 2026-11-16):** project `new` — exactly **one** `ADMIN_SECRET` entry, type `sensitive`, target **[production]**, no git-branch scope, no `readable-secret` flag. **Absent in preview and development** (fail-closed there; a known gap vs `docs/preview-isolation.md` step 3 — decide: add distinct preview/dev values or consciously accept the admin tool being production-only).
- **Where:** Vercel → project `new` → Settings → Environment Variables → Production → `ADMIN_SECRET` → Edit; save a fresh `openssl rand -hex 32` value (≥32 chars or the tool refuses everyone), then redeploy Production (owner-approved deploy only — rotation without redeploy does not take effect).
- **Cost:** free.
- **Consequence / interruption:** the moment the new value is live, the old value gets generic 401 everywhere and anyone holding it (only the operator, by design) must use the new one. Nothing else depends on it: no guest/staff flow, no webhook, no cron. If the new value is <32 chars or lost, the admin tool is simply dead (fail-closed) until fixed — no lockout of restaurant users.
- **Blocks:** security hygiene (not a hard launch gate).
- **Verify (no value exposed):** after redeploy, operator-locally: (1) old value → `POST /api/admin/renew-trial` returns **401** `{"error":"Unauthorized"}`; (2) new value with a deliberately non-existent restaurant name → **400** `restaurant_not_found`-class error (proves auth passed without moving any trial clock — do **not** verify with a real restaurant name unless you intend a renewal); (3) report only the two status codes. Arena re-checks metadata (updated-at changed, still `sensitive`, still production-only or as decided).

### B3. `QR_VERIFICATION_SECRET` review (readable-secret flag) — **CLOSED 2026-11-16 (branch-scoped readable entry deleted by owner and confirmed gone; Production + Preview rotated by Arena via Vercel to distinct fresh Sensitive values under owner authorization; effective on next deployments; no `readable-secret` flag remains on any entry)**
- **Why (corrected 2026-11-16):** despite the name, this secret does **not** sign or gate printed QR codes in current code. QR verification is database-token based (`table_qr_codes.public_token` minted by `public.new_qr_public_token()` from `gen_random_uuid()`, checked by the QR RPCs). The secret's only code consumer is `lib/server/staff-invite-rate-limit.ts:21`, where it salts the staff-invite caller IP hash (`QR_VERIFICATION_SECRET || SUPABASE_SECRET_KEY || 'staff-invite-rate-limit'`). Earlier wording ("QR tokens minted before rotation will fail"; "forged QR verification material") is superseded — see the correction in `docs/owner-closure-package-2026-11-14.md`.
- **Hosted inventory (Vercel metadata only, 2026-11-16):** **three** entries on project `new` — (1) `sensitive`, **[production]**, no flag; (2) `sensitive`, **[preview]**, no flag; (3) `encrypted`, **[preview] scoped to branch `arena/3711df6a-autodine`**, flagged **`readable-secret`** ← the B3 flag. **None for development** (code falls back to the Supabase secret key as salt there — works, but couples the salt to that key).
- **Where:** Vercel → project `new` → Settings → Environment Variables → find the branch-scoped preview entry (`arena/3711df6a-autodine`) → either delete it if that branch is dead, or Edit → re-save its value as **Sensitive**; then rotate production + preview values to fresh distinct random values (`openssl rand -hex 32`) as `sensitive`, and optionally add a distinct development entry. Redeploy affected targets on the approved schedule (env changes do not affect running deployments).
- **Cost:** free.
- **Consequence / interruption:** rotating a value only changes the invite rate-limit salt: existing invite-attempt buckets hash differently, so in-flight invite throttling counters effectively reset (a few minutes of fresh budget — the safe direction). **Printed QR codes, guest scanning, sessions and orders are unaffected.** Deleting the branch-scoped entry only affects previews of that one branch (they fall back to the preview-wide entry, or to the Supabase-key salt if none applied).
- **Blocks:** security hygiene (recommended pre-launch).
- **Verify (no value exposed):** (1) metadata re-check: no `QR_VERIFICATION_SECRET` entry anywhere carries `readable-secret`; production/preview entries `sensitive` and distinct; (2) functional smoke on staging/preview only: one staff-invite attempt still rate-limits normally and one table-QR scan still opens the menu (both expected unchanged — they prove the salt change broke nothing); (3) report only pass/fail classes.

### B4. Supabase service-role / secret key hygiene check
- **Why:** legacy service_role keys bypass RLS; confirm the production project uses new `sb_secret_*` keys where supported and that no key appears in client bundles.
- **Where:** Supabase dashboard → Settings → API; Vercel env audit; `npm run lint`/`deployment-isolation.mjs` already guards the bundle.
- **Cost:** free.
- **Consequence:** full-database compromise if leaked.
- **Blocks:** security sign-off (recommended pre-launch).
- **Verify:** CI isolation guard green; key names match expectations; no secret-like strings in built assets.

---

### B5. Rotate the staging review credentials (leaked in Git history) — **DONE 2026-11-16**
**Full scope, exposure map, rotation sequence and verification: `docs/credential-exposure-remediation-2026-11-14.md` (§5.1 closure record). Do not reuse the retired values anywhere.**
- **Why:** the 2026-11-11/2026-11-12 docs committed a Vercel `_vercel_share` token and the shared password of the four synthetic staging review accounts. They are redacted from the working tree as of 2026-11-14, but **Git history retains them** — redaction is not remediation.
- **Done:** C1 — review deployment `dpl_2i2oYjgNje5xQtkD9CzFSoWEmH9U` confirmed gone (Vercel API 404; owner: old link 404/Protected/Revoked). C2 — Option A: all four `*@autodine-review.test` accounts deleted on `juwyhslzchjevqkdvwjm`; old password rejected for all four (owner), independently confirmed by read-only `auth.users` count = 0 (Arena, 2026-11-16).
- **Cost:** free (spent).
- **Consequence if it had been skipped:** anyone with repo read access could open the protected review deployment and sign in as any review role (staging data only; production untouched). That path is now closed; history rewrite remains optional and was not performed.
- **Blocks:** nothing production-side; this gate is cleared.
- **Verify:** completed — see §5.1 of the remediation doc (`verify:release` 28/28, staging guards 25/25, current staging alias working, no staging suite dispatched).

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

### Quantity > 99 in guest orders — **recommendation recorded 2026-11-16: Option A (keep cap); owner decision still required in writing**
Evidence (code-verified 2026-11-16): the cap is consistent at every layer — DB `20261021000005_public_place_order.sql` (`k_max_qty=99`, `least(greatest(qty,1),99)`), cart `lib/cart-storage.ts` (`MAX_QTY=99`, cap tested in `cart-storage.test.ts`). Option C (raise) additionally breaks a hidden dependency: the kitchen announcer (`lib/announce.ts`) only speaks Hindi numbers **0–99**, so larger quantities would be announced wrong/silently — raising is a multi-surface change (DB + cart + TTS + kitchen expectations) needing a recorded business reason (none exists; banquet-scale orders are served by multiple lines/tickets under the session model). Option B (reject) is more honest than silent capping but changes guest UX for a case the cart already prevents (>99 unreachable from the UI today; only API-direct submissions hit the DB cap). **Recommend Option A for the pilot**: no code change, behaviour already uniform and tested; revisit only with a concrete banquet-ordering requirement. Current cap preserved; nothing was changed silently.
