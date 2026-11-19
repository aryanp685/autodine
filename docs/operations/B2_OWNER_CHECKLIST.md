# AUTODINE — B2 BACKUP & RESTORE: OWNER CHECKLIST

Everything the owner must do, in order, with the exact values, the exact
permissions, and the exact authorization each step needs — and nothing that
this repository may do on the owner's behalf.

**Status (2026-11-18): NOT RUN.** No B2 bucket, no application key, no
repository secret, no hosted backup run and no hosted restore rehearsal
exists. The implementation is complete and locally verified; only the
credentials and the authorized runs are missing.

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

## A. Owner action — credentials and bucket

### A1. Create the private bucket

| Property | Required value | Why |
|---|---|---|
| Provider | **Backblaze B2** | The owner's provider decision (2026-11-16). Not R2 — see the integration plan. |
| Visibility | **Private** (not public) | The backup contains the full logical dump of the Production database. |
| Region | e.g. `us-west-004` | Must match `^[a-z]{2}-[a-z]+-\d{3}$` — **lowercase, and a three-digit suffix**. `us-west-4` and `ap-south-1` are both rejected; the correct spelling is `us-west-004`. The endpoint is derived as `https://s3.<region>.backblazeb2.com`. Record the exact region string — it becomes `B2_REGION`. |
| Name | e.g. `autodine-backups` | Must match `^[a-zA-Z0-9][a-zA-Z0-9.-]{5,49}$` (6–50 characters). |
| Lifecycle rules | **none required** | B2's age-based lifecycle rules cannot express the recovery-point policy; `prune-b2.mjs` enforces it instead. Adding age-based rules on top can delete artifacts the policy still needs. |
| Versioning | recommended on | Cheap insurance against a bad overwrite; the pipeline writes unique timestamped keys, so it changes nothing in practice. |
| Object prefix | `autodine-backups/` | Hard-coded in the pipeline (`BACKUP_PREFIX`). Objects outside it are never written, listed or deleted. |

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
- Shape used by the runbook and by `docs/pitr-verification-procedure-2026-11-14.md`:
  `postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres`
  The pooler is used deliberately: the CI runner has no IPv6, so a direct
  `db.<ref>.supabase.co` connection is unreliable there.
- The pipeline opens `begin isolation level repeatable read read only`
  (`scripts/backup/lib-dump.mjs`) and, in Mode A, exports a snapshot for
  `pg_dump --snapshot`. **The role must be able to read every table in the
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
(an https endpoint for backup-failure alerts).

> **`B2_ENDPOINT` is not a free-form override.** The S3 *signing* region must
> be derivable: `lib-b2.mjs` reads it back out of the hostname, and it only
> recognises the standard B2 form `s3.<region>.backblazeb2.com`. An endpoint
> on any other hostname (a proxy, a CDN, a custom domain) is rejected with
> `B2_REGION (cannot be derived from B2_ENDPOINT)` — in that case set
> **both** `B2_REGION` and `B2_ENDPOINT`. The simplest correct setup is
> `B2_REGION` alone.

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
2. It downloads the newest artifact (SHA-256 verified against its manifest), restores into the disposable container, verifies the schema fingerprint, row counts and financial sums, and then **always** destroys the downloaded material — the cleanup step runs even when the job fails.
3. Nothing here can reach Production: the workflow uses no production connection string at all.

> **Prerequisite:** the drill must be **registered by name**. Today it is
> registered only as a file path, because the job-level `env:` block used
> the `runner` context, which GitHub Actions does not expose there. Until
> PR #190 is merged, the drill cannot be dispatched by name at all. Confirm
> with `gh workflow list` — the drill must appear as a *name*, not as
> `.github/workflows/hosted-restore-drill.yml`.

### B4. Measuring the RTO — honestly

**RTO is currently UNMEASURED.** The first successful drill produces the
first honest number. Measure it as **wall-clock from dispatch to green**,
not as the restore duration alone:

| Quantity | Where it comes from | What it is NOT |
|---|---|---|
| Dispatch → green (the rehearsal RTO) | the run's start and end timestamps in the Actions UI | not the service RTO — it excludes detection, decision, traffic cutover, Auth/Storage/Realtime, DNS and Vercel |
| Restore duration | `RESTORE_SECONDS`, measured inside the job around the restore step | not the RTO; it excludes download, verification and cleanup |
| RPO | the daily schedule ⇒ **≤ 24 h of data at risk** | not zero; PITR (Package 3) is what tightens it |
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
