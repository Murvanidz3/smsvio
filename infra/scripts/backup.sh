#!/usr/bin/env bash
# Nightly logical backup. Encrypts a custom-format dump with BACKUP_PASSPHRASE
# and keeps 14 days on disk. Copies to S3 only when BACKUP_S3_URI is set.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/smsvio}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[backup] %s\n' "$*"; }
die() {
  printf '[backup] %s\n' "$*" >&2
  exit 1
}

[[ -n "${BACKUP_PASSPHRASE:-}" ]] || die "Set BACKUP_PASSPHRASE before running a backup."
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
raw="$BACKUP_DIR/smsvio-$stamp.dump"
enc="$raw.enc"

cleanup() { rm -f "$raw"; }
trap cleanup EXIT
"$SCRIPT_DIR/compose.sh" exec -T postgres pg_dump -U smsvio -d smsvio --format=custom >"$raw"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$raw" -out "$enc"
rm -f "$raw"
chmod 600 "$enc"
find "$BACKUP_DIR" -name 'smsvio-*.dump.enc' -mtime +"$KEEP_DAYS" -delete
log "wrote $enc"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  command -v aws >/dev/null 2>&1 || die "BACKUP_S3_URI is set but the aws CLI is not installed."
  aws s3 cp "$enc" "${BACKUP_S3_URI%/}/$(basename "$enc")"
  log "copied to $BACKUP_S3_URI"
fi
