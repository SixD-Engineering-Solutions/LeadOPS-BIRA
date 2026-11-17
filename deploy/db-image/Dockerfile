# LeadOps database image: stock Postgres 17 plus a snapshot of the data, restored
# automatically the FIRST time the container starts with an empty data volume.
# It never touches a volume that already holds a database. Build with build.sh.
FROM postgres:17-alpine
COPY leadops.dump /seed/leadops.dump
COPY restore-seed.sh /docker-entrypoint-initdb.d/10-restore-seed.sh
RUN chmod 0555 /docker-entrypoint-initdb.d/10-restore-seed.sh && chmod 0444 /seed/leadops.dump
