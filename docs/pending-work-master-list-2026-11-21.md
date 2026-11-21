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

**P0-1. The repository's QR migration is weaker than production's, and applying it
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

**P1-1. The F-03 invariant exists only in production.** Adding
`create unique index if not exists table_qr_codes_one_active_per_table` to the
repository makes **72 of 280** embedded tests fail: the `after insert` trigger
`ensure_table_qr_code()` already provisions one live card per table, and 12
fixture sites in 7 files then insert a second live card. The migration experiment
was **reverted** (branch is 120 files again, `verify:release` 47/47). Remedy:
fixtures read the trigger-provisioned token; file:line list in the drift document
§5.

**P1-2. Acceptance matrix is stale.** `qa-evidence/day1/STAGING_ACCEPTANCE_MATRIX_2026-11-19.md`
records "13 ledger rows, all mapped" for the candidate; today it has **15** rows
and production has **124** with **3 unmapped**. Its local scores (e.g.
`test:db:embedded` 272/3) also lag today's 277/3.

**P1-3. `db:reconcile` reports 9 divergent objects** in the staging-shaped replay
(`qr_verification_attempts_legacy_<ts>` + sequence/constraint/index) and "75 of 120
repository migrations have no hosted ledger record" — i.e. hosted state is not
provable from the repository. Exit 1 on those findings is by design, not a crash.

**P1-4. Hosted ledger parity for this branch is unproven.** 120 repository files
vs 124 production rows vs 15 candidate rows; no mapping table exists for the 3
production-only entries.

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
Local only: logical restore (`F1`), cold physical recovery
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
  invisible here; no deploy can be verified from this session.
* GitHub secrets API returns 403 (used earlier for staging secrets) — accept the
  owner's statement instead of probing again.
* Local `env:check` exits 1 (missing local-only variables) — sandbox artefact.
* `lint` = 0 errors, **2 warnings** (unresolved to zero on purpose).
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

Status: **deployment BLOCKED · DR NOT READY · no merge, no PR, no deploy.**
