#!/usr/bin/env bash
# One-time host setup for the compose stack (docs/deploy-ubuntu.md §1): installs Docker with its
# data-root on the storage disk, makes Docker wait for that disk at boot, and creates the host
# directories the compose file mounts (it never creates them itself). Safe to re-run.
#   sudo deploy/scripts/setup-docker.sh            # apply
#   sudo deploy/scripts/setup-docker.sh --dry-run  # only print the commands
# Every path comes from .env: DOCKER_DATA_ROOT, STORAGE_ROOT, DATA_DIR, LOG_DIR.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

DOCKER_ROOT="$(env_value DOCKER_DATA_ROOT /var/lib/docker)"
STORAGE="$(env_value STORAGE_ROOT /mnt/relayfilesDB)"
DATA="$(env_value DATA_DIR /srv/relayfiles)"
LOGS="$(env_value LOG_DIR /var/log/relayfiles)"
UID_="$(env_value STORAGE_UID 10001)"
GID_="$(env_value STORAGE_GID 10001)"
# The operator who runs compose and deploy/scripts/backup.sh (writes DATA_DIR/backups).
OPERATOR="${SUDO_USER:-$(id -un)}"
DAEMON_JSON=/etc/docker/daemon.json
DROP_IN=/etc/systemd/system/docker.service.d/relayfiles-storage.conf

for path in "$DOCKER_ROOT" "$STORAGE" "$DATA" "$LOGS"; do
  case "$path" in /*) ;; *) echo "Paths in .env must be absolute (now: $path)." >&2; exit 1 ;; esac
done

run() {
  echo "+ $*"
  if [ "$DRY_RUN" = false ]; then "$@"; fi
}

# write_file PATH MODE: stdin → PATH (printed in dry-run).
write_file() {
  local content
  content="$(cat)"
  echo "+ write $1 ($2)"
  printf '%s\n' "$content" | sed 's/^/    /'
  if [ "$DRY_RUN" = false ]; then
    install -d -m 0755 "$(dirname "$1")"
    printf '%s\n' "$content" > "$1"
    chmod "$2" "$1"
  fi
}

# The mount that holds PATH; "/" means the path is on the system disk.
mount_of() {
  local dir="$1"
  while [ ! -e "$dir" ]; do dir="$(dirname "$dir")"; done
  findmnt -n -o TARGET -T "$dir"
}

[ "$DRY_RUN" = true ] || [ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

DISK_MOUNT="$(mount_of "$DOCKER_ROOT")"
for path in "$STORAGE" "$DATA" "$LOGS"; do
  if [ "$(mount_of "$path")" != "$DISK_MOUNT" ]; then
    echo "warning: $path is not on the same disk as $DOCKER_ROOT ($DISK_MOUNT)." >&2
  fi
done
if [ "$DISK_MOUNT" = "/" ] && [ "$DOCKER_ROOT" != /var/lib/docker ]; then
  echo "$DOCKER_ROOT is on the system disk: mount the storage disk first." >&2
  exit 1
fi

log "Docker data-root $DOCKER_ROOT (disk $DISK_MOUNT)"
if [ -f "$DAEMON_JSON" ] && ! grep -q "\"data-root\": \"$DOCKER_ROOT\"" "$DAEMON_JSON"; then
  echo "$DAEMON_JSON already exists with other settings; add \"data-root\": \"$DOCKER_ROOT\" by hand." >&2
  exit 1
fi
# Written before the install so Docker never initialises /var/lib/docker on the system disk.
write_file "$DAEMON_JSON" 0644 <<EOF
{
  "data-root": "$DOCKER_ROOT",
  "log-driver": "local"
}
EOF

# Docker starts only after the disk is mounted, and stops when it is unmounted (lock).
if [ "$DISK_MOUNT" != "/" ]; then
  write_file "$DROP_IN" 0644 <<EOF
[Unit]
RequiresMountsFor=$DOCKER_ROOT $STORAGE $DATA $LOGS
EOF
fi

log "Directories"
run install -d -m 0711 "$DOCKER_ROOT"
# install -o only takes names, and STORAGE_UID exists only inside the images: chown by number.
run install -d -m 0700 "$STORAGE"
run chown "$UID_:$GID_" "$STORAGE"
run install -d -m 0750 "$LOGS"
run chown "$UID_:$GID_" "$LOGS"
run install -d -o "$OPERATOR" -m 0700 "$DATA"
# The postgres and redis images take ownership of their directory on first start.
run install -d -m 0700 "$DATA/pg" "$DATA/redis"
run install -d -o "$OPERATOR" -m 0700 "$DATA/backups"

log "Packages"
if ! command -v docker > /dev/null; then
  run apt-get update
  run apt-get install -y docker.io docker-compose-v2 docker-buildx
fi
run systemctl daemon-reload
run systemctl enable docker.service
# Docker already ran with another data-root (images built before this script): copy it over
# once, so nothing has to be pulled or built again. The old directory is left for the operator.
OLD_ROOT="$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || true)"
if [ -n "$OLD_ROOT" ] && [ "$OLD_ROOT" != "$DOCKER_ROOT" ] && [ -z "$(ls -A "$DOCKER_ROOT" 2> /dev/null)" ]; then
  log "Copying $OLD_ROOT to $DOCKER_ROOT"
  run systemctl stop docker.service docker.socket
  run cp -a "$OLD_ROOT/." "$DOCKER_ROOT/"
  echo "After checking the stack, free the system disk: sudo rm -rf $OLD_ROOT"
fi
run systemctl restart docker.service
id -nG "$OPERATOR" | grep -qw docker || run usermod -aG docker "$OPERATOR"

if [ "$DRY_RUN" = false ]; then
  log "Docker Root Dir: $(docker info --format '{{.DockerRootDir}}')"
  echo "Log out and back in (docker group), then follow docs/deploy-ubuntu.md §3."
fi
