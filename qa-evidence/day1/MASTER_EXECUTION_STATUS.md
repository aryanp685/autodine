# AUTODINE — MASTER EXECUTION STATUS (Master Execution Run 1)

Date: 2026-11-17 · Branch `arena/2670dd12-autodine` (sandbox HEAD `d8d0e52`) · `main` = `b385bf4`, untouched · Consolidates Batches 1–6. Boundaries honored throughout: no Production/Staging mutation, no hosted migration/dispatch/deploy/merge, no real payment/email/provider activation, no secrets in source or chat, GST/IRP migrations NOT AUTHORIZED, no commit/push.

---

## Integration update — 2026-11-19 (PR #194 opened; PR #190 merged)

**The GitHub integration actions were executed.** This section records
what actually happened, so the dated batches below — which were accurate
when written — are not left standing as unqualified claims.

### Actions taken

| PR | Action | Detail |
|---|---|---|
| **#190** | **MERGED** | head `92c67fbaf6c561f9283f8fd8c462e2a7923c1acd`, base `main`, 1 file +4/−3, result blob `793d2a3c` byte-identical to the reviewed diff; 15/15 checks successful; merge commit `ff00d38d0abe72bfabf85fb84ac4b3423b62b6f6` |
| **#187** | **CLOSED** | superseded by merged PR #188 — its Cloudflare R2 implementation would have replaced the working, verified B2 pipeline on `main` |
| **#194** | **OPENED** | `arena/88c342c2-autodine` @ `e90ab824bff191b994a63fb2b83dc461271c0faa` → `main`; 38 files, +4353/−71; pushed without force, history preserved |
| **#192** | **CLOSED** | superseded by #194 after every one of its changes was verified present there (10 of its 12 files byte-identical; 2 supersets) |
| **#181, #184, #188** | **untouched** | as required |

### PR #194 update — 2026-11-19 (later the same day)

**Eleven further commits, then `main` merged in.** The PR head moved from
`e90ab82` to `bc58a16` and then to the merge commit, with every push
fast-forward and history preserved. The work in those commits is
described in `PHASE5_LOCAL_EVIDENCE.md`, `PHASE7_LOCAL_VERIFICATION.md`
and `MASTER_BLOCKER_REGISTER.md`; this section records only what changed
about the integration itself.

**A CI failure was found and fixed.** The new evidence guards failed the
`Hosted-acceptance and staging guards` step — for a reason that was in the
guard, not in the records. Two independent causes, both fixed:

1. The Phase 7 guard resolved every path a record cites against
   `origin/main` alone. `actions/checkout` fetches one commit by default,
   so a CI runner has **no `origin/main` ref at all** — the escape hatch
   failed there and a correct record was reported as broken. The guard now
   resolves a cited path against the working tree, **every** ref the clone
   holds, and `FETCH_HEAD`, and it still fails closed when none of them
   has the path. The CI job fetches `main`'s tip — read-only, one commit —
   so CI verifies the same paths the local run does, and the guard asserts
   that step exists.
2. GitHub's PR checks run the **merge** of the branch with `main`, not the
   branch alone. The Phase 7 record quotes exact counts, so a record true
   of the branch was false of the tree CI actually verifies: `main` carried
   three more migrations and more test cases. `main` is now merged into the
   branch, so the branch and the merge result are the same tree, and every
   count in the records was re-derived on it.

3. Two backup suites depended on the **host's** PostgreSQL client. The
   logical restore drill and the dump-order suite both intended the
   repository's own logical path, but neither pinned it: with a `pg_dump`
   on `PATH` they silently took the custom-format path instead. On a
   developer machine with no client installed they passed; on the runner,
   whose image ships a `pg_dump` 16 that cannot dump the PG 17 server
   they run against, they died with `pg_dump: error: aborting because of
   server version mismatch`. Both now pin the logical path
   (`--pg-dump 0`), so they prove the same thing everywhere — and a new
   gate re-runs them with an **older client stubbed in front of `PATH`**,
   reproducing the runner's condition locally. The runner now checks its
   own independence.

The same class of defect was latent in both browser claims — each asserted
"Chromium is absent", true of the local run and false of a CI job that
installs Chromium for the browser suites. Both now assert the claim's
scoping instead, and keep the strong local check where Chromium really is
absent.

**Current local counts** (on the merged tree, 2026-11-19): DR suite
**149/149**; unit suite **2,553 passed / 223 skipped / 0 failed**;
PostgreSQL-gated integration **214/214**; embedded replay **209 passed |
2 skipped (211)**; migration chain **101 files, 101 unique versions**;
staging guards **65/65**; release verifier **28/28**; logical restore drill
**VERIFIED** (101 migrations, 48 tables, 59 policies, 164 functions);
**17/17** local gates passed.

**The deployment, stated accurately**

**A Vercel Preview deployment was produced automatically** for each PR head
commit when the branch was pushed — deployments `6pFExiBEDXx7kooBgt6Puu4ksNE4`
(`e90ab82`), `7mcwf6HSBZ2DKpM2UVEwBKVWVhZL` (`f75107a`) and
`J9R1nrMpAJN29ofro5muLZytKubf` (`bc58a16`), project `new`, Preview host
`new-git-arena-88c342c2-autodine-iamjarvis9896-3988s-projects.vercel.app`.

They are **Preview**, not Production: the commit is not on `main`, the
hostname carries the branch name, and the check that carries the host is
Vercel's Preview-comments check. **No deployment was created, promoted or
dispatched by this work, and no Vercel setting was changed.** Merging
PR #194 into `main` **will** trigger a Production deployment — Vercel's
behaviour for the production branch, and a side effect of the merge rather
than of the code.

Full evidence: `qa-evidence/day1/VERCEL_PREVIEW_DEPLOYMENT_EVIDENCE.md`.

### Still true

**No Production or Staging database access or mutation. No hosted DDL/DML
or migration. No workflow dispatch that touches a hosted system. No Vercel
Production deployment or configuration change. No Brevo, Supabase Auth or
paid-service change. No secret value read, printed or copied. No PR merged
except the one the owner explicitly approved (#190).** PR #194 is open and
unmerged.

### Decision unchanged: NO-GO

The launch decision remains **NO-GO**, on hosted evidence and owner
decisions, with zero open P0 code defects. See
`MASTER_LAUNCH_READINESS.md`.

---

## Integration update — 2026-11-18 (PR #192 onto current `main`)

The run narrative below is the 2026-11-17 record and is left exactly as written. This section states what changed since, on branch `arena/88c342c2-autodine` (base `main` = `3e17c44`).

> **Superseded by the 2026-11-19 section below.** As of this batch there
> was no push, no PR merge and no deployment. That is no longer true: the
> branch was pushed, PR #194 was opened, PR #190 was merged, PRs #187 and
> #192 were closed, and a Vercel **Preview** deployment was produced
> automatically for the PR head commit. See the 2026-11-19 section and
> `qa-evidence/day1/VERCEL_PREVIEW_DEPLOYMENT_EVIDENCE.md`. What remains
> true of this batch is unchanged: no hosted setting change, no migration,
> no workflow dispatch, no Production/Staging mutation, no secret value
> accessed or printed.

**Integrated.** PR #192's operational-incident functionality (`d679a9e`) and its Brevo incident documentation (`e9b247d`, `e3ad205`) are now on top of current `main`, reconciled rather than merged wholesale. All five upstream code blobs are byte-identical to upstream: `app/auth/actions.ts` `142a8fe1`, `app/api/ops/incidents/route.ts` `f2f16c62`, `app/api/ops/incidents/route.test.ts` `a4ab4d66`, `lib/incident-registry.ts` `ae6dc412`, `app/(staff)/dashboard/settings/team-actions.ts` `5fae647d`. `app/auth/actions.test.ts` is the union of main's Auth coverage and PR #192's six operator-visibility tests — 24 tests across 6 describes, all green.

**Auth safety preserved.** Incident summaries carry only the fixed kind and a numeric status — never an address, a tenant id or a provider message. A 429 (expected throttling) and the enumeration-protected existing-email response deliberately raise nothing. Unit-proven in the `operator visibility for silent Auth failures` block.

**Documentation reconciled.** The Brevo checklist, email runbook, domainless-activation evidence and owner register are PR #192's newer versions (the 2026-11-18 activation, the `525` root cause and fix, the first verified Auth delivery, the silent-failure record). The Resend-era Package 4 in the hosted-verification runbook is superseded by Brevo guidance. Two references that pointed at files which did not exist now resolve: `scripts/hosted-verification/preflight.mjs` (read-only, SET/UNSET by name, per-package verdict, `--json`) and this directory's `MASTER_LAUNCH_READINESS.md`.

**Also landed on this branch.** PR #190's registration fix for the restore drill (byte-identical to upstream's result blob `793d2a3c`); a PostgreSQL 17 composite action (`.github/actions/postgres-client`) used by both hosted workflows so the dump and the restore use one client major version; and a shared restore-target guard (`scripts/backup/lib-restore-target.mjs`) that makes the restore loopback-only by default, refuses a Production project outright, and fails closed on a hosted target whose ref cannot be determined.

**Local counts at this step (a snapshot, not today's).** DR suite **78/78** (was 50/50 — the new restore-guard and composite-action suites are in it); full unit suite 2,503 passed / 221 skipped / 0 failed; lint, typecheck, staging guards and release verifier all exit 0.

**Decision unchanged: NO-GO**, on hosted evidence and owner decisions, with zero open P0 code defects. See `MASTER_LAUNCH_READINESS.md`.

---

## Audit & deliverable batch — 2026-11-18 (branch `arena/88c342c2-autodine`)

A read-only audit batch plus three documents. At the time of this batch: **no push, no PR merge, no deployment, no hosted setting change, no migration, no workflow dispatch, no Production/Staging mutation, no secret value accessed or printed**. (The push, the PR and the automatic Preview deployment are later events — see the 2026-11-19 section.)

**Branch diff audited against `main` (`3e17c44`, 693 commits), PR #190 and PR #192.** 32 files differ from `main` (27 committed + 5 added here). Every one is attributed: **4** PR #192 implementation files (byte-identical to upstream `e3ad205`), **3** more PR #192 files already in `main` (merged earlier by `ef5f549`/`ab541ee` — byte-identical, so they do not appear in the diff at all), **4** PR #192 documents (also byte-identical to upstream; newer than `main`'s), **1** PR #190 file (`hosted-restore-drill.yml`, its result blob `793d2a3c` carried byte-identically), and **23** shared-infrastructure files that belong to no open PR. Full attribution table: `docs/operations/PR_INTEGRATION_PLAN.md`.

**One competing PR found and excluded.** PR #187 (open, 19 files) is a **Cloudflare R2** implementation of the same workflows and scripts — `Hosted backup (R2)`, `lib-r2.mjs`, `upload-r2.mjs`, `download-r2.mjs`, `run-scheduled.mjs --r2`. It was branched before the B2 implementation landed, so its files register as *added* and merging it would **replace the owner's approved Backblaze B2 destination with the superseded R2 one**, silently switching providers, secret names and endpoints. **Recommendation: close PR #187 as superseded by the merged PR #188.** It is not merged.

**Seven dangling evidence references reconciled.** Every path cited by these documents was searched against the complete Git history of `main`, **all 80 remote branches**, **every pull request** (open, merged and closed) and the working tree. **None of the seven was ever committed.** They are not recoverable and are **not** recreated — a historical evidence document that was never written cannot be reconstructed honestly. Each of the 11 citation sites now carries an explicit `**[MISSING — see qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md]**` marker, and the register records, per item, what *did* land instead. Six are stale citations whose substance exists elsewhere. **One is a real open item:** `lib/staging/demo-seed-isolation.ts` and `npm run staging:seed-demo` never landed — `lib/staging/` does not exist and the npm script is absent — so the demo-seed guard claimed on 2026-11-16 is **not** in the repository. It was the ninth blocker, and the only one that was missing code rather than missing a hosted run — **closed on 2026-11-18**; see the demo-seed section below.

**Restore guard verified against the real drill.** `scripts/backup/lib-restore-target.mjs` is applied by both `restore-logical.mjs` and `verify-restored-db.mjs`. Exercised against the drill's actual loopback target and against Production in both direct and pooled forms: the drill target is allowed; Production is refused outright in both forms and **no flag unlocks it**; a hosted non-Production target is refused without a scratch opt-in, and refused with an opt-in whose ref does not match. Seven of seven scenarios correct.

**B2 requirements derived from the implementation, not from prose.** The authoritative list came from `lib-b2.mjs`, `upload-b2.mjs`, `download-b2.mjs`, `prune-b2.mjs`, `lib-dump.mjs` and the two hosted workflows. Secrets: `AUTODINE_BACKUP_SOURCE_URL` (backup only), `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` — the drill needs only five and must never be given the source URL. The key requires list/read/write/delete on **one** bucket and nothing else; no bucket creation, no bucket deletion, no sharing. The bucket must be **private**; B2 lifecycle rules must **not** be added, because age-based rules cannot express the 14-daily/8-weekly/6-monthly policy that `prune-b2.mjs` enforces and would delete artifacts the policy still needs. The backup source is the Production project `bdbaqpevwmgdvghszjno` used read-only (`begin isolation level repeatable read read only`), through the **session pooler (port 5432)** or a direct connection — never the transaction pooler (6543), because Mode A exports a snapshot on one connection and `pg_dump` imports it on a second, which does not work correctly through transaction-mode pooling (`PRODUCTION-BACKUP-RUNBOOK.md` §1; `docs/production-operator-setup-2026-11-11.md`). The restore target is the runner's own disposable `postgres:17` container on loopback — **never** Production, **never** Staging.

**RTO is UNMEASURED, and the measurement is specified.** The first successful drill produces the first honest number: dispatch-to-green wall-clock, with the restore duration reported separately, the RPO bounded by the daily schedule (≤ 24 h) and by the drill's measured artifact age, and the service RTO called out as *not* covered (no detection, cutover, Auth/Storage/Realtime, DNS or Vercel).

**Owner authorization stays separate from hosted execution.** The checklist marks every step `[OWNER-CREDS]` (creating the bucket, the key, the passphrase and the six secrets — owner dashboards only), `[OWNER-AUTH]` (dispatching a workflow — a separate explicit go-ahead naming the workflow and its scope) or `[LOCAL]`. *Preparing* a step is never performing it, and nothing in this repository dispatches anything.

**Deliverables.** `docs/operations/PR_INTEGRATION_PLAN.md` (attribution, merge sequence, what must not happen), `docs/operations/B2_OWNER_CHECKLIST.md` (the exact bucket, key, secret, dispatch and RTO steps), `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md` (the seven missing paths), and this repository's `MASTER_LAUNCH_READINESS.md` §3a (the open-PR topology).

**One stale reference fixed.** `docs/backup-restore-runbook.md` still named `upload-r2.mjs` in the B2 section — the only R2-era residue in the repository. Corrected to `upload-b2.mjs`.

**Local counts at this step (a snapshot, not today's).** DR suite **88/88**; unit suite 2,503 passed / 221 skipped / 0 failed; composite-action suite 11/11; wiring suite 8/8; restore-guard suite 19/19; preflight suite 8/8; lint, typecheck, release verifier and staging guards all exit 0; 13 YAML files parse.

**Decision unchanged: NO-GO**, on hosted evidence and owner decisions, with zero open P0 code defects.

---

## Demo-seed isolation guard — implemented 2026-11-18

The ninth blocker (the only one that was missing code rather than missing a
hosted run) is **closed**. Built to the claim the 2026-11-16 run log made but
never committed.

**What exists now**

- `lib/staging/demo-seed-isolation.ts` — a pure, dependency-free guard. No
  I/O, no connection, no environment read, so the same decision is unit-
  testable, CI-assertable and applicable by the command with no database in
  sight. It refuses, in order: a missing or malformed project ref; a
  **Production** project (no option unlocks it — the check runs first and is
  unconditional); a project that is **not on the owner-supplied designated
  list**; a malformed, non-Supabase, Production-named or mismatched target
  URL; a missing or wrong authorisation; an unsafe slug. The authorisation
  phrase names its target (`seed-demo:<ref>`), so an authorisation issued for
  one project does not carry over to another, and no standing permission
  exists.

  **Corrected 2026-11-19 (Finding A).** The guard used to carry a hard-coded
  demo allowlist in the source, which meant the repository — not the owner —
  decided which project could be seeded, and the historical candidate
  (`juwyhslzchjevqkdvwjm`) was authorised by default. It no longer holds any
  project ref at all. The designated list is supplied **externally, per run**
  (`AUTODINE_DEMO_SEED_APPROVED_REFS`), so no project can be authorised from
  code alone, an unknown or undesignated ref fails closed, and Production
  refusal stays unconditional and first.
- A second guard re-reads the generated SQL and refuses it unless every row
  id it writes belongs to the demo fixture, it touches only `public.` tables,
  it contains no statement that removes or alters data, and it never mentions
  a Production project. This is the cross-tenant rule: the seed cannot reach
  a row that is not its own.
- `scripts/staging/seed-demo.ts` — `npm run staging:seed-demo`. It evaluates
  the guard **first**, before loading anything that reads the environment, so
  a refusal is the only thing the operator sees: the rule id, and nothing
  else. On approval it prints the synthetic seed SQL and **writes nothing** —
  there is no database client in the file and no connection is opened. This
  matches the run log's "(nothing seeded; owner runs it)".

**Evidence**

- 32 unit tests (`lib/staging/demo-seed-isolation.test.ts`): positive,
  negative, the scope rules, and the "no credential is ever echoed" property.
- 13 command tests (`scripts/staging/seed-demo.test.mjs`) driving the real
  npm script.
- A real-PostgreSQL proof (`scripts/staging/seed-demo.db.test.mjs`): the
  repository's own schema (the Supabase shim plus all 98 migrations) on a
  disposable embedded cluster, with a second restaurant standing in for a
  real customer. The seed creates its own restaurant; the other restaurant is
  unchanged field for field; every dining table and every QR token belongs
  to the demo restaurant; a second run is idempotent.
- **14 mutation checks**: removing the production check, the designated-list
  check, the authorisation check, the URL cross-check, the slug check, the
  destructive-statement rule, the foreign-row-id rule, the non-public-table
  rule, the unscoped-update rule, the production-reference rule, or the
  CLI's call to either guard — each one fails the suite. Adding Production to
  the designated list does **not** break anything, because the production
  check runs first and is not unlockable; a test now asserts that no
  approved demo project is ever a Production project. (Counts below are the
  2026-11-19 figures: 32 unit tests and 13 command tests, after Finding A.)

**Additional audit: the B2 source connection**

Rechecked whether `AUTODINE_BACKUP_SOURCE_URL` must be direct or pooled.
From the code: the hosted backup runs **Mode A** (`pg_dump` is on the
runner's PATH, so `backup-logical.mjs` selects it), and Mode A opens one
connection, exports a snapshot from it (`pg_export_snapshot()`), then runs
`pg_dump` on a **second** connection with `--snapshot=<id>`. Importing an
exported snapshot needs that second connection to be session-affine, and
through **transaction-mode** pooling it is not. The repository's two
production-operator documents agree: `PRODUCTION-BACKUP-RUNBOOK.md` §1 ("Do
NOT use Transaction pooler (6543)") and
`docs/production-operator-setup-2026-11-11.md` ("never the transaction
pooler (6543), which `pg_dump` does not work correctly through").

**The host is the same; only the port differs.** The source must use the
**session pooler (port 5432)** or a direct connection. The session pooler is
also IPv4-reachable, which is what the GitHub-hosted runner needs. The
**restore target** is the opposite case: `pg_restore` imports no snapshot, so
either pooler is fine there.

**Corrected:** `docs/operations/B2_OWNER_CHECKLIST.md` §A4 (it recommended
the transaction pooler), `docs/backup-restore-runbook.md`,
`docs/pitr-verification-procedure-2026-11-14.md`,
`qa-evidence/day1/MASTER_HOSTED_VERIFICATION_RUNBOOK.md` Package 1, and the
B2 requirements paragraph above.

**Decision unchanged: NO-GO**, on hosted evidence and owner decisions, with
zero open P0 code defects. The blocker count is back to **eight**, all of
them hosted runs or owner decisions.

---

## Integration-readiness batch — 2026-11-18 (branch `arena/88c342c2-autodine`)

Read-only preparation and validation of the integration plan. **No push, no
PR creation, no merge, no deployment, no workflow dispatch, no hosted
database access or mutation, no B2 credential inspection, no Vercel change,
no GST change.** No PR was closed. Every existing commit is preserved.

> **Superseded by the 2026-11-19 section below.** This batch was
> read-only; the push, PR #194, the PR #190 merge and the closures of
> PR #187 and PR #192 happened afterwards. The Vercel change is still
> accurate in spirit and precise in fact: no Vercel *setting* was ever
> changed — the only deployment event is the automatic **Preview** build
> the GitHub App produced for the pushed branch, recorded in
> `qa-evidence/day1/VERCEL_PREVIEW_DEPLOYMENT_EVIDENCE.md`.

**Branch and ancestry.** HEAD `544355b` (the demo-seed guard), parent
`280c2d3`, merge-base with `main` `3e17c44` — which is the merge commit of
**PR #191** (already merged). `main` is a full ancestor of HEAD: the branch
is 11 commits ahead and **0 behind**, so it is fast-forwardable. The
ancestry is `main → PR #192's three commits (d679a9e, e9b247d, e3ad205) →
the reconciliation merge 105362e7 (p1=e3ad205, p2=3e17c44) → the eight
shared-infrastructure commits`.

**PR #192's head (`e3ad205`) is already an ancestor of this branch.** Ten
of PR #192's twelve files are byte-identical to ours; two differ — the
hosted-verification runbook (ours adds the Brevo Package 4 rewrite, the
target-guard description and the corrected B2 source-connection rule) and
the owner register (ours adds the MISSING markers). **PR #190's head is not
an ancestor, but its one file is contained**: our version is PR #190's blob
`793d2a3c` plus exactly one added step (the PostgreSQL 17 composite
action).

**Every merge order was measured, not assumed.** `git merge-tree
--write-tree` merges without touching the working tree:

- **PR #190 first, then this branch → CLEAN**, and the final tree is
  `34ac2f91`, **byte-identical to this branch's HEAD**.
- **PR #192 first → 5 files with unresolved conflict markers**, one of them
  `app/auth/actions.test.ts`, a test file where a wrong hand-resolution
  would silently drop 18 lines of coverage.
- **PR #187 (the competing R2 implementation) → 7 add/add conflicts** across
  the backup workflow, the drill workflow and four backup scripts.
- **PR #184 and PR #181 conflict with `main` on their own** (2 and 5
  conflicts respectively). Once either is resolved and merged, **this
  branch merges clean on top** — neither is our conflict.

**The integrated result was tested in an isolated worktree** at the
integrated commit: typecheck, lint, DR 88/88, staging guards 35/35, the

   *(That was the figure at the time of that isolated-worktree run. The
   current local figures, re-verified 2026-11-19, are in
   `qa-evidence/day1/MASTER_EXECUTION_STATUS.md` and the
   `MASTER_BLOCKER_REGISTER.md` closed table.)*
demo-seed PostgreSQL proof, release verifier 28/28, isolation self-test, and
the full unit suite at 2,527 passed / 221 skipped / 0 failed. All four
security guards were re-exercised there: the restore-target guard still
refuses Production (direct, pooled, and with the scratch opt-in and the
correct ref) with no flag able to unlock it; the demo-seed guard still
refuses Production even when Production is placed on its designated list; the
composite action still fails closed on a missing PostgreSQL 17 client; and
the preflight still prints names only and answers UNKNOWN rather than
"absent" when GitHub refuses a read. The scratch worktree and its probe
refs were removed afterwards; the primary workspace was not touched.

**B2 connection requirements re-verified against the actual configuration.**
`hosted-backup.yml` takes `AUTODINE_BACKUP_SOURCE_URL` from a repository
secret, so the owner chooses the form. The hosted backup runs **Mode A**
(`pg_dump` is on the runner's PATH and `run-scheduled.mjs` does not force
Mode B), and Mode A opens one connection, exports a snapshot from it, then
runs `pg_dump` on a **second** connection with `--snapshot=<id>`. Importing
an exported snapshot needs session affinity, which transaction-mode pooling
does not provide — the same conclusion the two production-operator
documents reached ("Do NOT use Transaction pooler (6543)"). **The source
must use the session pooler on port 5432, or a direct connection.** The
**restore target** needs neither: `pg_restore` imports no snapshot (zero
`--snapshot` occurrences in `restore-logical.mjs`), the hosted drill's
target is a loopback container, and the guard's hosted-target rules only
engage for a manual scratch restore. A final sweep confirms **every**
`AUTODINE_BACKUP_SOURCE_URL` example in the repository now uses 5432, and
that the only remaining 6543 occurrences are prohibitions, the restore
target, and test fixtures.

**B2 owner checklist consolidated.** `docs/operations/B2_OWNER_CHECKLIST.md`
now carries an at-a-glance ownership split, the optional
`BACKUP_ALERT_WEBHOOK` (and `DR_ALERT_WEBHOOK`) shape, the restore target's
project-ref and scratch-opt-in requirements for a manual scratch restore,
and a one-page §D ordered owner-action checklist — thirteen numbered
actions across credentials, offline checks and hosted runs, each with its
exact value, its evidence to keep, and its accept condition.

**The eight blockers are reconciled by ownership** in
`MASTER_LAUNCH_READINESS.md` §3b: every one is an owner action or a hosted
run, not a code change. One technical item sits outside the eight — PR #190
must merge before the restore rehearsal can be dispatched by name.

**Decision unchanged: NO-GO**, on hosted evidence and owner decisions, with
zero open P0 code defects.

---

## The 11 roadmap priorities — status at a glance

The locked roadmap, as tracked across Batches 1–6 and the owner register (wording consolidated here):

| # | Priority | Status | Evidence / remaining step |
|---|---|---|---|
| 1 | Backup & DR verified hosted (B2) | **BLOCKED on owner** | Pipeline verified complete + landed on `main` (DR 50/50); bucket/secrets/first-run outstanding (Register Tier 1) |
| 2 | Migration drift resolved safely | **Owner decisions pending** | 49 production-only classified; 5 collisions need canonical-body picks; B1 gated behind #1 |
| 3 | Order flow reliability (QR→receipt) | **VERIFIED (local)** | Batch 3: disposable-DB proof 222/222 incl. cross-restaurant invisibility; browser demo 67/67 |
| 4 | Authentication & session security | **VERIFIED (local)** | Batch 4: proxy refresh, browser-bound recovery, enumeration-safe flows; hosted round-trips pending |
| 5 | Realtime reliability | **VERIFIED (local)** | Monitor + polling fallback + Batch 4 `CLOSED`/dispose fixes; two-device hosted kill-test pending |
| 6 | Transactional email deliverability | **Brevo implemented in code; hosted activation pending owner steps (no domain yet)** | API adapter + webhook + Auth flows tested — see `qa-evidence/day1/BREVO_AUTH_EMAIL_IMPLEMENTATION.md`; Resend plan superseded |
| 7 | Browser & multi-device verification | **VERIFIED (demo)** | Batch 5: +3 multi-context tests; 49 hosted-stack specs await a disposable Supabase (no Docker here) |
| 8 | Observability & alerting | **VERIFIED (local)** | Fixed-vocabulary incidents, dedupe, ops console across both trackers; sink (drain/webhook) is owner's |
| 9 | Tenant isolation & security hardening (incl. the owner's Priority 4: Preview/Staging isolation) | **VERIFIED (local) + live-inspected** | Membership-derived context; outlet-switch route tests; preview↔production isolation guard + offline verifier; **live read-only inspection of Supabase/Vercel/GitHub + new committed-automation boundary tests** — `qa-evidence/day1/STAGING_ISOLATION_IMPLEMENTATION.md` **[MISSING — see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md`]**; staging *designation* is owner action O-B1 |
| 10 | Commercial readiness (billing, GST/IRP) | **NOT AUTHORIZED** | Billing webhook locally verified (sandbox); GST three-mode code implemented + unit-tested, migrations locked — §GST below |
| 11 | Launch gating & release governance | **NO-GO (this program)** | `verify:release` 28/28; decision + sequence in `MASTER_LAUNCH_READINESS.md` |

## What this run changed (implementation, not just paper)

1. **NEW `scripts/hosted-verification/preflight.mjs`** — the single read-only entry point for hosted readiness: env names as SET/UNSET (never values), live GitHub state (PR #190 OPEN/`92c67fba`/MERGEABLE; "Hosted backup (B2)" name-registered while the restore drill still lists **only as a file path** — the registration defect made visible in one line), evidence-file presence, and a per-package verdict across the seven hosted packages. Executed here in both text and `--json` modes (exit 0). Current verdicts: b2-backup / restore-rehearsal / email / monitoring = OWNER-ACTION-REQUIRED; pitr / realtime / browser-e2e = READY-TO-AUTHORIZE.
2. **Four master documents** (this file; `MASTER_OWNER_ACTION_REGISTER.md`; `MASTER_HOSTED_VERIFICATION_RUNBOOK.md`; `MASTER_LAUNCH_READINESS.md`) consolidating six batches + the owner register into one register, one runbook, one decision.
3. **Migration conflicts:** investigated for safe unilateral resolution — **none exists**, and that is a finding, not an omission. Each collision is a choice between two live function bodies; picking one in source would silently change Production semantics the Batch 1 reconciliation explicitly forbids inferring. Instead, every collision and all 49 production-only items now carry an *exact decision asked* (Register Tier 3), including the first-priority item: Production `report_sales` (SECURITY DEFINER without the role guard).
4. **Re-validated, unchanged:** PR #190 (head identical to the reviewed `92c67fba`, all checks green, MERGEABLE — ready for owner approval, not merged); backup/PITR implementation (DR 50/50 this run; `verify-pitr-checklist.mjs` + preview-isolation verifier already in repo and referenced, not duplicated); staging isolation (`lib/supabase/deployment-isolation.ts` + `scripts/verify-preview-isolation.mjs`, already tested — no gap found to close); email/realtime/monitoring/browser local gaps — re-scanned after Batches 4–5, **no remaining locally-actionable defect found**; remaining items are credential/hosted by nature and live in the Runbook packages.

## Final validation (this run, combined worktree)

| Check | Result |
|---|---|
| Full unit (`npm test`) | **222 files / 2,477 passed / 222 skipped / 0 failed** |
| Disposable-DB integration | **222/222 passed** |
| DR suite (`test:dr`) | **50/50** |
| Browser E2E (`e2e:local`) | **67 passed / 49 self-skipped (hosted-stack specs) / 0 failed** |
| Lint / typecheck / production build | exit 0 / 0 / 0 |
| `verify:release` | **OK (28 checks)** — repository invariants, not release authorization |
| Hosted preflight (new) | exit 0; verdicts above |

Changed files this run: `scripts/hosted-verification/preflight.mjs` + the four `qa-evidence/day1/MASTER_*.md`. Batches 3–5 worktree changes (G1–G5 groups, itemized in the Batch 6 assessment) are untouched and preserved; total worktree remains the same 42 entries plus these additions.

## GST and IRP readiness (plan — nothing activated, no rule invented)

**What already exists in source (verified by reading it, all defaulted OFF):**
- A three-mode model in the NOT-AUTHORIZED migration `20261113000100_gst_two_mode.sql`: `off` (today's behavior, byte-for-byte), `composition` (Bill of Supply, no tax shown, statutory notice), `regular` (GST tax invoice: inclusive-price tax *extraction* at document level with one rounding, CGST/SGST breakdown, place of supply, seller GSTIN). Orders snapshot `gst_mode_snapshot` + config version so a ticket never reprices retroactively; issued documents are immutable except an audited void.
- Application library `lib/gst/` — adapter, allocation, composition math, GSTIN validation, place-of-supply, profiles, snapshots, credit/debit notes — **unit-tested** (`gst.test.ts`, `allocate.test.ts`, `notes.test.ts`, `tax-address.test.ts`, `einvoice*.test.ts`, `irp/irp.test.ts`).
- An **applicability engine** (`lib/gst/applicability.ts`) encoding the rule as cited in-code (Notification No. 10/2023-Central Tax: e-invoicing mandatory above ₹5 crore AATO for B2B/exports; B2C and Bills of Supply never eligible), **failing closed**: unsupported cases surface a reason to the owner rather than a silent "not applicable". B2C documents are issued `IRN: not_required`; a future B2B document for an above-threshold tenant is held at `irp_status='pending'` and must not be presented as a final tax invoice until an IRN exists. IRP plumbing (`lib/gst/irp/`: payload, fingerprint, state machine, sandbox adapter, validation) exists behind that gate.

**What is NOT done and must not be improvised:**
1. The 7 migrations (`20261113000100`, `20261114000100`–`00600`) remain **NOT AUTHORIZED** — not applied anywhere by this program.
2. **Legal dependencies (owner + adviser, not code):** per-tenant mode selection in writing; confirmation that the implemented rules (thresholds, extraction/rounding, document types, composition eligibility) match current law for each tenant profile; e-invoice applicability per tenant; credit/debit-note treatment.
3. **Recipient capture:** B2B IRN flow needs buyer GSTIN capture at billing — a product/UX decision (Register C4 covers notes UI) before any IRP activation.
4. **IRP/GSP provider:** none selected; sandbox adapter only. Selection, credentials, and certification are commercial/legal steps.
5. **Test strategy when authorized:** staging-first; golden-file document snapshots per mode (off/composition/regular × B2C/B2B); applicability matrix tests (below/above threshold, exempt, composition); IRP sandbox end-to-end (generate → pending → IRN → signed invoice presented; rejection paths fail closed); immutability/void audits; reconciliation between issued documents and IRP state (`20261114000200`'s subject) — each behind its own migration authorization, one file at a time like B1.

**Owner decisions (exact):** (a) engage GST adviser and confirm the code's stated rules per tenant segment; (b) decide whether GST launches with the product or post-launch (today's default `off` makes post-launch safe); (c) select IRP/GSP provider only if any launch tenant is above threshold with B2B supplies; (d) authorize the migration set separately, naming project + files. Until (a)–(d): GST/IRP stays dark, and the register's Tier 4 holds it there.

## Master Run 2 — park B2 + execute staging isolation (2026-11-17)

**Part A (B2 parked, untouched):** owner decision recorded — Backblaze B2 **SELECTED**, local implementation **VERIFIED**, hosted backup/restore **DEFERRED** (not cancelled). Created `docs/operations/B2_BACKUP_IMPLEMENTATION_HANDOFF.md` **[MISSING — see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md`]** (paths, workflow names, secret names, evidence, limitations, exact resume steps); `MASTER_OWNER_ACTION_REGISTER.md` Tier 1 carries the four status lines. No B2 code, account, secret, schedule or workflow was modified; the daily scheduled workflow keeps failing closed at the secret gate until resume (intended posture).

**Part B (Priority 4 — Preview/Staging isolation, live-inspected read-only via the connected Supabase/Vercel apps + GitHub):** established that exactly two Supabase projects exist (`autodine-production` ap-south-1; `autodinetest` ap-northeast-2) — **no dedicated Staging project**; `autodinetest` is the de-facto test/preview backend and was *not* silently reclassified. One Vercel project (`new`, production branch `main`) separates environments by env targets (preview/dev → test project with per-target Sensitive secret keys; production → production project); `AUTODINE_EXPECTED_PROJECT_REF` is pinned for preview/dev only. Preview cannot accidentally reach Production (credentials + build/runtime isolation guard + exact-project pin, all re-verified; `ISOLATION-SELFTEST PASSED`). GitHub has zero environments. **Implemented:** NEW `lib/environment-boundaries.test.ts` **[MISSING — see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md`]** (5 tests guarding committed automation: no production ref in any workflow, literal Supabase URLs test-only, literal PG strings loopback-only, clean `vercel.json`) — one test-regex bug found/fixed during the run, guarded content never wrong. **Owner actions O-B1…O-B5** (staging designation decision; production expected-ref pin; staging Auth redirect fix + production allowlist tightening; optional GitHub environments; confirm `mailer_autoconfirm`) in `STAGING_ISOLATION_IMPLEMENTATION.md` §5. No hosted state changed.

## Master Run 3 — complete email deliverability (2026-11-16, in progress)

**Inspection (code + read-only hosted):** the Resend app path (provider, one caller, templates, retry/idempotency, telemetry/incidents) and the Supabase Auth path (signup/recovery → `/auth/confirm`, both link shapes) are complete and locally verified. Hosted state: **no** custom SMTP in either Supabase project (platform sender, 2 emails/hr cap in both), **no** `RESEND_API_KEY`/`AUTODINE_EMAIL_FROM` in any Vercel target, Auth templates are Supabase defaults, Vercel has no custom domain — email is `not_configured` everywhere, honestly. **Implemented this run:** `scripts/email/send-test-email.ts` (+ `npm run email:test-send`, exercised in usage/not-configured/fake-key modes — exit 2/2/1, retries ×3 on failure, zero mail sent), `AUTODINE_EMAIL_FROM` shape-check added to `scripts/verify-external-services-config.mjs`, branded paste-ready Auth templates (`docs/operations/email-templates/`), and the operations runbook `docs/operations/EMAIL_DELIVERABILITY_RUNBOOK.md` (Resend re-evaluated against current pricing: Free 3,000/mo with a 100/day cap; owner sequence E1–E8; controlled tests T1–T6; Production = separate E8 approval). **Validation:** focused email battery 7 files green; full unit 223 files / 2,482 passed / 0 failed (baseline-identical); lint + typecheck exit 0. **Paused at the owner gate:** completion criteria (real email received, auth links, live retry proof, monitoring) require E1–E5 (account → domain/DNS → keys → Preview env → test-project SMTP), which only the owner can perform; evidence + resume point in `qa-evidence/day1/EMAIL_DELIVERABILITY_IMPLEMENTATION.md` **[MISSING — see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md`]**.

## Brevo provider selection & complete Auth email implementation (2026-11-16)

**Owner decision executed:** Brevo replaces Resend as the selected transactional provider (Free plan, 300/day; no custom domain yet). **Implemented:** the existing provider boundary now carries a Brevo API adapter (`lib/email/provider.ts` — `api-key` header, sender parsing, `headers.idempotencyKey` UUID per logical send with Brevo's `duplicate_parameter` collapsed into the original delivery, 429/5xx/timeout bounded retry vs permanent-4xx single attempt, explicit fail-closed selection that ignores other providers' credentials); a fail-closed, bearer/custom-header-verified Brevo delivery webhook (`app/api/email/brevo/webhook` + `lib/email/brevo-webhook.ts`) feeding tenant-free telemetry/incidents; responsive invitation template; Brevo config surfaces (`.env.example`, external-services verifier, hosted preflight, controlled test-send). **Auth preserved and further pinned by tests:** signup/confirmation/resend (enumeration-safe), verified login, forgot/reset with PKCE state + recovery-cookie permission, expired/reused link handling, staff invitation + join signup/acceptance — Supabase Auth architecture and safeguards unchanged; Auth mail reaches Brevo via owner-configured SMTP relay (distinct SMTP key). **Validation:** focused 11 files / 107 tests; full unit 225 files / 2,509 passed / 0 failed; lint/typecheck/build exit 0; test-send honest in no-config (exit 2) and fake-key (failed ×3, exit 1) modes — **no real email sent** (no Brevo account/key/domain exists; real delivery + branded delivery remain owner-gated, runbook B1–B7 in `docs/operations/BREVO_EMAIL_RUNBOOK.md`). Full report: `qa-evidence/day1/BREVO_AUTH_EMAIL_IMPLEMENTATION.md`.

## Brevo domainless activation completion (2026-11-16)

Re-inspected the Brevo implementation on this branch against the runbook/register and **live hosted state**: Vercel project `new` still has **zero** Brevo variables in every target (activation not begun; app honestly reports invitations not-connected), Supabase Auth on both projects still has no custom SMTP (2/hr platform cap). **Verified end-to-end in code:** Brevo API adapter (api-key header, request shape, one-UUID idempotency with `duplicate_parameter` collapse, 429/5xx bounded retry vs permanent-4xx single attempt, fail-closed provider selection ignoring other providers' keys), unsigned-webhook receiver (fail-closed 503, constant-time shared-secret, fixed vocabulary, PII discarded, deduped incidents), all five auth/invitation flows with enumeration-safe responses and honest UI states (pending via `useFormStatus`; five distinct invitation outcome sentences), zero secrets/PII in logs. **One gap found and fixed:** reply-to now supported via optional `AUTODINE_EMAIL_REPLY_TO` (parsed like the sender, malformed fails closed; +2 tests, verifier/example/runbook updated). **Explicitly not implemented (not claimed):** order confirmation, receipt, and all customer notification emails — the only app mail is the staff invitation. Full unit 227 files / 2,539 passed / 0 failed; lint/typecheck/build exit 0; test-send honest in all modes; **no real email sent**. Report: `qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md`. Remaining: owner runbook B1–B6 (Production = separate approval), B7 after domain purchase.

## Staging isolation completion (2026-11-16)

Continuation of Master Run 2 Part B; full report `qa-evidence/day1/STAGING_ISOLATION_COMPLETION.md` **[MISSING — see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md`]**; live state re-verified read-only (projects, Vercel envs/branch mapping, Auth configs, buckets/policies) — nothing hosted changed. **Closed repo-side:** O-B2's missing guard direction — both deployment-isolation implementations now enforce a bidirectional trusted-project pin via `AUTODINE_EXPECTED_PROJECT_REF` (a production-pinned build pointed at the test project now fails the build; an unpinned production deployment is documented as still uncaught until the owner adds the one Production-targeted env value). Demo-seed hygiene: fail-closed `lib/staging/demo-seed-isolation.ts` **[MISSING — see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md`]** + `npm run staging:seed-demo` (nothing seeded; owner runs it). *(As of 2026-11-16 this had not landed; it was implemented on 2026-11-18 — see "Demo-seed isolation guard" above.)* Migration `20261117000100_revoke_public_storage_views_v2.sql` finalized (guarded revoke; live probe found no such view on either project; static + behavioral tests, full replay green; **not applied**). **Prepared, owner executes:** O-B3 redirect allow-list edits (test wildcard add; production wildcard/localhost removal needs explicit approval), O-B5 `mailer_autoconfirm=false` with consequences + B6 sequencing. **Still open owner decisions:** O-B1 designation (not silently assumed), O-B2 dashboard value, O-B3, O-B5, optional operator-restaurant cleanup/seed run, per-file migration authorizations (register 2.6–2.9, Tier 3). **Validation:** unit 227 files / 2,537 passed / 0 failed; PG integration 12 suites / 223; staging guards 31/31; isolation self-test incl. pin cases; lint/typecheck/build exit 0.

## Remaining blockers (one line each; full register in MASTER_LAUNCH_READINESS.md)

Backup gate (bucket/secrets/PR #190/first run/rehearsal — see `docs/operations/B2_OWNER_CHECKLIST.md`) · migration canonicalization + B1 · email domain/SMTP · staging designation + pins (register 2.6–2.9) · hosted browser + realtime evidence · alert sink wiring + cron live proof · Production migration per-file authorizations · billing provider + GST/IRP tracks (separate) · ~~demo-seed isolation guard~~ — **CLOSED 2026-11-18** (the guard and `npm run staging:seed-demo` now exist and are proven; see `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md` §3). **Current decision: NO-GO** — on hosted evidence and owner decisions, with zero open P0 code defects.
