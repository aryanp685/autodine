# Arena A — staging environment gate and default-branch registration (2026-11-20)

Scope: fixes A (protected `backup-staging` environment secret consumption in the
staging B2 rehearsal workflow), B (default-branch registration of that workflow)
and C (the exact-code mismatch between `main`, PR #194 head and the audited V3
staging implementation). No hosted service was touched: no dispatch, no B2
access, no database connection, no environment or secret was created, modified
or read. The PostgreSQL 17.11 custom-format local DR test was **not** repeated
(it had already passed, per instruction).

Nothing in this record authorizes a run. Launch remains **NO-GO**.

## Baselines recorded

| Ref | SHA |
|---|---|
| `origin/main` (default branch, fetched 2026-11-20) | `5b07e24f884128ffec86e45b2142fe171259c86f` |
| PR #194 head (`arena/88c342c2-autodine`) = this branch's base | `55dfc42932e937ab3c176ff2cd74a288551e70ee` |
| Merge base of the two | `0468d3acc0ba7a66add9cfd154ce9099f40b8a82` |
| This working branch (`arena/88c90663-autodine`) | `55dfc42932e937ab3c176ff2cd74a288551e70ee` (+ uncommitted fix set) |

PR #194 is open, `MERGEABLE`, `mergeStateStatus: CLEAN`, 46 commits. `main` adds
9 commits on top of the merge base, all confined to `.github/workflows/supabase-e2e-load.yml`
and the premium landing/auth redesign (`app/globals.css`, `components/**`,
`e2e/integration/**`, `e2e/kitchen-workflow.spec.ts`, `scripts/e2e/prepare-local-supabase.mjs`).
No file the V3 staging implementation pins was touched by `main`. A local
three-way merge (main into the PR head) auto-resolves `e2e/kitchen-workflow.spec.ts`
with no conflicts; 101 paths change; the pinned backup set is identical before
and after.

## A — protected `backup-staging` environment: what changed and what did not

### Verified live (read-only API)

- `backup-staging` exists (environment id `27886607474`, created 2026-11-19),
  `can_admins_bypass: true`, one protection rule of type `branch_policy`, and
  **zero** custom deployment branch policies configured
  (`deployment-branch-policies` returns `total_count: 0`).
- The environment endpoint lists **no required-reviewer protection rule**.
- Listing environment secrets (`/environments/backup-staging/secrets`) and
  environment variables (`/environments/backup-staging/variables`) returns
  **HTTP 403 "Resource not accessible by integration"**, as does listing
  *repository* secrets and variables (`/actions/secrets`, `/actions/variables`).
  This is a permissions limitation of the connected GitHub integration — it has
  no Actions secrets/variables read permission at all — **not** evidence that
  any secret is absent. Secret or variable **values** were never requested,
  printed, or handled. No secret was created (part 7: not attempted; the owner
  must enter them directly).
- `gh workflow list` does not show a `Staging B2 backup and disposable restore`
  entry; querying `actions/workflows/staging-b2-rehearsal.yml` returns **HTTP 404**.
  The workflow is not registered on the default branch (see part B).

### Workflow changes (`.github/workflows/staging-b2-rehearsal.yml`)

1. The rehearsal job explicitly binds `environment: backup-staging` (exactly one
   occurrence in the file). The new `exact-code-gate` job deliberately has **no**
   environment, secret or variable — it runs before any credential exists.
2. Six environment secrets, exactly these names, materialized only in the steps
   that need them and nowhere else:
   `STAGING_AUTODINE_BACKUP_SOURCE_URL`, `STAGING_AUTODINE_BACKUP_PASSPHRASE`,
   `STAGING_B2_REGION`, `STAGING_B2_BUCKET`, `STAGING_B2_ACCESS_KEY_ID`,
   `STAGING_B2_SECRET_ACCESS_KEY`.
3. Three environment variables, exactly these, in the source-validation step and
   in the preflight presence check only: `AUTODINE_STAGING_PROJECT_REF`,
   `AUTODINE_STAGING_B2_BUCKET`, `AUTODINE_PRODUCTION_B2_BUCKETS`.
4. A new **fail-closed preflight** (`Preflight — backup-staging presence check`)
   runs before any connection: each secret/variable is tested for presence via
   GitHub boolean expressions (`secrets.X != ''`), so the VALUES never enter
   that step; it names only the missing entries and exits 1. The semantic gate
   (`validate-staging-source.mjs`) then proves the source URL targets the
   designated 20-char staging project ref, the bucket equals the designated
   staging bucket, the production bucket inventory parses and does not contain
   the bucket, and the host is not loopback.
5. Secrets are never printed, artifacted (only manifests/reports are uploaded),
   or written to step output; no `secrets: inherit`; no OIDC `id-token`
   permission (`contents: read` only); no B2 endpoint override is wired (the
   client accepts only official `s3.<region>.backblazeb2.com` HTTPS endpoints);
   `--prune-b2` is never passed (guarded by test); every PostgreSQL connection
   string is loopback-only (guarded by test); no backup script loads `.env` or
   `dotenv` (guarded by test).
6. **Fallback posture — stated precisely, not overstated.** GitHub falls back
   to a repository-scoped secret or variable of the SAME NAME when the
   environment does not define one; presence checks cannot distinguish the
   scopes. The names are uniquely `STAGING_`-prefixed and the repository must
   not hold same-name copies — the owner must confirm that in Settings, since
   the integration cannot list repository secrets (403). The second,
   independent layer is the semantic validator plus the production-bucket
   refusal list: even a same-name repository value would have to be the
   designated staging source (exact 20-char ref match), the designated staging
   bucket, absent from the production inventory, pointed at a non-loopback
   designated Supabase project, and signed for that bucket's region — a
   production target fails at least one of those checks. The workflow cannot
   fall back to: any unprefixed/production secret name (none is referenced),
   `.env` files (none are loaded), a B2 endpoint override (none is wired), a
   scratch-project opt-in (none is used), or any other environment (exactly
   one `environment:` declaration exists).
7. No secret was created, rotated or inspected. The owner enters values
   directly in the environment; this record never carried them.

### Residual risk the YAML cannot remove (owner verification)

- Required reviewers on `backup-staging`: **none configured** (only a
  `branch_policy` rule with **zero** policies, meaning deployments from no
  branch may be permitted — the owner should decide the policy deliberately;
  this was not modified).
- `can_admins_bypass: true` remains.
- Staging source/bucket designation, B2 key scope, bucket privacy, revocation
  of the previously exposed credential — all unverified (registry:
  `qa-evidence/day1/MASTER_BLOCKER_REGISTER.md`).

## B — default-branch workflow registration (patch reconstructed)

**The previously prepared registration patch `pr194-arena-a-workflow-registration.patch`
was NOT found** — not in this branch, not in `origin/main`, not in PR #194's
files or comments, not anywhere under the workspace (searches: filesystem-wide
name search, `git log --grep=registration`, reflog, `git fsck --lost-found`).
Per the task, it was **reconstructed** from the documented requirements against
the current default-branch HEAD (`5b07e24`), not the old PR base. It is a new,
standalone artifact — it did not survive from the earlier execution and must be
reviewed as such.

Reconstruction design (self-contained; fails closed; no weaker alternate):

- Adds exactly one file: `.github/workflows/staging-b2-rehearsal.yml` — the
  byte-identical twin of the hardened PR file (SHA-256 `see patch table below`).
- `on: workflow_dispatch` only, with an optional `ref` input (empty = the
  commit the workflow runs at; a full 40-char lowercase hex SHA otherwise).
- New `exact-code-gate` job: validates the SHA format, fetches ONLY that
  commit (`git init` + `git fetch --no-tags --depth=1`, no tags), proves
  `rev-parse FETCH_HEAD` equals the request, then byte-compares the fetched
  tree's `scripts/backup/**`, `.github/actions/postgres-client/**`,
  `package.json`, `package-lock.json` (mode + blob id, exactly 44 entries)
  against a manifest pinned in the workflow. On any drift it prints ONLY the
  offending paths (missing / unexpected / changed) and fails closed BEFORE any
  credential is materialized. The gate job holds no environment, secret or
  variable.
- The rehearsal job has `needs: exact-code-gate` and checks out exactly the
  gated SHA, so the code that runs after the gate is precisely the code the
  gate verified.
- After PR #194 (with the hardening patch) is merged, `main` contains the same
  bytes; dispatching with an empty `ref` then rehearses `main` itself and the
  gate accepts it (proven in part C).

Verified for the reconstruction (all on this machine, read-only network to
`github.com` only):

- YAML parse of every workflow file and the composite action: 14/14 + action OK.
- `git apply --check` of the registration patch against pristine `origin/main`
  (throwaway worktree, later removed): applies cleanly; the applied file
  parses; `workflow_dispatch` present; exactly one `environment: backup-staging`.
- The gate executed end-to-end (steps extracted from the YAML): `5b07e24f…`
  → REFUSED (22 missing + 17 changed, paths printed, none read); `55dfc429…`
  → REFUSED (fails closed: the current PR head predates this patch set — after
  this set is committed and pushed, its tree passes); a non-existent SHA →
  fetch refused; `notasharef` → refused at the format check.
- A tamper of one pinned file (`lib-b2.mjs`) in a scratch merged-tree probe →
  REFUSED and named.
- actionlint **could not be run** in this sandbox: the release binary host is
  unreachable and no Go toolchain is installed; the PyPI `actionlint-py` sdist
  cannot fetch its embedded binary (its download host is also blocked). The
  patch was instead checked with full YAML parsing, a 16-test wiring guard
  (`scripts/backup/staging-rehearsal-wiring.test.mjs`), `node --test` suites,
  `tsc --noEmit`, `eslint .`, and a manual pass confirming the only expression
  spliced into shell text is `${{ job.status }}` (GitHub-controlled), no
  `github.event.inputs.*` ever reaches `run:`, and no user-controlled value
  reaches a shell unquoted. actionlint must be re-run wherever it is
  available (e.g. CI) before merge.

## C — the exact-code mismatch, precisely

`main` and the PR agree on the merge base (`0468d3a`); `main` then diverged
(9 commits; landing/auth redesign + Supabase CLI pin; only
`.github/workflows/supabase-e2e-load.yml`, `app/globals.css`, `components/**`,
`e2e/**`, `scripts/e2e/prepare-local-supabase.mjs`). The backup/staging
implementation in `main` is the OLDER one.

Files differing (git blob id) between `origin/main` and the V3 working tree:

| Set | Files |
|---|---|
| Missing on `main` (V3-only, 22) | `.github/actions/postgres-client/{action.yml,install-client.sh,verify-client.sh}`; `scripts/backup/{b2-owner-checklist.test.mjs, backup-mode.test.mjs, backup-source.test.mjs, compare-rehearsal-manifests.mjs, compare-rehearsal-manifests.test.mjs, dump-order.test.mjs, lib-b2-read.mjs, lib-backup-mode.mjs, lib-backup-source.mjs, lib-pg-client.mjs, lib-pg-client.test.mjs, lib-restore-target.mjs, postgres-client-action.test.mjs, postgres-client-env.test.mjs, postgres-client-wiring.test.mjs, prepare-disposable-restore.mjs, restore-target.test.mjs, staging-rehearsal-wiring.test.mjs, validate-staging-source.mjs}` |
| Changed relative to `main` (17) | `package.json`, `package-lock.json`, `scripts/backup/{b2-upload.test.mjs, backup-logical.mjs, check-dr-objectives.mjs, check-dr-objectives.test.mjs, download-b2.mjs, lib-b2.mjs, lib-dump.mjs, prune-b2.mjs, prune-b2.test.mjs, restore-logical.mjs, upload-b2.mjs, verify-backup-file.mjs, verify-backup-file.test.mjs, verify-restored-db.mjs, verify-restored-db.test.mjs}` |
| Identical (27) | remaining `scripts/backup` files, `docs/backup-restore-runbook.md` refresh is PR-side, untouched-by-main files |

The "mismatch" is therefore definitional: a workflow registered on `main` that
checked out `main` would run pre-V3 code (or fail to find
`validate-staging-source.mjs` outright) — fail-closed by accident, not by a
controlled gate. The reconstruction makes it fail-closed **by design** and,
after merge, fail-closed if and only if the dispatched ref is not the audited
V3 tree.

Minimal integration patch (`pr194-arena-a-staging-rehearsal-hardening.patch`):

1. `.github/workflows/staging-b2-rehearsal.yml` — the hardened unified file
   above (byte-identical to the file the registration patch adds to `main`,
   so the later merge sees identical add/add content, not a conflict);
2. `scripts/backup/staging-rehearsal-wiring.test.mjs` — NEW 16-test wiring
   guard (registered in `test:dr`);
3. `package.json` — registers the guard in `test:dr`;
4. this evidence record.

`main` was NOT modified locally at any point; no `main` file was replaced by an
older PR-base copy. No merge was performed. The V3 manifest was re-derived
from the post-patch tree; the wiring guard fails CI on any drift.

## D — verification evidence

| Requirement | Result |
|---|---|
| Workflow references `backup-staging` | ✅ exactly one declaration, on the rehearsal job; gate job binds none |
| Six required secrets referenced by name, values never read by preflight/gate | ✅ wiring test + grep audit: exactly the six names exist and no others (`staging-rehearsal-wiring.test.mjs`, test 6/11/12/13) |
| Three required variables checked | ✅ preflight presence booleans + `validate-staging-source.mjs` semantics (test 7/11/12) |
| No production fallback | ✅ no unprefixed secret name referenced; `secrets: inherit` absent; no `B2_ENDPOINT`; no `--prune-b2`; loopback-only PG URLs; ≤ one environment; `.env`/dotenv absence guarded |
| Default-branch workflow file contains `workflow_dispatch` | ✅ after applying the registration patch to a pristine `main` worktree (parse-verified); **not on `main` until the owner publishes it** |
| Exact-code gate accepts only the intended V3 implementation | ✅ accepts the simulated post-merge tree (tree `f23f6d8c254e78e86521da784272811bf30fced0`, compare-block exit 0); REFUSED `main`, REFUSED current PR head (pre-push), REFUSED a tampered file, REFUSED a nonexistent SHA and a branch name |
| YAML / actionlint / tests pass | YAML: all parse. actionlint: **unavailable in sandbox** (see B). `npm run test:dr` **194/194** (incl. new guard); `test:staging:guards` **66/66**; `tsc --noEmit` clean; `eslint .` clean; `verify:release` OK (28 checks); `verify:local-gates` not re-run (would repeat the PG17 DR pass deliberately not repeated) |
| SHAs recorded | main `5b07e24f884128ffec86e45b2142fe171259c86f`; PR head `55dfc42932e937ab3c176ff2cd74a288551e70ee`; merge base `0468d3acc0ba7a66add9cfd154ce9099f40b8a82`; merged-probe tree `f23f6d8c254e78e86521da784272811bf30fced0`; patch SHA-256s in the patch table below |

Environment secret/variable availability: **NOT verified — awaiting a protected
run or owner attestation.** The connected integration lacks Actions
secrets/variables read permission (HTTP 403 on environment AND repository
listings). This prevents independent listing; it does not prove the six
secrets and three variables are absent, and this record does not claim they
are. The first dispatch (only after owner authorization) is the verification.

## Status — stated plainly

1. **Workflow code fixed and tested** (hardening + registration reconstruction);
   YAML valid; wiring guard green; not yet on the default branch.
2. **Registration on `main`: still awaiting authorized publication.** The patch
   exists and applies to `main`; applying/merging/pushing it is owner action.
   Until then `gh workflow list` shows no such workflow and dispatch returns 404.
3. **Environment secret REFERENCES wired** exactly as required; presence
   preflight fails closed; values never handled.
4. **Actual protected-workflow secret AVAILABILITY: unverified.** 403 prevents
   independent listing. Only a protected `workflow_dispatch` run (or the owner's
   UI attestation) can establish it. Do not infer absence from the 403.

## Owner actions required (in order)

1. Review both patches (below). Commit the hardening patch to PR #194 (with the
   owner's approval), push, and let CI re-run (including the new guard).
2. Decide and configure `backup-staging` protection deliberately: required
   reviewers; branch policy (currently zero custom policies); whether
   `can_admins_bypass` should stay true. Enter the six secrets and confirm the
   three variables + no same-name repository copies exist.
3. Apply the registration patch to `main` (it adds only the workflow file),
   verify `gh workflow list` shows it by name, and merge PR #194.
4. Only with explicit authorization: dispatch `Staging B2 backup and disposable
   restore` with `ref` = the merged SHA (or empty on `main`). Watch for the
   gate line in the log. A refusal there is the gate working, not a defect.
5. Regenerate the V3 manifest in the same change whenever the pinned
   implementation changes — never edit it by hand; the wiring guard enforces
   the match.
6. Revoke and replace the previously exposed B2 credential if not yet done;
   verify bucket privacy/scope; keep the production backup workflow and its
   schedule untouched.

## Patch artifacts (repository root, uncommitted)

| File | Base | Contents | SHA-256 |
|---|---|---|---|
| `pr194-arena-a-workflow-registration.patch` | `5b07e24f884128ffec86e45b2142fe171259c86f` | NEW `.github/workflows/staging-b2-rehearsal.yml` (registration twin); 344 lines, 20,659 bytes | `e6c7dc8baa026e703cf747a35e8f84d3e9e4f882abe0807f571390653615a7fe` |
| `pr194-arena-a-staging-rehearsal-hardening.patch` | `55dfc42932e937ab3c176ff2cd74a288551e70ee` | Workflow hardening (same bytes, SHA-256 `5529bde29e0242af70f03b07acb3dfab8a6d74e37b94f293cb4ffe8b4d228685`), `scripts/backup/staging-rehearsal-wiring.test.mjs`, `test:dr` registration, this record | embeds this document — its SHA-256 is recorded only in the closing report, not in itself |

Both patches were applied to throwaway worktrees of their respective bases and
re-verified: the registration patch applies cleanly on `origin/main` (applied
file parses; `workflow_dispatch` present; one `environment: backup-staging`;
bytes identical to the PR version); the hardening patch applies cleanly on the
PR head and its 16-test wiring guard passes there.

The two patches carry the same workflow bytes by design; apply the hardening
patch to the PR branch and the registration patch to `main`. If only one is
applied, `main` ends up with the workflow but the PR's CI will cover the guard;
both are required for the end state described above.

Not done, by instruction and by boundary: dispatch, staging DB connection, B2
connection, hosted resource/secret/variable/bucket changes, commit, push,
merge, deploy. PR #194 remains open. `scripts/phase3/staging-baseline.json`
was not touched.
