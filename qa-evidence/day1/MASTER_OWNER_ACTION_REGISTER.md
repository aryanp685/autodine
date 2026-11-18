# AUTODINE — MASTER OWNER ACTION REGISTER

The single consolidated list of everything only the owner can do, decide, or authorize. It supersedes day-to-day navigation of `docs/owner-action-register-2026-11-14.md` (retained as the detailed annex — exact dashboard paths, costs and consequences live there and in `docs/owner-closure-package-2026-11-14.md`). Nothing here was performed. Items are ordered by launch criticality; each entry states the decision, the exact step, and the verification that closes it.

Run `node scripts/hosted-verification/preflight.mjs` before any session — it reports current presence/state by name, never values.

---

## Tier 1 — The backup gate (blocks everything downstream)

> **B2 status (owner decision, 2026-11-17):** provider **SELECTED** (Backblaze B2) · local implementation **VERIFIED** · hosted backup **DEFERRED** · hosted restore **DEFERRED**. Deferred, not cancelled: the implementation is complete and parked untouched — full handoff and exact resume instructions in `docs/operations/B2_BACKUP_IMPLEMENTATION_HANDOFF.md`. Items 1.1–1.5 below remain the resume path whenever the owner lifts the deferral; no account, secret, dispatch or paid service is to be created in the meantime.

| # | Action | Exact step | Closes when |
|---|---|---|---|
| 1.1 | Create B2 destination | Backblaze console → one **private** bucket + **bucket-scoped** app key (read/write, that bucket only) | Bucket + key exist; scope screenshot filed |
| 1.2 | Add six repo secrets | GitHub Settings → Secrets and variables → Actions: `AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` (values never in git/chat) | Names visible in Settings (the Arena integration gets 403 and cannot confirm — your eyes are the check) |
| 1.3 | Merge PR #190 | Review §"PR #190" in `MASTER_LAUNCH_READINESS.md`; merge knowing it triggers a Vercel Production build of `main`'s existing app code | Drill workflow appears **by name** in `gh workflow list`; the 0s-failure mode gone |
| 1.4 | Authorize + run first hosted backup | One manual dispatch of *Hosted backup (B2)*; authorization names the run | Output `uploaded:true, verified:true` (SHA-256 triple-match); manifest filed (Runbook Package 1) |
| 1.5 | Authorize + run hosted restore rehearsal | One dispatch of the drill, disposable target only | Green verified report incl. financial spot-checks; RTO number recorded (Package 2) |

## Tier 2 — Launch communications & operations

| # | Action | Exact step | Closes when |
|---|---|---|---|
| 2.1 | Email activation — **Brevo selected** (owner decision 2026-11-16; code implemented; **owner credentials created 2026-11-16** — API key `AutoDine-Preview` + SMTP credentials, values owner-held only; agent set Vercel Preview `AUTODINE_EMAIL_PROVIDER=brevo`; Preview deployed 2026-11-18 via owner-approved push + PR #191 (READY on branch alias, Deployment Protection on + bypass secret owner-generated); webhook live (Brevo test event HTTP 200, both headers); SMTP 525 root-caused and fixed 2026-11-18 (owner deactivated Brevo SMTP-key IP blocking only); first Auth confirmation mail delivered (Spam) and confirmed in `autodinetest`; silent-failure fix landed in code 2026-11-18 (Auth mail/workspace failures now raise deduped operator incidents — `app/auth/actions.ts`, 6 new tests, full suite green; ships on PR #191); remaining = API-path tests (test-send, staff invitation), password recovery, reply check — checklist Step E) | Exact steps in `docs/operations/BREVO_EMAIL_RUNBOOK.md`: B1 Brevo Free signup → B2 verify one owner-controlled sender (6-digit code; temporary, unauthenticated-domain limits apply) → B3 API key (`xkeysib-…`) into Vercel **Preview** (`AUTODINE_EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `AUTODINE_EMAIL_FROM`, `BREVO_WEBHOOK_SECRET`; optional `AUTODINE_EMAIL_REPLY_TO`) + Brevo transactional webhook to `/api/email/brevo/webhook` → B4 Supabase **test** project (`juwyhslzchjevqkdvwjm`) Brevo SMTP (`smtp-relay.brevo.com:587`, SMTP login + **SMTP key**, not the API key) + raise Auth email rate limit from 2/hr + redirect allow-list for the test origin (see O-B3) → B5 controlled tests to owner mailboxes only (runbook §2/§4) → **B6 Production is a separate approval**; **B7 after domain purchase:** authenticate domain in Brevo (Brevo code + DKIM + DMARC DNS records, §5) and switch senders to the domain before any branded/customer sending | Controlled real email received + auth links + webhook events evidenced in `qa-evidence/day1/BREVO_AUTH_EMAIL_IMPLEMENTATION.md`; domainless-phase completion (incl. reply-to support, live zero-config Vercel verification, explicit no-order/receipt-email scope) in `qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md`; branded delivery only after B7. Secrets only ever typed into Brevo/Vercel/Supabase dashboards, never chat/git |
| 2.2 | Alert path | Log drain rule on `[autodine:alert]` + uptime on `GET /api/health` + `AUTODINE_ALERT_WEBHOOK` to a human endpoint (register A3/D3) | One real alert paged, acknowledged, resolved (Package 7) |
| 2.3 | Hosted browser evidence | Dispatch `disposable-supabase-e2e-load` once on a disposable environment | 49 integration specs fully green (Package 6; retries are 0 by design) |
| 2.4 | Realtime hosted proof | Two-device Staging script (Package 5), can share 2.2's outage | Fallback + single degradation alert + recovery + zero cross-restaurant rows |
| 2.5 | Cron live proof | With the next authorized Production redeploy: no-header→401, wrong→401, correct→200 from the operator machine (register A4; secrets already configured) | Status codes recorded; daily job listed enabled |
| 2.6 | **O-B1: Staging designation** (repo guard + evidence complete 2026-11-16) | Decide verbatim (see `STAGING_ISOLATION_COMPLETION.md` §2/§8): “Designate `autodinetest` (`juwyhslzchjevqkdvwjm`) as the official non-production Staging project” OR “Create a third, dedicated Staging project and designate its ref instead.” Test project carries 33 Auth users / 30 restaurants and looser anon grants than production; it is **not** silently designated | Written owner designation; if third project: one repo ref update + `AUTODINE_EXPECTED_PROJECT_REF` re-target |
| 2.7 | **O-B2: Production trusted-project pin** (repo guard complete 2026-11-16) | Vercel project `new` → Settings → Environment Variables → Add `AUTODINE_EXPECTED_PROJECT_REF=bdbaqpevwmgdvghszjno`, target **Production only** → redeploy `main` + one branch → confirm both builds. Without it, production→test rests on config correctness alone (honest gap in `isolation:verify`) | Production build proves pin; `isolation:verify` semantics enforced in build |
| 2.8 | **O-B3: Auth redirect allow lists** (prepared 2026-11-16) | Supabase → Authentication → URL Configuration: test project add `https://*-iamjarvis9896-3988s-projects.vercel.app/**`; production decide separately whether to remove the team wildcard + `http://localhost:3000/**` (recommended; behavior change, explicit approval) | Preview signup completes; production surface narrowed |
| 2.9 | **O-B5: Production `mailer_autoconfirm`** (inspected 2026-11-16) | Decide: “Approve setting `mailer_autoconfirm = false` on production (`bdbaqpevwmgdvghszjno`), together with/after Brevo production SMTP (runbook B6); until then the 2 mails/hour fallback ceiling is accepted.” Currently `true` (unverified addresses can become accounts); test project `false` | Setting flipped under B6 sequencing; controlled signup confirms mail + redirect |

## Tier 3 — Migration decisions (paper decisions now; applications later, separately authorized)

The Batch 1 reconciliation (`qa-evidence/day1/MIGRATION_DRIFT_RECONCILIATION_BATCH1.md`) is the evidence. **No classification in it authorizes applying anything.** Exact decisions needed:

**3.1 Version collisions — pick the canonical body per version** (applying the wrong twin silently reverts the other):

| Versions | Decision asked |
|---|---|
| `20261112000500`, `20261112000600`, `20261112000700` (branch vs `main` differ) | Per version: branch body, `main` body, or a merged body — named per file |
| `20261114000100` (branch vs `main`; GST-adjacent) | Canonical body — *and* it remains inside the GST NOT-AUTHORIZED set regardless |
| `20261112000400` (branch) vs `20261112000600_cap_subscription_history_ceiling` (`main`) — different versions, same two functions, different bodies | Which function bodies are canonical going forward; the loser is quarantined, never replayed |

**3.2 The 49 Production-only versions — disposition per group** (adopt into repo / converge to repo / quarantine as console-only; per-item tables in Batch 1):

| Group | Count | Decision asked |
|---|---|---|
| Effect-equivalent | 14 | Adopt (record as applied-equivalent) or leave console-only with a written note |
| Partial | 5 | Capture hosted bodies first (separate read-only authorization), then converge deliberately |
| Conflict | 17 | Per item: which side wins. **First:** Production `report_sales` SECURITY DEFINER lacks `has_restaurant_role` — a live cross-restaurant sales exposure needing a hosted body capture + fix decision ahead of any batch work |
| Unknown | 13 | Authorize fresh read-only catalog probes (Batch 1 §8, P-1…P-7) to make them decidable; no other path |

**3.3 Forward sets:**
- B1 nine-file branch set (`20261112000200`→`00300`→`00400`→`00500`→`00600`→`00700`→`20261115000100`→`00200`→`00300`, filename order; `…15000300` supersedes part of `…12000200`): approvable only after Tier 1 closes; staging-first, one file at a time, re-probe between files, forward-only rollback from captured bodies.
- Four version-absent pre-branch files (`…000851`, `…000950`, `…001210`, `…001220`): effect-level verdicts exist (Batch 1 §: 1 genuinely pending-with-preflight, 2 partial, 1 resolved-equivalent); decide per verdict — **never apply the partials verbatim**.
- Scoped `20261116000100` (revoke client-maintain privileges): separate authorization naming `bdbaqpevwmgdvghszjno` + this file.
- Scoped `20261117000100` (revoke public/anon/authenticated on `STORAGE_VIEWS_v2`, guarded no-op where absent): finalized locally 2026-11-16 (`STAGING_ISOLATION_COMPLETION.md` §7); read-only probes show no such view on either hosted project today, so application would be a recorded no-op — same per-file authorization naming project + file when/if the owner wants it applied.

## Tier 4 — Commercial & statutory (separately authorized tracks)

| # | Action | Notes |
|---|---|---|
| 4.1 | Billing provider selection + certification (register C1) | Razorpay or other INR provider; live billing stays OFF until chosen + certified. Webhook pipeline is locally verified in sandbox mode |
| 4.2 | GST per-tenant mode decisions + adviser sign-off (C2) | Written decision per tenant: off / composition / regular. Code implements all three fail-closed (`lib/gst/`); see the readiness plan in `MASTER_EXECUTION_STATUS.md` §GST |
| 4.3 | GST/IRP migration + e-invoice authorization (C3) | The 7 files (`20261113000100`, `20261114000100`–`00600`) remain **NOT AUTHORIZED**; IRP/GSP provider selection + certification are legal dependencies, not code tasks |
| 4.4 | Credit/debit notes UI decision (C4) | Product decision; data model exists in the (unauthorized) migration set |
| 4.5 | PR #181 disposition (register E) | Explicit merge/close decision; nothing by default |
| 4.6 | Quantity > 99 (register G) | Recommendation recorded (keep cap); needs owner's written adoption. Not launch-blocking |
| 4.7 | Staging billing sandbox rehearsal (A6, optional) | Separate authorization if wanted pre-launch |

## Already closed — do not re-open

B5 staging review-credential rotation (DONE 2026-11-16); B3 QR secret hygiene (CLOSED); B2 `ADMIN_SECRET` rotation (configured; live proof rides on 2.5); A4 cron secrets (configured, metadata-verified); A1 Production ledger probe (executed 2026-11-16, SELECT-only; reconciliation in Batch 1); B2 backup pipeline implementation incl. retention + restore-verification hardening (landed on `main`, 22/22 blob-identical; DR 50/50). Supabase PITR purchase (D2) remains an open *option*, decided in Runbook Package 3.
