#!/usr/bin/env bash
# Removes what releases leave behind on the Docker deployment, and nothing else:
#   - relayfiles-app / relayfiles-tools tags outside the newest IMAGE_KEEP releases (default 3,
#     the rollback window). "latest" and tags any container still uses are always kept.
#   - third-party images this compose file used to pin (e.g. nginx 1.29 after the bump to
#     1.30, read from git history), so images of other projects on the host are left alone
#   - stopped containers of this compose project (one-off `run` without --rm, crashed runs)
#   - dangling images (untagged, used by no container)
#   - build cache unused for BUILD_CACHE_MAX_AGE (default 24h), in every running buildx
#     builder (`docker builder prune` only reaches the default one)
# Volumes, networks, DATA_DIR (database, backups) and the SSD are never touched.
# release.sh runs it after a healthy release (AUTOCLEAN=0 skips it). Run alone:
#   deploy/scripts/autoclean.sh [--dry-run]
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

KEEP="${IMAGE_KEEP:-3}"
CACHE_AGE="${BUILD_CACHE_MAX_AGE:-24h}"
RELEASES="$(env_value DATA_DIR /srv/relayfiles)/releases.log"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

mapfile -t RELEASE_REPOS < <(compose_images | sed -n "s/:$RELEASE_PROBE\$//p")
mapfile -t PINNED < <(compose_images | grep -v ":$RELEASE_PROBE\$")
PROJECT="$("${COMPOSE[@]}" config | awk '/^name:/ { print $2; exit }')"

run() {
  if [ "$DRY_RUN" = 1 ]; then echo "would run: $*"; else "$@"; fi
}

# remove_tag IMAGE → untags IMAGE; Docker refuses (and we move on) while a container uses it.
remove_tag() {
  if [ "$DRY_RUN" = 1 ]; then echo "would remove $1"; return; fi
  if docker image rm "$1" > /dev/null 2>&1; then echo "removed $1"; else echo "kept $1 (still in use)"; fi
}

# cache_total BUILDER → the builder's cache size ("Total" of `docker buildx du`); fails while
# the builder is not running (an inactive docker-container builder is not started for this).
cache_total() {
  docker buildx du --builder "$1" 2> /dev/null | awk '/^Total:/ { print $2 }'
}

contains() {
  local needle="$1"
  shift
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

# First, so the images they held are free for the steps below.
log "Stopped containers of $PROJECT"
run docker container prune -f --filter "label=com.docker.compose.project=$PROJECT"

# Tags to keep: the newest KEEP distinct releases, "latest", and every image a container uses.
# Without a release log there is no rollback history to go by, so release tags stay.
mapfile -t IN_USE < <(docker ps -a --format '{{.Image}}' | sort -u)
if [ -f "$RELEASES" ]; then
  KEEP_TAGS=(latest)
  mapfile -t -O 1 KEEP_TAGS < <(awk '{ print $2 }' "$RELEASES" | tac | awk '!seen[$0]++' | head -n "$KEEP")
  log "Release images (keeping ${KEEP_TAGS[*]})"
  for repo in "${RELEASE_REPOS[@]}"; do
    while read -r tag; do
      [ "$tag" = "<none>" ] && continue
      contains "$tag" "${KEEP_TAGS[@]}" && continue
      contains "$repo:$tag" "${IN_USE[@]}" && continue
      remove_tag "$repo:$tag"
    done < <(docker image ls "$repo" --format '{{.Tag}}')
  done
else
  log "No $RELEASES yet; release images are left as they are"
fi

log "Images the compose file no longer pins"
mapfile -t PAST < <(git -C "$ROOT" log --format= -p -- deploy/docker-compose.yml |
  sed -nE 's/^[-+ ][[:space:]]*image:[[:space:]]*([^$[:space:]]+)[[:space:]]*$/\1/p' | sort -u)
for image in "${PAST[@]}"; do
  contains "$image" "${PINNED[@]}" "${IN_USE[@]}" && continue
  docker image inspect "$image" > /dev/null 2>&1 && remove_tag "$image"
done

log "Dangling images"
run docker image prune -f

log "Build cache unused for $CACHE_AGE"
docker buildx ls
# One JSON object per builder; its own "Name" comes before the "Nodes" array.
mapfile -t BUILDERS < <(docker buildx ls --format json | sed -nE 's/^\{[^[]*"Name":"([^"]+)".*/\1/p')
for builder in "${BUILDERS[@]}"; do
  if ! before="$(cache_total "$builder")"; then
    echo "$builder: not running, skipped"
    continue
  fi
  if [ "$DRY_RUN" = 1 ]; then
    echo "$builder: build cache $before; would run: docker buildx prune -f --builder $builder --filter until=$CACHE_AGE"
    continue
  fi
  docker buildx prune -f --builder "$builder" --filter "until=$CACHE_AGE" > /dev/null
  echo "$builder: build cache $before -> $(cache_total "$builder")"
done

log "Docker disk usage"
docker system df
