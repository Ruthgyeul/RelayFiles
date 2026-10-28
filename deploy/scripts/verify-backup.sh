#!/usr/bin/env bash
# Weekly backup check (docs/runbook.md "백업 검증"): restores the newest database dump into a
# throwaway PostgreSQL container (same image as production, no data directory of its own,
# removed afterwards), then `npm run backup:verify` in the tools container compares it with
# production, runs a report-only storage:fsck and stores the result for the Server page. With
# an offsite repository (offsite-backup.sh), OFFSITE_CHECK_PERCENT of it is verified as well.
# One JSON line per run is appended to DATA_DIR/backup-verify.log. Exits 1 when the backup
# is not usable, so cron can mail the output.
#   deploy/scripts/verify-backup.sh
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

DATA_DIR="$(env_value DATA_DIR /srv/relayfiles)"
DIR="$DATA_DIR/backups"
LOG="$DATA_DIR/backup-verify.log"
NAME="relayfiles-verify-$$"
# Only lives as long as the scratch container, on the compose network.
PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
READY_TRIES=60

cleanup() { docker rm -f -v "$NAME" > /dev/null 2>&1 || true; }
trap cleanup EXIT

# verify ARGS... → npm run backup:verify in the tools container, reading the scratch URL on stdin.
# The offsite repository (offsite-backup.sh) is checked first; a failure is one more problem.
OFFSITE_FAILURE="$(offsite_check)"
OFFSITE_ARGS=()
[ -z "$OFFSITE_FAILURE" ] || OFFSITE_ARGS=(--offsite-failure "$OFFSITE_FAILURE")

verify() { "${COMPOSE[@]}" --profile tools run --rm -T tools npm run -s backup:verify -- "${OFFSITE_ARGS[@]}" "$@" | tee -a "$LOG"; }

DUMP="$(newest_first "$DIR"/relayfiles-*.dump | head -n 1)"
if [ -z "$DUMP" ]; then
  log "No dump in $DIR"
  verify --failure "no database dump in $DIR (deploy/scripts/backup.sh)" < /dev/null
  exit 1
fi
DUMP_AT="$(date -u -d "@$(stat -c %Y -- "$DUMP")" +%Y-%m-%dT%H:%M:%SZ)"
DUMP_ARGS=(--dump-name "$(basename "$DUMP")" --dump-at "$DUMP_AT")

POSTGRES_ID="$("${COMPOSE[@]}" ps -q postgres)"
[ -n "$POSTGRES_ID" ] || { echo "The postgres service is not running." >&2; exit 1; }
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$POSTGRES_ID")"
NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$POSTGRES_ID")"

log "Restoring $(basename "$DUMP") into a scratch database"
docker run -d --rm --name "$NAME" --network "$NETWORK" \
  -e POSTGRES_USER=verify -e POSTGRES_DB=verify -e POSTGRES_PASSWORD="$PASSWORD" "$IMAGE" > /dev/null
# TCP only answers once initialisation is over (the setup server listens on the socket only).
for _ in $(seq "$READY_TRIES"); do
  docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U verify -d verify && break
  sleep 1
done

STARTED="$(date +%s%3N)"
if ! docker exec -i "$NAME" pg_restore -h 127.0.0.1 -U verify -d verify --no-owner --no-privileges --exit-on-error < "$DUMP"; then
  verify "${DUMP_ARGS[@]}" --failure "pg_restore failed for $(basename "$DUMP")" < /dev/null
  exit 1
fi
RESTORE_MS="$(($(date +%s%3N) - STARTED))"

log "Comparing with production and checking storage"
printf 'postgresql://verify:%s@%s:5432/verify' "$PASSWORD" "$NAME" | verify "${DUMP_ARGS[@]}" --restore-ms "$RESTORE_MS" --restored-url -
