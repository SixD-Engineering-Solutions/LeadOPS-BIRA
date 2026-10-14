#!/usr/bin/env bash
# One-time copy of the LeadOps database from Aiven into the stack's own
# Postgres container (leadops-db). Run it ON THE DEPLOYMENT SERVER, after the
# stack (with leadops-db) is up. See PORTAINER_DEPLOYMENT.md, "Move the data
# off Aiven".
#
#   AIVEN_DATABASE_URL='postgres://avnadmin:...@....aivencloud.com:16864/defaultdb?sslmode=require' \
#     ./migrate-aiven-to-local.sh
#
# What it does, in order:
#   1. stops the API container, so nothing writes while the data is copied;
#   2. refuses to continue if leadops-db already holds tables (never overwrites);
#   3. dumps Aiven with pg_dump (read-only on Aiven) into ./leadops-aiven-<time>.dump;
#   4. restores that dump into leadops-db;
#   5. compares the row count of every table, Aiven vs local;
#   6. starts the API again — now on the local database.
# Aiven itself is never modified, so it stays a working fallback.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-leadops-db}"
: "${AIVEN_DATABASE_URL:?set AIVEN_DATABASE_URL to the existing Aiven connection string}"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "no container named $DB_CONTAINER — deploy the updated stack first."
PG_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$DB_CONTAINER")"
PGUSER="$(docker exec "$DB_CONTAINER" printenv POSTGRES_USER)"
PGDB="$(docker exec "$DB_CONTAINER" printenv POSTGRES_DB)"
local_psql() { docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDB" -At "$@"; }
# A throwaway client container from the same Postgres image, for talking to Aiven.
aiven_psql() { docker run --rm -i "$PG_IMAGE" psql -X -v ON_ERROR_STOP=1 "$AIVEN_DATABASE_URL" -At "$@"; }

say "Checking versions"
AIVEN_VER="$(aiven_psql -c 'show server_version_num')" || die "can't connect to Aiven — check AIVEN_DATABASE_URL and Aiven's IP allowlist for this server."
LOCAL_VER="$(local_psql -c 'show server_version_num')"
echo "Aiven: $AIVEN_VER   local ($PG_IMAGE): $LOCAL_VER"
[ $((AIVEN_VER / 10000)) -le $((LOCAL_VER / 10000)) ] \
  || die "Aiven runs a newer major Postgres than $PG_IMAGE. Set POSTGRES_IMAGE to postgres:$((AIVEN_VER / 10000))-alpine in the stack BEFORE the first start of leadops-db (delete the empty leadops-pgdata volume if it was already created), then run this again."

say "Checking the local database is empty"
TABLES="$(local_psql -c "select count(*) from information_schema.tables where table_schema = 'public'")"
[ "$TABLES" = "0" ] || die "$DB_CONTAINER already has $TABLES tables in it. This script only fills an empty database and never overwrites one."

API_CONTAINER="$(docker ps --filter label=com.docker.compose.service=leadops-api --format '{{.Names}}' | head -n1)"
if [ -n "$API_CONTAINER" ]; then
  say "Stopping the API ($API_CONTAINER) so nothing writes during the copy"
  docker stop "$API_CONTAINER" >/dev/null
fi
# Also stop the OLD API (the one still on Aiven) yourself before this point,
# or anything saved there after the dump is lost.

DUMP="leadops-aiven-$(date +%Y%m%d-%H%M%S).dump"
say "Dumping Aiven into ./$DUMP"
umask 077 # the dump holds all the data — readable by this user only
docker run --rm "$PG_IMAGE" pg_dump --format=custom --no-owner --no-privileges "$AIVEN_DATABASE_URL" > "$DUMP"
ls -lh "$DUMP"

say "Restoring into $DB_CONTAINER"
# --no-owner/--no-privileges: Aiven's roles (avnadmin) don't exist here; every
# object is owned by $PGUSER instead.
RESTORE_LOG="$DUMP.restore.log"
if ! docker exec -i "$DB_CONTAINER" pg_restore --no-owner --no-privileges -U "$PGUSER" -d "$PGDB" < "$DUMP" 2> "$RESTORE_LOG"; then
  echo "pg_restore reported problems (full log: $RESTORE_LOG):"
  grep -i error "$RESTORE_LOG" | head -20 || true
  echo "Errors about the 'public' schema or Aiven-only extensions are expected and harmless; the row counts below are what matter."
fi

say "Comparing row counts (Aiven vs local)"
COUNT_SQL="select string_agg(format('select %L, count(*) from public.%I', table_name, table_name), ' union all ' order by table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
QUERY="$(aiven_psql -c "$COUNT_SQL")"
[ -n "$QUERY" ] || die "Aiven has no tables in the public schema?"
diff <(aiven_psql -F ' ' -c "$QUERY" | sort) <(local_psql -F ' ' -c "$QUERY" | sort) > /dev/null \
  && MATCH=1 || MATCH=0
printf '%-32s %10s %10s\n' TABLE AIVEN LOCAL
join <(aiven_psql -F ' ' -c "$QUERY" | sort) <(local_psql -F ' ' -c "$QUERY" | sort) | while read -r t a l; do
  printf '%-32s %10s %10s %s\n' "$t" "$a" "$l" "$([ "$a" = "$l" ] || echo '<-- MISMATCH')"
done
[ "$MATCH" = 1 ] || die "row counts differ — the API has been left STOPPED. Fix the restore (see $RESTORE_LOG) before starting it. Aiven is untouched."

if [ -n "$API_CONTAINER" ]; then
  say "Starting the API again, now on the local database"
  docker start "$API_CONTAINER" >/dev/null
  sleep 15
  docker logs --since 30s "$API_CONTAINER" 2>&1 | tail -n 15
fi

say "Done. Every table matches."
echo "Keep ./$DUMP somewhere safe (outside this server too) — it's a full copy of the data as it was on Aiven."
