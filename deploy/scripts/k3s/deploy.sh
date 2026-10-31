#!/usr/bin/env bash
# Deploys a release published to GHCR (.github/workflows/images.yml) to k3s
# (docs/deploy-k3s.md): .env becomes the relayfiles-env Secret, the Nginx templates and error
# pages become ConfigMaps, then PostgreSQL and Redis → migrations (a Job with the new tools
# image) → app, worker and Nginx, all on the node labelled relayfiles/storage=true. Run from a
# repository checkout (npm ci done) with kubectl access to the cluster:
#   deploy/scripts/k3s/deploy.sh [sha-<12 hex> | vX.Y.Z]   (default: this checkout's commit)
# When a rollout does not finish within K3S_ROLLOUT_TIMEOUT (default 10m) or /api/health does not
# say "ok" afterwards, the deployments this run changed are rolled back (kubectl rollout undo) and
# the script fails. Rollback by hand: the same command with an earlier tag (schema changes are
# expand → contract, so the previous release runs on the newer schema).
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

command -v kubectl > /dev/null || { echo "kubectl not found (on a k3s server: export KUBECONFIG=/etc/rancher/k3s/k3s.yaml)." >&2; exit 1; }
TAG="${1:-sha-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"
REPO="$(env_value K3S_IMAGE_REPO)"
[ -n "$REPO" ] || { echo "Set K3S_IMAGE_REPO in .env (e.g. ghcr.io/<owner>/relayfiles)." >&2; exit 1; }
NS="$(env_value K3S_NAMESPACE relayfiles)"
TIMEOUT="${K3S_TIMEOUT:-30m}"
ROLLOUT_TIMEOUT="${K3S_ROLLOUT_TIMEOUT:-10m}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
# preStop wait of the app and Nginx pods: long enough for the endpoint to leave the Service first.
export K3S_PRESTOP_SEC="${K3S_PRESTOP_SEC:-5}"

NODES="$(kubectl get nodes -l relayfiles/storage=true -o name | wc -l)"
[ "$NODES" = 1 ] || { echo "Label the node with the storage SSD, and only it: kubectl label node <node> relayfiles/storage=true (labelled now: $NODES)." >&2; exit 1; }

# Values the templates need, with the defaults of src/config/env.ts; images as compose pins them.
export K3S_NAMESPACE="$NS" APP_IMAGE="$REPO-app:$TAG" TOOLS_IMAGE="$REPO-tools:$TAG"
export RELEASE_ID="${TAG//[^a-zA-Z0-9]/-}"
RELEASE_ID="${RELEASE_ID,,}"
POSTGRES_IMAGE="$(compose_image postgres)" REDIS_IMAGE="$(compose_image redis)" NGINX_IMAGE="$(compose_image nginx)"
export POSTGRES_IMAGE REDIS_IMAGE NGINX_IMAGE
NGINX_RESOLVER="$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}')"
export NGINX_RESOLVER
for pair in K3S_APP_REPLICAS:1 APP_PORT:3000 STORAGE_UID:10001 STORAGE_GID:10001 DATA_DIR:/srv/relayfiles LOG_DIR:/var/log/relayfiles \
  APP_MEMORY_MAX:2G APP_CPUS:3 WORKER_MEMORY_MAX:2G WORKER_CPUS:2 NGINX_LISTEN_PORT:80 SERVER_NAME:localhost STORAGE_ACCEL_PREFIX:/_protected/ \
  NGINX_MAX_BODY_MB:100 NGINX_AUTH_RATE_PER_MIN:20 NGINX_AUTH_BURST:20 NGINX_UPLOAD_RATE_PER_MIN:60 NGINX_UPLOAD_BURST:30 \
  NGINX_API_RATE_PER_MIN:120 NGINX_API_BURST:60 APP_STOP_GRACE_SEC:30 WORKER_STOP_GRACE_SEC:90 STORAGE_ROOT:; do
  export "${pair%%:*}=$(env_value "${pair%%:*}" "${pair#*:}")"
done
[[ "$STORAGE_ROOT" == /* ]] || { echo "STORAGE_ROOT must be an absolute path on the storage node." >&2; exit 1; }
# Kubernetes counts the grace period from the start of preStop.
export APP_TERMINATION_GRACE_SEC="$((APP_STOP_GRACE_SEC + K3S_PRESTOP_SEC))"
KEYS=(K3S_NAMESPACE APP_IMAGE TOOLS_IMAGE RELEASE_ID POSTGRES_IMAGE REDIS_IMAGE NGINX_IMAGE NGINX_RESOLVER K3S_APP_REPLICAS APP_PORT STORAGE_UID STORAGE_GID DATA_DIR LOG_DIR
  APP_MEMORY_MAX APP_CPUS WORKER_MEMORY_MAX WORKER_CPUS NGINX_LISTEN_PORT SERVER_NAME STORAGE_ACCEL_PREFIX NGINX_MAX_BODY_MB NGINX_AUTH_RATE_PER_MIN NGINX_AUTH_BURST
  NGINX_UPLOAD_RATE_PER_MIN NGINX_UPLOAD_BURST NGINX_API_RATE_PER_MIN NGINX_API_BURST WORKER_STOP_GRACE_SEC APP_TERMINATION_GRACE_SEC K3S_PRESTOP_SEC STORAGE_ROOT)
render() { node "$ROOT/scripts/render-template.mjs" "$ROOT/deploy/k3s/$1.yaml.template" "${KEYS[@]}"; }
apply() { kubectl apply -f - > /dev/null; }

log "Release $TAG to namespace $NS"
kubectl create namespace "$NS" --dry-run=client -o yaml | apply
kubectl -n "$NS" create secret generic relayfiles-env --from-env-file="$ENV_FILE" --dry-run=client -o yaml | apply
for map in relayfiles-nginx-templates:deploy/nginx/templates relayfiles-error-pages:deploy/error-pages relayfiles-nginx-volumes:deploy/nginx/volumes; do
  kubectl -n "$NS" create configmap "${map%%:*}" --from-file="$ROOT/${map#*:}" --dry-run=client -o yaml | apply
done

log "PostgreSQL and Redis"
render data | apply
for name in statefulset/relayfiles-postgres statefulset/relayfiles-redis; do kubectl -n "$NS" rollout status "$name" --timeout="$TIMEOUT"; done

log "Migrations (schema, data, storage layout) with $TOOLS_IMAGE"
JOB="job/relayfiles-migrate-$RELEASE_ID"
kubectl -n "$NS" delete "$JOB" --ignore-not-found > /dev/null
render migrate-job | apply
if ! kubectl -n "$NS" wait --for=condition=complete "$JOB" --timeout="$TIMEOUT"; then
  kubectl -n "$NS" logs "$JOB" >&2 || true
  echo "Migrations failed; the running release is unchanged." >&2
  exit 1
fi

# revision DEPLOYMENT → its current rollout revision (empty when it does not exist yet).
revision() { kubectl -n "$NS" get deployment "$1" -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' 2> /dev/null || true; }
DEPLOYMENTS=(relayfiles-app relayfiles-worker relayfiles-nginx)
declare -A BEFORE
for name in "${DEPLOYMENTS[@]}"; do BEFORE[$name]="$(revision "$name")"; done

# roll_back REASON → undoes every deployment this run moved to a new revision, waits for it, and fails.
# The Secret and ConfigMaps keep this run's values; the database keeps the migrated schema.
roll_back() {
  echo "$1" >&2
  local name before undone=0
  for name in "${DEPLOYMENTS[@]}"; do
    before="${BEFORE[$name]}"
    if [ -n "$before" ] && [ "$(revision "$name")" != "$before" ]; then
      log "Rolling $name back to revision $before"
      kubectl -n "$NS" rollout undo "deployment/$name" --to-revision="$before" || true
      kubectl -n "$NS" rollout status "deployment/$name" --timeout="$ROLLOUT_TIMEOUT" || true
      undone=$((undone + 1))
    fi
  done
  if [ "$undone" -gt 0 ]; then
    echo "Release $TAG was rolled back ($undone deployment(s)); the Secret, ConfigMaps and migrated schema stay." >&2
  else
    echo "Nothing to roll back to (first deploy, or no deployment changed)." >&2
  fi
  echo "Logs: kubectl -n $NS logs deployment/relayfiles-app; probe failures: kubectl -n $NS describe pod -l app.kubernetes.io/name=relayfiles-app" >&2
  exit 1
}

log "App, worker and Nginx"
render relayfiles | apply
for name in "${DEPLOYMENTS[@]}"; do
  kubectl -n "$NS" rollout status "deployment/$name" --timeout="$ROLLOUT_TIMEOUT" || roll_back "deployment/$name did not finish rolling out within $ROLLOUT_TIMEOUT."
done

# Readiness only needs an answer; a release is live once /api/health says "ok".
log "Health check"
HEALTH=""
for _ in $(seq 1 "$HEALTH_TRIES"); do
  HEALTH="$(kubectl -n "$NS" exec deployment/relayfiles-app -- node -e "fetch('http://127.0.0.1:$APP_PORT/api/health').then((r) => r.text()).then(console.log)" 2> /dev/null || true)"
  if status_ok "$HEALTH"; then
    log "Release $TAG is live."
    exit 0
  fi
  sleep 2
done
roll_back "Health check failed: ${HEALTH:-no answer}"
