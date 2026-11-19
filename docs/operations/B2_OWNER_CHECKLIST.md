# AUTODINE — B2 BACKUP & RESTORE: OWNER CHECKLIST

Everything the owner must do, in order, with the exact values, the exact
permissions, and the exact authorization each step needs — and nothing that
this repository may do on the owner's behalf.

**Status: hosted evidence NOT FILED.** Bucket, key and repository-secret
state is unknown without owner confirmation; no successful hosted backup or
restore report is filed here. A locally tested recovery fix is on this branch
and must be reviewed and integrated before the hosted drill is dispatched.

**One technical prerequisite was cleared on 2026-11-19:** PR #190 (the
drill's registration fix) merged, so the restore drill is registered **by
name** and can be dispatched at all. Before that it could not be, which is
why every step below was blocked behind it.

> **Authority boundary — read this first.**
> Section A is **owner action**: creating a paid-service account, a private
> bucket, a scoped key, and repository secrets. It happens in the owner's
> dashboards, and nothing in this repository, script or agent can perform it.
> Section B is **owner authorization**: dispatching a hosted workflow. The
> workflows are `workflow_dispatch` only (plus the backup's daily schedule),
> so a human must trigger every run deliberately. Section C is **owner
> acceptance**: reading the evidence and recording the verdict.
>
> *Preparing* any step below is not performing it. No step here is
> authorized by anything in this repository, and nothing here authorizes a
> Production change, a migration, a deployment or a credential disclosure.

---

## 0. At a glance — what is already done, and what is not

| | Status | Detail |
|---|---|---|
| **Technical implementation** | **Follow-on fix locally verified; integration pending** | A bare PostgreSQL target lacks platform objects needed by a public-only restore. This branch adds a disposable scaffold, fixes Mode B precision loss, and hardens target URL checks; see `qa-evidence/day1/LOCAL_POPULATED_RESTORE_REHEARSAL.md`. This does not prove hosted recovery. |
| **Owner action (credentials + bucket)** | **UNVERIFIED** | Sections A1–A5 below. Only the owner can provision or confirm these; inaccessible secret names are UNKNOWN, not proof of absence. |
| **Hosted verification** | ❌ **NOT RUN** | Sections B1–B4 below. A human must authorize each dispatch. |
| **Workflow registration** | ✅ **CLEARED 2026-11-19** | PR #190 fixed registration by name. The additional disposable-scaffold fix on this branch must be reviewed and merged before dispatch from the default branch. |

**Nothing in the technical column is a substitute for the other two.** A
green local suite is not a backup; a bucket without a verified restore is not
a recovery story.

---

## A. Owner action — credentials and bucket

### Account, cost, and staging boundary

Sign up or sign in only at [Backblaze](https://www.backblaze.com/). Complete
verification privately; never share passwords, OTPs, or key values in chat.
Backblaze's [pricing](https://www.backblaze.com/cloud-storage/pricing) lists
10 GB free, storage starting at $6.95/TB/month and free monthly egress up to
3× average stored data; overages and API pricing may apply. Check current
account-specific pricing and obtain explicit approval before any billing or
paid upgrade. Choose the account region deliberately: Backblaze describes an
account as associated with a single region. Consider the designated staging
project's region, residency requirements and actual availability; do not
assume a new bucket can be moved between regions.

For initial acceptance use a designated **staging** source and the separate,
manual-only `Staging B2 backup and disposable restore` workflow on this branch.
It uses the `backup-staging` GitHub Environment, uniquely prefixed secrets and
matching staging project/bucket variables; it refuses Production and never
prunes B2. **It has not been dispatched or verified.** GitHub registers manual
workflows from the default branch, so review and integration are required before
this workflow can normally be dispatched. Configure required reviewers on the
Environment before adding its secrets. The existing hosted workflow instead
reads repository secrets and has a daily 03:17 UTC schedule on the default
branch. Changing repository secrets can affect scheduled runs: do not put a
production source or live key there without explicit operation and
secret-change authorization.

### A1. Create the private bucket

| Property | Required value | Why |
|---|---|---|
| Provider | **Backblaze B2** | The owner's provider decision (2026-11-16). Not R2 — see the integration plan. |
| Visibility | **Private** (not public) | The backup contains the full logical dump of the Production database. |
| Region | e.g. `us-west-004` | Must match `^[a-z]{2}-[a-z]+-\d{3}$` — **lowercase, and a three-digit suffix**. `us-west-4` and `ap-south-1` are both rejected; the correct spelling is `us-west-004`. The endpoint is derived as `https://s3.<region>.backblazeb2.com`. Record the exact region string — it becomes `B2_REGION`. |
| Name | e.g. `autodine-backups` | Must match `^[a-zA-Z0-9][a-zA-Z0-9.-]{5,49}$` (6–50 characters). |
| Lifecycle rules | **none required** | B2's age-based lifecycle rules cannot express the recovery-point policy; `prune-b2.mjs` enforces it instead. Adding age-based rules on top can delete artifacts the policy still needs. |
| Versioning | B2 buckets are versioned by default; verify account settings | The pruner's S3 DELETE without a version ID creates a delete marker, **not permanent deletion**. Hidden versions can continue to incur storage charges. The 14/8/6 policy governs visible recovery points, not physical storage reclamation. Do not apply lifecycle deletion or Object Lock without reviewing recoverability, retention behavior and cost with the owner. |
| Object prefix | `autodine-backups/` | Hard-coded in the pipeline (`BACKUP_PREFIX`). Objects outside it are never written, listed or deleted. |

### Staging-only secure configuration and acceptance

After the owner has explicitly designated a non-production Supabase project,
created a separate private staging B2 bucket, and approved secret changes:

1. In GitHub Settings → Environments, create `backup-staging` and configure
   required reviewers. In **Environment secrets** (not repository secrets),
   enter `STAGING_AUTODINE_BACKUP_SOURCE_URL`,
   `STAGING_AUTODINE_BACKUP_PASSPHRASE`, `STAGING_B2_REGION`,
   `STAGING_B2_BUCKET`, `STAGING_B2_ACCESS_KEY_ID`, and
   `STAGING_B2_SECRET_ACCESS_KEY`. Map them to the same source, passphrase,
   region, bucket, key ID and key-secret meanings described below, but use
   staging-only values. Enter values directly; never share them in chat.
2. In that Environment's **variables**, enter `AUTODINE_STAGING_PROJECT_REF`
   (the explicitly designated staging Supabase ref),
   `AUTODINE_STAGING_B2_BUCKET` (exact staging bucket name), and
   `AUTODINE_PRODUCTION_B2_BUCKETS` (a JSON array containing **all** known
   Production B2 bucket names, for example `["production-bucket"]`). Enter
   `[]` only after the owner verifies that no Production B2 bucket exists.
   The workflow rejects a match against this owner-supplied inventory as well
   as known Production project refs, loopback, connection host/user overrides
   and transaction poolers. The inventory is not independent discovery: an
   incomplete or incorrect inventory cannot establish isolation. Verify the
   bucket is separate, private and the key is restricted in Backblaze.
   GitHub can resolve secrets and variables from broader scopes if an
   Environment value is absent. Verify the `STAGING_*` names are not set at
   repository/organization scope and the variables above have the intended
   Environment values. Configure reviewers and allowed deployment branches;
   workflow YAML cannot prove either protection or secret scope.
3. After review and integration, request a separate explicit authorization to
   dispatch **Staging B2 backup and disposable restore**. This reads staging
   data and uploads to the private bucket, potentially incurring charges. The
   workflow downloads the same run's artifact, checks that every downloaded
   manifest field matches the local manifest, and compares manifest counts and
   financial totals in disposable PostgreSQL. This same-run comparison does
   not cryptographically authenticate a stored manifest for a later restore.
   It does not establish a full row
   fingerprint, recover Auth/Storage, or demonstrate service RTO. Preserve
   report/run links and investigate mismatches; do not claim success if any
   stage or cleanup fails. Monitor B2 storage usage, including hidden versions.

### A2. Create the scoped application key

Backblaze B2 → **App Keys → Add a Key → Restrict Key → Bucket (one bucket)**.

| Capability | Grant? | Used by |
|---|---|---|
| `listFiles` / ListBucket | **yes** | the downloader lists the prefix; the pruner lists it too |
| `readFiles` / GetObject | **yes** | download; the pruner's pre-delete integrity gate re-downloads every candidate |
| `writeFiles` / PutObject | **yes** | upload of the artifact and its manifest |
| `deleteFiles` / DeleteObject | **yes** | remote retention (`prune-b2.mjs`) |
| `createBuckets` | **no** | the bucket is created by the owner, out of band |
| `deleteBuckets` | **no** | the key must never be able to remove the bucket itself |
| `shareFiles` | **no** | the bucket is private; no public URL is ever used |
| Other buckets | **no** | restrict the key to this one bucket |

The key's S3 access key ID becomes `B2_ACCESS_KEY_ID`; its secret becomes
`B2_SECRET_ACCESS_KEY`.

### A3. Create the backup encryption passphrase

One passphrase, owner-held, never in git and never in chat. It becomes
`AUTODINE_BACKUP_PASSPHRASE`.

- **At least 12 characters.** `scripts/backup/lib-crypto.mjs` refuses
  anything shorter (`Backup passphrase must be at least 12 characters`) —
  the run fails at the encryption step, not at the secret gate.
- **Retrievable later.** A backup that cannot be decrypted is not a
  backup. Record where it is stored before continuing.
- **One passphrase, both workflows.** The drill must use the *same*
  passphrase as the backup, or the restore cannot decrypt what the backup
  wrote.

### A4. Prepare the read-only Production connection

`AUTODINE_BACKUP_SOURCE_URL` is a **Postgres connection string to the
Production Supabase project, used read-only**. It is the *source*; the
restore *target* is a different thing entirely (§B3).

- Project ref: **`bdbaqpevwmgdvghszjno`** — the Production project declared in `lib/supabase/production-projects.json`.
- **Use the SESSION pooler (port 5432), or a direct connection. Never the transaction pooler (6543).**

  ```
  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
  ```

  This is the one detail in this checklist that is easy to get wrong, so here
  is why. The backup runs in **Mode A** — `pg_dump` is on the runner's PATH,
  so `backup-logical.mjs` selects it — and Mode A opens one connection,
  exports a snapshot from it (`pg_export_snapshot()`), then runs `pg_dump`
  on a **second** connection with `--snapshot=<id>`, so that the dump and the
  manifest's row counts describe exactly the same frozen data.

  Importing an exported snapshot needs the second connection to be
  session-affine, and through **transaction-mode** pooling (port 6543) it is
  not. The repository says so in the two documents written by whoever
  actually ran a production backup: `PRODUCTION-BACKUP-RUNBOOK.md` §1
  ("Do NOT use Transaction pooler (6543)") and
  `docs/production-operator-setup-2026-11-11.md` ("never the transaction
  pooler (6543), which `pg_dump` does not work correctly through").

  **The host is the same; only the port differs.** Port **5432** is the
  session pooler and is what belongs here. It is also IPv4-reachable, which
  matters because the GitHub-hosted runner has no IPv6 — so a direct
  `db.<ref>.supabase.co` connection (IPv6-only for most projects) is the
  wrong choice from the hosted workflow, even though it is the right one
  from a desktop with IPv6.

  The **restore target** is the opposite case and may use either pooler:
  `pg_restore` imports no snapshot.

  **This is now enforced in code, not only written down (2026-11-19).**
  `scripts/backup/lib-backup-source.mjs` decides the source's fitness before
  `backup-logical.mjs` creates a directory or opens a connection: a
  transaction-pooler source is **refused** with a message naming the fix, a
  pooled host on any other port is refused rather than guessed at, and the
  refusal never echoes the URL, the user name or the password. The rule was
  in three runbooks and enforced nowhere — a rule in prose is not a rule.
  Covered by `scripts/backup/backup-source.test.mjs`.
- The pipeline opens `begin isolation level repeatable read read only`
  (`scripts/backup/lib-dump.mjs`) and exports the snapshot from that same
  read-only transaction. **The role must be able to read every table in the
  `public` schema** — the dump is schema-complete by design.
- Prefer a dedicated **read-only** database role over the `postgres`
  superuser role. Nothing in the pipeline writes to the source, and the
  read-only transaction enforces that at the database level.
- The connection string is a credential. It goes straight into the
  repository secret store and nowhere else.

### A5. Add the six repository secrets

GitHub → **Settings → Secrets and variables → Actions → New repository secret**,
one at a time. Type each value into the form; do not paste it into chat,
a ticket, a commit, or a CI log.

| # | Secret name | Value | Needed by |
|---|---|---|---|
| 1 | `AUTODINE_BACKUP_SOURCE_URL` | §A4 connection string | backup only |
| 2 | `AUTODINE_BACKUP_PASSPHRASE` | §A3 passphrase | backup **and** drill |
| 3 | `B2_REGION` | §A1 region, e.g. `us-west-004` | backup **and** drill |
| 4 | `B2_BUCKET` | §A1 bucket name | backup **and** drill |
| 5 | `B2_ACCESS_KEY_ID` | §A2 key ID | backup **and** drill |
| 6 | `B2_SECRET_ACCESS_KEY` | §A2 key secret | backup **and** drill |

Optional: `B2_ENDPOINT` (an explicit S3 endpoint) and `BACKUP_ALERT_WEBHOOK`
(an https endpoint for backup-failure alerts). The production workflow uses
repository secrets; configure or change these only with separate explicit
approval because its daily schedule can run automatically.

> **`B2_ENDPOINT` is not a free-form override.** Only the standard HTTPS
> `s3.<region>.backblazeb2.com` endpoint is accepted, with no userinfo,
> custom port, path, query or fragment; an explicitly supplied region must
> match the endpoint. Proxies and custom domains are rejected even if
> `B2_REGION` is also supplied. The simplest setup is `B2_REGION` alone.

**Optional: `BACKUP_ALERT_WEBHOOK`.** An `https://` endpoint that receives a
`POST` with `{"text": "AutoDine backup FAILED (...)"}` when a backup run
fails, so a failure reaches a human. It is **optional** — without it a
failed backup still exits non-zero and is still visible in the Actions UI;
the webhook only adds an out-of-band ping. It must be an `https` URL: the
shape-check in `scripts/verify-external-services-config.mjs` rejects
anything else. Put it in the same repository-secret store as the six above,
never in a workflow file.

> **The drill needs only five of them.** The drill never connects to
> Production, so it does not need `AUTODINE_BACKUP_SOURCE_URL` — and must
> never be given it.

### A6. Verify offline, before any hosted run

```
npm run hosted:preflight        # names only, never values
node scripts/verify-external-services-config.mjs
```

The first reports which names are present; the second checks the *shape* of
each value (region format, bucket-name format, key length) without
transmitting anything. **Both are read-only.** A green result means the
inputs are in place — it does not mean any backup has been verified.

---

## B. Owner authorization — the hosted runs

Each step below needs a separate, explicit go-ahead naming the workflow and
its scope. Nothing in this repository dispatches anything.

### B1. First hosted backup — manual

1. Actions → **Hosted backup (B2)** → **Run workflow** → branch `main` → **Run workflow**.
2. The job fails closed at the secret gate if any of the six names is missing, naming only the missing names.
3. Success looks like: `uploaded:true, verified:true` in the upload step's output — the signed HEAD returned the same SHA-256 that the manifest records.
4. The manifest is archived as the run artifact `backup-manifest-<run_id>` (counts and financial spot-checks only; the encrypted artifact is never uploaded to the artifact store).
5. Record: run URL, `uploaded:true, verified:true`, and the manifest's `createdAt`.

> **Accept only if** the manifest carries `counts` **and** `financialSpotChecks`.
> A manifest without them predates the verification contract and must be
> re-taken, not waved through.

### B2. Remote retention

The same run prunes automatically (`--b2 --prune-b2`). The policy is the
newest **14 daily** backups, then one per week for **8** weeks, then one
per month for **6** months. The pruner is fail-closed: it downloads and
re-hashes every expiring candidate, verifies it against both the manifest
and the upload-time object metadata, and deletes **nothing** if any check
fails.

### B3. Disposable hosted restore rehearsal

> **The drill's target is the runner's own disposable `postgres:17`
> container on loopback — never Production, never Staging.** This is
> enforced in code, not by convention: `scripts/backup/lib-restore-target.mjs`
> is applied by both `restore-logical.mjs` and `verify-restored-db.mjs`.
> It refuses any non-loopback target without an explicit scratch opt-in
> **and** a matching approved project ref, and it refuses a Production
> project outright — no flag unlocks it.

1. Actions → **Hosted restore rehearsal (disposable)** → **Run workflow** → **Run workflow**.
2. It downloads the newest artifact (SHA-256 verified against its manifest), prepares a **synthetic** Auth/Storage scaffold on the empty loopback container, restores the public schema, verifies schema counts, row counts and financial sums, and then **always** destroys the downloaded material — the cleanup step runs even when the job fails. The scaffold does not restore or verify hosted Auth or Storage data, and this is not a full Supabase recovery rehearsal. The preparation fix on this branch must be merged before dispatching the named workflow from the default branch.
3. Nothing here can reach Production: the workflow uses no production connection string at all.

> **Prerequisite — CLEARED 2026-11-19:** the drill must be **registered by
> name**, and it now is. The defect was real: the job-level `env:` block
> used the `runner` context, which GitHub Actions does not expose there, so
> the workflow never registered and appeared only as a file path. PR #190
> fixed it and merged on 2026-11-19 (merge commit `ff00d38`); the live
> preflight now reports the drill **by name**
> (`Hosted restore rehearsal (disposable)`).
>
> Confirm before dispatching — it must appear as a *name*, not as
> `.github/workflows/hosted-restore-drill.yml`:
>
> ```
> npm run hosted:preflight
> gh workflow list --repo aryanp685/autodine
> ```

### B3a. If you restore into a real scratch project instead (manual, optional)

The hosted drill uses a loopback container, so the guard's hosted-target rules
never come into play there. A **manual** restore into a scratch Supabase
project does engage them, and the project-ref requirements are exact:

| Variable | Requirement |
|---|---|
| `AUTODINE_RESTORE_TARGET_URL` | A connection string for the **scratch** project. Either pooler works: `pg_restore` imports no exported snapshot, so session affinity is not required here (unlike the *source* — see §A4). |
| `AUTODINE_RESTORE_EXPECTED_REF` | The scratch project's 20-character ref — **the scratch project the owner has actually designated**, e.g. `<your-scratch-project-ref>`. The guard reads the target's **own** ref back out of the URL and refuses unless it equals this one. **Do not reuse a candidate project here:** the acceptance environment's historical candidate ref is not a designated target (register O-B1 is still open), and pointing a restore at it would be an owner decision, not a default. |
| Scratch opt-in | The guard requires an explicit scratch opt-in **as well as** the ref. The opt-in alone is not enough, and the ref alone is not enough. |

**Production is refused outright and no flag unlocks it** — not the scratch
opt-in, not the expected ref, not both together. A hosted target whose ref
cannot be determined also fails closed. Refusals name the host and the
project ref; they never echo the URL, the user name or the password.

### Monitoring, retries and escalation

- The existing production workflow is scheduled for **03:17 UTC daily**;
  GitHub may delay or skip scheduled runs. Staging rehearsal is manual-only.
  Inspect GitHub Actions → **Hosted backup (B2)** for the last successful
  backup run and its manifest, and **Hosted restore rehearsal (disposable)**
  or **Staging B2 backup and disposable restore** for the last successful
  restore report. Until a successful run exists, status is **unverified**.
- B2 downloads retry interrupted reads and transient 408/429/500/502/503/504
  responses up to three attempts (1s, then 2s delay); other errors fail closed.
  The custom-format dump briefly uses a mode-0600 plaintext file in a private
  temporary directory, removed on ordinary success/failure; an uncatchable
  process termination may leave it behind. The hosted job has an unconditional
  runner-directory cleanup step; inspect and securely remove leftovers on a
  self-hosted runner after a hard kill. Never upload the plaintext file.
  Upload PUTs are not automatically retried, avoiding silent extra object
  versions. A failed upload can leave an orphaned object; inspect the bucket
  and report before any explicitly authorized cleanup or retry.
- `BACKUP_ALERT_WEBHOOK` is optional for the scheduled production workflow;
  without a configured sink, only a failed Actions run is visible. It is not
  proof of delivery, and it cannot independently detect a missing scheduled
  run. Owner should check the latest success against the 24-hour target and
  monitor B2's total and hidden-version usage; on missed backup, failed drill,
  unexpected storage growth or access change, escalate to the repository
  owner, preserve run links and investigate before any deletion or deployment.
- The backup is a public-schema database export, not Auth, Storage files,
  configuration or a traffic cutover. Backup and restore report sums and
  counts, not full hosted row fingerprints. Restore command duration alone is
  not an end-to-end service RTO.

### B4. Measuring the RTO — honestly

**RTO is currently UNMEASURED.** The first successful drill produces the
first honest number. Measure it as **wall-clock from dispatch to green**,
not as the restore duration alone:

| Quantity | Where it comes from | What it is NOT |
|---|---|---|
| Dispatch → green (the rehearsal RTO) | the run's start and end timestamps in the Actions UI | not the service RTO — it excludes detection, decision, traffic cutover, Auth/Storage/Realtime, DNS and Vercel |
| Restore duration | `RESTORE_SECONDS`, measured inside the job around the restore step | not the RTO; it excludes download, verification and cleanup |
| RPO target | daily schedule targets 24 h between successful backups | not a guarantee: missed/failed/delayed jobs can exceed 24 h; monitor the latest verified backup independently. PITR (Package 3) is separate. |
| Drill RPO | newest artifact's `createdAt` vs the run start | this is the honest bound the drill actually proves |

Record all four. Set the launch RTO target **from the measured rehearsal
RTO plus the operational overhead**, never from the restore duration alone.

---

## C. Owner acceptance — recording the verdict

The backup gate closes only when all of the following are recorded in
`qa-evidence/`:

- [ ] B2 bucket created, private, region and name recorded.
- [ ] Bucket-scoped key created with exactly the permissions in §A2, restricted to that one bucket.
- [ ] Passphrase stored somewhere retrievable.
- [ ] Six repository secrets added (names only in any record).
- [ ] Offline checks green (`hosted:preflight`, `verify-external-services-config.mjs`).
- [ ] A hosted backup run showing `uploaded:true, verified:true`, with the manifest archived.
- [ ] The manifest carries `counts` and `financialSpotChecks`.
- [ ] The restore drill dispatched **by name** and green, with zero unexplained deltas, and cleanup confirmed.
- [ ] The rehearsal RTO recorded, with the four quantities in §B4.
- [ ] The download artifact destroyed (confirmed by the cleanup step's output).

**Until every line is checked, the backup gate is closed and the launch
decision is NO-GO.** A green local suite is not a hosted backup.

---

## D. One consolidated owner-action checklist

Everything the owner does, in one ordered list. Nothing here has been done;
every line is still open. Tick a line only when its evidence exists.

### D1. Credentials and bucket — owner action, no authorization needed beyond the owner's own judgement

| # | Action | Exact value / shape | Evidence to keep |
|---|---|---|---|
| 1 | Create a **private** B2 bucket | name matches `^[a-zA-Z0-9][a-zA-Z0-9.-]{5,49}$` (6–50 chars); region matches `^[a-z]{2}-[a-z]+-\d{3}$` (e.g. `us-west-004`, **three digits**) | bucket name + region |
| 2 | **Do not** add B2 lifecycle rules | the 14-daily / 8-weekly / 6-monthly policy is enforced by `prune-b2.mjs`; age-based rules would delete artifacts the policy still needs | — |
| 3 | Create a **bucket-scoped** application key | one bucket only; **list, read, write, delete**; **no** bucket-create, bucket-delete or share | key id (never the secret) |
| 4 | Create the backup passphrase | ≥ 12 characters; owner-held; retrievable later; **same** passphrase for the drill | where it is stored |
| 5 | Prepare the Production source connection | `postgresql://postgres.bdbaqpevwmgdvghszjno:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres` — **session pooler, port 5432**, or a direct connection. **Never port 6543.** | the ref, never the URL |
| 6 | Add **six** repository secrets | `AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`, `B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` | names only |
| 7 | *(optional)* add the alert webhook | `BACKUP_ALERT_WEBHOOK` (or `DR_ALERT_WEBHOOK`) = an `https://` URL | name only |

### D2. Offline checks — read-only, safe to run any time

| # | Action | Command | Pass looks like |
|---|---|---|---|
| 8 | Presence of the six names | `npm run hosted:preflight` | every name SET/UNKNOWN — **never a value** |
| 9 | Shape of each value | `node scripts/verify-external-services-config.mjs` | no violations |

> `UNKNOWN` means "GitHub refused the read", not "absent". Neither result
> says anything about validity or delivery.

### D3. Hosted runs — each needs a **separate** authorization naming the workflow

| # | Action | Authorization | Accept only if |
|---|---|---|---|
| 10 | ~~Merge PR #190~~ — **DONE 2026-11-19** | merged as `ff00d38` | ✅ the drill registers **by name** in `gh workflow list` |
| 11 | Dispatch **Hosted backup (B2)** | explicit go-ahead for that workflow | output shows `uploaded:true, verified:true`; manifest archived; manifest carries `counts` **and** `financialSpotChecks` |
| 12 | Dispatch **Hosted restore rehearsal (disposable)** | explicit go-ahead for that workflow | green, zero unexplained deltas, cleanup confirmed, download artifact destroyed |
| 13 | Record the rehearsal RTO | — | all four quantities from §B4 recorded |

> The daily schedule (`17 3 * * *`) starts running the backup by itself once
> the secrets exist. It fails closed at the secret gate until they do. No
> dispatch, no merge and no credential is created by this document.

### D4. What stays out of the owner's hands, and out of this repository's

- The **restore target** of the hosted drill is a disposable `postgres:17`
  container on the runner's loopback. It is never Production and never
  Staging, and no credential can point it anywhere else.
- The **Production source** is read-only by construction: the pipeline opens
  `begin isolation level repeatable read read only`, and it never writes.
- Applying a demo seed, a migration or a restore to a hosted project is an
  owner action with its own authorization — never a side effect of this
  checklist.
