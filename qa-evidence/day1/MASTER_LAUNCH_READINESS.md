# AUTODINE — MASTER LAUNCH READINESS

The launch decision, the gates behind it, and the exact sequence that closes them.

**Current decision: NO-GO.** Not because of an open code defect — there are **zero open P0 code defects** — but because the hosted evidence and the owner decisions that stand between this codebase and a launch have not been produced yet. Every gate below is a *hosted run* or an *owner action*, not a code change.

**Live state, on demand:** `node scripts/hosted-verification/preflight.mjs` (read-only; `--json` for machines). It prints configuration names as SET/UNSET (never values), the live GitHub state, and a per-package verdict. When GitHub refuses a read it answers UNKNOWN — never "absent". **Presence is not validity; validity is not delivery.** A verdict of READY-TO-AUTHORIZE means the inputs are in place and a human must now authorize the run; it never means the run happened.

---

## 1. The gates

| # | Gate | Verdict source | What is missing |
|---|------|----------------|-----------------|
| 1 | B2 backup + artifact verification | preflight `b2-backup` | Bucket + bucket-scoped key, the six repository secret names, then one authorized run whose output shows `uploaded:true, verified:true` |
| 2 | Disposable hosted restore rehearsal | preflight `restore-rehearsal` | The drill is registered **by name** (PR #190 merged 2026-11-19); it must now be **dispatched** against gate 1's backup |
| 3 | PITR / recovery evidence | preflight `pitr` | The owner's PITR-vs-B2 decision plus a completed checklist and a human signature |
| 4 | Auth email + Brevo deliverability | preflight `email` | The Brevo environment names, the Authorized-IPs setting, and the five controlled observations |
| 5 | Realtime multi-device verification | preflight `realtime` | A seeded Staging project, three devices, a human watching the fallback |
| 6 | Guest QR-to-receipt browser E2E | preflight `browser-e2e` | One authorized CI run on a disposable environment, green with `retries: 0` |
| 7 | Monitoring, alert delivery + recovery | preflight `monitoring` | A log drain on `[autodine:alert]`, an uptime monitor on `/api/health`, and the live 401/200 cron proof |
| 8 | Preview/Staging isolation | preflight `preview-isolation` | Nothing locally — this gate is a standing guard, re-run after every environment change |

Gates 1 and 2 close the **backup gate**: until a backup exists, has been verified, and has been restored and verified again, there is no recovery story. Gates 4 and 7 can proceed in parallel on Staging. Gate 5 rides on gate 7's sink. Gate 6 is independent CI evidence. Gate 3 is a decision, taken any time, that changes gates 1–2's cadence claims.

---

## 2. PR #190 — the restore drill's registration defect

**What is wrong.** The job-level `env:` block of `.github/workflows/hosted-restore-drill.yml` used the `runner` context:

```yaml
env:
  DRILL_DIR: ${{ runner.temp }}/restore-drill
```

GitHub Actions does not expose `runner` in job-level `env`. The workflow therefore failed to register, and `gh workflow list` shows it only as a **file path** (`.github/workflows/hosted-restore-drill.yml`) sitting next to the name-registered `Hosted backup (B2)`. A drill that cannot be dispatched by name cannot be rehearsed at all.

**The fix.** `DRILL_DIR` and the two preserved report paths become the workspace-relative `.restore-drill`. The cleanup step still removes `$DRILL_DIR` unconditionally, so downloaded backup material is destroyed on success and on failure alike. The change is one file, +4/−3.

**Why it must merge knowing what it triggers.** Merging PR #190 into `main` triggers a Vercel **Production** build of `main`'s existing app code. The workflow change itself touches no application code and no runtime behaviour; the build is the side effect the owner should expect, not a new capability.

**State — RESOLVED 2026-11-19.** PR #190 was **merged** after its head SHA, base, one-file diff, result blob (`793d2a3c`) and all 15 checks were verified: merge commit `ff00d38d0abe72bfabf85fb84ac4b3423b62b6f6`. The drill is registered by name, so the preflight can report it and it can be dispatched. The Vercel Production build the merge triggered was the expected side effect named above.

**Still open and unchanged:** PR #194 (the shared-infrastructure pull request, https://github.com/aryanp685/autodine/pull/194) is **open and unmerged**, and merging it is an owner decision this document does not make.

---

## 3. The blocker register (one line each)

> **The consolidated register is `qa-evidence/day1/MASTER_BLOCKER_REGISTER.md`.**
> It gives every open blocker exactly **one owner, one acceptance condition
> and one evidence requirement**, and it is the authoritative list. The
> narrative lists in this section and in `MASTER_OWNER_ACTION_REGISTER.md`
> remain as the owner's working checklists.

- **Backup gate** — bucket + bucket-scoped key, the six repository secret names, **PR #190 merged ✅ (2026-11-19)**, one verified backup run, then one verified restore rehearsal. *Exact steps: `docs/operations/B2_OWNER_CHECKLIST.md`.*
- **Migration canonicalization + B1** — 98 checked-in migrations (98 unique versions) replay green locally, but each collision between two live function bodies is an owner decision, never an inferred source edit. **Reconciled 2026-11-19** against the Batch 2 conflict report merged in PR #193 (`qa-evidence/day1/MIGRATION_CONFLICT_RESOLUTION_BATCH2.md`): it finds **no literal same-version file collisions**, and it confirms the ordered history `20261112000400` → `20261112000600` → `20261114000100` is already correct, with no combined function body needed.
- **Email domain / SMTP** — Brevo must allow Supabase Auth egress IPs (else `525 5.7.1`), and no domain is purchased yet, so branded sending is not claimable.
- **Staging designation + pins** — the staging project's designation is the owner's; it is never silently assumed.
- **Hosted browser + realtime evidence** — gates 5 and 6; both need an authorized hosted run.
- **Alert sink wiring + cron live proof** — gate 7; the sink is the owner's to point at a human-reachable endpoint.
- **Production migration per-file authorizations** — each migration file needs its own authorization; none is implied by a green local replay.
- **Billing provider + GST/IRP tracks** — a separate track with its own approvals; out of scope for this decision.
- **Demo-seed isolation guard** — **CLOSED 2026-11-18; authorization model corrected 2026-11-19.** The fail-closed guard and `npm run staging:seed-demo` described on 2026-11-16 were never committed. They now exist: `lib/staging/demo-seed-isolation.ts` (pure guard) and `scripts/staging/seed-demo.ts` (the command, which prints SQL and writes nothing). On 2026-11-19 the guard was corrected: it no longer hard-codes any project ref, so the historical candidate project **cannot be authorized by default** — the owner supplies the designated list per run through `AUTODINE_DEMO_SEED_APPROVED_REFS`, the target must be an exact member of it, and Production is refused unconditionally before any list or opt-in is consulted. Proven by unit tests, command tests and a real-PostgreSQL proof that the seed leaves another restaurant's rows untouched. See `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md` §3.

> **Eight blockers remain**, and all eight are hosted runs or owner decisions.
> The ninth — the demo-seed guard — was the only one that was also missing
> code, and it is now closed.

---

## 3a. The open-pull-request topology (why merging order matters)

Full audit in `docs/operations/PR_INTEGRATION_PLAN.md`. The short version:

| PR | Status | Disposition |
|---|---|---|
| **#190** | **MERGED 2026-11-19**, one file, `+4/−3`, merge commit `ff00d38` | **Done.** It unblocked the restore drill; the drill is registered by name. |
| **#192** | **CLOSED 2026-11-19** as superseded by #194 | **Done.** Every change was verified present in #194 (10 of 12 files byte-identical, 2 supersets). |
| **#187** | **CLOSED 2026-11-19** as superseded by #188 | **Done.** Merging it would have replaced the owner's approved B2 provider with the superseded R2 implementation. |
| **#194** | **OPEN**, 38 files, `+4353/−71` | **This branch's shared infrastructure.** It carries PR #192's work and the shared infrastructure. It is **not merged** — that is an owner decision. |
| **#188**, **#189** | merged | The B2 implementation and the restore verification — already in `main`. |

The launch decision does not depend on any of them being merged. Gate 2's
*dispatchability* depended on PR #190, which is now merged; what gate 2
still needs is an authorized hosted run.

---

## 3b. The eight blockers, by who has to move them

| # | Blocker | Owner action (decisions, credentials) | Technical implementation | Hosted verification |
|---|---|---|---|---|
| 1 | **Backup gate** | bucket + bucket-scoped key + the six secret names + passphrase; the Production project ref | **DONE** — pipeline, guard, composite action (verifying psql, pg_dump **and** pg_restore), workflows, 132 DR tests, all locally verified (2026-11-19) | **NOT RUN** — one `Hosted backup (B2)` run, then one `Hosted restore rehearsal (disposable)` run. Both need a separate authorization. |
| 2 | **Migration canonicalization + B1** | one decision per colliding function body — never an inferred source edit | manifest, reconciliation and production-only documents landed; canonical bodies await the decision | none — a decision, not a run |
| 3 | **Email domain / SMTP** | Brevo **Authorized IPs** off/allow-all (else `525 5.7.1`); purchase a domain | Brevo adapter, webhook receiver, five Auth flows, template — landed and tested | the five controlled observations (signup, reset, invitation, retry, key-loss) |
| 4 | **Staging designation + pins** | the designation itself; `AUTODINE_EXPECTED_PROJECT_REF`; Auth redirect allow-list; **the designated demo project list** (`AUTODINE_DEMO_SEED_APPROVED_REFS`) | isolation guards landed: deployment isolation, staging config, preview verification, and the demo-seed guard (closed 2026-11-18; corrected 2026-11-19 so no project is authorized by default) | none — standing guard, re-run after every environment change |
| 5 | **Hosted browser + realtime evidence** | authorize both runs; seed the Staging project | E2E specs, the disposable-stack runner, the three-device fallback test — landed | gates 5 and 6: one authorized CI run green with `retries: 0`, and a human watching the realtime fallback |
| 6 | **Alert sink wiring + cron live proof** | point the sink at a human-reachable endpoint | the `[autodine:alert]` channel and the escalation cron — landed | the live 401/200 cron proof |
| 7 | **Production migration per-file authorizations** | one written authorization per migration file | all migrations checked in; the chain replays green locally (101 files) | per-file apply only after that authorization |
| 8 | **Billing provider + GST/IRP tracks** | a separate track with its own approvals | sandbox adapter only; nothing activated | out of scope for this decision |

**The technical item that sat outside the eight is now closed**: PR #190
merged on 2026-11-19, so gate 1's restore rehearsal can be dispatched by
name. What remains is the hosted run itself.

**One technical item sits outside the eight today**: PR #194 is open and
unmerged. It carries the shared infrastructure and PR #192's work, and
merging it is a merge decision rather than a hosted run — but it is not a
launch blocker: the code is already on the branch and locally verified.

**Nothing in the "technical implementation" column is a substitute for the
other two.** All eight blockers are, today, owner actions or hosted runs —
not code changes. That is the honest reason the decision is NO-GO with zero
open P0 code defects.

---

## 4. What this document does NOT do

It does not authorize anything. No merge, no Production deployment, no Production change, no migration, no workflow dispatch, no hosted setting change, no credential disclosure and no paid-service change is implied by any statement here.

**One deployment did occur, and it is stated rather than hidden:** pushing the integration branch caused the Vercel GitHub App to produce a **Preview** deployment automatically (deployment `6pFExiBEDXx7kooBgt6Puu4ksNE4`, project `new`, head `e90ab82`, Preview host `new-git-arena-88c342c2-autodine-iamjarvis9896-3988s-projects.vercel.app`). It is a Preview — the commit is not on `main` and the hostname carries the branch name — and **no Vercel setting was changed**. Merging PR #194 into `main` **will** trigger a Production deployment; that is the merge's side effect, not this document's authorization. Full facts: `qa-evidence/day1/VERCEL_PREVIEW_DEPLOYMENT_EVIDENCE.md`.

The code-level work those gates depend on is already in the repository and locally verified; what remains is the hosted runs and the owner decisions. Where a gate is blocked by an owner decision, the honest report of that gate is **NO-GO**, not a re-scoped pass.
