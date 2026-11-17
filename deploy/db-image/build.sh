#!/usr/bin/env bash
# Snapshots the LOCAL database (container leadops-local-db) into a Postgres image.
#   ./build.sh [tag]        default tag: leadops-db:<today>
# The dump holds real data (emails, clients, invoices) - it is git-ignored; keep
# the image/tar private.
set -euo pipefail
cd "$(dirname "$0")"
TAG="${1:-leadops-db:$(date +%Y-%m-%d)}"
SRC="${SRC_CONTAINER:-leadops-local-db}"
docker exec "$SRC" pg_dump --format=custom --no-owner --no-privileges -U leadops -d leadops > leadops.dump
ls -lh leadops.dump
docker build -t "$TAG" .
echo "built $TAG"
