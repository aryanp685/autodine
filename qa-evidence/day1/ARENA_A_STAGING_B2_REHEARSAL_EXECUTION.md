# Arena A — Staging B2 rehearsal: execution record

Sanitized. No credential value, database URL, key, token or customer record appears here.
Every credential below is described by **length only**, which is what the workflow emits.

## Verdict

| Field | Value |
|---|---|
| Rehearsal result | **BLOCKED** — the staging source rejected authentication |
| Blocking step | `9. Back up staging, verify locally and upload to B2` |
| Failure | `password authentication failed for user "postgres"` (PostgreSQL `28P01`) |
| Backup produced | none — the dump never started |
| B2 contact | none — no upload was attempted, so no object exists and none could be deleted |
| Restore executed | none — dependent steps were skipped |

A real B2 rehearsal did **not** happen. Nothing in this record should be read as a pass.

## Identities (verified without printing secrets)

| Item | Value | How verified |
|---|---|---|
| Default branch at dispatch | `main` | `git rev-parse origin/main` |
| Code SHA rehearsed | `7a0c4811b5e9d38ab85e78fc2748a0ce97741461` | exact-code gate accepted 44/44 files, byte for byte |
| Supabase staging project | `juwyhslzchjevqkdvwjm` | `vars.AUTODINE_STAGING_PROJECT_REF` matched by the identity step, which **passed** |
| Production project | `bdbapevwmgdvghszjno` | not present in the source URL; production denied by construction |
| B2 bucket | `autodine-staging-db-backups` (ID `d209a0cc2db8f17fac100514`) | identity step passed; bucket variable matched |
| B2 region / endpoint | `eu-central-003` / `s3.eu-central-003.backblazeb2.com` | region secret present (14 chars); endpoint derived, no override in use |
| Production bucket exclusion | enforced | `vars.AUTODINE_PRODUCTION_B2_BUCKETS` present, fail-closed check passed |

## Protected-environment configuration, proven by a real protected run

The preflight step evaluates `secrets.X != ''` for all six secrets and three variables and fails closed if any is empty. It **passed** in every run, which proves effective availability from the scope GitHub resolves for the `backup-staging` environment (that scope also considers same-name repository secrets — see Limitations).

| Credential | Effective presence | Length observed |
|---|---|---|
| `STAGING_AUTODINE_BACKUP_SOURCE_URL` | present | 122 |
| `STAGING_AUTODINE_BACKUP_PASSPHRASE` | present | **8** (code only enforces non-empty; `12+` is advice in its message, not a rule) |
| `STAGING_B2_ACCESS_KEY_ID` | present | 26 |
| `STAGING_B2_SECRET_ACCESS_KEY` | present | 31 |
| `STAGING_B2_BUCKET` | present | 27 |
| `STAGING_B2_REGION` | present | 14 |
| `AUTODINE_STAGING_PROJECT_REF` | present | not read |
| `AUTODINE_STAGING_B2_BUCKET` | present | not read |
| `AUTODINE_PRODUCTION_B2_BUCKETS` | present | not read |

## Runs

| # | Run | Result | What it established |
|---|---|---|---|
| 1 | [44789437003](https://github.com/aryanp685/autodine/actions/runs/44789437003) | gate PASS, rehearsal FAIL | exact-code gate works in real CI; failure reason unreadable |
| 2 | [44791402579](https://github.com/aryanp685/autodine/actions/runs/44791402579) | FAIL | diagnostic saw no secrets (step-scoped) → false "empty" claim |
| 3 | [44792714068](https://github.com/aryanp685/autodine/actions/runs/44792714068) | FAIL | passphrase length (8) observed; annotation mis-stated the rule |
| 4 | [44794052811](https://github.com/aryanp685/autodine/actions/runs/44794052811) | FAIL | handler never ran: `bash -e` aborted before it |
| 5 | [44795251974](https://github.com/aryanp685/autodine/actions/runs/44795251974) | gate PASS, rehearsal FAIL | **true cause**: source auth rejected (`28P01`) |

Defects found and fixed in our own workflow during execution (PRs #197–#201): gate registration; annotation channel that works without log access; step-scoped secret visibility; a duplicated rule that disagreed with the implementation; and the `bash -e` handler that never ran. Each fix is in `main`.

## Why the boundary was not crossed

The source database is the credential owner's staging project. The authentication failure is a **credential/permission boundary**, not a code defect:

- re-dispatching with the same credentials cannot succeed, so repeating it would only add noise (authorized "repeat where safe" does not cover "repeat a known-failing auth");
- recovering or brute-forcing the staging password is explicitly out of scope (no rotating/creating credentials);
- no fallback to production, no other database, no local `.env` may be substituted.

Minimum action to proceed: the owner sets `STAGING_AUTODINE_BACKUP_SOURCE_URL` in the `backup-staging` environment so its password authenticates for user `postgres` against the **session/direct** endpoint of `juwyhslzchjevqkdvwjm` (not the transaction pooler), then the same dispatch is repeated — no workflow change needed.

## Limitations that remain unproven

- **Repository-level shadow copies**: listing secrets/variables returns HTTP 403 at both repository and environment scope, so "the value came only from the environment" cannot be proven. The preflight proves *effective* availability, which may include same-name repository values.
- **Environment protection strength**: `backup-staging` has `can_admins_bypass: true`, no required reviewers, and **zero** custom deployment branch policies (`total_count: 0`). Dispatch to `main` worked regardless, so no branch-policy gate is in force.
- **Workflow log text**: GitHub serves job logs from hosts this environment cannot reach (HTTP 000), so evidence here relies on check-run annotations plus per-step conclusions. Annotations are sufficient for the facts cited.
- **`actionlint`** was not runnable here (no binary host access, no Go toolchain); CI lint plus `test:dr` 194/194 and `test:staging:guards` 66/66 stand in its place. This is a gap, not a pass.

## Security statements

- No secret value, URL, passphrase or key was printed, logged, artifacted or committed.
- The workflow emits credential **lengths** only and scrubs URLs and 40+ char token runs before emitting anything.
- No B2 object, version, bucket or key was created, modified or deleted.
- No production database or production bucket was contacted.
- PR #194 was not merged; no production deployment occurred.
