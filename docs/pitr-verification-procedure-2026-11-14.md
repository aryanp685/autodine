# PITR & backup verification procedure for owner review — 2026-11-14

**Purpose:** the exact, ordered procedure an owner can run (or have run, with
their credentials) to turn AutoDine's current "no verified hosted backup" state
into an evidence-backed RPO/RTO position. Nothing below has been executed
against hosted infrastructure in this batch; it is written so it can be
executed verbatim by whoever the owner designates.

**What exists today (local, verified):** `scripts/backup/backup-logical.mjs`,
`restore-logical.mjs`, `lib-crypto.mjs` (AES-256-GCM + scrypt), and
`scripts/backup/selftest.mjs` — 14/14 checks PASS on embedded PostgreSQL 17,
including: dump contains DDL/policies/RLS/functions/triggers/SECURITY DEFINER/
search_path, row fingerprint identical after destroy-and-restore, tampered file
rejected, wrong passphrase rejected. A full chain replay (90 migrations) →
logical backup → restore → fingerprint PASS also ran today
(`test:db:logical-restore`, 47 tables / 58 policies / 160 functions). Cold
physical recovery (`test:recovery:cold`) PASS. None of this is a **hosted** or
**production** verification.

**Standing honesty note:** the Supabase connector cannot show the project's
plan or PITR entitlement (checked 2026-11-14 earlier in this programme). Third-party
pricing observed 2026-11 may drift — re-verify; do not rely on figures below for
budgeting.

---

## Part 1 — Confirm the platform baseline (owner, ~15 minutes, read-only)

In the Supabase dashboard for `bdbaqpevwmgdvghszjno`:

1. **Project → Database → Backups.**
   - Plan tier (Free / Pro) and whether *scheduled backups* are listed with
     timestamps. Free tier: no usable scheduled backups recorded 2026-11.
   - Whether **PITR** is enabled. If not, note the retention window offered
     (typ. 7/14/28 days) and its price. PITR covers the **database only** —
     never Storage objects or Auth users.
2. **Project → Settings → General → Region** (record it; restore must target
   the same region for a clean cutover) and **project reference**
   (`bdbaqpevwmgdvghszjno` — confirm this is what the app uses; see
   `lib/supabase/env.ts`).
3. **Project → Database → Database health** (CPU/IO/connections) — a backup
   taking longer than the maintenance window matters.
4. Estimate **database size** (Settings → Database → size). The logical
   pipeline below was exercised against ~0.4 MB schema and untested at
   production volume; record the number for the runbook's capacity note.
5. Record who holds: dashboard owner access, database password, the logical
   pipeline passphrase (if adopted), and the incident phone tree. Store the
   answers in the team's password manager — never in this repository.

**Checkpoint P1:** plan tier, PITR on/off, region, size, access owners —
written down, dated, signed.

## Part 2 — Decide the protection posture (owner decision required)

| Option | RPO | RTO (typical) | Cost signal (verify) | Notes |
|---|---|---|---|---|
| PITR add-on (Pro base or as offered) | minutes | minutes–1 h | ~US$100+/mo per project | Simplest, database-only; point-in-time restore into a *new* project or in place |
| Scheduled provider backups (Pro) | ≤ 24 h | 1–4 h (restore + promote + DNS) | included in Pro (~US$25/mo) | 7-day retention typical |
| AutoDine logical pipeline on owner-managed schedule | = backup interval | 1–4 h | B2/R2 ≈ US$0.01–0.08/mo at this scale | DB only; needs cron host + passphrase custody; not yet scheduled anywhere |
| Do nothing | ∞ | undefined | $0 | Not acceptable for money-bearing tables |

**Recommendation:** confirm or enable provider PITR (or Pro daily backups)
**and** run the logical pipeline as an independent, encrypted second copy on a
14/8/6 retention schedule. Two independent mechanisms = survives operator error
and provider failure classes that the other cannot.

**Checkpoint P2:** written decision with named backup owner and alert route.

## Part 3 — Logical backup drill against production (owner-approved, read-only)

Preconditions: P2 decided; a maintenance window agreed (it is read-only but
takes one consistent snapshot); a **scratch** Supabase project created in the
same org (Free tier is fine; ~2 minutes); scratch is empty.

```bash
# 1) Encrypted backup of production (read-only, one transaction)
AUTODINE_BACKUP_SOURCE_URL='postgresql://postgres.bdbaqpevwmgdvghszjno:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres' \
AUTODINE_BACKUP_PASSPHRASE='<from password manager>' \
node scripts/backup/backup-logical.mjs --out-dir /mnt/backups/autodine-drill --keep-daily 3 --keep-weekly 1 --keep-monthly 0

# 2) Record the manifest (row counts, byte size, sha256) — NEVER commit it.
ls -la /mnt/backups/autodine-drill/ && sha256sum /mnt/backups/autodine-drill/*.enc

# 3) Restore into the SCRATCH project (never into production)
AUTODINE_RESTORE_TARGET_URL='postgresql://postgres.<scratchref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres' \
AUTODINE_BACKUP_PASSPHRASE='<same>' \
node scripts/backup/restore-logical.mjs --file /mnt/backups/autodine-drill/autodine-*.sql.gz.enc --confirm-empty-db

# 4) Verify — counts, money invariants, application smoke
psql "$AUTODINE_RESTORE_TARGET_URL" <<'SQL'
select 'orders' t, count(*) from orders union all select 'payments', count(*) from payments
union all select 'restaurant_invoices', count(*) from restaurant_invoices
union all select 'order_sessions', count(*) from order_sessions;
select coalesce(sum(amount_paise),0) as payment_paise from payments;
SQL
# then point a local checkout of the release SHA at the scratch project and
# smoke: open menu, place synthetic order, settle, issue receipt, verify
# /api/health against the scratch project.
```

5. Destroy the scratch project when done (or keep it encrypted-in-place until
   sign-off; it contains a copy of production data).
6. Record: date, operator, backup file sha256, manifest counts vs production
   counts, money-invariant comparison, health output, scratch destroyed
   (or retained where). Attach to the ops record — not to git.

**Checkpoint P3:** restore verified on disposable infrastructure; report filed.

## Part 4 — PITR verification (only if PITR is enabled)

Provider PITR restores are **not** to be tested in place. Use a copy:

1. In the dashboard, note the earliest restorable point it displays (must match
   the retention bought).
2. Trigger a **restore to a new project** at a timestamp a few minutes in the
   past (this creates a second project; production is untouched).
3. Verify on the copy: row counts vs. the Part 3 manifest; open the app against
   the copy; confirm `public_restaurant_profile()` answers; confirm the RLS
   flags (`select relrowsecurity from pg_class where relname='restaurants'`).
4. Delete the copy project. Record duration end-to-end (this is your measured
   RTO) and the delta between trigger and the point restored (your measured
   RPO).
5. If the provider offers multi-region or read replicas, note separately —
   they are availability features, not backup.

**Checkpoint P4:** measured RPO/RTO on the copy, provider timestamps, copy
destroyed.

## Part 5 — Ongoing protection (after P2 decision)

- Schedule the logical backup (cron example and the NOT-YET-ACTIVATED GitHub
  Actions template are in `docs/backup-restore-runbook.md` §Scheduling). Any
  destination (B2/R2/offline disk) requires account creation + owner approval;
  none exists today.
- Wire `BACKUP_ALERT_WEBHOOK` to an endpoint that actually pages a human;
  until then failures are visible only in the cron log. A backup that silently
  fails for 14 days is not protection.
- Rehearse restore **quarterly** and after every schema-migration incident;
  drill date goes in the same record as Part 3.
- Rotation: passphrase yearly, or on any operator departure; "rotate" means
  take a fresh backup under the new passphrase.

## Part 6 — What still needs the owner (cannot be done from this repo)

- Plan confirmation & PITR purchase decision (Part 1–2).
- Creation of the scratch project (Part 3) and any copy project (Part 4).
- Credentials, destination bucket, cron host, passphrase custody (Part 3/5).
- Written waiver if the owner chooses not to verify backups before launch —
  this document recommends against that waiver for a money-bearing system.

**Exit criteria for "backup gate met":** Parts 1–4 checkpoints all signed, and
Part 5 scheduled with an alert that has been observed to fire at least once
(test alarm). Only then should the release-baseline document's preflight §6
item 8 be considered satisfied.
