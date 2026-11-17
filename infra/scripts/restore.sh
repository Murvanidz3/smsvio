#!/usr/bin/env bash
# Replaces the live database with an encrypted dump. This destroys current data.
# Usage: restore.sh <file.dump.enc> --yes
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/smsvio}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
file="${1:-}"
confirm="${2:-}"

die() {
  printf '[restore] %s\n' "$*" >&2
  exit 1
}

[[ "$confirm" == "--yes" && -f "$file" ]] || die "Usage: restore.sh <file.dump.enc> --yes"
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || die "Set BACKUP_PASSPHRASE to the passphrase used for this dump."

mkdir -p "$BACKUP_DIR"
umask 077
tmp="$(mktemp "$BACKUP_DIR/restore.XXXXXX.dump")"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" -out "$tmp"
"$SCRIPT_DIR/compose.sh" stop api worker
set +e
"$SCRIPT_DIR/compose.sh" exec -T postgres pg_restore -U smsvio -d smsvio --clean --if-exists <"$tmp"
status=$?
set -e
"$SCRIPT_DIR/compose.sh" start api worker
cleanup
exit "$status"
