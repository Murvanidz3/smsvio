#!/usr/bin/env bash
# Deploys one release of SMSVIO on the production host and rolls back automatically when the
# new release does not become ready.
#
#   deploy.sh <release>            deploy the images tagged <release> (a git commit SHA)
#
# Expects in APP_DIR (default /opt/smsvio): .env, docker-compose.prod.yml and scripts/.
# Writes .release.env (the active release) and releases.log (deploy history).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/smsvio}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/murvanidz3/smsvio}"
SERVICES=(migrate api worker web caddy)
KEEP_RELEASES="${KEEP_RELEASES:-3}"
READY_ATTEMPTS="${READY_ATTEMPTS:-36}"
READY_INTERVAL_SECONDS="${READY_INTERVAL_SECONDS:-5}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

release="${1:-}"
[[ "$release" =~ ^[0-9a-f]{7,40}$ ]] || die "usage: deploy.sh <git-sha>"

cd "$APP_DIR"
[[ -f .env ]] || die "$APP_DIR/.env is missing; see docs/DEPLOY.md"
[[ -f docker-compose.prod.yml ]] || die "$APP_DIR/docker-compose.prod.yml is missing"

exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || die "another deploy is already running"

env_value() {
  local key="$1" file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

site_domain="$(env_value SITE_DOMAIN .env)"
[[ -n "$site_domain" ]] || die "SITE_DOMAIN is not set in .env"

previous=""
if [[ -f .release.env ]]; then
  previous="$(env_value APP_RELEASE .release.env)"
fi

compose() {
  docker compose \
    --project-directory "$APP_DIR" \
    -f "$APP_DIR/docker-compose.prod.yml" \
    --env-file "$APP_DIR/.env" \
    --env-file "$APP_DIR/.release.env" \
    "$@"
}

write_release() {
  printf 'APP_RELEASE=%s\nIMAGE_PREFIX=%s\n' "$1" "$IMAGE_PREFIX" >"$APP_DIR/.release.env.tmp"
  mv "$APP_DIR/.release.env.tmp" "$APP_DIR/.release.env"
}

images_present() {
  local tag="$1" service
  for service in "${SERVICES[@]}"; do
    docker image inspect "${IMAGE_PREFIX}-${service}:${tag}" >/dev/null 2>&1 || return 1
  done
}

wait_until_ready() {
  local attempt
  for ((attempt = 1; attempt <= READY_ATTEMPTS; attempt++)); do
    if curl --fail --silent --show-error --max-time 10 \
      --resolve "${site_domain}:443:127.0.0.1" \
      "https://${site_domain}/readyz" >/dev/null; then
      return 0
    fi
    sleep "$READY_INTERVAL_SECONDS"
  done
  return 1
}

activate() {
  local tag="$1"
  write_release "$tag"
  if ! compose pull --quiet; then
    images_present "$tag" || return 1
    log "registry pull failed; using the images already on this host for ${tag}"
  fi
  compose up --detach --remove-orphans --wait --wait-timeout 300
}

prune_old_images() {
  local keep service image tag
  mapfile -t keep < <(awk '{ print $2 }' releases.log | tail -n "$KEEP_RELEASES")
  for service in "${SERVICES[@]}"; do
    while read -r image; do
      tag="${image##*:}"
      if [[ ! " ${keep[*]} " =~ \ ${tag}\  ]]; then
        docker image rm "$image" >/dev/null 2>&1 || true
      fi
    done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "${IMAGE_PREFIX}-${service}")
  done
  docker image prune --force >/dev/null
}

log "deploying ${release} (previous: ${previous:-none})"
if activate "$release" && wait_until_ready; then
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$release" >>releases.log
  prune_old_images
  log "release ${release} is live on https://${site_domain}"
  exit 0
fi

log "release ${release} failed its readiness check"
compose ps --all || true
compose logs --no-color --tail 80 migrate api worker web caddy || true

if [[ -z "$previous" || "$previous" == "$release" ]]; then
  die "no previous release to roll back to"
fi

log "rolling back to ${previous}"
if activate "$previous" && wait_until_ready; then
  die "rolled back to ${previous}; release ${release} was not deployed"
fi
die "rollback to ${previous} also failed; manual intervention required"
