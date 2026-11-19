# AUTODINE — PR INTEGRATION PLAN

One plan for the three open pull requests and the branch that already
reconciles them, so nothing is merged twice, nothing is implemented twice,
and no two pull requests fight over the same files.

**Branch audited:** `arena/88c342c2-autodine` (head `66d8ad0`), built on
`main` = `3e17c44` (693 commits).

> **Status update — 2026-11-19.** The sentence this note replaced said
> "Nothing has been pushed, merged or deployed. All three pull requests
> remain open and untouched." That was true when the plan was written and
> is **no longer true**. What has happened since:
>
> - **PR #190 merged** (`92c67fb` → merge commit `ff00d38`), after its head,
>   base, diff, result blob (`793d2a3c`) and all 15 checks were verified.
> - **PR #187 closed** as superseded by merged PR #188 (the R2 implementation
>   would have replaced the working B2 pipeline).
> - **The branch was pushed** (no force; history preserved) and **PR #194
>   opened** — https://github.com/aryanp685/autodine/pull/194 — carrying this
>   branch's shared infrastructure plus PR #192's work.
> - **PR #192 closed** as superseded by PR #194, after every one of its
>   changes was verified present in PR #194.
> - **A Vercel Preview deployment was produced automatically** for PR #194's
>   head commit by the Vercel GitHub App. It is a **Preview**, not
>   Production; the facts are in `qa-evidence/day1/VERCEL_PREVIEW_DEPLOYMENT_EVIDENCE.md`.
>   No deployment was created, promoted or triggered by this work.
>
> **PR #194 is open and unmerged, and must not be merged without the
> owner's approval.** The rest of this document is the plan as it was
> written, and the sequence it recommends is the sequence that was followed.

---

## 1. The audit result — who owns which change

**32 files differ from `main`** (27 committed + 5 added by this batch).
They fall into exactly four groups, and the counts below are the
*audited* counts, not estimates.

| Group | Count | Origin | Merge treatment |
|---|---|---|---|
| **A — PR #192 implementation** | **4** in the diff (+3 already in `main`) | PR #192 | already byte-identical to upstream — §2 |
| **B — PR #192 documentation** | **4** | PR #192 | already byte-identical to upstream — §2 |
| **C — PR #190** | **1** | PR #190, **extended** | one file, three hunks — §3 |
| **D — shared infrastructure** | **23** | this branch | **new** — needs its own PR — §6 |

### Group A — the four PR #192 implementation files in the diff

| File | Blob (this branch) | Upstream `e3ad205` |
|---|---|---|
| `app/auth/actions.ts` | `142a8fe1` | **identical** |
| `app/auth/actions.test.ts` | `50937f17` | **identical** |
| `app/api/ops/incidents/route.ts` | `f2f16c62` | **identical** |
| `app/api/ops/incidents/route.test.ts` | `a4ab4d66` | **identical** |

### Group A′ — three more PR #192 files that are **already in `main`**

These were merged into `main` earlier by upstream commits `ef5f549` and
`ab541ee`, so they do **not** appear in the branch diff at all. `main`
and this branch hold the *same blob*:

| File | Blob in `main` | Blob here |
|---|---|---|
| `lib/incident-registry.ts` | `ae6dc412` | `ae6dc412` — identical |
| `app/(staff)/dashboard/settings/team-actions.ts` | `5fae647d` | `5fae647d` — identical |
| `app/(staff)/dashboard/settings/team-actions.test.ts` | `f665f240` | `f665f240` — identical |

**PR #192's effective contribution to `main` is therefore 8 files** — the
4 above plus 4 documents — and all 8 are already present here, byte for
byte.

### Group B — the four PR #192 documents

| File | Blob here | In `main`? |
|---|---|---|
| `docs/operations/BREVO_ACTIVATION_OWNER_CHECKLIST.md` | `504df80d` | older (`ce7c9db6`) — diff +51/−16 |
| `docs/operations/BREVO_EMAIL_RUNBOOK.md` | `82b8908c` | older (`c9f41e6b`) — diff +3/−3 |
| `qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md` | `850d8b52` | older (`0f527f3f`) — diff +144 |
| `qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md` | `6560f335` | older (`7f109ae7`) — diff +1/−1 |

All four are byte-identical to upstream PR #192's head. The diff against
`main` exists only because **PR #192's documentation is newer than
`main`'s** — merging PR #192 would carry the same four updates.

### Group C — PR #190

`.github/workflows/hosted-restore-drill.yml` — the single file PR #190
touches. §3.

### Group D — shared infrastructure (23 files)

| Component | Files | What it is |
|---|---|---|
| PostgreSQL composite action | `.github/actions/postgres-client/action.yml`, `install-client.sh`, `verify-client.sh` | installs the PostgreSQL 17 client and **verifies the resolved binaries really are that major version** |
| Its tests | `scripts/backup/postgres-client-action.test.mjs`, `scripts/backup/postgres-client-wiring.test.mjs` | 11 + 8 tests, mutation-checked |
| Restore-target guard | `scripts/backup/lib-restore-target.mjs`, `scripts/backup/restore-target.test.mjs` | the fail-closed guard, 19 tests |
| Guard wiring | `scripts/backup/restore-logical.mjs`, `scripts/backup/verify-restored-db.mjs` | both scripts now apply the guard |
| Hosted preflight | `scripts/hosted-verification/preflight.mjs`, `scripts/hosted-verification/preflight.test.mjs` | read-only hosted-readiness reporter, 8 tests |
| Workflow changes | `.github/workflows/ci.yml`, `.github/workflows/hosted-backup.yml` | CI now calls the composite action; the backup workflow is wired to it |
| Test registration | `package.json`, `package-lock.json` | `test:dr` now runs the wiring suite; `yaml@^2.9.1` |
| Documentation | `qa-evidence/day1/MASTER_HOSTED_VERIFICATION_RUNBOOK.md`, `MASTER_LAUNCH_READINESS.md`, `MASTER_EXECUTION_STATUS.md`, `MISSING_EVIDENCE_REGISTER.md`, `docs/operations/EMAIL_DELIVERABILITY_RUNBOOK.md`, `docs/backup-restore-runbook.md`, `docs/operations/B2_OWNER_CHECKLIST.md`, `docs/operations/PR_INTEGRATION_PLAN.md` | the reconciled runbooks, the launch decision, the missing-evidence register, and the two new deliverables |

**Group C is the only file that two pull requests touch.**

---

## 2. PR #192 — functionally identical, and already merged into this branch

Every implementation file in group A is **byte-identical to upstream's
head** (`e3ad205`). Nothing was rewritten:

| File | Blob | Upstream |
|---|---|---|
| `app/auth/actions.ts` | `142a8fe1` | identical |
| `app/auth/actions.test.ts` | `50937f17` | identical |
| `app/api/ops/incidents/route.ts` | `f2f16c62` | identical |
| `app/api/ops/incidents/route.test.ts` | `a4ab4d66` | identical |
| `lib/incident-registry.ts` | `ae6dc412` | identical (and already in `main`) |
| `app/(staff)/dashboard/settings/team-actions.ts` | `5fae647d` | identical (and already in `main`) |
| `app/(staff)/dashboard/settings/team-actions.test.ts` | `f665f240` | identical (and already in `main`) |

**The Auth conflict was not a conflict of substance.** `main` had 18 tests
in `app/auth/actions.test.ts`; upstream had 24. A title-by-title diff
shows **none** of `main`'s 18 are missing from upstream's 24 — upstream's
file is a strict superset (the same 18 plus a sixth `describe` block,
`operator visibility for silent Auth failures`, with 6 new tests). Git
flagged the region as conflicted only because both branches wrote there.

`app/auth/actions.ts` is a **pure addition against `main`: 76 lines added,
0 removed.** `main`'s privacy-safe provider logging (`safeErrorShape` —
name/status/code only, never the provider message) is untouched and still
present.

**Consequence for the merge:** PR #192 and this branch would contribute the
*same* code and the *same* document updates. Merging both is a duplicate,
and GitHub will show a conflict only where the *documentation* differs —
which is exactly where this branch deliberately differs (§5).

### Recommended handling

**Do not merge PR #192 and this branch both.** Pick one:

- **(a) Merge this branch, close PR #192.** This branch contains all of
  PR #192's code, byte-identical, plus the shared infrastructure. PR #192
  then becomes redundant. *This is the recommended option*: it produces one
  merge commit, one review, one CI run.
- **(b) Merge PR #192 first, then rebase this branch.** This branch's
  documentation deltas (§5) must then be re-applied on top of PR #192's
  versions, because PR #192's docs are the *older* base this branch
  already superseded. More work, same result.

Option (a) loses nothing: PR #192's code is already here, exactly.

---

## 3. PR #190 — one file, and the only genuine overlap

PR #190 changes exactly one file, `+4/−3`: the job-level `env:` block of
`.github/workflows/hosted-restore-drill.yml` used `${{ runner.temp }}`,
and GitHub Actions does not expose the `runner` context there. The
workflow therefore **never registered** — `gh workflow list` shows it only
as a file path next to the name-registered `Hosted backup (B2)`.

The fix replaces `DRILL_DIR` and the two preserved report paths with the
workspace-relative `.restore-drill`. The cleanup step still removes
`DRILL_DIR` unconditionally.

This branch carries PR #190's result blob **byte-identically** (`793d2a3c`),
plus one additional step (the PostgreSQL client action, §6).

**Recommended handling:** merge **PR #190 as-is**, on its own, before
anything else. It is one file, it is self-contained, it has no
interdependency with the shared infrastructure, and it unblocks the drill —
the one blocker standing between the owner and a rehearsable backup. If
this branch is merged first, PR #190 becomes a no-op that conflicts on one
file.

**What the owner must know before merging:** merging into `main` triggers
a Vercel **Production build** of `main`'s existing application code. The
workflow change itself touches no application code and no runtime
behaviour; the build is the side effect.

---

## 4. PR #187 — a competing provider implementation. **Do not merge.**

PR #187 (`autodine/hosted-backup-workflows`) adds **19 files as *added***,
including a full **Cloudflare R2** implementation of the same workflows and
scripts:

| PR #187 | `main` (merged) |
|---|---|
| `.github/workflows/hosted-backup.yml` — `Hosted backup (R2)` | `Hosted backup (B2)` |
| `.github/workflows/hosted-restore-drill.yml` — R2 secrets | B2 secrets |
| `scripts/backup/lib-r2.mjs`, `upload-r2.mjs`, `download-r2.mjs`, `r2-upload.test.mjs` | `lib-b2.mjs`, `upload-b2.mjs`, `download-b2.mjs`, `b2-upload.test.mjs` |
| `run-scheduled.mjs --r2` | `run-scheduled.mjs --b2 --prune-b2` |

PR #188 (`Hosted backup + restore workflows (Backblaze B2)`) is the
**merged** sibling and is what `main` actually contains. **Backblaze B2 is
the owner's provider decision (2026-11-16)**; the R2 plan was superseded.

Because PR #187 was branched before the B2 implementation landed, its files
are marked *added*. Merging it would **replace `main`'s working, verified
B2 implementation with the superseded R2 one** — silently switching
providers, secret names and endpoints. It would also collide with this
branch's `hosted-restore-drill.yml`.

**Recommended handling: close PR #187 as superseded by PR #188.** Do not
merge it. If the owner still wants R2 as a second destination, that is a
*new* piece of work — a provider adapter alongside B2, not a replacement
of it — and it needs its own design and approval.

---

## 5. Documentation deltas — the only place the two pull requests differ

This branch intentionally diverges from `main` in four documents, each for
a stated reason. If PR #192 is merged *instead of* this branch, the
evidence work below is lost; if this branch is merged, it is included.

| File | Delta | Why |
|---|---|---|
| `qa-evidence/day1/MASTER_HOSTED_VERIFICATION_RUNBOOK.md` | Package 4 rewritten from **Resend** to **Brevo** | `main`'s copy still names `RESEND_API_KEY` and a verified sending domain as a prerequisite. Brevo is the selected provider; `RESEND_API_KEY` is deliberately never activated. Package 2 now records the registration defect as still open, Package 1 records the client pinning. |
| `qa-evidence/day1/MASTER_EXECUTION_STATUS.md` | dated integration section added | The 2026-11-17 run narrative is left exactly as written; the new section states the current position. |
| `qa-evidence/day1/MASTER_LAUNCH_READINESS.md` | **new** | The launch decision, the eight gates, the PR #190 review the owner register points at, and the blocker register. |
| `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md` | **new** | The authoritative answer for seven referenced-but-absent files. |

The four group-B documents carry PR #192's own newer versions, so they
need no separate treatment — see §2.

---

## 6. Shared infrastructure — what needs its own pull request

Group D is new work that belongs to no existing pull request:

| Component | What it is | Why it exists |
|---|---|---|
| `.github/actions/postgres-client/` | A composite action that installs the PostgreSQL 17 client and **verifies the resolved binaries really are that major version** | A custom-format dump written by a newer `pg_dump` carries an archive format the runner's older `pg_restore` refuses outright. The backup and the drill must pin the *same* major version, or a backup cannot be restored. |
| `scripts/backup/lib-restore-target.mjs` | The restore-target guard | `restore-logical.mjs` had **no** target guard while the verify script had a loopback-only one. Now: loopback only by default; a hosted target needs an explicit scratch opt-in **and** a matching approved ref; Production is refused outright with no unlocking flag; an undeterminable ref fails closed; refusals never carry the URL, user name or password. |
| `scripts/hosted-verification/preflight.mjs` | The read-only hosted-readiness preflight | Two documents referenced a script that did not exist. It prints configuration **names** as SET/UNSET (never values), the live GitHub state, and a per-package verdict — and says UNKNOWN, never "absent", when a read is refused. |
| `docs/operations/B2_OWNER_CHECKLIST.md` | The owner checklist | The exact bucket configuration, key permissions, secret list, dispatch steps and RTO procedure, with the authority boundary stated explicitly. |
| `docs/operations/PR_INTEGRATION_PLAN.md` | This document | — |
| `.github/workflows/ci.yml` | **changed** — now calls the composite action | `main`'s CI carried an *inline* PGDG install duplicating the new action. One implementation, one pinned version, three call sites (CI drill, hosted backup, hosted restore drill). |

**The CI change is the one to review most carefully**, because it replaces
working inline logic. It preserves everything the inline step did — the
`pg-client-install.log` capture (so the existing error-annotation step still
works), the non-interactive apt flag, and the "prove what resolves" output —
and adds a fail-closed version assertion the inline step never made.

---

## 7. The safe sequence

Each step is independent and can stop at any point; nothing below is
authorized by this document.

**Step 1 — Close PR #187 as superseded.** Read-only until the owner acts.
*Why first:* it is the only pull request that would actively damage `main`
if merged, and closing it removes a whole class of accidental merge.

**Step 2 — Merge PR #190** (one file, `+4/−3`, self-contained).
*Why second:* it unblocks the restore drill, which is the long pole of the
backup gate, and it does not depend on anything else.

**Step 3 — Open a pull request for this branch's shared infrastructure**
(group D), based on `main` after step 2.
*Why third:* it now rebases onto a `main` where the drill is registered, so
the preflight will report the drill by name and the restore-rehearsal gate
can move to READY-TO-AUTHORIZE.

**Step 4 — Merge PR #192, or close it in favour of step 3.** They carry the
same code; merging both is a duplicate.
*Why fourth:* it is the least time-critical — the Auth incident work is
already tested and needs no hosted run to be valuable.

**Step 5 — Only then, the owner runs the hosted backup and the restore
drill**, following `docs/operations/B2_OWNER_CHECKLIST.md`.

### What must not happen

- **Do not merge PR #187.** It replaces the approved B2 provider with the
  superseded R2 one.
- **Do not merge PR #192 and this branch both.** The code is identical;
  merging both duplicates every file and double-conflicts every document.
- **Do not merge this branch before PR #190**, or PR #190 conflicts on the
  one file they share and the registration fix is obscured.
- **Do not treat a green local suite as a hosted backup.** The backup gate
  closes on a hosted run that printed `uploaded:true, verified:true` and a
  drill that was dispatched **by name** and went green.

---

## 7a. Verified integration sequence (2026-11-18, re-verified with virtual merges)

`git merge-tree --write-tree` computes a merge without touching the working
tree, so every order below was **actually merged and measured**, not
reasoned about.

| Sequence | Result |
|---|---|
| **A — PR #190 first, then this branch** | **CLEAN.** Final tree `34ac2f91` — **byte-identical to this branch's HEAD**. Zero conflicts, zero content surprises. |
| **B — PR #192 first, then this branch** | **5 files carry unresolved conflict markers**, including `app/auth/actions.test.ts` (a *test* file — 18 lines of coverage at risk in a hand-resolution). The final tree differs from this branch's. |
| **C — PR #187 (R2) + this branch** | **7 add/add conflicts** across `hosted-backup.yml`, `hosted-restore-drill.yml`, `backup-logical.mjs`, `lib-dump.mjs`, `restore-logical.mjs`, `run-scheduled.mjs`, `verify-restored-db.mjs`. |
| **D — PR #184 + this branch** | PR #184 conflicts with `main` **on its own** (2 add/add, both documentation files it adds). Once resolved and merged, **this branch merges clean on top**. Not our conflict. |
| **E — PR #181 + this branch** | PR #181 conflicts with `main` **on its own** (5 content conflicts). Once resolved and merged, **this branch merges clean on top**. Not our conflict. |

The sequence-A result was then **tested end to end in an isolated worktree**
at the integrated commit: typecheck, lint, DR 88/88, staging guards 35/35,

   *(That was the figure at the time of that isolated-worktree run. The
   current local figures, re-verified 2026-11-19, are in
   `qa-evidence/day1/MASTER_EXECUTION_STATUS.md` and the
   `MASTER_BLOCKER_REGISTER.md` closed table.)*
the demo-seed PostgreSQL proof, the release verifier 28/28, the isolation
self-test, and the full unit suite at 2,527 passed / 221 skipped / 0 failed.
All four security guards were re-exercised there and all still refuse
Production with no flag able to unlock them.

---

## 8. Audit coverage — what was checked

| Check | Result |
|---|---|
| `main` unchanged since the merge base (`3e17c44`, 693 commits) | confirmed |
| Every file in the branch diff classified into A/A′/B/C/D | 32/32 |
| Group A blobs compared against upstream `e3ad205` | 4/4 byte-identical (+3 A′ already in `main`) |
| Group B blobs compared against upstream `e3ad205` | 4/4 byte-identical |
| `main`'s 18 Auth test titles checked against the merged 24 | none missing — strict superset |
| `app/auth/actions.ts` diffed against `main` | +76 / −0 (pure addition) |
| PR #190's result blob compared | byte-identical (`793d2a3c`) |
| PR #187's file list and provider compared against `main` | conflicting R2 implementation — **do not merge** |
| All open pull requests reviewed for file overlap | only PR #190 overlaps this branch |
| All 80 remote branches searched for the 7 missing evidence files | none present |
| All pull requests (open, merged, closed) searched for the 7 files | none present |
| Composite action verified in both hosted workflows **and** CI | wired, same pinned version, after checkout |
| Restore guard exercised against the real drill target and against Production direct/pooled | 7/7 scenarios correct |
| R2-era residue swept from the documentation | 1 stale reference found and fixed (`upload-r2.mjs` → `upload-b2.mjs`) |
| Local gates | DR 88/88 · unit 2,503 passed / 0 failed · lint · typecheck · release verifier · backup selftest · staging guards 25/25 |
