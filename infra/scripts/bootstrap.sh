#!/usr/bin/env bash
# SMSVIO VPS bootstrap for Ubuntu 24.04. Idempotent: safe to run again.
#
# Run once as root:
#   DEPLOY_SSH_KEYS_FILE=/root/deploy_keys.pub bash bootstrap.sh
#
# DEPLOY_SSH_KEYS_FILE must contain one or more OpenSSH public keys. They become the only
# way to log in: root login and password authentication are disabled at the end.
set -Eeuo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/smsvio}"
DEPLOY_SSH_KEYS_FILE="${DEPLOY_SSH_KEYS_FILE:-}"
SWAP_FILE=/swapfile
SWAP_SIZE=2G
SWAP_RAM_THRESHOLD_KB=$((4 * 1024 * 1024))

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
trap 'die "bootstrap failed at line $LINENO: $BASH_COMMAND"' ERR

[[ ${EUID} -eq 0 ]] || die "run as root"
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID}" == "ubuntu" && "${VERSION_ID}" == "24.04" ]] || die "Ubuntu 24.04 required, found ${PRETTY_NAME}"
[[ -n "${DEPLOY_SSH_KEYS_FILE}" && -s "${DEPLOY_SSH_KEYS_FILE}" ]] || die "set DEPLOY_SSH_KEYS_FILE to a non-empty file of public keys"
ssh-keygen -l -f "${DEPLOY_SSH_KEYS_FILE}" >/dev/null || die "${DEPLOY_SSH_KEYS_FILE} does not contain valid public keys"

export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-q -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

log "Updating the system"
apt-get update -q
apt-get "${APT_OPTS[@]}" full-upgrade
apt-get "${APT_OPTS[@]}" install ca-certificates curl gnupg jq ufw fail2ban python3-systemd \
  unattended-upgrades apt-listchanges

log "Setting timezone to UTC"
timedatectl set-timezone UTC

log "Creating the ${DEPLOY_USER} user"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG sudo "${DEPLOY_USER}"
# The deploy user has no password (key-only logins), so sudo cannot prompt for one.
SUDOERS_FILE="/etc/sudoers.d/90-${DEPLOY_USER}"
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "${DEPLOY_USER}" >"${SUDOERS_FILE}"
chmod 0440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}" >/dev/null
DEPLOY_HOME="$(getent passwd "${DEPLOY_USER}" | cut -d: -f6)"
install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"
install -m 0600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_SSH_KEYS_FILE}" "${DEPLOY_HOME}/.ssh/authorized_keys"

log "Installing Docker Engine from Docker's official repository"
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  if dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null | grep -q "install ok installed"; then
    apt-get "${APT_OPTS[@]}" remove "${pkg}"
  fi
done
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-${VERSION_CODENAME}}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -q
apt-get "${APT_OPTS[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

log "Configuring Docker log rotation"
DAEMON_JSON=/etc/docker/daemon.json
DESIRED_DAEMON_JSON='{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"},"live-restore":true}'
if [[ ! -f "${DAEMON_JSON}" ]] || [[ "$(jq -cS . "${DAEMON_JSON}")" != "$(jq -cS . <<<"${DESIRED_DAEMON_JSON}")" ]]; then
  jq . <<<"${DESIRED_DAEMON_JSON}" >"${DAEMON_JSON}"
  systemctl restart docker
fi
systemctl enable --now docker containerd
usermod -aG docker "${DEPLOY_USER}"

log "Swap"
MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
if (( MEM_KB <= SWAP_RAM_THRESHOLD_KB )); then
  if ! swapon --show=NAME --noheadings | grep -qx "${SWAP_FILE}"; then
    [[ -f "${SWAP_FILE}" ]] || fallocate -l "${SWAP_SIZE}" "${SWAP_FILE}"
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}" >/dev/null
    swapon "${SWAP_FILE}"
  fi
  grep -q "^${SWAP_FILE} " /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" >>/etc/fstab
  echo "vm.swappiness=10" >/etc/sysctl.d/99-smsvio-swap.conf
  sysctl -q -p /etc/sysctl.d/99-smsvio-swap.conf
  echo "RAM is $((MEM_KB / 1024)) MB: ${SWAP_SIZE} swap file enabled"
else
  echo "RAM is $((MEM_KB / 1024)) MB (> 4 GB): no swap file needed"
fi

log "Firewall (UFW): allow only 22, 80, 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status verbose

log "fail2ban"
cat >/etc/fail2ban/jail.d/90-smsvio.local <<'EOF'
[DEFAULT]
backend  = systemd
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
# Ubuntu 24.04 runs the daemon as ssh.service; fail2ban's default filter only matches sshd.service.
journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd
EOF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban
for _ in $(seq 1 15); do
  fail2ban-client ping >/dev/null 2>&1 && break
  sleep 1
done
fail2ban-client status sshd

log "Unattended security upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades >/dev/null

log "Application directory ${APP_DIR}"
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}"

log "Hardening SSH: key-only logins, no root login"
# sshd uses the first value it reads and includes sshd_config.d/*.conf in lexical order,
# so this file must sort before the provider's 50-cloud-init.conf.
cat >/etc/ssh/sshd_config.d/00-smsvio.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
X11Forwarding no
MaxAuthTries 4
AllowUsers ${DEPLOY_USER}
EOF
sshd -t
systemctl reload ssh
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|allowusers) '

log "Bootstrap complete"
if [[ -f /var/run/reboot-required ]]; then
  echo "A reboot is required to finish applying updates: run 'sudo reboot'."
fi
