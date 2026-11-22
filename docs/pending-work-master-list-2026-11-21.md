# Master list — everything pending, failing, or not working (2026-11-21)

One list, no omissions. It merges the gates re-run today with every item reported
in earlier turns. Evidence rule: a line is **PASS** only with a command and its
output in this session; **BLOCKED** means an owner action or an access this
session does not have; **OPEN** means work nobody has done yet.

Branch `arena/ce32f7c8-autodine`, head `663a8c0`, three GitHub workflows green at
that SHA. `main` is `89fa684`. Production is `bdbaqpevwmgdvghszjno`.

---

## 1. Fixed in this session (do not re-report)

| # | Defect | Fix | Evidence |
|---|---|---|---|
| F1 | Built-in logical dump was not restorable: views and table `CHECK`s reference `has_restaurant_role`, which must exist before `CREATE VIEW`/`CREATE TABLE`; the dumper emitted functions last | `scripts/backup/lib-dump.mjs`: `set check_function_bodies = false`, functions before tables, with only table-rowtype-signature functions held back to `2b)` — the order `pg_dump` uses | `LOCAL_LOGICAL_RESTORE_VERIFIED {pgVersion:17, migrations:120, tables:64, functions:236, policies:63, rows:0}` — `ea940b4` |
| F2 | Authorization regression: `20261114000101` granted `EXECUTE` on `issue_closed_session_receipt(uuid,jsonb)` to `authenticated`, letting a signed-in client issue a document for an already-closed sitting and skip the settlement wrapper | Adopted main's forward fix `20261119000100_restore_receipt_helper_boundary.sql` verbatim (revoke from `public, anon, authenticated, service_role`); manifest + register + `EXPECTED_MIGRATIONS` 119 → 120 | `supabase/checks/07_p8_close_settlement.sql` passes; `test:db:local` exit 0 — `663a8c0` |
| F3 | Gate false-negative: harness asserted the retired `close_order_session_and_issue_receipt(uuid)` signature | Harness now asserts `(uuid, jsonb)` | `test:db:local` exit 0 |
| F4 | Two integration tests encoded the loosened grant (called the helper as `authenticated`) | Reissue runs under the owner claim without the `authenticated` role; the bypass case asserts `permission denied for function ...` plus the wrapper's outstanding-balance refusal. No assertion dropped | `test:db:integration` 295 passed / 1 skipped |
| F5 | Readiness integration deadlock (shared DB DDL) | Retry patch `362158a` | `irp:rehearse` exit 0 |
| F6 | Docs head reference moved with every doc commit | Stable head row `a155662` | — |

Full file-by-file detail: `qa-evidence/day1/FINAL_COMPLETION_AND_DEPLOYMENT_2026-11-19.md`.

## 2. P0 — production hazards (blocking any deploy or push)

**P0-1 — FIXED 2026-11-21.** Superseded by `20261122000200_qr_one_active_cleanup.sql` + `20261122000300_qr_one_active_per_table.sql`
(unique index + advisory lock, newer than every hosted ledger row) and
`20261122000100_announcement_claim_recovery.sql`. See
`docs/remediation-report-2026-11-21.md` §D1. Original finding, kept for the record:

**P0-1 (original). The repository's QR migration is weaker than production's, and applying it
would downgrade production.** `20261118002200_qr_code_staff_boundary.sql` (this
branch only) has no `pg_advisory_xact_lock` and no
`table_qr_codes_one_active_per_table` unique index; production's
`20261120190546_qr_code_staff_boundary` has both. `db push` applies missing
versions regardless of order, so this file would run *after* production's newer
one and `create or replace` the QR functions **without** the lock.
Evidence: `qa-evidence/day1/production-schema-drift-2026-11-21.md` §3–§4.
**Owner decision required** (option a or b in §4 of that document). Nothing was
changed in production.

**P0-2. Three production migrations have no repository file**, so production
cannot be rebuilt from either branch: `20261119101116_announcement_claim_recovery`,
`20261120190546_qr_code_staff_boundary`, `20261120190553_qr_owner_management`.
Production ledger = 124 rows; repository = 120 files; newest production version
`20261120190553` > newest repository file `20261119000300`.
Also missing from the repository: `restore_table_qr_code(uuid)`.

**P0-3. Deploying this branch's build to production would break 29 RPC paths.**
83 distinct `rpc('…')` names are called by code; 29 do not exist on production
(GST/IRP, waiter, floor, guest-order-status, `transfer_open_sitting`,
`set_guest_order_lines_at_version`). All 29 are defined by repository migrations
that are not applied. Full list in the drift document §6.

**P0-4. Nothing is deployed, merged or opened.** No PR exists from this branch;
`main` has not received any of these commits; the earlier "push to main?" answer
stays **NO** (§4).

## 3. P1 — repository ↔ reality divergence found today

**P1-1 — FIXED 2026-11-21.** The index is in the repository
(`20261122000200`), the 12 fixture sites were reworked to use the trigger-provisioned
card, and `test:db:embedded` is 281 passed / 3 skipped. Original finding:

**P1-1 (original). The F-03 invariant exists only in production.** Adding
`create unique index if not exists table_qr_codes_one_active_per_table` to the
repository made **72 of 280** embedded tests fail: the `after insert` trigger
`ensure_table_qr_code()` already provisions one live card per table, and 12
fixture sites in 7 files then insert a second live card. The migration experiment
was **reverted** (branch is 120 files again, `verify:release` 47/47). Remedy:
fixtures read the trigger-provisioned token; file:line list in the drift document
§5.

**P1-2 — FIXED 2026-11-21.** The matrix carries a refreshed local scoreboard and the
current ledger counts. Original finding:

**P1-2 (original). Acceptance matrix is stale.** `qa-evidence/day1/STAGING_ACCEPTANCE_MATRIX_2026-11-19.md`
records "13 ledger rows, all mapped" for the candidate; today it has **15** rows
and production has **124** with **3 unmapped**. Its local scores (e.g.
`test:db:embedded` 272/3) also lag today's 277/3.

**P1-3. `db:reconcile` reports 9 divergent objects** in the staging-shaped replay
(`qr_verification_attempts_legacy_<ts>` + sequence/constraint/index) and "75 of 120
repository migrations have no hosted ledger record" — i.e. hosted state is not
provable from the repository. Exit 1 on those findings is by design, not a crash.

**P1-4 — ANSWERED 2026-11-21.** 122 repository files vs 124 production rows vs 15
candidate rows; the three production-only entries are mapped to repository
equivalents in `docs/remediation-report-2026-11-21.md` §D3, and the 51 files that
are still pending on production are enumerated there. Hosted parity remains
**unproven** until those files are applied.

## 4. P1 — main-branch integration (unchanged)

* `main` = `89fa684`, **red**: 6 failing jobs on that SHA — CI
  `clean migrations · SQL boundaries (PG 15)`, CI
  `typecheck · lint · design · test · build`, E2E
  `scan throttle · real browser + disposable PostgreSQL`, E2E
  `staff shell · kitchen · back/forward · 390px drawer`, E2E
  `64 hermetic + 49 Supabase-backed E2E, then synthetic load and Kitchen polling`,
  and `Hosted backup (B2)` `encrypted backup → verify → B2 upload (SHA-256 verified)`.
* `main` is an **orphan history** (`89fa684`, no common ancestor). A normal merge
  is 71 conflicts + 148 auto-merged files; a force-push would delete 41 main-only
  files including 5 migrations. Both rejected.
* Plan order (unchanged): P0 QR reconciliation → fix main's CI → cherry-pick this
  branch's commits onto a new branch cut from `main`, resolve the ~71 conflicts,
  run the full battery, open a PR. **Creating that branch and opening a PR need
  explicit permission**; nothing has been done.

## 5. P1 — PR #194 is closed, and its work is still missing here

`gh pr view 194` → `state: CLOSED`, `mergeable: UNKNOWN`, head
`arena/88c342c2-autodine` (branch still exists remotely), last update
2026-11-21T07:25Z. It was **not merged**. Its infrastructure files are absent from
this branch: extra `scripts/backup/*`, `scripts/hosted-verification/preflight.mjs`,
`scripts/staging/seed-demo.ts`, `.github/workflows/hosted-*`. Meanwhile
`npm run test:dr` runs 6 local files while the PR lineage expected 29.
Decisions still open: which files to port, whether to reopen #194 or re-cut it
from `main`, and whether `test:staging:guards` should assert the hosted set.
Note: `20261119000100` was imported from `main` by necessity (security), not by
instruction — flagged in the manifest as "Main-inherited security correction".

## 6. P1 — DR / PITR: NOT READY

Proven (read-only, earlier turns): archiving is on for production —
`archive_mode=on`, `wal_level=logical`, 6,334 segments, 0 failures, RPO ≈ 2 min.
Local only: logical restore with **data-level** verification (row counts and row
content identical, including microsecond timestamps — the driver was truncating
`timestamptz` to milliseconds until `lib-dump.mjs` was given raw text types), cold
physical recovery
(`LOCAL_COLD_RECOVERY_VERIFIED {migrations:120, tables:68, orders:121}`), backup
selftest, `test:dr`.

Not done, in order:

1. **P1** baseline (`scripts/verify-pitr-checklist.mjs --template` → a filled
   evidence file; none exists in the repository).
2. **P2** posture decision: PITR add-on entitlement and retention are unverified.
3. **P3** encrypted logical backup + scratch restore **on a hosted target** —
   never executed.
4. **P4** restore-to-new-project drill with measured RPO/RTO — never executed.
5. **P5** schedule + a proven alert (`DR_ALERT_WEBHOOK`), and
   `scripts/backup/check-dr-objectives.mjs` needs `--backup-dir`.
6. **P6** owner sign-off.

Rules still in force: hosted rehearsal is **preflight-only** until the owner
explicitly authorizes it (no dispatch, no B2 auth, no hosted DB connection, no
backup/upload/download/restore). **No DR READY claim** without an evidenced hosted
restore.

## 7. P2 — backups in CI, and the B2 setup

* `Hosted backup (B2)` on `main` fails at
  `encrypted backup → verify → B2 upload (SHA-256 verified)` (run 2026-11-21T11:16Z).
  The branch's own `hosted-*` workflows live only in the closed PR #194 lineage, so
  nothing here produces a hosted backup.
* Owner-reported, **accepted as done**: bucket `autodine-staging-db-backups`
  (`d209a0cc2db8f17fac100514`, `eu-central-003`, encryption + keep-all-versions),
  dedicated App Key, 6 repository secrets, 3 variables. Read-only verification was
  not performed this session; a 403 would mean UNKNOWN, never "missing".

## 8. P2 — access and tooling limits

* **Vercel connector is `limited: true`** — project, deployment and build state are
  invisible through it. The public endpoint was probed read-only instead:
  `GET https://new-alpha-five-43.vercel.app/api/health` → `ok:true`,
  `credentials:"accepted"`, all probed schema flags `applied` (2026-11-21T20:52Z).
  A deployment is live; **which commit** is deployed remains unverifiable.
* GitHub secrets API returns 403 (used earlier for staging secrets) — accept the
  owner's statement instead of probing again.
* Local `env:check` exits 1 (missing local-only variables) — sandbox artefact.
* `lint` = **0 problems** (the two `no-unused-vars` warnings were removed on
  2026-11-21).
* Non-zero **by design** without their inputs: `pitr:check` (usage),
  `dr:objectives` (needs `--backup-dir`), `backup:run` (usage), `d2:verify`
  (needs `AUTODINE_D2_VERIFY_URL`), `email:test-send` (needs a recipient; sends
  nothing), `staging:verify-env` (needs hosted E2E variables), `db:reconcile`
  (findings).

## 9. P3 — housekeeping

* `main`'s "Cleanup" commit removed historical reports that this branch still
  carries; that asymmetry is a direct source of the 71 cherry-pick conflicts.
* Evidence docs are tracked by exception in `.gitignore`; new ones must be added
  there or they stay untracked.
* Sandbox state is disposable: `node_modules` is not snapshotted (`npm ci` after a
  resume), and `dist`/`build`/`coverage` are excluded.

## 10. What is green right now (head `663a8c0`, re-run today)

| Command | Result |
|---|---|
| `npm run test:db:local` | exit 0 — schema objects + all `supabase/checks/*` + 5 gated suites; 5,000-guest synthetic load (5,000 orders verified) |
| `npm run test:db:integration` | 295 passed / 1 skipped (13 files) |
| `npm run test:db:embedded` | 277 passed / 3 skipped (10 files) |
| `npx vitest run` | 2,614 passed / 305 skipped (236 files) |
| `npm run test:db:logical-restore` | `LOCAL_LOGICAL_RESTORE_VERIFIED` (120 migrations, 64 tables, 236 functions, 63 policies) |
| `npm run test:recovery:cold` | `LOCAL_COLD_RECOVERY_VERIFIED` |
| `npm run test:e2e:journey` | 20 passed (2.6 m) |
| `npm run test:db:report-sales-upgrade` | upgrade verification passed (local evidence only) |
| `npm run irp:rehearse` | all PostgreSQL-gated suites passed |
| `npm run test:dr` · `test:backup` · `test:d2` · `test:staging:guards` | exit 0 |
| `npm run verify:release` | 47 checks OK (repository invariants only, never release authorization) |
| `npm run migrations:verify` | 120 files, 120 unique versions, 4 anchored |
| `npm run design:check` · `sql:check` · `isolation:verify` · `audit:definer` | exit 0 |
| `npx tsc --noEmit` | clean |
| GitHub CI / E2E / Throttle at `663a8c0` | 3/3 success |

## 11. Decisions this session cannot take for you

1. **D1** QR reconciliation: commit production's three statements verbatim and
   delete `20261118002200`, or strengthen `20261118002200` (option a/b, drift doc §4).
2. **D2** Authorize the fixture rework (12 sites, 7 files) so the F-03 unique index
   can live in the repository.
3. **D3** Apply the 29 pending migrations to production before any build that needs
   them (GST/IRP, waiter, floor).
4. **D4** Authorize the hosted recovery rehearsal (P3–P5) — this is the only path to
   DR READY.
5. **D5** Authorize creating the integration branch from `main` and opening a PR,
   plus how to dispose of closed PR #194's files.
6. **D6** Fix `main`'s six failing jobs (separate workstream; needs the branch
   permission above).
7. **D7** Provide Vercel access or accept "deployment unverified" for this cycle.

## 12. Closed on 2026-11-21 (second pass)

Full detail and evidence: [`remediation-report-2026-11-21.md`](remediation-report-2026-11-21.md).

| Item | Outcome |
|---|---|
| P0-1 / D1 QR downgrade hazard | Fixed — `20261122000300` adds the unique index + advisory lock, newer than every hosted row |
| P0-2 missing repository files | Fixed for the three production-only corrections (`20261122000100`, `20261122000200`, `20261122000300`) |
| P1-1 F-03 invariant | In the repository; 12 fixture sites + the local seed reworked; embedded 281/3 |
| P1-2 stale matrix | Refreshed local scoreboard and ledger counts |
| P1-4 ledger mapping | Answered in §D3 (51 pending files, enumerated by `release:apply-plan`, collision audit clean) |
| D2 fixtures | Done |
| D3 production apply | **Prepared and proven safe, not applied** — 51 files, 0 object/column collisions |
| D4 recovery evidence | Upgraded to data-level; found and fixed a real microsecond-truncation defect in the dumper |
| D5 PR #194 port | **Done** on 2026-11-21 (third pass) — 48-file backup subsystem, 230 assertions, the pinned-client composite action, the B2 rehearsal workflow with an exact-code manifest; branch fixes (raw timestamps, relation ACLs) re-applied on top |
| D6 main red jobs | Diagnosed to root cause (duplicate `record_counter_payment` overload from main's `20261121000200`); guard added here; main repair needs branch permission |
| D7 deployment visibility | Solved read-only — production health endpoint live and healthy |
| Lint warnings | 0 problems |
| New guard | `supabase/checks/09_rpc_overloads.sql` runs in every replay |

Still open, in one line each: **D3** apply authorization · **D4** hosted rehearsal
authorization · **D5** dedicated port pass · **D6** main repair · B2 staging setup
(owner-reported, deliberately not re-verified here).

Status: **deployment BLOCKED · DR NOT READY · no merge, no PR, no deploy.**

## 13. Closed on 2026-11-21 (third pass)

Two of these are not paperwork: the second one is a **real restore defect** that the
previous passes could not see because they only compared catalogs.

| Item | Outcome | Evidence |
|---|---|---|
| D3 apply list made reproducible | `scripts/release/production-apply-plan.mjs` + `npm run release:apply-plan` — reads a ledger dump, prints the pending list in apply order with before/after verification SQL, `--json` for machines, `--check` exits 1 while anything is pending | `npm run release:apply-plan -- --ledger <dump>` → `pending: 51`, `applied: 72`, `52` ledger rows with no repository file (reported, never absorbed) |
| Restore fidelity: table/sequence privileges | **Fixed** — `lib-dump.mjs` never emitted `relacl`, so a restore produced a database where every application role got `permission denied for table …`. It now emits an explicit `revoke all … from public, anon, authenticated, service_role` plus the exact `GRANT` list per relation | `test:db:logical-restore` → `securityRestoreVerified {"memberRows":1,"strangerRows":0,"anonDenied":true}` |
| The drill asks the product's questions after a restore | Added: connect to the restored database, insert a profile + membership, then read as member / non-member / `anon` | member 1 row, stranger 0 rows, `anon` refused `42501` |
| That suite cannot rot | `scripts/release/production-apply-plan.test.mjs` (8 tests: pipe + JSON ledgers, empty ledger refused, pending set, out-of-band reporting, real inventory ordering/uniqueness, CLI exit codes) wired into `test:dr` | `npm run test:dr` → 58 passed / 0 failed |
| Docs | `docs/backup-restore-runbook.md` (relacl in "what is covered", 123-migration drill numbers, the fifth dumper defect), D3 list regenerated at 51 files, D4 section extended | — |

## 14. D5 closed: the PR #194 backup/DR lineage is in

`scripts/backup/` went from 20 files to 48; `test:dr` from 6 suites to 21 (230
assertions, all passing). Ported together, because they only work together: the
client-resolution modules, the composite action that pins PostgreSQL 17 for CI *and*
both hosted workflows, the two hosted workflow updates, `staging-b2-rehearsal.yml`
with its byte-exact code gate (manifest regenerated from this tree), and
`docs/operations/B2_OWNER_CHECKLIST.md`.

Two branch fixes had to be re-applied on their `lib-dump.mjs`, which predates them:
raw date/time text (microsecond fidelity) and relation ACLs (a restored database the
app can actually read). Their own `taken_at.toISOString()` call broke the moment the
raw parser returned — a clean demonstration that the forks had diverged.

Not taken: their `ci.yml` ergonomics additions (demo-seed isolation, hermetic browser
count, failure annotations). They depend on scripts this branch does not carry and
add no DR capability.

Evidence: `test:dr` 230/230 · `test:backup` ALL CHECKS PASS (15) · logical restore
`dataRestoreVerified` + `securityRestoreVerified` at 130 migrations / 64 tables /
63 policies / 241 functions · cold recovery 130 migrations / 68 tables ·
`test:db:local` PASS · integration 299/1 · embedded 281/3 · vitest 2,614/309 ·
lint 0 · tsc clean · `verify:release` 47/47 · `migrations:verify` 130/130.

## 15. D6 is fixed upstream; what is left is a merge, not a bug

Checked on 2026-11-21 at `main` = `3b1ca5b` (read-only):

- **`main`'s CI is green.** Five of its six workflows now pass. The duplicate
  `record_counter_payment` was fixed in `20261121000200_upi_ref_at_mark_paid` +
  `20261122000100_single_counter_payment_function`: the five-argument function is
  dropped and the six-argument one takes `p_upi_ref text default null`, so both
  call shapes resolve to a single function. The guard added here
  (`supabase/checks/09_rpc_overloads.sql`) now protects both lineages.
- **This branch never had the defect.** Its chain defines one signature
  (`record_counter_payment(text, uuid, text, bigint, uuid)`); `migrations:verify`
  and the overload check both pass. Deliberately **not** ported: the UPI-reference
  requirement, because this branch's cashier UI does not collect a reference, so
  requiring one would turn every UPI settlement into a runtime error. That is a
  product change that arrives with main's UI at merge. (A same-day attempt to port
  it was reverted after the readiness suite failed with
  `UPI transaction reference is required.` — the gate did its job.)
- **The merge is not free.** Divergence at this head: `main` has 8 migrations this
  branch does not (`20261118002300`, `20261119000200/00300/00400`,
  `20261121000100/00200`, `20261122000100/00200`); this branch has 23 `main` does
  not (the GST/IRP block and the D1 QR fixes). Two of them **collide on the version
  prefix** `20261122000100` (`announcement_claim_recovery` here,
  `single_counter_payment_function` there). A merge must renumber one of them and
  re-run the whole chain; it is a merge decision, not something to guess at.
- **`main`'s one remaining red** is `Disposable Supabase E2E and load`
  (run 44987998244), which fails before any test runs: the `prepare-local-supabase`
  step produced no log and no Playwright JSON
  (`ENOENT test-results/supabase-e2e/integration-results.json`). It is a runner/Docker
  infrastructure failure, not a code assertion, and that workflow does not run on
  this branch.

## 16. Production status at the end of 2026-11-21 (read-only, plus one rehearsal)

Production moved while this branch was being finished: its ledger is now **160** rows
ending `20261122000100 single_counter_payment_function` and
`20261122000200 announcement_claim_and_table_delete_fixes`. That changes the answer
everywhere:

| Question | Answer, with evidence |
|---|---|
| How far behind is production? | **22 migrations**: the 20-file GST/IRP block plus the two renumbered QR files. The 51-file figure in §12 is obsolete. |
| Do those 22 fit production's schema? | **Yes** — `scripts/local-pg/rehearse-prod-apply.mjs` builds production's ledger subset (108 replayed, 52 out-of-band skipped), applies all 22, and the four verification invariants come back right (`gst_irp_tables 9, qr_index 1, advisory_functions 2, counter_payment_signatures 1`). |
| Are the two QR files already in production? | Their **effects** are (index `table_qr_codes_one_active_per_table` exists, 0 tables with duplicate live cards, both RPCs carry `pg_advisory_xact_lock`), their **ledger rows** are not. Both files are `if not exists` / `create or replace`, so applying them records the rows without redoing the work. |
| Why not applied from here? | No credential path. `Hosted backup (B2)` dispatched → `Missing required repository secrets: AUTODINE_BACKUP_SOURCE_URL` (fails closed). The Supabase connector can run SQL but cannot carry ~250 KB of DDL; hand-copying that into a production console was refused on purpose. |
| Hosted restore rehearsal? | Blocked by the same secret, plus `branching_limit` (`Pro plan or above`) when a schema clone of production was attempted. Both are owner actions, not code. |

### The three refusals, verbatim (2026-11-21, from this session)

| Attempt | Result |
|---|---|
| `gh workflow run hosted-backup.yml` (production, read-only) | run 44998836032 failed in 40 s: `Missing required repository secrets: AUTODINE_BACKUP_SOURCE_URL` — before any connection, by design. The preceding step, `Install the PostgreSQL 17 client tools`, **succeeded** on the runner. |
| `create_branch` on production (a schema clone for the rehearsal) | `entitlement_required` — `Branching is supported only on the Pro plan or above`. |
| `gh workflow run staging-b2-rehearsal.yml -f ref=<sha>` | run 44999512751 stopped at the exact-code gate's attestation input: `Owner Environment-only scope attestation is required; API denial is not proof of absence.` That input is a human statement about secret scope, and the secret list returns 403 to this token, so it was not asserted on the owner's behalf. |

One owner action unblocks the production pair: set `AUTODINE_BACKUP_SOURCE_URL` (production read
connection), `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`,
`B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` as repository secrets, then run
**Hosted backup (B2)** and **Hosted restore rehearsal (disposable)**. For the schema
push, `supabase link --project-ref bdbaqpevwmgdvghszjno && supabase db push` applies
exactly those 22 rows.

## 17. The merge divergence is fixed, and provable by set arithmetic

`main` is at `3b1ca5b` with 108 migrations; this branch has 130. Checked mechanically:

```
$ comm -23 <(main versions) <(our versions)      # versions main has that we lack
                                                  -> nothing
$ comm -13 <(main versions) <(our versions) | wc -l
                                                  -> 22
$ # same version prefix, different filename
                                                  -> nothing
```

How it was fixed, in the order that keeps every ledger honest:

1. **Ported main's 8** so the chain is a superset, not a sibling.
2. **Deleted our duplicate** `20261122000100_announcement_claim_recovery.sql`: main carries
   the same correction as `20261119000400`, which production already applied. Two files
   for one fix is how ledgers start lying.
3. **Renumbered** the QR pair to `20261122000400`/`20261122000500`. Neither version exists
   in production's ledger, in main's tree, or in any hosted candidate, so the rename
   costs nothing anywhere — that is why renumbering was safe here and would not have
   been for a row production had already recorded.
4. **Updated** manifest, register and `EXPECTED_MIGRATIONS` to 130, and `verify:release`
   (47 checks) enforces the tally.

The 22 that remain ours are exactly the work production still needs — the GST/IRP block
and the two QR files — so the merge and the rollout now point the same way.

