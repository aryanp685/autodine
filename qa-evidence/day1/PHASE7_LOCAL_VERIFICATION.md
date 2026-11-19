# AUTODINE — PHASE 7 LOCAL VERIFICATION (every gate, every skip explained)

**Date: 2026-11-19.** One record of every gate the CI workflow runs, run
locally, with **every skip explained**. Re-runnable:

```
npm run verify:local-gates
```

**No hosted system was touched to produce this record.** No deployment, no
workflow dispatch, no hosted DDL/DML, no migration, no hosted fixture, no
hosted backup or restore.

---

## 1. The gate sweep — 16/16 passed

`scripts/verify-local-gates.mjs` runs each gate, records its real exit code
and prints a verdict line. It never reports a skip as a pass.

| # | Gate | CI step it mirrors | Result | Time |
|---|---|---|---|---|
| 1 | `typecheck` | Typecheck | **PASS** | 5.2s |
| 2 | `lint` | Lint | **PASS** | 11.1s |
| 3 | `design:check` | Design system guard | **PASS** | 0.2s |
| 4 | `sql:check` | Migration syntax check | **PASS** | 0.6s |
| 5 | `migrations:verify` | Migration chain integrity | **PASS** | 0.2s |
| 6 | `verify:release` | Release readiness invariants | **PASS** (28 checks) | 0.2s |
| 7 | `isolation:verify` | Preview/production isolation self-test | **PASS** | 0.2s |
| 8 | `test:staging:guards` | Hosted-acceptance and staging guards | **PASS** (65/65) | 28.5s |
| 9 | `test:staging:seed-demo-db` | Demo-seed isolation | **PASS** (1/1) | 1.8s |
| 10 | `test:backup` | Backup pipeline selftest | **PASS** | 1.2s |
| 11 | `test:dr` | Backup-file and DR objective verifiers | **PASS** (138/138) | 8.8s |
| 12 | `test:d2` | D2 ACL probe | **PASS** (2/2) | 1.5s |
| 13 | `test:db:integration` | PostgreSQL-gated integration suites | **PASS** (214/214) | 12.9s |
| 14 | `test:db:logical-restore` | Logical restore drill | **PASS** | 2.6s |
| 15 | `test:hosted:preflight` | Hosted preflight (read-only) | **PASS** (8/8) | 20.0s |
| 16 | `npm test` | Tests | **PASS** (2,553 / 223 skipped / 0 failed) | 76.4s |

**16/16 gates passed.**

This record describes the **merged** state of the PR — the tree CI
actually verifies. GitHub's PR checks run the merge of the branch with
`main`, not the branch alone, so a record that quoted the branch's own
counts would be true on the branch and false in the check that matters.
`main` is merged into this branch, the branch and the merge result are
the same tree, and every number below was re-derived on it.

---

## 2. The unit suite, and every one of its 223 skips

```
Test Files  225 passed | 11 skipped (236)
      Tests  2553 passed | 223 skipped (2778)
```

**All 223 skips are the same thing: tests that need a PostgreSQL server.**
(225 test cases in total; see the table below for the 2-case difference.)
They are not skipped because they are hard, flaky or inconvenient — they
are skipped because `npm test` alone starts no database, and every one of
them is executed by a suite that does.

| Skipped file | Test cases | Reported skipped | Executed by | Result |
|---|---|---|---|---|
| `app/menu/throttle-db.integration.test.tsx` | 5 | 5 | `test:db:integration` | **PASS** |
| `lib/db/account-link-audit.integration.test.ts` | 8 | 8 | `test:db:integration` | **PASS** |
| `lib/db/credit-debit-notes.integration.test.ts` | 11 | 11 | `test:db:integration` | **PASS** |
| `lib/db/gst-two-mode.integration.test.ts` | 22 | 22 | `test:db:integration` | **PASS** |
| `lib/db/order-read-boundary.integration.test.ts` | 11 | 9 | `test:db:embedded` | **PASS** |
| `lib/db/owner-billing-guard.integration.test.ts` | 6 | 6 | `test:db:integration` | **PASS** |
| `lib/db/phase0-security.integration.test.ts` | 25 | 25 | `test:db:integration` | **PASS** |
| `lib/db/readiness.integration.test.ts` | 62 | 62 | `test:db:integration` | **PASS** |
| `lib/db/report-sales.integration.test.ts` | 26 | 26 | `test:db:integration` | **PASS** |
| `lib/db/restaurant-account-link.integration.test.ts` | 8 | 8 | `test:db:integration` | **PASS** |
| `lib/db/subscription-billing.integration.test.ts` | 41 | 41 | `test:db:integration` | **PASS** |
| **Total** | **225** | **223** | | **223 executed and passed, 2 never executed (see §3)** |

The two columns differ by exactly **2**, and that difference is explained
rather than hidden: `order-read-boundary` holds 11 cases, 9 of which need
only PostgreSQL and 2 of which need PostgREST as well. Vitest's summary
counts the 9 as skipped; the 2 sit inside a nested skip, so it does not
count them among the file's skipped tests — but they are still never
executed anywhere (§3).

The whole table is re-derivable in about three seconds:

```
$ npx vitest run <the eleven files>
Test Files  11 skipped (11)
      Tests  223 skipped (225)
```

The runner is `scripts/local-pg/with-embedded-postgres.mjs`: a **disposable**
embedded PostgreSQL on a random loopback port with a random password, whose
data directory is deleted when the command exits. It reaches nothing hosted.

```
$ npm run test:db:integration
Test Files  10 passed (10)
      Tests  214 passed (214)

$ npm run test:db:embedded
Test Files  9 passed (9)
      Tests  209 passed | 2 skipped (211)
```

---

## 3. The two tests that no suite ever executes

`lib/db/order-read-boundary.integration.test.ts` has two cases inside
`describe.skipIf(!PGRST_BIN)` — they need a running **PostgREST** server,
not only PostgreSQL.

- **PostgREST is not installed here.** Its release archive is served from
  `release-assets.githubusercontent.com`, which this sandbox cannot reach:
  `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL`. The `postgrest` npm
  package is a JavaScript **client**, not the server, so it cannot stand in.
- **`PGRST_BIN` is never exported to any vitest run in any workflow.** A
  grep over `.github/` and `scripts/` finds it set in exactly one place —
  `scripts/e2e/run-throttle.sh`, for the browser throttle E2E — and never
  wired into a vitest invocation. So these two tests are skipped in **CI as
  well**, not only here.

**This is stated rather than hidden: 2 of the repository's 2,770 test cases
are never executed by any suite, local or CI.** They are not counted as
passing anywhere. Closing them needs PostgREST installed and `PGRST_BIN`
wired into `test:db`; that is an available, small piece of work that no
launch gate depends on.

---

## 4. The other two suites that cannot run here

| Suite | Status | Why |
|---|---|---|
| **Browser (Playwright)** | **BLOCKED — ENVIRONMENT** | Chromium is absent in this workspace and `cdn.playwright.dev` is unreachable. The suite **collects**: `npx playwright test --list` → **113 tests in 16 files**, so every spec parses and every project selector resolves. Runs in CI. Full record: `PHASE5_LOCAL_EVIDENCE.md` §2. |
| **Mode A restore drill** (`ciCustomFormatDrill: "not-run-locally"`) | **BLOCKED — ENVIRONMENT** | The pure-SQL path (`test:db:logical-restore`) runs green locally. The **custom-format** path needs the `pg_dump`/`pg_restore` binaries; they are installed by the composite action in CI, not on this machine. The local drill says so in its own output rather than claiming the custom-format path ran. |

---

## 5. Migration chain — verified, not asserted

```
$ npm run migrations:verify
101 files, 101 unique versions
```

101 files, 101 unique versions, no duplicate version, no out-of-order file,
and the deployed anchors present and hashable. Reconciled against the Batch
2 conflict report merged in PR #193
(`qa-evidence/day1/MIGRATION_CONFLICT_RESOLUTION_BATCH2.md`): that report
finds **no literal same-version file collision**, and confirms that
`20261112000400` → `20261112000600` → `20261114000100` is the correct
ordered history, so no combined function body is required.

That citation is checked, not assumed: the drift guard resolves every path
this record names against the working tree and against every ref the clone
holds, and the CI job fetches `main`'s tip so its shallow checkout verifies
the same paths this run does. If neither the working tree nor a known ref
holds a cited path, the guard fails — it never reports a missing file as
present.

**No collision was resolved and no migration was applied.** Those remain
owner decisions — `MASTER_BLOCKER_REGISTER.md` B2 and B10.

---

## 6. Backup, restore and the demo seed

```
$ npm run test:db:logical-restore
LOCAL_LOGICAL_RESTORE_VERIFIED {"pgVersion":17,"migrations":101,"tables":48,
 "policies":59,"functions":164,"backupFormat":"autodine-logical-1",
 "productionBackupClaim":false,"ciCustomFormatDrill":"not-run-locally"}
```

The drill replays the full 101-file chain into a disposable database and
compares the fingerprints. `productionBackupClaim: false` means the run
makes no claim about any Production backup, and `ciCustomFormatDrill` states
plainly that the custom-format path did not run here.

**A real defect was found and fixed by this phase.** The pure-SQL dump
emitted every view before every function, and `CREATE VIEW` validates its
query at creation time — so a restore of any schema with a role-checking
view failed with
`function has_restaurant_role(uuid, text[]) does not exist` and left the
target half-restored. It reproduced identically at `e90ab82`, so it was
live on `main` and no suite was running it. Fixed in `f88ce87`; pinned by
`scripts/backup/dump-order.test.mjs`, which drives a real dump against a
real disposable PostgreSQL and replays the artifact.

---

## 7. YAML, workflows and the PostgreSQL client

- **All 12 workflow files parse**, and all 14 jobs resolve:
  `ci` (check, native-database), `dr-drill`, `e2e`, `hosted-backup`,
  `hosted-restore-drill`, `phase3-hosted-baseline`,
  `phase3-probe-safety` (probe-safety, staging-reconstruction),
  `preview-checks`, `staging-e2e`, `supabase-e2e-load`, `throttle-e2e`,
  `tts-smoke`; plus the `postgres-client` composite action.
  `actionlint` is **not available** in this environment, so this is a
  structural parse, not a lint — stated rather than implied.
- **All three PostgreSQL binaries are verified** by the composite action
  (`psql`, `pg_dump`, `pg_restore`): a missing tool, a version mismatch and
  a PATH shadow each fail closed, and backup/restore invoke the pinned
  absolute path of the **verified** binary. Covered by 39 tests across
  `postgres-client-action`, `lib-pg-client` and `postgres-client-wiring`.
- **The hosted backup and restore-drill workflows are wired to that action**
  and were reviewed for trigger, permission and untrusted-input handling:
  both are `workflow_dispatch`-only, neither takes a ref or a URL from an
  untrusted event, and neither can be started by a fork's pull request.

---

## 8. What is NOT claimed

- **No hosted gate is claimed.** The hosted backup, the hosted restore
  rehearsal, the hosted browser run, the two-device realtime observation,
  the live cron status codes and a real paged alert are all
  `BLOCKED — OWNER AUTHORIZATION REQUIRED` — `MASTER_BLOCKER_REGISTER.md`
  B1, B7, B8, B9.
- **The browser suite is not claimed to pass.** It could not run here
  (§4).
- **The 2 PostgREST-only tests are not claimed to pass.** They are never
  executed (§3).
- **The custom-format restore path is not claimed to pass.** It needs the
  client binaries and runs in CI (§4).
- **The migration chain is verified, but no migration was applied and no
  collision was resolved.** Those are owner decisions (§5).
