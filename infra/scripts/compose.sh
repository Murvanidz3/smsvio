#!/usr/bin/env bash
# Runs docker compose against the active production release, e.g.
#   compose.sh ps
#   compose.sh logs -f api
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/smsvio}"
[[ -f "$APP_DIR/.release.env" ]] || {
  echo "No active release in $APP_DIR (.release.env missing). Deploy first." >&2
  exit 1
}

exec docker compose \
  --project-directory "$APP_DIR" \
  -f "$APP_DIR/docker-compose.prod.yml" \
  --env-file "$APP_DIR/.env" \
  --env-file "$APP_DIR/.release.env" \
  "$@"
