#!/usr/bin/env bash
# Installs the deploy-key guard and restricts only the GitHub Actions key.
# The admin key is left as a normal shell login. Run as root.
set -euo pipefail

[[ ${EUID} -eq 0 ]] || { printf 'run as root\n' >&2; exit 1; }

src="$(cd "$(dirname "$0")" && pwd)/ssh-guard.sh"
[[ -f "$src" ]] || { printf 'missing %s\n' "$src" >&2; exit 1; }
install -m 0755 -o root -g root "$src" /usr/local/sbin/smsvio-ssh-guard

auth=/home/deploy/.ssh/authorized_keys
[[ -f "$auth" ]] || { printf 'missing %s\n' "$auth" >&2; exit 1; }
install -m 0600 -o deploy -g deploy "$auth" "${auth}.bak"
tmp="$(mktemp)"
python3 - "$auth" "$tmp" <<'PY'
import pathlib, subprocess, sys

src, dst = sys.argv[1], sys.argv[2]
prefix = 'command="/usr/local/sbin/smsvio-ssh-guard",restrict '
out = []
restricted = 0
for raw in pathlib.Path(src).read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        out.append(raw)
        continue
    parts = line.split()
    idx = next(
        (
            i
            for i, part in enumerate(parts)
            if part in ("ssh-rsa", "ssh-ed25519", "ssh-dss")
            or part.startswith("ecdsa-")
            or part.startswith("sk-")
        ),
        None,
    )
    if idx is None or len(parts) < idx + 2:
        print("unrecognized authorized_keys line", file=sys.stderr)
        sys.exit(1)
    key = " ".join(parts[idx:])
    comment = parts[-1]
    if comment != "smsvio-github-actions":
        out.append(key)
        continue
    proc = subprocess.run(
        ["ssh-keygen", "-lf", "-"],
        input=key.encode(),
        capture_output=True,
        check=True,
    )
    fingerprint = proc.stdout.decode().split()[1]
    out.append(prefix + key)
    restricted += 1
    print(f"restricted {fingerprint}", file=sys.stderr)
if restricted != 1:
    print(f"expected exactly one CI key, found {restricted}", file=sys.stderr)
    sys.exit(1)
pathlib.Path(dst).write_text("\n".join(out) + "\n")
PY
install -m 0600 -o deploy -g deploy "$tmp" "$auth"
rm -f "$tmp"
stat -c '%U %a %n' /usr/local/sbin/smsvio-ssh-guard
printf 'guard installed\n'
