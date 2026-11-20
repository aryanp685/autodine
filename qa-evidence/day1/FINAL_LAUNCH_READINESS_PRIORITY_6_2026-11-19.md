# P6 — Final launch readiness, staging acceptance and release gates (2026-11-19)

**Branch:** `arena/ce32f7c8-autodine`, based on `7064c912b1b85ab6364f23d1755d855ff4f462ad`
of `arena/2670dd12-autodine`. Worktree carries P1–P6 changes (263 paths);
**nothing committed, nothing pushed, nothing staged**. All work below is local,
except one read-only Supabase metadata call (§8) and one read-only migration
listing on the *candidate* project.

**Four verdicts:**

| Verdict | Result |
|---|---|
| LOCAL RELEASE CANDIDATE | **PASS** — all local gates green; 20/20 product journeys, 2/2 IRP simulation journeys, 13-suite native integration 286/1, replay and populated upgrade 270/3, build 28/28, 47 release checks |
| STAGING ACCEPTANCE | **NOT AUTHORIZED** — no designated Staging target; candidate carries unresolved ledger drift (§8) |
| PROVIDER ACCEPTANCE | **NOT AUTHORIZED** — no IRP provider, no payment gateway, no Production credential (§9) |
| PRODUCTION RELEASE | **NO-GO** — blocked by the three above plus the owner decisions in §9 and the recovery gate |

---

## 1. Baseline and preservation

| Item | State |
|---|---|
| Branch / base | `arena/ce32f7c8-autodine` / `7064c912…` (as recorded in session context) |
| Remote | `origin` = `aryanp685/autodine`; no push performed |
| Index | 0 staged entries before and after P6 |
| Worktree | 263 changed paths (all P1–P6 work); no file deleted, renamed or reverted |
| Migrations | 118 files: 98 tracked and git-verified unmodified, 20 untracked (added by P1–P4 on this branch) |
| Protected predecessors | 0 digest mismatches (§13) |
| Hosted writes | **None.** One read-only project listing and one read-only migration listing (§8) |

P1–P5 closures were not reopened. The only files P6 changed are listed in §12.6.

---

## 2. Gap A — Unregistered and Composition outlets in a real browser

`e2e/journey/nogst.desktop.spec.ts` (2 tests, both passing inside the 20-test
journey suite) drives the full guest-to-receipt path for:

- **Unregistered outlet** — receipt is a **Bill of Supply**, shows GSTIN and
  FSSAI where the rules require them, carries **no tax rows**, records
  `irp_status='not_required'`, and the IRP register never offers the outlet a
  route. Payment is a single recorded cash tender (`10511` paise) reconciled to
  the sitting; refresh and a repeated submit do not create a second bill.
- **Composition outlet** — receipt is a **Bill of Supply with the mandatory
  composition declaration**, still no tax rows and no IRP workflow, and the
  printed document and the database row agree.

The distinction that mattered here is a UI/data one: `document_type` is not
`gst_tax_invoice` for either outlet, so any code path that assumed "invoice"
would have shown tax rows or an IRN placeholder. Both specs assert the absence
explicitly (`IRN pending` renders 0 times).

## 3. Gap B — IRP owner/manager browser journey on synthetic data

`e2e/journey/irp.simulation.spec.ts`, **2/2 passing** (40.7 s) against a real
production build served by `next start`:

| Test | What it proves |
|---|---|
| eligibility, offline preparation, simulated response, lookup recovery, cancellation | Turnover evidence and route choice are owner-only (the manager sees `Read only.…` and no save control); the covered B2B document is prepared **offline**, queued, and answered by the local simulator; the acknowledgement is labelled **`Verified synthetic evidence — not an IRN`** with a **simulation reference**; the invoice keeps `irn = null` and `irp_status='pending'` throughout; `void_restaurant_invoice` is refused with `P0001 / Reconcile IRP evidence`; a cancellation inside the window is confirmed (`Simulation cancellation confirmed`, `Cancellation recorded at …`) and the legal hold text remains |
| a lost response is looked up, never resent, and B2C stays untouched | After an accepted-then-lost first answer the register offers **Request lookup** and *not* a retry; the lookup resolves the same document (claims `1 generate · 1 lookup`); a second B2C order at the same outlet is a normal `gst_tax_invoice` with `irp_status='not_required'`, prints, shares via a 24-hour link, and never shows an IRN placeholder |

The journey is honest by construction: the simulator is a local process
(`lib/gst/irp/execution/simulator.ts`) with a generated key pair and a
synthetic registry row; the register prints "No live IRP is enabled" and the
UI never presents the simulation reference as a legal IRN.

`e2e/journey/irp-closed.desktop.spec.ts` (1 test) proves the counterpart in the
**ordinary production build**: the same owner sees the register read-only, with
no route selector, no `Save route` and no `Validate IRP payload offline`
control. This is the regression guard against a rehearsal configuration
leaking into a shipped build.

### 3.1 The blocker that was actually in the way

The previous segment's "clicks do nothing" symptom had two causes, both now
fixed and documented:

1. **CSP.** `lib/csp.ts` ships `script-src 'self' 'nonce-…'` with no
   `unsafe-eval`; `next dev` requires `eval`, so nothing hydrated. Collected
   `securitypolicyviolation` events proved it (`script-src eval`). The journey
   now runs a production build, which is also the only honest way to test
   production behaviour.
2. **Preflight gate.** With a production build the offline IRP gate was
   correctly closed. Rather than weaken it, P6 added an explicit
   **hermetic-rehearsal identity**: `isHermeticIrpRehearsal()` requires
   `GITHUB_ACTIONS=true`, `CI=true`, `AUTODINE_TEST_DEMO_BUILD=true`,
   `VERCEL_ENV='test'` and a loopback `NEXT_PUBLIC_SUPABASE_URL`. `production`
   and `preview` are refused outright, as is any non-`sandbox` provider.
   `lib/gst/adapter.test.ts` (new, 2 tests) pins that matrix; `GET`-style
   remote origins and `CI=false` are refused too.

### 3.2 Test-defect fixes made along the way (not product changes)

- The draft row for one invoice is now found by its document link inside an
  `li`, not by a page-wide `exact` text match.
- The queue action is awaited by its visible outcome before the worker runs,
  so the test no longer races the server action.
- `Request lookup` / `Queue simulation cancellation` are awaited by **dispatch
  phase** (`lookup_queued`, `cancel_queued`) before the schedule is advanced,
  because the status notice text is identical for the previous action.
- Each test re-saves the local route idempotently, so the suite is
  order-independent (a filtered single-test run behaves like a full run).
- Outlet *d* now carries the complete e-invoice profile (`einvoice_location`
  Nagpur, `einvoice_pincode` `440001`, `einvoice_hsn_sac` `996331`), which the
  product requires before it will prepare a document.

## 4. Gap C — Auth / PostgREST / Realtime readiness on disposable infrastructure

Tested only on local disposable PostgreSQL (`npm run test:db:integration`,
13 suites, 286 passed / 1 skipped). The single skip is the long-standing
hosted-PostgREST case that cannot run against a loopback cluster; it is
reported as a skip, never a pass. There is no new product defect open in this
area, and P6 adds no speculative rewrite.

Two defects *were* demonstrated and fixed with regression coverage in this
phase, both at the boundary rather than in the data path:

| Defect | Fix | Regression |
|---|---|---|
| The IRP offline gate could only be opened by the development environment, which the shipped CSP makes unusable | Explicit hermetic-rehearsal identity in `lib/gst/adapter.ts` | `lib/gst/adapter.test.ts` (2 tests) + `irp-closed.desktop.spec.ts` |
| A filtered IRP run could not reproduce a full-suite run (route not saved, action not yet committed) | Order-independent helpers and phase-based waits in the spec | both IRP tests pass individually and together |

## 5. Migration safety review (per file)

Every one of the 118 files was reviewed for: version ordering and uniqueness,
filename convention, dependency order, forward-only style, populated-table
compatibility, destructive statements, publication preservation and
RLS/grant/definer hygiene. Result of the mechanical part
(`npm run register:migrations`):

- **118 files / 118 manifest rows / 0 problems** — no duplicate version, no
  gap in ordering, no file missing from the manifest, no manifest row without
  a file.
- **59 files contain DROP/TRUNCATE/DELETE statements**; the register lists
  every one. The `DROP`s are `drop policy if exists`, `drop
  function/trigger/constraint if exists`, or a forward `create or replace`
  whose replacement follows immediately in the same file.
- `TRUNCATE` appears only on the session temporary tables `tt_order_lines` and
  `tt_line_addons` inside trigger helpers; two further files *revoke* the
  `TRUNCATE` privilege rather than using it. No application table is
  truncated anywhere.
- `delete from public.<table>` appears in **13 files**, each scoped by a
  predicate: zero-quantity order lines for one order, one membership row, expired
  rate-limit windows, one QR attempt/budget key, and the menu-snapshot
  replacement limited to that menu's ids. One file
  (`20261110000800_remove_order_submission_caps.sql`) also removes obsolete
  `po:s:%` / `po:t:%` rate-limit keys in a single forward cleanup. None is an
  unqualified table wipe, and none runs at apply time against unknown data.
- `20261118002100_operational_realtime.sql` is the only file that touches
  `supabase_realtime`, and it **refuses** to alter a publication that already
  contains other tables — the safe direction for a target whose publication
  state is unknown.
- The three token-scoped anon entry points from P4 remain the only new
  `SECURITY DEFINER` surfaces; the definer audit is unchanged in shape at
  148 audited / 81 flagged (heuristic triage, not a clearance).

## 6. Replay and populated upgrade

| Run | Command | Result |
|---|---|---|
| Full-chain replay, no application scaffolds | `npm run test:db:embedded` | **118 migrations, 270 passed / 3 skipped** |
| Populated upgrade from the P4 baseline | `READINESS_GST_UPGRADE=1 npm run test:db:embedded` | **270 passed / 3 skipped**, 10 files |

The populated upgrade preserves financial, order, guest, table, audit and share
rows, continues series counters, and performs no rewrite or backfill. The 3
skips are the same environment-gated cases carried since P2 (hosted/direct
PostgREST and clock-dependent paths in a loopback cluster).

## 7. Per-migration authorization register

New: [`docs/migration-authorization-register-2026-11-19.md`](../../docs/migration-authorization-register-2026-11-19.md),
generated by `npm run register:migrations`
(`scripts/release/render-migration-register.mjs`). It reproduces all 118 rows
with classification, authorization state, dependency note and destructive
statement inventory, and it is regenerable, so a reviewer can diff it rather
than trust it.

Authorization state is unchanged from P5: **24 GST/IRP files plus the two
Priority 2 files plus `20261118002000` and `20261118002100` are each
`NOT AUTHORIZED`**. Reading or regenerating the register authorizes nothing.

## 8. Staging authorization and the 14-point checklist

Full document:
[`docs/staging-authorization-and-acceptance-2026-11-19.md`](../../docs/staging-authorization-and-acceptance-2026-11-19.md).

**No hosted Staging acceptance was executed**, and none can be until the owner
designates a target. Evidence gathered read-only this session:

| Project | Ref | Region | PostgreSQL | Status |
|---|---|---|---|---|
| `autodinetest` | `juwyhslzchjevqkdvwjm` | ap-northeast-2 | 17.11.0.018 | ACTIVE_HEALTHY — **candidate only** |
| `autodine-production` | `bdbaqpevwmgdvghszjno` | ap-south-1 | 17.11.0.003 | ACTIVE_HEALTHY — out of scope |

**New finding: the candidate has drifted.** Its ledger holds 13 entries that
are not this repository's sequence (including `autodine_local_test_scaffold`,
`arena_staging_forward_upgrade_55`, two ad-hoc names) and its newest entry,
`announcement_claim_recovery`, was applied **2026-11-19 10:11 UTC** — not by
this session and not present in this repo. No migration from this branch may
be applied to that project until the drift is explained and the authorized
set is agreed file by file.

The 14 acceptance points (identity, ledger parity, authorized replay, role/RLS
matrix, auth round-trip, guest journey, unregistered receipt, composition
receipt, IRP rehearsal, realtime fallback, payment reconciliation,
print/share/redaction, rate limits, recovery/rollback) are each **NOT RUN**,
with pass criteria, evidence requirements and exact commands recorded.

**Verdict: STAGING ACCEPTANCE — NOT AUTHORIZED.**

## 9. Provider and owner dependency register

Full document:
[`docs/operations/PROVIDER_DEPENDENCY_REGISTER_2026-11-19.md`](../../docs/operations/PROVIDER_DEPENDENCY_REGISTER_2026-11-19.md).

Twelve dependencies with state and the exact owner action. The blocking ones:

| Dependency | State |
|---|---|
| IRP provider + sandbox | NOT AUTHORIZED — local simulator only; no credential, endpoint or runtime network adapter |
| IRP production credential | NOT AUTHORIZED — gate refuses production/preview and any non-sandbox provider |
| Payment gateway | NOT AUTHORIZED — cash and manually verified UPI only; no aggregator |
| Supabase Staging | BLOCKED — candidate only, ledger drift (§8) |
| Supabase Production | NO-GO — read-only metadata only |
| Vercel deployment | NOT AUTHORIZED — local hermetic build only |
| Email (Brevo) | PARTIAL — domainless Preview only; Production separate |
| Backblaze B2 backup | SELECTED, DEFERRED — implementation parked, no bucket/key |
| Monitoring / paging | PARTIAL — log-line alerts only, no external pager |
| Domain / DNS, GST portal, CA sign-off | NOT AUTHORIZED / NOT APPLICABLE locally |

**Verdict: PROVIDER ACCEPTANCE — NOT AUTHORIZED.**

## 10. Security and reliability verification

| Check | Result |
|---|---|
| Strict CSP preserved | `lib/csp.ts` unchanged: `script-src 'self' 'nonce-…'`, no `unsafe-inline`, no `unsafe-eval`, no `blob:`; `lib/csp.test.ts` green |
| Gate cannot be opened in a deploy | `lib/gst/adapter.test.ts` refuses `production`, `preview`, remote origin, `CI=false`, `real` provider |
| Production build has no synthetic controls | `irp-closed.desktop.spec.ts` |
| Cross-outlet refusal | asserted for all five staff roles through definer RPCs and guest-token probes (integration test 1) |
| Invoice immutability with IRP evidence | `void_restaurant_invoice` → `P0001 / Reconcile IRP evidence` |
| Definer audit | **148 audited / 81 flagged** (unchanged from P5); triage list, not a clearance |
| Secret scan of the build | no `sb_secret_*`, service-role key or JWT material in `.next/static` or `.next/server` |
| No secret in evidence | no value read, printed or stored; the Supabase calls were metadata-only |

Residual risks that are unchanged and documented rather than silently accepted:
heuristic definer flags need periodic review; realtime fallback depends on staff
refreshing; the paging path is a log line until an external pager is approved.

## 11. Operations runbooks

New: [`docs/operations/INCIDENT_RUNBOOKS_2026-11-19.md`](../../docs/operations/INCIDENT_RUNBOOKS_2026-11-19.md)
covering the six required scenarios with a read-before-retry rule and a
two-person rule for money and tax:

1. **Database/platform outage** — blast-radius check, poller backoff
   (`2s → 60s`), reconcile-before-resume, restore only under a separate
   authorization.
2. **Failed or disputed payment** — per-order resolution, no duplicate payment
   row, credit note instead of deletion, UPI reconciliation against the
   statement.
3. **IRP failure / lost response** — register follow-up filter,
   lookup-before-resend, retry only after the lookup proves non-receipt, hold
   and cancellation inside the window, never a hand-edited dispatch.
4. **Realtime degradation** — distinguish transport from data, documented
   manual refresh fallback, guest poller behaviour, post-recovery
   reconciliation.
5. **Escalation ladder** — S1/S2/S3 with acknowledgement and containment
   targets, one incident owner, UTC timeline, contacts owner-held.
6. **Post-incident** — root cause, affected documents, correction path,
   regression test.

Existing backup/restore, PITR, monitoring, preview-access and email runbooks
remain the references of record and are linked, not duplicated.

## 12. Full final gate run

### 12.1 Static and policy gates

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run design:check` | exit 0 |
| `npm run sql:check` | exit 0 (parser only, not native execution) |
| `npm run migrations:verify` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run verify:release` | **OK — 47 checks (118 files)**; explicitly "not release authorization" |
| `npm run audit:definer` | 148 audited / 81 flagged |
| `npm run register:migrations` | 118 files / 118 rows / **0 problems** |

### 12.2 Native and unit

| Gate | Result |
|---|---|
| `npm run test:db:integration` | **13 suites, 286 passed / 1 skipped** |
| `npm run test:db:embedded` | **270 passed / 3 skipped** |
| `READINESS_GST_UPGRADE=1 npm run test:db:embedded` | **270 passed / 3 skipped**, 10 files |
| `npm test` | **2,614 passed / 296 skipped** (2,912 tests, 236 files passed / 14 skipped) |

### 12.3 Browser

| Gate | Result |
|---|---|
| `npm run test:e2e:journey` | **20/20 passed** (2.2 min) — 17 prior + Unregistered + Composition + the new IRP-closed guard |
| `npm run test:e2e:irp` | **2/2 passed** (40.7 s) against `next build && next start` |

### 12.4 Build

`GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build`
→ exit 0, **28/28 static pages**, secret scan clean.

### 12.5 Explained skips

| Count | Where | Why it is not a pass |
|---|---|---|
| 1 | integration | hosted-PostgREST/HTTP-fixture case; needs a hosted endpoint, which is not authorized |
| 3 | replay and upgrade | hosted/direct PostgREST and clock-dependent paths in a loopback embedded cluster |
| 296 / 14 files | unit | DB-gated suites (need the disposable cluster), credential/deployment-gated suites, and browser-gated cases |

No skip is counted as a pass, and no local fixture is presented as hosted
evidence.

### 12.6 Files changed in P6

| File | Change |
|---|---|
| `lib/gst/adapter.ts` | hermetic-rehearsal gate; production/preview still refused |
| `lib/gst/adapter.test.ts` | **new**, 2 tests pinning the matrix |
| `playwright.irp.config.ts` | production webServer, explicit rehearsal env, loopback URL guard |
| `e2e/journey/irp.simulation.spec.ts` | phase-based waits, order-independent route, scoped selectors, no debug output |
| `e2e/journey/irp-closed.desktop.spec.ts` | **new**, production-build read-only guard |
| `e2e/journey/seed.mjs` | complete e-invoice profile for outlet *d* |
| `scripts/release/render-migration-register.mjs` | **new**, register generator |
| `package.json` | `register:migrations` |
| `docs/migration-authorization-register-2026-11-19.md` | **new**, generated |
| `docs/staging-authorization-and-acceptance-2026-11-19.md` | **new** |
| `docs/operations/PROVIDER_DEPENDENCY_REGISTER_2026-11-19.md` | **new** |
| `docs/operations/INCIDENT_RUNBOOKS_2026-11-19.md` | **new** |
| `qa-evidence/day1/protected-digests-2026-11-19.md` | **new**, snapshot |

## 13. Protected predecessor digests vs P5

| Check | Result |
|---|---|
| Digest rows recorded in earlier closures (P1–P4 reports) | **49/49 rows (27 unique files) recomputed and identical** |
| Tracked migrations | **98 files, `git status`/`git diff` clean** → byte-identical to the committed base tree |
| Untracked branch migrations | 20 files; **19 covered by previously recorded digests, all match**; `20261118002100_operational_realtime.sql` had no prior digest and is pinned for the first time at `abcb86e5…fe353` |
| Mismatches | **0** |

Honest limitation: P5's "123/123" referred to an opening snapshot held in that
session, not to a file in the repository, so an exact recomputation of that
particular count is not possible from the tree alone. P6 therefore reports
what it can prove: the git object identity of every tracked protected file, the
digest of every file whose digest was previously written down, and a fresh
pinned snapshot for the remaining one. No protected file was modified in P6.

Full table: [`qa-evidence/day1/protected-digests-2026-11-19.md`](protected-digests-2026-11-19.md).

---

## 14. What is now true, and what is not

**True:** the product-wide build is locally verified end to end — guest
ordering, Unregistered and Composition receipts, GST documents, the IRP
owner/manager rehearsal with a simulated provider, realtime fallback, payments,
printing and sharing — on the exact commit under review, with every gate green
and every change traceable.

**Not true:** that this is launch-ready. No staging target is designated, no
migration in the GST/IRP/P3/P4 set is authorized, no provider exists, no
recovery evidence exists for any hosted target, and the candidate Staging
project drifted today in a way this repository cannot explain.

**Verdicts:** LOCAL RELEASE CANDIDATE **PASS** · STAGING ACCEPTANCE **NOT
AUTHORIZED** · PROVIDER ACCEPTANCE **NOT AUTHORIZED** · PRODUCTION RELEASE
**NO-GO**.

---

## 15. P6b addendum (2026-11-19) — what supersedes this report

This section was added after §1–§14 were written. Where the two disagree, this
section wins, and the earlier numbers remain in place as the record of that
moment.

| Item | At P6 (§1–§14) | After P6b |
|---|---|---|
| Migrations | 118 files | **119** — `20261118002200_qr_code_staff_boundary.sql` added |
| Register | 118 files / 118 rows | **119 / 119 / 0 problems** (the generated title said "118 files" while listing 119; fixed in the generator) |
| Integration suite | 286 passed / 1 skipped | **288 passed / 1 skipped** (13 files) — two new QR-boundary tests |
| Unit suite | not run in P6 | **2,614 passed / 298 skipped** (250 files) |
| Embedded replay | 270 passed / 3 skipped | **272 passed / 3 skipped** (10 files) |
| `verify:release` | 47 checks (118 files) | **47 checks (119 files)** |
| Definer audit | 148 audited / 81 flagged | **148 / 80** — the fix removes one flag |

**§8 is partly superseded.** The candidate's drift is now **PARTIALLY
EXPLAINED**: twelve of its thirteen ledger rows are accounted for with
byte-level or statement-set evidence, and the 49-file bundle is
content-addressed (the pinned commit's `approved-upgrade.sql` reproduces the
exact SHA-256 the ledger statement enforces). The thirteenth row is the third
main-branch workstream's `announcement_claim_recovery` (PR #195), applied 31
minutes before that PR merged, and the `qr_verification_attempts_legacy_*` table
with no ledger row is proven to be the documented 2026-11-11 review application
(Report A §4.1). See [Report A](STAGING_DRIFT_INVESTIGATION_2026-11-19.md).

**A security finding was raised and closed locally.** The 81-function definer
review ([Report B](DEFINER_SECURITY_REVIEW_2026-11-19.md)) found exactly two
class-A functions — `rotate_table_qr_code` and `retire_table_qr_code`, both
guarded only by the billing predicate. The defect is reproduced on a disposable
database, the fix is written and tested, and it is **not applied**:
`20261118002200_qr_code_staff_boundary.sql` remains NOT AUTHORIZED.
[Cross-check](SECURITY_AND_STAGING_CROSS_CHECK_2026-11-19.md) ·
[findings register](SECURITY_FINDINGS_REGISTER_2026-11-19.md).

**Verdicts are unchanged:** LOCAL **PASS** · STAGING **NOT AUTHORIZED** ·
PROVIDER **NOT AUTHORIZED** · PRODUCTION **NO-GO**. The document this report
linked to in §8 (`docs/staging-authorization-and-acceptance-2026-11-19.md`) is
now written, with the 14 acceptance points as executable procedures.
