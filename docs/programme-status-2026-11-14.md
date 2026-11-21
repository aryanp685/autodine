# AutoDine programme status — 2026-11-14 (consolidated report)

**Branch:** `arena/9b120325-autodine` (active) · **Base:** `b866601` (main, merge of PR #185)
**HEAD at this report:** the commit carrying this file. NOTE — an environment reset between turns destroyed all 21 commits listed in §A (fresh clone at `b866601`, worktree intact). The content was re-verified (npm ci, `npm test` 2324/198 — identical) and restored as a single commit; pre-reset HEAD was `a9a7b3b`. Hashes in §A/§B are the lost history's identifiers, kept for provenance.
**Nothing was pushed, merged, deployed, or applied to any hosted database. Production remains read-only and untouched. `--ack-drift` was never passed. No secrets were decrypted; no provider was configured; no paid service was used.**

This is the single consolidated report for the six-item 2026-11-14 programme. Every locally executable item is now complete (items 2 and 3) or completed as far as a disposable local stand-in allows (item 4); everything else is explicitly gated on owner authorization or hosted access and is listed in §E. Owner-accepted commits `1b0263b`, `717d6a0`, `5da9f73` are preserved unchanged, as are all earlier commits on this branch.

## A. The commits on this branch (oldest → newest)

| SHA | Content |
|---|---|
| `da6c96d` | Strengthen report_sales boundary tests |
| `0456d98` | GST two-mode billing with B2B/e-Invoice readiness (docs; no IRP provider) |
| `7fc2a79` | Serialize outlet creation, subscription payments and expiry (forward migrations) |
| `6467c36` | Independent logical backup/restore pipeline with offline selftest |
| `773f938` | Reconciliation evidence, rehearsal prep and readiness documentation |
| `d2a36a1` | Privileged-function audit tooling and SAFE forward hardening |
| `a452506` | Credit/debit notes with IRP-aware fail-closed payloads (forward migration) |
| `6f10386` | RLS coverage inventory probe renamed; safety contract documented |
| `eb1ff22` | Monitoring: provider-independent incident core wired to real failure paths |
| `d7a33c5` | Incident core + `[autodine:alert]` prefix documented |
| `5f963c1` | Hosted acceptance preparation: offline env validator for the staging runner |
| `5d5ce43` | Lint fix in the acceptance-env test |
| `1b0263b` | GST migrations made idempotent on re-run (owner accepted) |
| `717d6a0` | CI: staging guards + backup selftest in the check job (owner accepted) |
| `5da9f73` | Backup: enum/domain dump, dependency-order functions, EXECUTE ACLs kept; logical restore drill (owner accepted) |
| `7a15d53` | e-Invoice issuance readiness: profile columns, app integration, audited attempt action |
| `52240e8` | Invoice history: owner/manager e-Invoice follow-up panel |
| `cb8f9b5` | report_sales rehearsal doc re-derived on the 89-migration tree; upgrade verification 9/9 PASS |
| `c3b11c3` | logical-restore drill: admin client closed before server shutdown (was crashing after a PASS) |

## B. Local verification evidence (HEAD `c3b11c3`, 2026-11-14)

| Check | Result |
|---|---|
| `npm test` | **2,324 passed / 198 skipped** (205 files passed, 8 skipped); skips are hosted-gated suites |
| `npm run test:db:embedded` | **198/198** (disposable embedded PostgreSQL 17.11, 89 migrations) — run at `7a15d53`; no DB-affecting commit since |
| `npm run test:db` (native, custom-format restore) | **Not the CI job — see item 4.** Local stand-in passed: full replay + integration suite on disposable PG 16.2, then `LOCAL_RESTORE_VERIFIED {tables:51, policies:58, functions:124, archiveBytes:1102773}` (2026-11-14) |
| `npm run test:db:logical-restore` | **green at `c3b11c3`** — 89 migrations, 47 tables/58 policies/160 functions (public schema), `autodine-logical-1` backup verified restore fingerprint-identical; `productionBackupClaim: false` |
| `npm run e2e:demo` | **64 passed / 0 unexpected / 0 flaky** at `c3b11c3` |
| `npm run typecheck` / `lint` / `design:check` / `sql:check` | clean |
| `npm run isolation:verify` | **14/14 PASS** (offline preview/production isolation self-test) |
| `npm run test:staging:guards` | **25 pass / 0 fail** |
| `npm run test:db:report-sales-upgrade` | **9/9 PASS** (pre-fix markers reproduce; post-fix markers match the committed tree; re-application stable) |
| `npm run test:backup` | 14/14 (pre-compaction evidence, unchanged pipeline) |

**Not verified / not claimed anywhere in this report:** hosted staging or Production behaviour; hosted backup restore or PITR; hosted monitoring delivery or paging; email delivery; real devices/printers; real payment provider or live money; load/SLO numbers; GST CA/adviser sign-off; Production apply of any migration; the CI `native-database` job.

## C. The six items, final state

### 1. report_sales security remediation — staging rehearsal (BLOCKED on S0)

Prepared and locally re-verified; **not executed**. The committed fix
`20261112000300_report_sales_export_authorization.sql` (sha256
`968ae47c…b874a4`, unchanged) adds the Owner/Manager predicate (42501),
400-day range cap (22023), `p_order_limit` clamp to 10,000, `p_bucket`
hour|day only, UTC fallback — grants unchanged. Pre-fix markers reproduce
on the current tree; post-fix markers match; re-application is stable
(`npm run test:db:report-sales-upgrade` 9/9; doc refreshed in `cb8f9b5`,
928-line rehearsal runbook otherwise unchanged).
**Blocked on:** the owner naming `juwyhslzchjevqkdvwjm` in writing (S0),
the S3 backup disposition (a/b), the executor, and the evidence location.
Production apply is a separate, separately-gated decision and stays closed.

### 2. Provider-independent GST — B2B capture + IRP/GSP readiness (DONE)

Committed `7a15d53` + `52240e8` (+ this report's predecessors):
- B2B recipient capture on Regular GST tax invoices (issue-time
  `p_recipient`; GSTIN format+checksum enforced at the app boundary,
  format at the database; state code derived from the GSTIN; snapshotted;
  rendered on invoice screen and share links).
- IRP/GSP readiness as an app integration, **not a live provider**:
  `lib/gst/einvoice.ts` (pure, fail-closed preparer — GST figures
  allocated largest-remainder exact-sum), `lib/gst/einvoice-server.ts`
  (RLS-scoped loader, env gate), `app/invoice/[id]/einvoice-actions.ts`
  (audited attempt: `payload_built → submitted → accepted|rejected|transport_error`,
  audit-RPC-first, fail-closed; never flips the document to generated;
  sandbox output is labelled non-IRP), owner/manager-only
  `EinvoiceAttemptButton`, and — new today — an owner/manager **e-Invoice
  follow-up panel** on `/dashboard/invoices` reading the
  `list_restaurant_irp_reconciliation()` surface (invoker-rights,
  RLS-scoped; cashier/kitchen see nothing and make no RPC call).
- Embedded-PG integration proves the issuance profile persists with a
  history mirror and rejects bad PIN/HSN/short-location (198/198).
- Document never renders as filed without a real IRN; B2C is always
  `not_required`; the offline sandbox is explicitly not an IRP.
**Not built (owner decision):** live IRP/GSP adapter + credentials, IRN
cancellation workflow, HSN/SAC on lines, status-reconciliation aging job.

### 3. Resend/Auth + monitoring + alerts + workflows — verified; hosts gated

**Implementation status: code built and locally green; no provider chosen or
configured anywhere; every hosted step is preparation-only.** Verified today:
- Resend/Auth: signup/resend/confirm are enumeration-safe and unit-tested
  (confirm route 11/11, actions + pending screens pass). App calls no mail
  API; deliverability is hosted Supabase Auth SMTP. `docs/resend-auth-readiness-2026-11-14.md`
  remains the checklist; Resend unconfirmed, no DNS, no SMTP, no mailbox,
  no CAPTCHA decision. No production Auth change will be made.
- Monitoring: `lib/monitoring-incidents.ts` — validation, in-memory
  dedup (open→acknowledged→resolved, TTL sweep), `[autodine:alert]`
  formatter, `deliverWithRetry` (bounded backoff, never throws) —
  wired into `POST /api/ops/realtime-alert` and `GET /api/health`.
  **Verified today:** incidents 16/16, realtime-alert route 5/5,
  realtime-alerts 10/10, realtime-monitor 3/3, health route 2/2.
  No ack/resolve UI exists (deliberately); the tracker is per-instance;
  structured logs are the durable record; **no delivery observed, none claimed.**
  `docs/monitoring-readiness-2026-11-14.md` updated to match today's evidence
  and the retired `[autodine:realtime-alert]` prefix.
- Alerts/workflows: CI `check` job runs staging guards + backup selftest +
  logical restore drill (`717d6a0`); the `native-database` job exists but has
  **never run** (item 4). No alert-delivery workflow exists; none is claimed.

### 4. CI native-database restore drill (local stand-in passed; CI never ran)

- **CI `native-database` has still never executed** — the branch has no
  remote ref (HTTP 422 on dispatch), so the custom-format drill has produced
  no CI 15/17/18 evidence. Do not call this complete.
- **Improvement made today:** a genuine custom-format `pg_dump`/`pg_restore`
  drill now exists locally. Official PG client binaries were unavailable
  (no apt; embedded PG ships only `initdb`/`pg_ctl`/`postgres`), so a
  disposable PG 16.2 (PyPI `pgserver`, 0.1.4) was used with a minimal empty
  `pgcrypto` stand-in (the migration chain uses no pgcrypto functions —
  `gen_random_uuid` is core; the shim only satisfies `create extension`).
  Result: full 89-migration replay, **198/198** integration tests, then
  `LOCAL_RESTORE_VERIFIED {tables:51, policies:58, functions:124}` — a real
  custom-format dump/restore with a fingerprint comparison. **Disclosed:
  PG 16.2 ≠ CI matrix; the stand-in is not a hosted or CI claim.**
- `npm run test:db:logical-restore` re-verified at HEAD (89 migrations,
  47/58/160 objects fingerprint-identical) and a real shutdown bug in it was
  fixed (`c3b11c3`) — it previously crashed with an unhandled `error` event
  *after* printing VERIFIED, risking a false failure exit code.

### 5. Migration investigation — classification current; Production unresolved (never `--ack-drift`)

Re-ran the reconciler today: ledger and comparison reproduced as committed
(`scripts/reconcile/evidence/classify-production-2026-11-14.json` —
**176 findings**; `report_sales` remains the one known drift with direct
confidentiality impact; `operational_schema_readiness` is absent in
production; 44 repository migrations have no ledger record). The three
serialization migrations `20261112000500–700` remain correct for
production's actual state but unapplied/unverified there. Nothing was
applied, acknowledged, or re-baselined; the 20261113xx re-apply remains
forbidden. **All apply verdicts remain owner decisions.**

### 6. Hosted synthetic acceptance + Preview isolation (hosted-blocked / config-verified)

- **Hosted synthetic acceptance** (`docs/hosted-synthetic-acceptance-2026-11-14.md`)
  — prepared, offline env validator green (`test:staging:guards` 25/0).
  **Not run**: requires S0 authorization, the report_sales rehearsal (or
  written waiver), synthetic fixtures, and Resend/Auth for Scenario A.1.
- **Preview isolation — read-only hosted verification completed 2026-11-14**
  (`docs/preview-isolation-verification-2026-11-14.md`): at the configuration
  level the Supabase split is correct — preview/development
  `NEXT_PUBLIC_SUPABASE_URL` = staging (`juwyhslzchjevqkdvwjm`), production
  = `bdbaqpevwmgdvghszjno`; secret entries are per-environment and distinct
  (values not decrypt-verified); both READY previews (`dpl_EGp5…` PR #182,
  `dpl_HrRZ7…` PR #185) are `ready_state READY`, `target null`, OIDC
  `environment: preview`, and were built after the env split.
  **Findings (owner disposition required):** production `GEMINI_API_KEY` and
  `GROQ_API_KEY` shared with preview; stale branch-scoped overrides for
  `arena/3711df6a-autodine` and a `GEMINI_KEY_VERIFY_TMP` development leftover;
  `ADMIN_SECRET` absent in preview/development (fail-safe but a checklist gap);
  old pre-split previews unverified (deletion not performed); **runtime
  database traffic of a preview is still not proven — the hosted smoke run
  remains outstanding.** The "no new previews until proven" rule is relaxed to
  "previews may build; runtime smoke + findings outstanding" — not to "done".

## D. Still not built / not claimed (deliberate)

Live IRP/GSP provider and credentials; IRN-cancellation workflow; HSN/SAC on
lines; status-reconciliation aging job; payment provider (any); discounts;
hosted restore rehearsal/PITR; hosted monitoring delivery; device acceptance;
any Production write; any DNS/SMTP/Auth change; any preview deletion;
CA/adviser sign-off.

## E. The one consolidated owner request (updated 2026-11-14)

1. **report_sales staging rehearsal (S0)** — name `juwyhslzchjevqkdvwjm`
   in writing; choose the S3 disposition; name the executor; name where the
   evidence is filed. (Then: either execute per the runbook, or waive in writing.)
2. **Push `arena/9b120325-autodine` to origin** (nothing is pushed) and
   dispatch the `Disposable Supabase E2E and load` workflow, or authorize a
   Docker-capable runner — still the only route to full-stack evidence.
3. **CI native-database** — after the branch is pushed, the `native-database`
   matrix (PG 15/17/18) will run and produce the first true custom-format CI
   evidence; confirm you want that dispatch (it is part of `ci.yml` on push).
4. **Resend/Auth** — confirm Resend; sender domain + from-address; authorize
   staging DNS/Auth SMTP inspection; provide an authorized test mailbox;
   CAPTCHA enable/waive; rate-limit values or delegate.
5. **Monitoring** — pick the uptime provider; confirm the Vercel plan's
   Log Drain entitlement; name the paging recipient + second contact; set
   thresholds after a traffic baseline; name the weekly-digest owner.
6. **Devices & pilot** — pilot device matrix, venue/bench Wi-Fi, printer
   model(s), and an outlet for device acceptance (staging or an explicitly
   authorized pilot outlet).
7. **Backup/PITR** — authorize a hosted restore rehearsal to an isolated
   non-production target; confirm plan/PITR entitlement; set numeric RPO/RTO
   and ownership; choose the external backup destination and scheduler.
8. **GST remaining scope** — (a) choose or explicitly defer the IRP/GSP
   provider (fail-closed `irp_status='pending'` stays until then);
   (b) credit/debit note scope (built IRP-aware, not yet issued anywhere);
   (c) CA/adviser review of the two-mode + issuance build and sign-off of the
   rollout gates.
9. **Payment provider** — select or ratify manual pay-at-counter only.
10. **Discount policy** — provide written policy; discounts stay disabled.
11. **Production-only schema drift** — decisions on the 95 production-only
    objects, `restaurant_subscriptions` cluster, QR-verification design,
    `*_staff_*` vs `*_manage` policies, and the `--ack-drift` disposition.
12. **History acknowledgment** — `1b33bc4`…`0456d98` (rebuilt set) accepted as
    the continuation of the lost commits.
13. **Preview findings (new)** — disposition the shared `GEMINI_API_KEY` /
    `GROQ_API_KEY` across production+preview; the stale
    `arena/3711df6a-autodine` branch overrides; `GEMINI_KEY_VERIFY_TMP`
    (development); whether preview receives its own `ADMIN_SECRET`; and
    whether pre-split previews may be deleted (they are not READY previews
    of this branch, but deletion is destructive — not done).
14. **Pilot launch gate** — after (1)–(13): approve the hosted synthetic
    acceptance run on staging; pilot scope per `PHASE-7-PILOT-SCOPE-DECISIONS.md`.

**Standing reminders:** nothing here authorizes a Production write; the two
READY previews stay READY and untouched; no payment keys; no Production
Auth/SMTP/DNS/backup changes; Production stays read-only; `--ack-drift`
never without (11); previews build but hosted runtime smoke stays outstanding
until authorized.

## F. How to re-check

```sh
git log --oneline b866601..HEAD
git diff --stat b866601..HEAD
npm ci
npm test                       # 2324 passed / 198 skipped
npm run test:db:embedded       # 198/198 (disposable PG 17.11)
npm run test:db:logical-restore# 89 migrations; fingerprints match; exit 0
npm run e2e:demo               # 64 passed / 0 unexpected / 0 flaky
npm run typecheck && npm run lint && npm run sql:check && npm run design:check
npm run isolation:verify && npm run test:staging:guards && npm run test:db:report-sales-upgrade
# Native custom-format restore stand-in (disclosed PG 16.2): see §C-4
```

Hosted claims require the separately authorized runs above and are made nowhere
in this document.
