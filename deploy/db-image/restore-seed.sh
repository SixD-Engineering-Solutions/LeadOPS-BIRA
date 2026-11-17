#!/bin/sh
# Runs once, by the postgres image's entrypoint, on a brand-new data directory.
# --no-owner/--no-privileges: every object ends up owned by $POSTGRES_USER.
set -e
echo "[seed] restoring /seed/leadops.dump into $POSTGRES_DB"
pg_restore --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /seed/leadops.dump
echo "[seed] done"
