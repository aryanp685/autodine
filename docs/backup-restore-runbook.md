# AutoDine backup & restore runbook (independent logical backup)

**Status: pipeline implemented and locally verified; no hosted destination configured (needs owner approval); plan/PITR visibility BLOCKED.**

AutoDine currently has **no independent, verified backup of production data**. The Supabase connector cannot show the project plan or any PITR/backup entitlement (checked 2026-11-14). Third-party sources (check date 2026-11) indicate Free projects get effectively no usable scheduled backups and no PITR; Pro ($25/month) includes daily backups with 7-day retention; PITR is a paid add-on (~$100–$400/month per project depending on retention window) and covers **database only** — Supabase Storage objects are never included in any database backup. Verify your plan in the Supabase dashboard: **Project → Database → Backups**.

Until the owner (a) confirms the plan and (b) approves a destination, this runbook's pipeline is the primary protection. It costs nothing to run against any reachable Postgres connection string.

## What the pipeline covers

- All tables, data, constraints (PK inline; UNIQUE/CHECK deferred, FKs last), indexes, sequences (`setval` restored), views, functions (full `pg_get_functiondef` DDL — SECURITY DEFINER and `search_path` preserved; emitted in dependency order; EXECUTE ACLs recreated from `proacl`), triggers, RLS policies (role lists preserved) and RLS enable/force flags — for the `public` schema.
- User-defined enum and domain types, which the table DDL references (emitted before any table). Composite types are reported as a WARNING, not silently dropped; domain CHECK constraints are likewise reported, not recreated — see failure modes.
- Consistency: one `REPEATABLE READ READ ONLY` transaction for the entire dump — a single point-in-time snapshot.
- Data round-trips through `::text` casts, which is lossless for built-in types (arrays, jsonb, ranges, inet…).
- Encryption: **AES-256-GCM**, key = scrypt(passphrase, random salt, N=2^14). Layout: `ADBK01\n` magic, 16B salt, 12B IV, 16B tag, ciphertext of gzipped SQL. Losing the passphrase loses the backup.
- Integrity: SHA-256 recorded in a sidecar `<name>.manifest.json` (rows/bytes/object counts, duration, schema). Restore prints file hash and a verification report.
- Retention: `--keep-daily 14 --keep-weekly 8 --keep-monthly 6` by default; prunes **only** files it wrote (`autodine-*.*`), never anything else.

## What it does NOT cover (honest gaps)

- `auth.*` (GoTrue users, identities, refresh tokens) — managed by Supabase; export requires the Management API / database `auth` schema access. Not backed up here. Covered only by the platform's own backup/PITR if your plan has it.
- Supabase Storage buckets (logos, brand assets) — separate system; needs its own sync/mirror. Not backed up here.
- Platform configuration (Auth settings, SMTP, Realtime config, extensions) — documented in the infrastructure runbooks, not in the dump.
- Object-level `GRANT`/`REVOKE` on tables/schemas and default privileges — the dump restores function EXECUTE ACLs from `proacl` exactly, but table/schema-level ACLs are recreated only as PostgreSQL defaults. The migrations own those (e.g. revokes from `public`/`anon`); replaying the migration chain onto an empty database reproduces them. Use `--pg-dump` mode on any host that has `pg_dump` for full-fidelity ACLs and extension management.
- Point-in-time recovery (RPO < the backup interval) — only PITR gives that; this pipeline is snapshot-only (RPO = backup interval).

## Commands

```bash
# self-verification drill (embedded PostgreSQL, synthetic data, ~10 s)
node scripts/backup/selftest.mjs

# backup (Mode A when pg_dump exists, else built-in Mode B)
AUTODINE_BACKUP_SOURCE_URL='postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:6543/postgres' \
AUTODINE_BACKUP_PASSPHRASE='<from your password manager>' \
node scripts/backup/backup-logical.mjs --out-dir /mnt/backups/autodine \
  --keep-daily 14 --keep-weekly 8 --keep-monthly 6

# restore into an EMPTY database
AUTODINE_RESTORE_TARGET_URL='postgresql://...scratch...' \
AUTODINE_BACKUP_PASSPHRASE='<same>' \
node scripts/backup/restore-logical.mjs --file /mnt/backups/autodine/autodine-*.sql.gz.enc --confirm-empty-db
```

Never put either URL on a command line (shell history) — always the environment variables, as shown. Neither command prints the URL.

## Machine-checkable evidence (2026-11-15)

`npm run pitr:check` validates a filled PITR/restore evidence file (see
`docs/pitr-verification-procedure-2026-11-14.md` addendum (removed in the 2026-11-21 cleanup): template emission, per-field schema
validation, PITR-chosen consistency rules (p4 measured RPO/RTO, copy destroyed), and SHA-256
re-verification of an accessible `p3.backup_file`. It never touches a database or the network.

## Verified evidence (2026-11-14)

- `selftest.mjs` — 14/14 checks PASS on embedded PostgreSQL 17: dump contains DDL/policies/RLS/functions; destroy-and-restore reproduces the row fingerprint (sha256) exactly; trigger, SECURITY DEFINER, `search_path`, RLS flag and policy all preserved; tampered ciphertext and wrong passphrase both rejected.
- CLI end-to-end — 400-row fixture: backup → manifest (rows=400, sha256 recorded) → drop → restore → exact row count and `sum(qty)` verified (240600). Restore report prints object counts + exact rows.
- `test:db:logical-restore` — full 88-migration chain replayed onto embedded PostgreSQL 17, Mode B backup → restore into a shim-only target, then public-schema fingerprint compared: 47 tables / 58 policies / 160 functions identical. (This found and fixed four real dump defects in one pass: missing enum/domain types, function dependency order, `name[]` role lists from `pg_policies`, and function EXECUTE ACLs.) It does NOT exercise the `pg_dump --format=custom` path — that drill exists only in the CI `native-database` job and has never been executed; see CI notes.
- NOT YET PERFORMED: a restore rehearsal against a hosted scratch database (acceptance criterion Part 2). Procedure below; needs owner approval to create the scratch project.

## Isolated hosted restore rehearsal (prepare, then execute with approval)

**Prerequisites (all must hold before step 1):** owner approval naming the
scratch project and the production read; backup passphrase in a password
manager (never in chat/git); destination bucket chosen (register A2/C-1);
off-peak window; scratch project in the same org, same region
(`ap-south-1`), PostgreSQL 17; **no** production writes planned during the
drill.

1. Create a **scratch** Supabase project in the same org (Free tier is fine; ~2 minutes; existing org — this is a cost-neutral creation, but still requires the owner’s go-ahead because it handles real backup data).
2. Run the backup against production (read-only, one transaction; off-peak; reads only).
3. Restore into the scratch project with `--confirm-empty-db`.
4. Verify: row counts per table vs. production manifest; app-level smoke (open menus, counts); spot-check money invariants (e.g., `select sum(amount_paise) from payments` vs. manifest totals).
5. **Destroy the scratch project** (or keep encrypted in place until acceptance signed). Record: date, who ran it, counts, pass/fail.
6. Evidence file: store the manifest + verification report in the ops repo; never commit the dump.

**Acceptance criteria (drill passes only if every line holds):**

- Restore exits 0 with the verification report printed; manifest SHA-256
  re-verifies against the artifact.
- Per-table row counts equal the backup manifest exactly (0 mismatches);
  money spot-checks (`payments`, `subscription_payments` sums) match.
- Schema fingerprint (tables/policies/functions) matches the manifest
  counts; SECURITY DEFINER + `search_path` spot-checked on financial RPCs.
- App-level smoke against the scratch project only: health `ok:true`,
  menu read, checkout-guard error paths behave (no writes to production).
- Measured wall-clock recorded as the rehearsal RTO; backup timestamp vs
  drill start recorded as the rehearsal RPO; both filed with the evidence.
- Scratch project destroyed (or encrypted-at-rest retention explicitly
  approved) and its ref recorded as retired in the evidence file.
- Any failure → drill is FAILED (not partial): artifact and logs retained,
  defect filed, production backup gate stays UNMET until a pass.

## Scheduling

Host cron (operator workstation / a small VM) — use the orchestrator, which
runs backup → automated recovery check (decrypt + manifest verify of the
newest artifact) → DR objective check, and exits non-zero with one alert line
(`BACKUP_ALERT_WEBHOOK`, else `DR_ALERT_WEBHOOK`) on any failure:

```cron
17 3 * * *  cd /opt/autodine && AUTODINE_BACKUP_SOURCE_URL=... AUTODINE_BACKUP_PASSPHRASE=... node scripts/backup/run-scheduled.mjs --out-dir /mnt/backups/autodine --rpo-minutes 1440 >> /var/log/autodine-backup.log 2>&1
```

**First hosted run (executes immediately once the B2 variables exist):**
add `--b2` to the same command. The run then ends with the upload stage:
artifact SHA-256 re-checked against its manifest, signed PUT of artifact +
manifest to the bucket, signed HEAD verification of the remote SHA-256.
Success prints `B2 upload remotely verified`; missing configuration fails
the run at the `upload` stage with the missing variable NAMES (verified
2026-11-16 against a disposable cluster — fail-closed, no silent local-only
pass). Follow it with the hosted restore rehearsal above; only a passed
rehearsal closes the backup gate.

## Hosted execution via GitHub Actions (implemented 2026-11-16; not yet run)

Two workflows make the hosted path independent of any one machine:

- **`.github/workflows/hosted-backup.yml`** — manual dispatch + daily
  03:17 UTC schedule; `contents: read` only; concurrency-guarded; fails
  closed naming any missing secret; runs `run-scheduled.mjs --b2 --prune-b2` and
  archives the (non-sensitive) manifest as run evidence.
- **`.github/workflows/hosted-restore-drill.yml`** — manual dispatch only;
  downloads the newest B2 artifact (`download-b2.mjs`, SHA-256 vs manifest
  verified), restores into a disposable `postgres:17` service container,
  verifies with `verify-restored-db.mjs`, records restore
  seconds as rehearsal RTO, archives the two JSON reports, and destroys
  the downloaded material in an unconditional cleanup step. The target is
  loopback-only by construction, and the verifier refuses non-loopback
  hosts before connecting.

**Restore-verification contract (fail closed, both backup formats):**
every manifest — built-in dump and `pg_dump` alike — carries `counts`
(tables/policies/functions/rows) and `financialSpotChecks`
(`payments`/`subscription_payments` `amount_paise` sums, null when a
table/column is absent), measured in the backup snapshot (for `pg_dump`,
the same exported snapshot the dump itself reads). The drill derives the
manifest from the artifact's filename (never selects the pair
independently), and `verify-restored-db.mjs --manifest … --artifact …`
rejects — before connecting — any manifest that is malformed, of an
unknown format, missing contract fields, or not cryptographically paired
with the artifact (name + SHA-256). All six comparisons must match for
exit 0; expectations are always measured at backup time, never invented
at verification time. Pre-contract backups cannot be drill-verified and
must be re-taken.

**Trigger the first runs:** configure the repository secrets below, then
Actions → *Hosted backup (B2)* → Run workflow; on success Actions →
*Hosted restore rehearsal (disposable)* → Run workflow. Hosted success is
claimed only when the backup run prints `uploaded:true, verified:true`
and the drill job is green — neither has happened yet.

Required repository secrets (Settings → Secrets and variables → Actions):
`AUTODINE_BACKUP_SOURCE_URL`, `AUTODINE_BACKUP_PASSPHRASE`,
`B2_REGION`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`,
`B2_SECRET_ACCESS_KEY` (backup workflow set); the drill needs the last
five. `BACKUP_ALERT_WEBHOOK` is optional (failure alerting).

(systemd: a `.timer` invoking the same command with a root-only
`EnvironmentFile=` for the two variables; Windows: Task Scheduler with a
stored environment. The wrapper never prints the URL or the passphrase, and
its failure alert is one capped, redacted line.)

A hand-rolled cron line calling `backup-logical.mjs` alone is legal but skips
verification; if you keep one, add a second line or a monitoring rule on the
backup directory. `--skip-verify` / `--skip-dr-objectives` exist for
rehearsals and are printed as skipped, never silently.

Automated recovery check on demand (GitHub): the manual **DR drill** workflow
(`.github/workflows/dr-drill.yml`, `workflow_dispatch`) replays the backup
pipeline self-test, the backup-file/DR-objective verifiers and the full
logical-restore drill against a disposable embedded PostgreSQL. It touches no
hosted project and needs no secret. CI also runs all of these on every push.

GitHub Actions (NOT ACTIVATED — needs the two secrets and approval):

```yaml
name: backup
on: { schedule: [{ cron: "17 3 * * *" }], workflow_dispatch: {} }
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci --omit=dev
      - run: node scripts/backup/backup-logical.mjs --out-dir "$RUNNER_TEMP/backups" --keep-daily 14 --keep-weekly 8 --keep-monthly 6
        env:
          AUTODINE_BACKUP_SOURCE_URL: ${{ secrets.BACKUP_SOURCE_URL }}
          AUTODINE_BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
      - uses: actions/upload-artifact@v4   # or rclone to the chosen bucket
        with: { name: autodine-backup, path: ${{ runner.temp }}/backups, retention-days: 35 }
```

## Backblaze B2 destination (APPROVED PROVIDER, confirmed 2026-11-16; implementation complete, credentials pending)

Backblaze B2 (S3-compatible API) is the approved destination; an earlier
same-day switch to Cloudflare R2 was superseded by the owner's provider
decision. The upload path is implemented in
`scripts/backup/upload-b2.mjs` (+ `lib-b2.mjs`): SigV4-signed S3 PUT of the
encrypted artifact and its manifest under `autodine-backups/`, with SHA-256
verified three ways (local file vs backup manifest before upload;
`x-amz-meta-sha256` on the PUT; signed HEAD comparison after). Configuration
is environment-only — `B2_REGION` (e.g. `us-west-004`, endpoint derived as
`https://s3.<region>.backblazeb2.com`, or explicit `B2_ENDPOINT`),
`B2_BUCKET`, `B2_ACCESS_KEY_ID` (keyID), `B2_SECRET_ACCESS_KEY`
(application key) — and no code path
prints a value; missing configuration reports variable NAMES only
(`upload-r2.mjs` exit 2, and the offline shape-check in
`scripts/verify-external-services-config.mjs`).

```bash
# after any backup run (e.g. in the scheduling wrapper, post run-scheduled):
node scripts/backup/upload-b2.mjs --file /mnt/backups/autodine/autodine-*.sql.gz.enc
node scripts/backup/upload-b2.mjs --file <artifact> --dry-run   # local integrity + config check, no network
```

**Status (2026-11-16): NOT UPLOADED — no B2 credentials exist** in the repo,
the operator environment, or any connected tool (checked by variable name /
presence only). The exact remaining human action: create one private B2
bucket and a bucket-scoped B2 application key (read/write), then place
the four variables above in the backup host's secret store (or as the
GitHub Actions secrets listed below). Cost at AutoDine's scale
(< 5 GB stored): ≈ $0.01–0.04/month at $6.95/TB/month; the first 10 GB
are free. **Local drill evidence
(2026-11-16, disposable embedded PostgreSQL, never hosted):** full-chain
logical restore verified (93 migrations; 48 tables / 59 policies / 162
functions; schema fingerprint identical); backup selftest ALL CHECKS PASS
(destroy→restore row fingerprint exact; tamper + wrong-passphrase rejected);
a real artifact + manifest produced from a disposable cluster passed
`upload-b2 --dry-run` SHA-256/manifest verification and correctly reported
the four missing config names (B2_ENDPOINT|B2_REGION forms included); disposable cluster and artifacts destroyed
afterwards. Hosted upload + hosted restore drill remain UNVERIFIED until
credentials exist.

## Remote retention in B2 (implemented 2026-11-16; native lifecycle rules are NOT sufficient)

Backblaze lifecycle rules are age-based only (`daysFromUploadingToHiding`,
`daysFromHidingToDeleting`, `fileNamePrefix`): they can expire everything
past a fixed age, but they cannot express the recovery-point policy —
newest 14 daily backups, one per week for 8 weeks, one per month for
6 months. Retention is therefore enforced by `scripts/backup/prune-b2.mjs`
(authenticated S3 LIST/GET/DELETE), run after each verified upload via
`run-scheduled.mjs --b2 --prune-b2` (already wired into the hosted-backup
workflow):

```bash
node scripts/backup/prune-b2.mjs            # dry-run: prints keep/expire plan, deletes nothing
node scripts/backup/prune-b2.mjs --confirm  # execute (what the scheduler runs)
```

Guarantees: only `autodine-backups/` objects matching the backup pattern
are candidates (anything else is reported ignored, never touched); the
**newest valid backup is always kept**; every artifact must carry a
structurally valid manifest (naming this artifact, well-formed SHA-256,
positive byte count, format, sane `createdAt` no later than the object's
server-side upload time) or the run aborts deleting nothing;
incomplete/repeating pagination aborts; more than 50 expirations aborts
(--max-delete to override deliberately); a failed DELETE stops the run.

**Pre-deletion integrity gate:** before the first DELETE, every expiring
artifact is downloaded in full and its SHA-256 recomputed. The hash must
equal both the manifest's `sha256` and the upload-time `x-amz-meta-sha256`
object metadata (HEAD metadata alone is never trusted — it only
cross-checks the recomputed content hash; metadata absence is
unverifiable and aborts). The downloaded byte count must match the listed
object size, and the bytes must carry the AutoDine backup magic. **All**
candidates are verified before **any** deletion begins; one missing,
corrupt, mismatched or unverifiable pair aborts the run with zero
deletions. The pruner never sees the backup passphrase.

**Pre-delete recheck (per pair):** immediately before each pair's
DELETEs, a HEAD must still show the verified SHA-256 metadata and byte
size; any drift aborts the run (pairs already deleted are counted in the
error). Deletion itself is artifact-first: an artifact-DELETE failure
leaves the pair intact for a clean re-run, and a manifest-DELETE failure
is retried once before the run aborts naming the orphaned manifest.

Optional defense-in-depth (owner, at bucket setup): add a B2 lifecycle
rule on prefix `autodine-backups/` — hide after 400 days, delete 30 days
after hiding — as a coarse backstop far beyond the 6-month policy horizon.
It must never be the only retention mechanism.

### Remote retention — known limitations (P2 observations, accepted)

These are documented deliberately; none is silently "fixed" by changing
retention semantics, and none blocks the integrity gate above.

1. **No cross-process lock.** `prune-b2.mjs` takes no distributed lock.
   Overlap is bounded by (a) the hosted-backup workflow's concurrency
   group (`cancel-in-progress: false`), (b) newest-backup protection, and
   (c) the rule that an object uploaded after listing is not in the
   inventory and cannot be selected. A manual `--confirm` prune racing a
   manual upload outside the workflow remains theoretically possible;
   run pruning only via the scheduled workflow or a single operator
   shell. Revisit if pruning ever moves off the workflow.
2. **Orphan manifests after a partial pair deletion.** Each pair deletes
   artifact-then-manifest; if the artifact DELETE succeeds and the
   manifest DELETE fails, the run stops and reports progress, leaving an
   orphaned `*.manifest.json`. Orphans match no artifact, are reported as
   ignored by later runs, and can never become deletion candidates or be
   mistaken for a backup. Cleanup is a manual, operator-visible action;
   re-running the pruner is safe and idempotent.
3. **Week buckets are day-of-month segments, not ISO weeks.** The pruner
   mirrors the local pipeline exactly (`floor(dayOfMonth / 7)` buckets):
   deterministic, and consistent between local and remote retention so a
   recovery point survives in both or neither. Switching to ISO weeks
   would change *which* recovery points are kept, so it is a deliberate
   policy change to make in both pruners together — never a silent fix.

Residual trust notes: a manifest `createdAt` inside its consistency
bounds (parseable, not future, not after upload time) is still trusted
for tier selection — manifests are not cryptographically signed; the
hash/metadata gate proves the artifact is exactly what the manifest
describes, and newest-backup protection bounds the blast radius.
Likewise, an object replaced between its pre-delete HEAD recheck and its
DELETE (same-key overwrite by a credentialed writer inside that single
round-trip) cannot be detected by the S3 API available here — S3 offers
no conditional delete the pruner can rely on; the workflow's serialized
schedule makes this a credentialed-insider-only scenario. Separately,
"newest" means manifest `createdAt` to the pruner but server
`LastModified` to `download-b2.mjs`; after a delayed manual upload of an
old backup the two can differ, in which case a prune may expire the
drill's most recent pick — the drill then fails loudly (404) or takes
the next artifact, never silently restoring the wrong bytes (its
SHA-256 verification is independent of which artifact it picked).

## Storage destination — options and approximate cost (2026 prices; re-verify)

AutoDine’s database is small (44 tables; expect < 500 MB). Any of these is effectively free; **all require account creation and owner approval — none is enabled**:

| Option | Price | Egress | Notes |
|---|---|---|---|
| Backblaze B2 | ~$6.95 / TB / month | Free to 3× stored volume | Cheapest; S3-compatible; recommended default for this scale |
| Cloudflare R2 | $0.015 / GB / month | Free | Zero egress; also S3-compatible |
| AWS S3 Standard | ~$0.023 / GB / month | ~$0.09 / GB after 100 GB | Most expensive at scale; free tier tiny |
| Wasabi | $7.99 / TB / month, 1 TB minimum | Free (fair use) | Minimum spend ~$8/month — avoid |
| Google Drive (already connected) | Free (15 GB) | — | Not S3-compatible; usable via rclone; approval required, and content would sit in a personal drive — prefer B2/R2 |
| Supabase Pro upgrade ($25/mo) | included daily backups, 7-day retention | — | Separate decision; PITR add-on extra (~$100+/mo) — not needed if this pipeline is scheduled and drills pass |

For < 5 GB/month stored: **B2 or R2 ≈ $0.01–0.08/month**. No paid plan is to be activated without explicit owner approval.

## Key management

- Passphrase: 20+ random chars from a password manager; never in git, env files committed anywhere, or chat. Rotate yearly; re-encrypt means "take a fresh backup".
- The manifest is not secret (counts and timestamps only). The `.sql.gz.enc` file is.
- Restore drills: quarterly; after any schema-migration incident; before declaring a new environment "production-ready".

## Alerting

On failure the script POSTs `{ "text": ... }` to `BACKUP_ALERT_WEBHOOK` (Slack-compatible; any JSON webhook works) and exits 1. On success it stays silent by design (alert on absence via your cron/monitor, or add `--alert-on-success` if wanted). Delivery is UNVERIFIED until an endpoint exists; until then failures appear only in the log. Once email (Resend) is live, point the webhook at a relay or wire the runbook's owner-email alert (Part 7).

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| ` Decryption failed: wrong passphrase or corrupted file` | Passphrase mismatch / truncated upload | Use password manager; re-download; re-run with `--pg-dump` if the file came from another tool |
| Replay fails with syntax error | Backup from newer Postgres into older target | Restore into PG ≥ source version |
| FK violation on restore | Tables restored out of order | Pipeline order handles this; if using psql directly, replay FKs last |
| Backup hangs | Locked tables / huge data | It takes one consistent snapshot — wait; check `pg_stat_activity` on source |
| Row fingerprint mismatch in drill | Non-deterministic ordering in compare | Compare per-table counts, not raw order (selftest does ordered compare) |
| `type "x" does not exist` on restore | Dump predates enum/domain support | Re-take the backup with the current pipeline |
| Domain CHECK missing after restore | Domain CHECK constraints are reported, not recreated | Recreate the domain CHECK by hand or restore via `pg_dump` mode |
