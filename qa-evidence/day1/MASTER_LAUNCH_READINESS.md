# AUTODINE — MASTER LAUNCH READINESS

The launch decision, the gates behind it, and the exact sequence that closes them.

**Current decision: NO-GO.** Not because of an open code defect — there are **zero open P0 code defects** — but because the hosted evidence and the owner decisions that stand between this codebase and a launch have not been produced yet. Every gate below is a *hosted run* or an *owner action*, not a code change.

**Live state, on demand:** `node scripts/hosted-verification/preflight.mjs` (read-only; `--json` for machines). It prints configuration names as SET/UNSET (never values), the live GitHub state, and a per-package verdict. When GitHub refuses a read it answers UNKNOWN — never "absent". **Presence is not validity; validity is not delivery.** A verdict of READY-TO-AUTHORIZE means the inputs are in place and a human must now authorize the run; it never means the run happened.

---

## 1. The gates

| # | Gate | Verdict source | What is missing |
|---|------|----------------|-----------------|
| 1 | B2 backup + artifact verification | preflight `b2-backup` | Bucket + bucket-scoped key, the six repository secret names, then one authorized run whose output shows `uploaded:true, verified:true` |
| 2 | Disposable hosted restore rehearsal | preflight `restore-rehearsal` | The drill must be registered **by name** (PR #190, unmerged) and then dispatched against gate 1's backup |
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

**State.** PR #190 is OPEN, not merged. The fix is also carried on the integration branch `arena/88c342c2-autodine` (byte-identical to upstream's result blob). Merging it — and the other open PRs — is an owner decision this document does not make.

---

## 3. The blocker register (one line each)

- **Backup gate** — bucket + bucket-scoped key, the six repository secret names, PR #190 merged, one verified backup run, then one verified restore rehearsal. *Exact steps: `docs/operations/B2_OWNER_CHECKLIST.md`.*
- **Migration canonicalization + B1** — 99 checked-in migrations replay green locally, but each collision between two live function bodies is an owner decision, never an inferred source edit.
- **Email domain / SMTP** — Brevo must allow Supabase Auth egress IPs (else `525 5.7.1`), and no domain is purchased yet, so branded sending is not claimable.
- **Staging designation + pins** — the staging project's designation is the owner's; it is never silently assumed.
- **Hosted browser + realtime evidence** — gates 5 and 6; both need an authorized hosted run.
- **Alert sink wiring + cron live proof** — gate 7; the sink is the owner's to point at a human-reachable endpoint.
- **Production migration per-file authorizations** — each migration file needs its own authorization; none is implied by a green local replay.
- **Billing provider + GST/IRP tracks** — a separate track with its own approvals; out of scope for this decision.
- **Demo-seed isolation guard** — the fail-closed guard and `npm run staging:seed-demo` described on 2026-11-16 were never committed: `lib/staging/` does not exist and the npm script is absent. **This is a real open code item, not a stale citation.** Until it exists, no demo seed is protected by the guard the run log claims. See `qa-evidence/day1/MISSING_EVIDENCE_REGISTER.md` §3.

> The eight earlier blockers are all hosted runs or owner decisions. The ninth
> is the only one that is *also* missing code — and it is small, bounded and
> does not block the launch gates above; it blocks the claim that staging is
> demo-safe.

---

## 3a. The open-pull-request topology (why merging order matters)

Full audit in `docs/operations/PR_INTEGRATION_PLAN.md`. The short version:

| PR | Status | Disposition |
|---|---|---|
| **#190** | open, one file, `+4/−3` | **Merge first.** It unblocks the restore drill. |
| **#192** | open, 8 files | **Do not merge alongside this branch** — the code here is byte-identical to it. Merge this branch and close #192, or merge #192 first and rebase. |
| **#187** | open, 19 files, **Cloudflare R2** | **Close as superseded by #188.** Merging it would replace the owner's approved B2 provider with the superseded R2 implementation. |
| **#188**, **#189** | merged | The B2 implementation and the restore verification — already in `main`. |

The launch decision does not depend on any of them being merged, except
that gate 2 cannot pass until PR #190 is.

---

## 4. What this document does NOT do

It does not authorize anything. No merge, no deployment, no Production change, no migration, no workflow dispatch, no hosted setting change, no credential disclosure and no paid-service change is implied by any statement here.

The code-level work those gates depend on is already in the repository and locally verified; what remains is the hosted runs and the owner decisions. Where a gate is blocked by an owner decision, the honest report of that gate is **NO-GO**, not a re-scoped pass.
