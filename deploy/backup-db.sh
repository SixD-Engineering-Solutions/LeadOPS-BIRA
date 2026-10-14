#!/usr/bin/env bash
# Nightly backup of the self-hosted LeadOps database (leadops-db). With Aiven
# gone, nothing backs the data up unless this runs. Run it ON THE SERVER, e.g.
# from cron at 02:30 every night:
#
#   30 2 * * * /opt/leadops/backup-db.sh >> /opt/leadops/backups/backup.log 2>&1
#
# Keeps the last KEEP_DAYS days of dumps in BACKUP_DIR. Copy that folder off the
# server too (another disk, cloud storage) — a backup on the same disk doesn't
# survive the disk.
#
# Restore one into an EMPTY leadops-db:
#   docker exec -i leadops-db pg_restore --no-owner -U leadops -d leadops < leadops-<time>.dump
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-leadops-db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/leadops/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
umask 077
PGUSER="$(docker exec "$DB_CONTAINER" printenv POSTGRES_USER)"
PGDB="$(docker exec "$DB_CONTAINER" printenv POSTGRES_DB)"
OUT="$BACKUP_DIR/leadops-$(date +%Y%m%d-%H%M%S).dump"

# Write to a temp name first, so a failed run never leaves a truncated file
# that looks like a good backup.
docker exec "$DB_CONTAINER" pg_dump --format=custom -U "$PGUSER" -d "$PGDB" > "$OUT.partial"
mv "$OUT.partial" "$OUT"
echo "$(date '+%F %T') backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

find "$BACKUP_DIR" -name 'leadops-*.dump' -mtime +"$KEEP_DAYS" -delete
