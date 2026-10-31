#!/usr/bin/env bash
# Offsite encrypted backup with restic (docs/runbook.md "오프사이트 백업"), for both deployments.
# Sends the database dumps (DATA_DIR/backups, written by backup.sh) and the original files
# (users/ of STORAGE_ROOT, plus OFFSITE_EXTRA_PATHS for extra volumes) to RESTIC_REPOSITORY
# (Cloudflare R2, Backblaze B2, …). restic encrypts with RESTIC_PASSWORD and stores each file
# once across snapshots; old snapshots are thinned to OFFSITE_KEEP_DAILY/WEEKLY/MONTHLY.
# Generated files (thumbnails, previews, trash, upload chunks under system/) are left out: the
# worker makes them again (npm run media:backfill). Run as root after backup.sh, since it reads
# every account's files. Does nothing when RESTIC_REPOSITORY is empty.
#   sudo deploy/scripts/offsite-backup.sh
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

if ! offsite_env; then
  log "RESTIC_REPOSITORY is empty in $ENV_FILE: no offsite backup is set up."
  exit 0
fi
command -v restic > /dev/null || { echo "restic is not installed (sudo apt install restic)." >&2; exit 1; }

DATA_DIR="$(env_value DATA_DIR /srv/relayfiles)"
STORAGE_ROOT="$(env_value STORAGE_ROOT)"
# A relative STORAGE_ROOT (the development default) is relative to the repository.
[[ "$STORAGE_ROOT" == /* ]] || STORAGE_ROOT="$ROOT/$STORAGE_ROOT"
PATHS=("$DATA_DIR/backups" "$STORAGE_ROOT/users")
read -r -a EXTRA <<< "$(env_value OFFSITE_EXTRA_PATHS)"
PATHS+=("${EXTRA[@]}")
for path in "${PATHS[@]}"; do
  [ -d "$path" ] || { echo "Not a directory: $path" >&2; exit 1; }
done

# The local cache lives next to the dumps (root only), so it moves with the data disk.
export RESTIC_CACHE_DIR="$DATA_DIR/restic-cache"
mkdir -p "$RESTIC_CACHE_DIR"
chmod 700 "$RESTIC_CACHE_DIR"

if ! restic cat config > /dev/null 2>&1; then
  log "Creating the offsite repository"
  restic init
fi

# A fixed host name keeps every snapshot in one group even if the server is renamed or replaced.
log "Backing up ${PATHS[*]}"
restic backup --host relayfiles --tag relayfiles --one-file-system "${PATHS[@]}"

log "Thinning old snapshots"
restic forget --host relayfiles --tag relayfiles --prune \
  --keep-daily "$(env_value OFFSITE_KEEP_DAILY 7)" \
  --keep-weekly "$(env_value OFFSITE_KEEP_WEEKLY 4)" \
  --keep-monthly "$(env_value OFFSITE_KEEP_MONTHLY 6)"
log "Offsite backup done."
