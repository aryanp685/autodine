# AUTODINE — MISSING EVIDENCE REGISTER

Seven paths are referenced by documents in this repository but have never existed in it. This register is the authoritative answer to "where is that file?" — **MISSING**, with the search that proves it and the honest consequence for each claim.

**Search performed (2026-11-18, read-only).** Every one of the seven was checked against:

- the complete Git history of `main` (693 commits, unshallowed) and of **all 80 remote branches** — `git log --all --diff-filter=A -- <path>`;
- the file list of **every pull request** in the repository, open, merged and closed (~40 PRs) — `gh api .../pulls/<n>/files`;
- the working tree.

**Result: none of the seven was ever committed, in any branch or in any pull request.** They are not lost, superseded-on-disk, or recoverable from a dangling object — they were described in a run log whose own working tree was never committed.

**This register does not recreate them.** A historical evidence document that was never written cannot be reconstructed honestly; inventing one would put invented content where a reader expects a record of what actually happened. Each entry below states what DID land instead, and what remains unproven.

---

## 1. `docs/operations/B2_BACKUP_IMPLEMENTATION_HANDOFF.md` — MISSING

- **Referenced by:** `MASTER_OWNER_ACTION_REGISTER.md` (B2 status banner); `MASTER_EXECUTION_STATUS.md` (Part A, B2 parked).
- **Claim it supported:** the narrative handoff for the backup/restore implementation.
- **What DID land:** the implementation itself — `scripts/backup/{backup-logical,upload-b2,download-b2,prune-b2,restore-logical,verify-restored-db,lib-b2,lib-crypto,lib-dump}.mjs`, `.github/workflows/hosted-backup.yml`, `.github/workflows/hosted-restore-drill.yml`, and the DR suite.
- **Consequence:** no *document* describes the implementation's reasoning, but the code and its tests do. The B2 provider decision and the hosted-run status are recorded in the owner register. **Nothing in the backup gate depends on this document.**

## 2. `lib/environment-boundaries.test.ts` — MISSING

- **Referenced by:** `MASTER_EXECUTION_STATUS.md` (Part B, Priority 4 — Preview/Staging isolation).
- **Claim it supported:** a test file pinning environment boundaries.
- **What DID land:** the boundary implementations and their tests under different names — `lib/supabase/deployment-isolation.ts` (+ `lib/supabase/deployment-isolation.test.ts`), `lib/staging-config.ts` (+ `lib/staging-config.test.ts`), `scripts/verify-preview-isolation.mjs`, `docs/preview-isolation.md`.
- **Consequence:** the *capability* is present and tested; only the file name in the run log is unresolvable.

## 3. `lib/staging/demo-seed-isolation.ts` — MISSING **and its feature never landed**

- **Referenced by:** `MASTER_EXECUTION_STATUS.md` (staging isolation completion).
- **Claim it supported:** a fail-closed demo-seed guard plus `npm run staging:seed-demo` ("nothing seeded; owner runs it").
- **What DID land:** `lib/db/demo-menu.ts` (a `demoSeedSql` helper) — which is **not** the same thing. The `lib/staging/` directory does not exist and `npm run staging:seed-demo` is **absent from `package.json`**.
- **Consequence:** unlike the other six, this is a **real open item, not a stale reference**. The fail-closed guard and the owner-run seeding command described on 2026-11-16 were never committed. Until they are, any demo seed that runs is not protected by the guard the run log claims. See the blocker register.

## 4. `qa-evidence/day1/EMAIL_DELIVERABILITY_IMPLEMENTATION.md` — MISSING (superseded)

- **Referenced by:** `docs/operations/EMAIL_DELIVERABILITY_RUNBOOK.md` (companion evidence); `MASTER_EXECUTION_STATUS.md` (Resend-era inspection).
- **Claim it supported:** the inspection + validation record for the Resend-era email implementation.
- **What DID land:** `qa-evidence/day1/BREVO_AUTH_EMAIL_IMPLEMENTATION.md` — the Brevo record that replaced it. The Resend plan was explicitly superseded ("Resend plan superseded", "Resend runbook + prior evidence marked SUPERSEDED").
- **Consequence:** the Resend-era record is missing *and was meant to be* — the surviving evidence is the Brevo one. `docs/operations/EMAIL_DELIVERABILITY_RUNBOOK.md` still points at the superseded path and is itself Resend-era; see the blocker register.

## 5. `qa-evidence/day1/MIGRATION_DRIFT_RECONCILIATION_BATCH1.md` — MISSING

- **Referenced by:** `MASTER_OWNER_ACTION_REGISTER.md` (Tier 3: "The Batch 1 reconciliation (…) is the evidence. No classification in it authorizes any migration.").
- **Claim it supported:** the Batch 1 classification of 49 production-only items and 5 canonical-body collisions.
- **What DID land:** `docs/migration-manifest-2026-11-14.md`, `docs/migration-reconciliation.md`, `docs/production-only-migrations-2026-11-14.md`, plus the owner register's own Tier 3 table.
- **Consequence:** the per-file classification is **not** in the repository as a single evidence document. The owner register carries the actionable form of it (the exact decisions asked), and `npm run verify:release` asserts the "not applied" invariant. **Each migration file still needs its own authorization** — the missing document does not change that, and no migration may be treated as authorized by its absence.

## 6. `qa-evidence/day1/STAGING_ISOLATION_IMPLEMENTATION.md` — MISSING

- **Referenced by:** `MASTER_EXECUTION_STATUS.md` (roadmap row 9; Part B).
- **Claim it supported:** the implementation record for Preview/Staging isolation.
- **What DID land:** the implementation and its evidence — `lib/supabase/deployment-isolation.ts`, `lib/staging-config.ts`, `scripts/verify-preview-isolation.mjs`, `docs/preview-isolation.md`, and the isolation self-test (`npm run isolation:verify`).
- **Consequence:** the capability is present, tested and offline-verified. Only the narrative record is missing.

## 7. `qa-evidence/day1/STAGING_ISOLATION_COMPLETION.md` — MISSING

- **Referenced by:** `MASTER_OWNER_ACTION_REGISTER.md` (items 2.6 and the migration note); `MASTER_EXECUTION_STATUS.md` (staging isolation completion).
- **Claim it supported:** the 2026-11-16 completion record — closed repo-side items, prepared owner items, and the open owner decisions (O-B1…O-B5).
- **What DID land:** the owner register's rows 2.6–2.9 and the Tier 3 tables, which carry the open owner decisions in actionable form.
- **Consequence:** the open owner decisions are recorded; the completion narrative is not. Note that item 3 of this register (the demo-seed guard) was part of that same completion and genuinely did not land.

---

## How to read a MISSING marker

Anywhere a document in this repository cites one of these paths, the citation is marked **[MISSING]** and points here. A MISSING marker means:

- **the file does not exist** — do not go looking for it, and do not treat its absence as a repository defect to fix by writing the file;
- **the substance may still be elsewhere** — check the "What DID land" line before concluding anything;
- **in one case only (item 3) the capability itself is missing** — that is an open item, recorded in the blocker register.
