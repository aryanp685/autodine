# Arena A — Staging B2 rehearsal: execution record

Sanitized. No credential value, database URL, key, token or customer record appears here.
Credentials are described by **length or result only**, which is what the workflow emits.

## Verdict: BLOCKED

| Field | Value |
|---|---|
| Result | **BLOCKED** — the staging source rejects its own password |
| Blocking gate | `Authentication check` (new, runs before any backup work) |
| Safe diagnostic | `psql … FATAL: password authentication failed for user "postgres"` (`28P01`) |
| Backup / upload / download / restore | none — nothing was attempted past the gate |
| B2 objects created | none, therefore none deleted |

No backup, no B2 upload, no restore happened. Nothing here may be read as a pass.

## Why this is an owner-side gate, not a code defect

The workflow now proves the credential **before** spending a run. The configured
`STAGING_AUTODINE_BACKUP_SOURCE_URL` resolves to `aws-0-ap-northeast-2.pooler.supabase.com:5432`
(session pooler, which is the correct endpoint class for a consistent snapshot), and that
endpoint rejects the configured password for user `postgres`.

The only fixes are owner-side: set a working password in the environment secret, or reset the
staging database password in Supabase. This run is **not** authorized to rotate or recover
credentials, and will not substitute production or another project.

## GitHub run

| # | Run | Gate | Outcome |
|---|---|---|---|
| 1 | [44798845545](https://github.com/aryanp685/autodine/actions/runs/44798845545) | PASS | auth step had no connection target (defect, PR #203) |
| 2 | [44800101568](https://github.com/aryanp685/autodine/actions/runs/44800101568) | PASS | **auth rejected `28P01`** — the real gate |

- Code SHA rehearsed: `26d236e34ae54e248f5215f315c2fd4b17c5ef4e` (44-file manifest, byte for byte).
- Workflow on `main` at dispatch: `016b03ef7633deaeffe051f372ca2d340cb759d6`.

## Identities

| Item | Value | How established |
|---|---|---|
| Supabase project | `juwyhslzchjevqkdvwjm` | identity step passed; source ref matched the variable |
| Production project | `bdbaqpevwmgdvghszjno` | refused **by name** in a negative test; never contacted |
| B2 bucket / ID | `autodine-staging-db-backups` / `d209a0cc2db8f17fac100514` | identity step passed |
| B2 region / endpoint | `eu-central-003` / `s3.eu-central-003.backblazeb2.com` | region secret present (14 chars), endpoint derived, no override |
| Production bucket exclusion | enforced | exclusion variable present, fail-closed check passed |

## Effective credential presence (preflight passed in every run)

| Credential | Presence | Length |
|---|---|---|
| `STAGING_AUTODINE_BACKUP_SOURCE_URL` | present | 122 |
| `STAGING_AUTODINE_BACKUP_PASSPHRASE` | present | 8 — **below the enforced 12-char minimum** |
| `STAGING_B2_ACCESS_KEY_ID` | present | 26 |
| `STAGING_B2_SECRET_ACCESS_KEY` | present | 31 |
| `STAGING_B2_BUCKET` | present | 27 |
| `STAGING_B2_REGION` | present | 14 |
| `AUTODINE_STAGING_PROJECT_REF`, `AUTODINE_STAGING_B2_BUCKET`, `AUTODINE_PRODUCTION_B2_BUCKETS` | present | not read |

The 8-character passphrase would now be refused **before any connection** by the shared contract; it never
reached encryption because authentication failed first. It still needs an owner-side update to 16+ characters.

## Passphrase contract (implemented this run)

`lib-crypto.mjs` enforced 12+ characters but only inside `encryptBuffer`, i.e. **after**
`backup-logical.mjs` had already opened a PostgreSQL snapshot. Now:

- `MIN_PASSPHRASE_LENGTH`, `PASSPHRASE_RULE`, `passphraseProblem()` live in `lib-crypto.mjs` — one authority;
- `backup-logical.mjs` refuses before any connection, snapshot, temp directory or byte;
- the workflow pre-check mirrors the constant, and a test fails if the two drift;
- 9 focused tests (`passphrase-contract.test.mjs`): missing, too short, boundary, valid, no-leak (value and length), encrypt guard, ordering, drift, workflow mirror.


## Structural finding: PR #194 is a separate history, not a branch of `main`

Discovered while validating the merge path. This is the deepest blocker and it is **not** a code defect.

| Check | Result |
|---|---|
| Common ancestor of PR #194 head and `main` | **none** (`git merge-base` reports no common ancestor) |
| Shared commits | **0** |
| Root commit of PR #194 | `55dfc429…` (the branch root is itself a grafted root) |
| Root commit of `main` | `5b07e24f…` |
| `git merge main` on the PR branch | `fatal: refusing to merge unrelated histories` |
| V3 implementation on `main` | absent — e.g. `scripts/backup/lib-b2-read.mjs`, `scripts/backup/validate-staging-source.mjs`, `.github/actions/postgres-client/action.yml` all missing |
| `main`'s `test:dr` | does not run the staging wiring test, so the gate refuses `main` too |

### Operational consequence

The exact-code gate accepts only a commit that contains the audited 45-file implementation. That
implementation exists **only** in PR #194's history. `main` cannot contain it without importing
that history, and the two histories cannot be merged by an ordinary merge.

So the rehearsal cannot be unblocked by fixing credentials alone. Two gates stand in order:

1. **Import PR #194's history into `main`** (see below) — a repository-architecture decision.
2. **Repair the staging source password** (`28P01`).

Both are owner-side. Neither is authorized to this execution, and neither was bypassed.

### Minimum action for gate 1 (owner decision required)

Either:

- **(a) adopt PR #194's tree as the line of development** — merge `arena/88c342c2-autodine` into `main`
  with `--allow-unrelated-histories`, reviewing the resulting diff, then re-point future work at it; or
- **(b) graft deliberately** — keep `main` as the trunk and import the implementation as a single
  reviewed commit produced from PR #194's tree (a true "subtree import"), accepting that PR #194's
  individual commits are not preserved as ancestry.

Option (a) is the faithful one and preserves history; option (b) rewrites lineage. Both are product
decisions about which line owns the repository, so this execution stops and asks rather than choosing.

## Defects found and fixed by executing

| Run | Defect | Fix |
|---|---|---|
| #44795251974 | failure reason unreadable without an elevated log viewer | check-run annotation channel (#198) |
| #44791402579 | diagnostic saw no secrets (step-scoped) and wrongly claimed one empty | report inside the owning step (#199) |
| #44792714068 | workflow duplicated a rule and stated it wrongly | code is the single authority (#200) |
| #44794052811 | handler never ran: `bash -e` aborted first | `set +e` (#201) |
| #44798845545 | auth step gave `psql` no connection target | `PG*` variables, never the URI (#203) |

## Timings

Not measurable: the gate rejects the credential in seconds, before any dump, upload or restore.
Reporting a backup/upload/restore duration or an RPO/RTO figure would be fabrication.

## Limitations (unresolved)

- **Repository-level shadow values**: listing secrets returns HTTP 403 at both environment and repository scope, so "environment-only" scope is **unverified**. Preflight proves *effective* availability, which may include same-name repository values. Minimum owner action: confirm in Settings that the six secrets and three variables exist under `backup-staging` and that no same-name repository-level copies exist.
- **Environment protection**: `can_admins_bypass: true`, no required reviewers, **0** custom deployment branch policies. Dispatch works with no policy gate. Not changed by this execution.
- **Job logs**: GitHub serves them from hosts unreachable here (HTTP 000); evidence uses check-run annotations and per-step conclusions.
- **`actionlint`**: not runnable here (no binary host access, no Go). CI lint plus `test:dr` 203/203 and `test:staging:guards` 66/66 stand in its place. A gap, not a pass.

## Security statements

- No secret value, URL, passphrase or key was printed, logged, artifacted or committed.
- The workflow emits result codes and credential **lengths** only, and scrubs URLs and 40+ char token runs.
- No B2 object, version, bucket or key was created, modified or deleted.
- No production database or bucket was contacted; production project refused by name in a negative test.
- PR #194 remains OPEN and unmerged; no production deployment occurred.
