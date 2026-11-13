# Production manual backup and isolated restore

Production: `autodine-production` / `bdbaqpevwmgdvghszjno`.
No production changes are performed by these instructions. Run on your trusted
computer in Bash, with Docker installed/running and enough free disk space.
Backups contain private customer/auth data: never upload them to chat or Git.

> **Phase 7 evidence boundary (Arena date 2026-11-06 UTC):** No Production backup, dump, PITR/retention inspection, or hosted restore was performed in this execution. The local synthetic PostgreSQL cold-recovery pass is not provider recovery evidence. Current Production backup/PITR state and numeric RPO/RTO remain unknown. Do not treat this procedure as an executed backup; see [`PHASE-7-RECOVERY-RPO-RTO.md`](PHASE-7-RECOVERY-RPO-RTO.md).

## 1. Find connection details

Supabase project → Connect → **Session pooler** (port 5432), or Direct connection
if your computer has IPv6 connectivity. Do NOT use Transaction pooler (6543).
Copy host, database and username separately. Confirm they belong to the
production project above. Do not paste the password/connection URI into chat.
The username for session pooler is typically `postgres.<project-ref>`; use the
actual dashboard value, not an assumed value.

## 2. Create a logical backup (read-only against production)

Open Bash (`bash` in Terminal), then run:

```bash
umask 077
BACKUP_DIR="$HOME/autodine-private-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
read -r -p 'Production DB host from Connect: ' PROD_HOST
read -r -p 'Production DB username from Connect: ' PROD_USER
read -r -p 'Database name from Connect (usually postgres): ' PROD_DB
printf 'Backup destination: %s\n' "$BACKUP_DIR"

docker run --rm -it \
  -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=30 \
  -v "$BACKUP_DIR:/backup" postgres:18 \
  pg_dump --host="$PROD_HOST" --port=5432 --username="$PROD_USER" \
  --dbname="$PROD_DB" --password --format=custom --lock-wait-timeout=10s \
  --file=/backup/production.dump
```

Enter the DB password at the PostgreSQL prompt. It is not echoed. Never put it
in the command/URI/environment file. This command reads data but takes normal
pg_dump ACCESS SHARE locks; schedule away from concurrent schema changes. It
can add database load. If it fails (permissions/network/version/timeout), STOP.
Do not exclude failing schemas/tables just to get a success status.

Only if the command exits successfully, inspect the archive:

```bash
docker run --rm -v "$BACKUP_DIR:/backup:ro" postgres:18 \
  pg_restore --list /backup/production.dump > "$BACKUP_DIR/archive-list.txt"
test -s "$BACKUP_DIR/production.dump" && test -s "$BACKUP_DIR/archive-list.txt"
# macOS:
shasum -a 256 "$BACKUP_DIR/production.dump" > "$BACKUP_DIR/production.dump.sha256"
# On Linux use sha256sum instead of shasum -a 256.
```

Keep output private. Archive listing/checksum alone does not prove restorability.
If postgres:18 cannot dump the server version, stop and select a compatible
client after review. Do not upgrade the production server.

## 3. Restore into a NEW disposable local container ONLY

This step never accepts a production connection URL. It starts a fresh database
with no published ports; restore runs inside that container. A name collision
fails safely—do not remove any existing container to proceed.

```bash
RESTORE_CONTAINER="autodine-restore-$(date -u +%Y%m%dT%H%M%SZ)"
docker run --detach --name "$RESTORE_CONTAINER" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$BACKUP_DIR:/backup:ro" postgres:18
```

Trust authentication is for this network-disabled disposable container only.
Wait for startup by checking:

```bash
docker exec "$RESTORE_CONTAINER" pg_isready -U postgres
```

When ready:

```bash
docker exec "$RESTORE_CONTAINER" createdb -U postgres restorecheck
docker exec "$RESTORE_CONTAINER" pg_restore -U postgres \
  --dbname=restorecheck --exit-on-error --single-transaction \
  --no-owner --no-privileges /backup/production.dump \
  > "$BACKUP_DIR/restore.log" 2>&1
```

**A successful restore is NOT guaranteed on vanilla PostgreSQL.** Supabase
extensions, managed schemas and roles referenced by policies may require a
compatible isolated Supabase environment. If it fails, leave production alone;
report only the sanitized first error (no data/passwords). Do not ignore errors,
add exclusions, or manually remove policies to declare success. A reviewed
compatible restore target/bootstrap may be needed.

`--no-owner --no-privileges` deliberately skips restoring ownership/ACLs: this
is a structural/data restore test, NOT a complete permissions/recovery test.
The archive retains object ACL/ownership metadata, but cluster-wide roles are
not included by pg_dump. Review role recreation, extensions and grants before
claiming full disaster recovery. This backup does not include Storage file
objects, provider configuration or Edge Function secrets.

After a zero-exit restore, inspect local counts privately:

```bash
docker exec "$RESTORE_CONTAINER" psql -U postgres -d restorecheck \
  -v ON_ERROR_STOP=1 -c "select 'orders' as relation,count(*) from public.orders union all select 'order_items',count(*) from public.order_items;"
```

Compare schema/content/invariants against the dump snapshot using a reviewed
verification process. Counts from a later live production query can differ as
new orders arrive; they are not an exact same-snapshot comparison.

## 4. What to report back

Send only:
- pg_dump success/failure and archive size (not the archive);
- pg_restore success/failure, with sanitized error if it failed;
- whether a compatible restore environment/ACL verification is still needed.

Do not send passwords, connection strings, dump contents, customer records,
archive listings or raw logs. Retain backup securely outside the repository.
No production migration, reset, fixture write, or load test is authorized by
running this runbook. Production rollout approval exists separately, but its
technical recovery/cutover gates must still be satisfied.
