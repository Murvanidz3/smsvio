#!/usr/bin/env bash
# Re-deploys the release that was live before the current one (from releases.log).
#
#   rollback.sh              roll back one release
#   rollback.sh <release>    re-deploy a specific earlier release
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/smsvio}"
cd "$APP_DIR"
[[ -f releases.log ]] || { echo "No releases.log in $APP_DIR; nothing to roll back to." >&2; exit 1; }

current="$(sed -n 's/^APP_RELEASE=//p' .release.env 2>/dev/null | tail -n 1)"
target="${1:-}"
if [[ -z "$target" ]]; then
  target="$(awk -v current="$current" '$2 != current { release = $2 } END { print release }' releases.log)"
fi
[[ -n "$target" ]] || { echo "No earlier release recorded in releases.log." >&2; exit 1; }

echo "Rolling back from ${current:-none} to ${target}"
exec "$APP_DIR/scripts/deploy.sh" "$target"
