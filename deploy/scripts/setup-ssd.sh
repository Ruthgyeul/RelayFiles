#!/usr/bin/env bash
# One-time setup of the external SSD (docs/deploy-ubuntu.md §2): LUKS2 full-disk
# encryption with a key file, ext4, automatic unlock and mount at boot, and the
# storage account that owns the files. ERASES THE DEVICE.
#   sudo deploy/scripts/setup-ssd.sh /dev/sdX            # asks before formatting
#   sudo deploy/scripts/setup-ssd.sh /dev/sdX --dry-run  # only prints the commands
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DEVICE="${1:-}"
DRY_RUN=false
[ "${2:-}" = "--dry-run" ] && DRY_RUN=true
[ -b "$DEVICE" ] || { echo "Usage: $0 /dev/sdX [--dry-run]  (a whole disk; see lsblk)" >&2; exit 1; }

MOUNT="$(env_value STORAGE_ROOT /mnt/relayfilesDB)"
UID_="$(env_value STORAGE_UID 10001)"
GID_="$(env_value STORAGE_GID 10001)"
case "$MOUNT" in /*) ;; *) echo "STORAGE_ROOT must be an absolute path in production (now: $MOUNT)." >&2; exit 1 ;; esac
NAME="relayfilesDB"
KEY=/etc/relayfiles/ssd.key

run() {
  echo "+ $*"
  if [ "$DRY_RUN" = false ]; then "$@"; fi
}

lsblk -o NAME,SIZE,MODEL,SERIAL,MOUNTPOINTS "$DEVICE" || true
if [ "$DRY_RUN" = false ]; then
  [ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
  read -r -p "Type the device name ($DEVICE) to ERASE it and continue: " answer
  [ "$answer" = "$DEVICE" ] || { echo "Aborted."; exit 1; }
fi

log "Storage account $UID_:$GID_"
getent group relayfiles > /dev/null || run groupadd --system --gid "$GID_" relayfiles
getent passwd relayfiles > /dev/null || run useradd --system --uid "$UID_" --gid relayfiles --no-create-home --shell /usr/sbin/nologin relayfiles

log "LUKS2 key file $KEY (keep a copy offline: without it the files cannot be read)"
run install -d -m 0700 /etc/relayfiles
[ -f "$KEY" ] || run sh -c "umask 077 && dd if=/dev/urandom of=$KEY bs=512 count=8 status=none"
run chmod 0400 "$KEY"

log "Encrypt $DEVICE (LUKS2, AES-XTS) and add a passphrase as a second key"
run cryptsetup luksFormat --type luks2 --batch-mode --key-file "$KEY" "$DEVICE"
run cryptsetup luksAddKey --key-file "$KEY" "$DEVICE"
run cryptsetup open --key-file "$KEY" "$DEVICE" "$NAME"

log "ext4 filesystem (no reserved blocks; the app keeps STORAGE_RESERVE_PERCENT free)"
run mkfs.ext4 -L "$NAME" -m 0 "/dev/mapper/$NAME"

LUKS_UUID="$( [ "$DRY_RUN" = true ] && echo '<luks-uuid>' || blkid -s UUID -o value "$DEVICE")"
log "Unlock and mount at boot ($MOUNT)"
run sh -c "grep -q '^$NAME ' /etc/crypttab || echo '$NAME UUID=$LUKS_UUID $KEY luks,discard,nofail' >> /etc/crypttab"
run sh -c "grep -q ' $MOUNT ' /etc/fstab || echo '/dev/mapper/$NAME $MOUNT ext4 defaults,noatime,nodev,nosuid,noexec,nofail,x-systemd.device-timeout=10s 0 2' >> /etc/fstab"
run install -d -m 0755 "$MOUNT"
run systemctl daemon-reload
run mount "$MOUNT"

log "Volume layout (owned by the storage account, private to it)"
run install -d -o "$UID_" -g "$GID_" -m 0700 "$MOUNT/users" "$MOUNT/system"
run chown "$UID_:$GID_" "$MOUNT"
run chmod 0700 "$MOUNT"

log "Done. Next: docker compose ... run --rm tools npm run volume:init (docs/deploy-ubuntu.md §5)"
