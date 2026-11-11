#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy key.
#
# sshd runs this instead of whatever the client asked for, and puts the client's
# command in SSH_ORIGINAL_COMMAND. The key cannot open a shell, change this script,
# or run a release that is older than the one already live unless the command
# carries --rollback.
set -euo pipefail
export LC_ALL=C

APP_DIR=/opt/smsvio
REPO=Murvanidz3/smsvio

log() { printf '[ssh-guard] %s\n' "$*" >&2; }
die() { log "refusing: $*"; exit 1; }

cmd="${SSH_ORIGINAL_COMMAND:-}"
[[ -n "$cmd" ]] || die "no command"
if [[ "$cmd" =~ [';&|<>`$()'] ]] || [[ "$cmd" == *$'\n'* ]] || [[ "$cmd" == *$'\r'* ]]; then
  die "command shape"
fi

refuse_if_older() {
  local sha="$1" live live_date sha_date status
  live="$(sed -n 's/^APP_RELEASE=//p' "$APP_DIR/.release.env" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$live" || "$live" == "$sha" ]]; then
    log "allowing ${sha}"
    return 0
  fi
  local api="https://api.github.com/repos/${REPO}"
  local -a curl_args=(-fsS --retry 2 --retry-delay 1 --max-time 20 -H "User-Agent: smsvio-ssh-guard" -H "Accept: application/vnd.github+json")
  live_date="$(curl "${curl_args[@]}" "${api}/commits/${live}" | jq -er '.commit.committer.date')" \
    || die "could not read the live commit ${live}"
  sha_date="$(curl "${curl_args[@]}" "${api}/commits/${sha}" | jq -er '.commit.committer.date')" \
    || die "could not read commit ${sha}"
  status="$(curl "${curl_args[@]}" "${api}/compare/${live}...${sha}" | jq -er '.status')" \
    || die "could not compare ${sha} with the live release ${live}"
  case "$status" in
    identical)
      log "allowing ${sha}"
      return 0
      ;;
    behind)
      die "${sha} is behind the live release ${live}"
      ;;
    ahead | diverged)
      if [[ "$sha_date" < "$live_date" ]]; then
        die "${sha} (${sha_date}) is older than the live release ${live} (${live_date})"
      fi
      log "allowing ${sha} (${status}, ${sha_date})"
      return 0
      ;;
    *)
      die "unknown compare status for ${sha}"
      ;;
  esac
}

set -f
# shellcheck disable=SC2206
args=($cmd)
set +f

case "${args[0]}" in
  mkdir)
    [[ "$cmd" == 'mkdir -p /opt/smsvio/scripts' ]] || die "mkdir"
    exec mkdir -p /opt/smsvio/scripts
    ;;
  chmod)
    [[ "$cmd" == 'chmod 0755 /opt/smsvio/scripts/*.sh' ]] || die "chmod"
    exec chmod 0755 /opt/smsvio/scripts/*.sh
    ;;
  docker)
    if [[ "$cmd" == 'docker logout ghcr.io' ]]; then
      exec docker logout ghcr.io
    fi
    [[ ${#args[@]} -eq 6 ]] || die "docker"
    [[ "${args[1]}" == login && "${args[2]}" == ghcr.io && "${args[3]}" == --username && "${args[5]}" == --password-stdin ]] \
      || die "docker"
    [[ "${args[4]}" =~ ^[A-Za-z0-9-]{1,39}$ ]] || die "docker username"
    exec docker login ghcr.io --username "${args[4]}" --password-stdin
    ;;
  scp)
    mode=""
    path=""
    for arg in "${args[@]:1}"; do
      case "$arg" in
        -t | -f) mode="$arg" ;;
        -*) [[ "$arg" =~ ^-[dprv]+$ ]] || die "scp flag" ;;
        *)
          [[ -z "$path" ]] || die "scp destination"
          path="$arg"
          ;;
      esac
    done
    [[ "$mode" == "-t" || "$mode" == "-f" ]] || die "scp mode"
    case "$path" in
      /opt/smsvio/scripts | /opt/smsvio/scripts/ | /opt/smsvio/docker-compose.prod.yml | \
        /opt/smsvio/scripts/deploy.sh | /opt/smsvio/scripts/compose.sh | /opt/smsvio/scripts/rollback.sh) ;;
      *) die "scp destination" ;;
    esac
    exec "${args[@]}"
    ;;
  /opt/smsvio/scripts/deploy.sh)
    sha="${args[1]:-}"
    [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "release must be a git sha"
    if [[ ${#args[@]} -eq 3 && "${args[2]}" == "--rollback" ]]; then
      log "allowing rollback to ${sha}"
    elif [[ ${#args[@]} -eq 2 ]]; then
      refuse_if_older "$sha"
    else
      die "deploy arguments"
    fi
    exec /opt/smsvio/scripts/deploy.sh "$sha"
    ;;
  /opt/smsvio/scripts/rollback.sh)
    [[ "$cmd" == '/opt/smsvio/scripts/rollback.sh --rollback' ]] || die "rollback requires --rollback"
    exec /opt/smsvio/scripts/rollback.sh --rollback
    ;;
  *)
    die "command not allowed"
    ;;
esac
