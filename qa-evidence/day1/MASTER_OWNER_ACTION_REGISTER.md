# AUTODINE — MASTER OWNER ACTION REGISTER

The single consolidated list of everything only the owner can do, decide, or authorize. It supersedes day-to-day navigation of `docs/owner-action-register-2026-11-14.md` (retained as the detailed annex — exact dashboard paths, costs and consequences live there and in `docs/owner-closure-package-2026-11-14.md`). Nothing here was performed. Items are ordered by launch criticality; each entry states the decision, the exact step, and the verification that closes it.

**Latest evidence (2026-11-19):** [final completion & deployment report](FINAL_COMPLETION_AND_DEPLOYMENT_2026-11-19.md).
It supersedes the deployment half of every earlier entry: the QR fix (F-01/F-02)
is confirmed **live on production** `bdbaqpevwmgdvghszjno`, production is 47
migrations behind this branch and missing 30 of the 84 RPCs the app calls, and
the Vercel token cannot see any project. The four decisions that remain are
listed in §10 of that report.

Run `node scripts/hosted-verification/preflight.mjs` before any session — it reports current presence/state by name, never values.

---

## Priority 6 release-gate status

The [Priority 6 report](FINAL_LAUNCH_READINESS_PRIORITY_6_2026-11-19.md) closes
every local gate (20/20 product journeys, 2/2 IRP simulation journeys, 13-suite
integration 286/1, replay and populated upgrade 270/3, 47 release checks) and
adds **no authorization**: LOCAL RELEASE CANDIDATE **PASS**, STAGING ACCEPTANCE
**NOT AUTHORIZED**, PROVIDER ACCEPTANCE **NOT AUTHORIZED**, PRODUCTION RELEASE
**NO-GO**. Two documents make the remaining decisions concrete:
[staging authorization + 14 acceptance points](../../docs/staging-authorization-and-acceptance-2026-11-19.md)
and the [provider dependency register](../../docs/operations/PROVIDER_DEPENDENCY_REGISTER_2026-11-19.md).
New evidence (2026-11-19, read-only): the only non-Production project
(`autodinetest`, ref `juwyhslzchjevqkdvwjm`) holds **thirteen** dashboard
applications rather than this branch's 119-file sequence. Twelve are explained by
repository evidence — six repository migrations applied by hand on 2026-11-08,
the explicitly local scaffold, a content-addressed 49-file bundle whose pinned
artifact checksum matches the recorded one, an operational probe and three owner
migrations — and the thirteenth is the third main-branch workstream's
`announcement_claim_recovery` (PR #195, applied 31 minutes before merge). The
`qr_verification_attempts_legacy_*` table with no ledger row is now **proven** to
be that 2026-11-11 review application (Report A §4.1). Details:
[Report A](STAGING_DRIFT_INVESTIGATION_2026-11-19.md). **Nothing was reset,
repaired or applied.** The project is therefore not a clean Staging baseline
until the decisions in the Priority 6b status below are taken.

## Priority 6b status — definer review and staging drift (2026-11-19)

Two reports and one written fix came out of this phase; **none of it is an
authorization**.

| Deliverable | What it says |
|---|---|
| [Report A — staging drift](STAGING_DRIFT_INVESTIGATION_2026-11-19.md) | The candidate's thirteen ledger rows are explained with byte- or statement-level evidence; the pinned 49-file bundle is content-addressed and its checksum verifies; the 2026-11-11 `qr_verification_attempts_legacy_*` object is **proven** to come from the documented review application (§4.1). Verdict: **EXPLAINED**, still **NOT ELIGIBLE** as a Staging baseline (undesignated, scaffold installed, live defects) |
| [Report B — definer review](DEFINER_SECURITY_REVIEW_2026-11-19.md) | All 81 flagged `SECURITY DEFINER` functions classified individually: **2 class A, 0 class B**, 26 C, 28 D, 26 E. One defect family |
| [Cross-check](SECURITY_AND_STAGING_CROSS_CHECK_2026-11-19.md) | How the two constrain each other, plus the full finding dossier |
| [Acceptance matrix](STAGING_ACCEPTANCE_MATRIX_2026-11-19.md) | The 14 staging points scored: **11 pass locally, 3 blocked, 0 fail**; on hosted only ledger parity has been run |
| [Findings register](SECURITY_FINDINGS_REGISTER_2026-11-19.md) | F-01, F-02 and F-03, kept separate from accepted defects and audit observations |

### Finding QR-01 / QR-02 — two cross-tenant defects, live on the candidate

`rotate_table_qr_code` (QR-01) and `retire_table_qr_code` (QR-02) are
`SECURITY DEFINER`, executable by `authenticated`, and guarded only by
`restaurant_can_write()` — a **billing** gate that never compares the caller with
a membership. Any signed-in account that learns a table id (guests get it from
`current_table_session()`) can revoke another outlet's printed cards and, on
rotate, receive the replacement 64-character `public_token` — order injection
into a foreign kitchen plus a denial of service on their cards. No finance, GST,
IRP or payment path is reachable.

Reproduced on a disposable local database: PRE-FIX rotate returned a token and
retire succeeded for an outsider; POST-FIX both raise `42501`, while the owning
outlet's owner still succeeds. Regression tests: `table QR lifecycle` in
`lib/db/phase0-security.integration.test.ts` (6 tests). Fix:
`supabase/migrations/20261118002200_qr_code_staff_boundary.sql` — **written,
tested, NOT APPLIED**, forward-only, signature-preserving.

**F-03 (found in Priority 7 by reading the bodies):** rotation was not
serialised, so two overlapping rotations left **two live cards** for one table,
and a retire racing a rotation could report success while a fresh card stayed
live. The same file now takes a `for update` row lock on `dining_tables` before
the checks. Proven with two real concurrent sessions: 2 live cards without the
fix, 1 with it.

### Owner decisions introduced by 6b

| # | Decision | Closes when |
|---|---|---|
| 6b.1 | Confirm the 2026-11-19 `announcement_claim_recovery` application as the third workstream's (PR #195) | Written confirmation recorded in Report A §8 |
| 6b.2 | **Resolved (origin proven).** Only a disposition is left: keep the inert 0-row legacy table as evidence (recommended) or authorize its removal later | Decision recorded |
| 6b.3 | Designate a Staging target, or create a fresh project | A ref is named as Staging |
| 6b.4 | Authorize (or refuse) `20261118002200_qr_code_staff_boundary.sql` for that target — it now closes **three** findings (F-01, F-02, F-03) | Written decision naming file + ref; highest-value item in the queue |
| 6b.5 | Re-apply `20261115000200` from the repository, or accept the older `owner_billing_configuration_guard` revision | Decision recorded |
| 6b.6 | Drop `autodine_local_test_scaffold` before any Staging label | Target no longer carries inferred DDL |

### Gates after 6b / Priority 7

Unit and replay counts are in the Priority 7 report · integration **293 passed /
1 skipped** (13 files) · guest-plus-receipt journey suite **20/20 passed** ·
`verify:release` 47 checks · register 119 files / 119 rows / 0 problems · definer
audit 148 audited / **80** flagged (was 81; both QR functions now unflagged) ·
`verify-qr-finding.mjs` reproduces the isolation defect, the race, and their
closure. No hosted write, no provider call.

## Priority 5 release-candidate status

The [Priority 5 RC verification](RELEASE_CANDIDATE_PRIORITY_5_LOCAL_VERIFICATION.md)
adds product-wide local evidence but **no new authorization**. It does not
change the GST/IRP/realtime approval state, does not clear any hosted gate and
does not permit applying `20261118002000` or `20261118002100`. The decisions
below remain the prerequisites; nothing here was performed.

## Active-branch guest-to-receipt gate

The [Priority 3 local rehearsal](GUEST_TO_RECEIPT_PRIORITY_3_LOCAL_COMPLETION.md)
is not a hosted or physical till/print acceptance. Keep Tier 1 recovery and
Tier 2 exact-target isolation first. Once the owner designates the isolated
non-production target, separately authorize fresh read-only ledger/catalog
and ACL/compatibility checks. Then decide on the exact app and migration
set, including separate written decisions on `20261118002000` and
`20261118002100` (neither is part of the frozen bundle; both **NOT
AUTHORIZED**). The realtime file also changes the target's `supabase_realtime`
publication and refuses to run if that publication already carries other
tables; review the target publication before any authorization decision. Only after recovery and exact apply /
deploy approval, authorize synthetic acceptance with real Supabase identity
and Data API, separate guests and outlet roles, and the device, interruption,
ledger/print/share and redaction checks in the report. This does not advance
GST/IRP, payments, or other provider approvals. No action performed.

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
| 2.1 | Email activation — **Brevo selected** (owner decision 2026-11-16; code implemented; **owner credentials created 2026-11-16** — API key `AutoDine-Preview` + SMTP credentials, values owner-held only; agent set Vercel Preview `AUTODINE_EMAIL_PROVIDER=brevo`; remaining = owner dashboards + deployment gate in `docs/operations/BREVO_ACTIVATION_OWNER_CHECKLIST.md`) | Exact steps in `docs/operations/BREVO_EMAIL_RUNBOOK.md`: B1 Brevo Free signup → B2 verify one owner-controlled sender (6-digit code; temporary, unauthenticated-domain limits apply) → B3 API key (`xkeysib-…`) into Vercel **Preview** (`AUTODINE_EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `AUTODINE_EMAIL_FROM`, `BREVO_WEBHOOK_SECRET`; optional `AUTODINE_EMAIL_REPLY_TO`) + Brevo transactional webhook to `/api/email/brevo/webhook` → B4 Supabase **test** project (`juwyhslzchjevqkdvwjm`) Brevo SMTP (`smtp-relay.brevo.com:587`, SMTP login + **SMTP key**, not the API key) + raise Auth email rate limit from 2/hr + redirect allow-list for the test origin (see O-B3) → B5 controlled tests to owner mailboxes only (runbook §2/§4) → **B6 Production is a separate approval**; **B7 after domain purchase:** authenticate domain in Brevo (Brevo code + DKIM + DMARC DNS records, §5) and switch senders to the domain before any branded/customer sending | Controlled real email received + auth links + webhook events evidenced in `qa-evidence/day1/BREVO_AUTH_EMAIL_IMPLEMENTATION.md`; domainless-phase completion (incl. reply-to support, live zero-config Vercel verification, explicit no-order/receipt-email scope) in `qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md`; branded delivery only after B7. Secrets only ever typed into Brevo/Vercel/Supabase dashboards, never chat/git |
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

**3.4 Staging target and the QR boundary (2026-11-19, from Reports A and B):**

| Decision | Why it is needed |
|---|---|
| Designate a Staging target (candidate or new project) | No target means no acceptance; the candidate is PARTIALLY EXPLAINED and not eligible as-is |
| Authorize `20261118002200_qr_code_staff_boundary.sql` for that target | Two cross-tenant defects are live on the candidate today; this is the only file needed to close them |
| Confirm the third workstream's `announcement_claim_recovery` (PR #195) as intentional | It is the candidate's newest ledger row and came from `main`, not from this branch |
| Record a disposition for the 2026-11-11 `qr_verification_attempts_legacy_*` object (origin now proven, inert, 0 rows) | Evidence or cleanup — the owner's call |
| Accept the older `owner_billing_configuration_guard` revision, or authorize `20261115000200` | Defence-in-depth delta (missing `service_role` revoke) |
| Drop `autodine_local_test_scaffold` before any Staging label | Inferred local DDL must not sit under a Staging name |

## Tier 4 — Commercial & statutory (separately authorized tracks)

For the delivered 114-file GST baseline, use the [current GST owner decisions](GST_OWNER_ACTION_REGISTER_2026-11-18.md#current-workstream-b-decisions)
and the [local closure evidence](GST_WORKSTREAM_B_FINAL_CLOSURE.md). No
hosted permission or operator sign-off follows from local proof.


| # | Action | Notes |
|---|---|---|
| 4.1 | Billing provider selection + certification (register C1) | Razorpay or other INR provider; live billing stays OFF until chosen + certified. Webhook pipeline is locally verified in sandbox mode |
| 4.2 | GST per-tenant mode decisions + adviser sign-off (C2) | CA product specification confirmed for local implementation only. Confirm Owner-only GST writes (Manager read-only) and provide the signed [tenant/registration and outlet decision record](../../docs/gst-two-mode-2026-11-14.md#owner-and-adviser-decision-record): activate/defer, registration, GST or No-GST situation, GSTIN where applicable, FSSAI, service SAC, eligible hotel evidence/effective date, AATO, series allocation, classification, and correction/IRN hold handling. |
| 4.3 | GST/IRP migration + e-invoice authorization (C3) | All 26 GST/IRP files in the [manifest](../../docs/migration-manifest-2026-11-14.md) remain **NOT AUTHORIZED**. Separately name the isolated target and authorize read-only preflight; then decide on exact filenames/checksums and synthetic acceptance only after reconciliation and restore evidence. IRP/GSP is a separate decision after outlet/CA eligibility, provider contract/trust and a controlled authorization. See the [synthetic-only Priority 2 evidence](IRP_PRIORITY_2_LOCAL_COMPLETION.md). No live IRP test or activation now. |
| 4.4 | Credit/debit notes UI decision (C4) | Local full-document note ledger and owner/manager controls exist with holds; per-tenant adviser/owner sign-off on corrections is still required. No partial notes, refund or IRN activation. |
| 4.5 | PR #181 disposition (register E) | Explicit merge/close decision; nothing by default |
| 4.6 | Quantity > 99 (register G) | Recommendation recorded (keep cap); needs owner's written adoption. Not launch-blocking |
| 4.7 | Staging billing sandbox rehearsal (A6, optional) | Separate authorization if wanted pre-launch |

## Already closed — do not re-open

B5 staging review-credential rotation (DONE 2026-11-16); B3 QR secret hygiene (CLOSED); B2 `ADMIN_SECRET` rotation (configured; live proof rides on 2.5); A4 cron secrets (configured, metadata-verified); A1 Production ledger probe (executed 2026-11-16, SELECT-only; reconciliation in Batch 1); B2 backup pipeline implementation incl. retention + restore-verification hardening (landed on `main`, 22/22 blob-identical; DR 50/50). Supabase PITR purchase (D2) remains an open *option*, decided in Runbook Package 3.
