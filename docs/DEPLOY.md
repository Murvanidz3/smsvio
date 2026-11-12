# Deploying SMSVIO

SMSVIO runs on one Ubuntu 24.04 VPS with Docker Compose. Every push to `main` that passes CI is
built into images, pushed to GitHub Container Registry (GHCR) and deployed over SSH. A failed
readiness check rolls the server back to the previous release automatically.

```
Internet ──► Caddy :80/:443 (TLS, www → apex, security headers)
               ├── /api/*, /healthz, /readyz ──► api :4000 (NestJS + Fastify)
               └── everything else ────────────► web :3000 (Next.js)
             api, worker ──► postgres :5432, redis :6379   (internal network, no published ports)
             migrate (one-shot `prisma migrate deploy`) runs before api and worker start
```

| Item               | Value                                                             |
| ------------------ | ----------------------------------------------------------------- |
| Server             | `179.67.196.35`, Ubuntu 24.04, user `deploy` (SSH keys only)      |
| App directory      | `/opt/smsvio` (owned by `deploy`, mode 0750)                      |
| Images             | `ghcr.io/murvanidz3/smsvio-{api,worker,web,migrate,caddy}:<sha>`  |
| Production secrets | `/opt/smsvio/.env` (mode 0600, never committed)                   |
| Active release     | `/opt/smsvio/.release.env`; history in `/opt/smsvio/releases.log` |
| Scripts            | `/opt/smsvio/scripts/{deploy,rollback,compose}.sh` (copied by CI) |
| Deploy-key guard   | `/usr/local/sbin/smsvio-ssh-guard` (root-owned, not copied by CI) |

Root login and password login are disabled. If you lose the `deploy` SSH keys, use the Hostinger
VPS recovery console.

## 1. Fresh VPS to live site

### 1.1 DNS

Create these records at the DNS provider (currently Spaceship) and wait until they resolve:

| Type | Name  | Value           |
| ---- | ----- | --------------- |
| A    | `@`   | `179.67.196.35` |
| A    | `www` | `179.67.196.35` |

```bash
dig +short smsvio.com
dig +short www.smsvio.com
```

Caddy requests Let's Encrypt certificates on first start, so both names must point at the server
before the first deploy. A missing record only affects that name.

### 1.2 SSH keys (on your computer)

```bash
ssh-keygen -t ed25519 -C smsvio-admin -f ~/.ssh/id_ed25519_smsvio
ssh-keygen -t ed25519 -C smsvio-github-actions -f ~/.ssh/smsvio_ci_deploy -N ""
cat ~/.ssh/id_ed25519_smsvio.pub ~/.ssh/smsvio_ci_deploy.pub > smsvio_deploy_keys.pub
```

The first key is for people. It stays a normal login, so an admin can still open a shell and
roll back by hand. The second key is for GitHub Actions. After bootstrap, section 1.3 restricts
that key to `/usr/local/sbin/smsvio-ssh-guard`. It cannot open a shell.

### 1.3 Bootstrap the server

The bootstrap is idempotent and hardens the server: system upgrade, `deploy` user with sudo,
SSH keys only (root and password login disabled), UFW (22, 80, 443), fail2ban, unattended
security upgrades, UTC, Docker Engine and Compose from Docker's repository, Docker log rotation,
a 2 GB swap file when RAM is 4 GB or less, and `/opt/smsvio`.

```bash
scp infra/scripts/bootstrap.sh infra/scripts/ssh-guard.sh infra/scripts/install-ssh-guard.sh \
  smsvio_deploy_keys.pub root@179.67.196.35:/root/
ssh root@179.67.196.35 'DEPLOY_SSH_KEYS_FILE=/root/smsvio_deploy_keys.pub bash /root/bootstrap.sh && bash /root/install-ssh-guard.sh && rm /root/smsvio_deploy_keys.pub'
```

`install-ssh-guard.sh` copies the guard to `/usr/local/sbin/smsvio-ssh-guard` (mode `0755`, owner
`root`) and rewrites only the `smsvio-github-actions` line in `authorized_keys` so sshd always
runs that script. A previous copy of the file is kept at
`/home/deploy/.ssh/authorized_keys.bak`.

Then, from a **new** terminal, confirm key login works before closing the root session:

```bash
ssh -i ~/.ssh/id_ed25519_smsvio deploy@179.67.196.35 'docker version --format "{{.Server.Version}}"'
```

Reboot if the script printed a reboot notice: `ssh deploy@179.67.196.35 sudo reboot`.

Optional `~/.ssh/config` entry used in the rest of this guide:

```
Host smsvio
  HostName 179.67.196.35
  User deploy
  IdentityFile ~/.ssh/id_ed25519_smsvio
  IdentitiesOnly yes
```

### 1.4 Production environment file

Run on the server. It generates strong random passwords and never prints them:

```bash
ssh smsvio
cd /opt/smsvio
test -f .env || (
  umask 077
  cat > .env <<EOF
SITE_DOMAIN=smsvio.com
ACME_EMAIL=you@example.com
POSTGRES_PASSWORD=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
LOG_LEVEL=info
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
EOF
)
ls -l .env   # must be -rw------- deploy
```

| Variable             | Meaning                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `SITE_DOMAIN`        | Apex domain Caddy serves. `www.<domain>` redirects to it.        |
| `ACME_EMAIL`         | Contact for Let's Encrypt / ZeroSSL expiry notices.              |
| `POSTGRES_PASSWORD`  | Database password (hex only; it is embedded in connection URLs). |
| `REDIS_PASSWORD`     | Redis `requirepass` (hex only, same reason).                     |
| `LOG_LEVEL`          | `info` in production; `debug` temporarily when investigating.    |
| `SENTRY_DSN`         | Empty keeps Sentry off. Set it to enable error reporting.        |
| `SENTRY_ENVIRONMENT` | Environment tag sent to Sentry.                                  |
| `DATABASE_POOL_MAX`  | Optional, default 10.                                            |

The api refuses to start without `PUBLIC_ORIGIN` and `APP_ENCRYPTION_KEY`. Edit the existing
`/opt/smsvio/.env` (do not regenerate it) before deploying this release. A missing key makes
the api exit and `deploy.sh` rolls back to the previous release.

| Variable               | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`        | `https://smsvio.com`. Cookies and links use this exact origin.                              |
| `APP_ENCRYPTION_KEY`   | `openssl rand -hex 32` (64 hex characters). Encrypts TOTP secrets at rest.                  |
| `EMAIL_MODE`           | `disabled` (default) or `smtp`. `disabled` boots with no mail server.                       |
| `GOOGLE_CLIENT_ID`     | Optional. Set together with `GOOGLE_CLIENT_SECRET`, or leave both empty to hide Google.     |
| `GOOGLE_CLIENT_SECRET` | Optional. Set together with `GOOGLE_CLIENT_ID`.                                             |
| `SEED_ADMIN_EMAIL`     | Optional. The verified account with this email is the platform admin, however they sign in. |
| `SMTP_HOST`            | Required only when `EMAIL_MODE=smtp`.                                                       |
| `SMTP_PORT`            | Default `587`. Port `465` uses implicit TLS.                                                |
| `SMTP_USER`            | Optional. Set together with `SMTP_PASSWORD`, or leave both empty.                           |
| `SMTP_PASSWORD`        | Optional. Set together with `SMTP_USER`.                                                    |
| `SMTP_FROM`            | Required only when `EMAIL_MODE=smtp`. For example `SMSVIO <noreply@smsvio.com>`.            |

The browser callback is `/auth/google/callback` on `PUBLIC_ORIGIN`. These are the URIs
this app sends to Google:

| Where                         | Redirect URI                                  |
| ----------------------------- | --------------------------------------------- |
| Production                    | `https://smsvio.com/auth/google/callback`     |
| `dev.smsvio.com`              | `https://dev.smsvio.com/auth/google/callback` |
| Local Compose (`HTTP_PORT`)   | `http://localhost:8080/auth/google/callback`  |
| `pnpm dev` (web on port 3000) | `http://localhost:3000/auth/google/callback`  |

When `EMAIL_MODE=disabled`, password reset is not emailed. Create a one-time link on the server
and give it to the person. The command prints the link on your terminal and does not write it to
the application log:

```bash
ssh smsvio
cd /opt/smsvio
./scripts/compose.sh exec -T api node dist/scripts/password-reset-link.js person@example.com
```

The migrate container refuses to store `SEED_ADMIN_PASSWORD=smsvio-demo-local` when `NODE_ENV` is
production, and it never changes the password of an account that already exists. Reference data
still loads: countries, dial codes, networks, the simulated mock provider, and one route per
country. An empty `SEED_ADMIN_PASSWORD` skips password seeding. The verified `SEED_ADMIN_EMAIL`
becomes the platform admin when that person signs in, and an existing user with that email and
no membership becomes the owner of one organization. The shared sender is filled only while it
is unset.

### 1.5 GitHub repository secrets

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret                | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `VPS_HOST`            | `179.67.196.35`                                                        |
| `VPS_SSH_USER`        | `deploy`                                                               |
| `VPS_SSH_KEY`         | Full contents of `~/.ssh/smsvio_ci_deploy` (the private key)           |
| `VPS_SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 179.67.196.35`, verified (see below) |

Verify the host key before trusting it: the fingerprint printed by
`ssh-keyscan -t ed25519 179.67.196.35 | ssh-keygen -lf -` must match
`ssh smsvio 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'`.

GHCR needs no secret. The workflow pushes with its own `GITHUB_TOKEN`, logs the server in with
that short-lived token for the pull, and logs it out again afterwards.

Images must be private. Because the repository is public, GHCR creates each `smsvio-*` package
as **public** on the first push, and GitHub offers no API to change that. After the first push,
for each of the five packages open **GitHub → your profile → Packages → package → Package
settings**, choose **Change visibility → Private**, and under **Manage Actions access** make sure
the `smsvio` repository has at least _Read_ access. Check with an anonymous pull, which must be
refused once the package is private:

```bash
docker logout ghcr.io; docker pull ghcr.io/murvanidz3/smsvio-web:<sha>   # expect "denied"
```

### 1.6 First deploy

Push to `main` (or run the **CI** workflow manually from the Actions tab). The `deploy` job copies
`infra/docker-compose.prod.yml` and the scripts to `/opt/smsvio` with `scp -O` (the legacy SCP
protocol; the deploy key rejects SFTP), then runs `scripts/deploy.sh <sha>`. The guard on the
server runs first and refuses the release when it is older than the one already live. `deploy.sh`
then:

1. writes `.release.env` with the new release and pulls its images;
2. runs `docker compose up --wait`: Postgres and Redis become healthy, `migrate` applies pending
   migrations and must exit 0, then `api`, `worker`, `web` and `caddy` start and pass their
   health checks;
3. calls `https://smsvio.com/readyz` through Caddy on the server itself (real TLS) until it
   returns 200;
4. on success appends the release to `releases.log` and keeps the images of the last three
   releases; on failure prints logs and redeploys the previous release.

Afterwards the workflow checks `/readyz`, `/` and `/signin` from the internet and reports whether
`www` redirects to the apex.

Verify by hand:

```bash
curl -fsS https://smsvio.com/readyz          # {"status":"ok","checks":{"postgres":{"status":"up",...},"redis":{...}}}
curl -fsSI https://smsvio.com/ | head -1      # HTTP/2 200
curl -fsSI https://smsvio.com/signin | head -1
curl -sSI https://www.smsvio.com/ | grep -i '^location'   # location: https://smsvio.com/
```

## 2. Updating

Merge to `main`. CI runs the full quality gate, then builds, pushes and deploys automatically.
Deploys are serialised; a second push waits for the running deploy to finish.

Manual deploy of a release that CI already pushed (for example to re-run a deploy):

```bash
ssh smsvio
echo "<github-token-with-read:packages>" | docker login ghcr.io -u <github-user> --password-stdin
/opt/smsvio/scripts/deploy.sh <full-git-sha>
docker logout ghcr.io
```

Without a registry login, `deploy.sh` still works for any release whose images are already on
the server (the last three).

## 3. Rolling back

Automatic: `deploy.sh` redeploys the previous release when the new one fails its readiness
check. That path does not open a second SSH connection, so the age check does not see it. When
the public check fails after a deploy that did start, the workflow runs
`rollback.sh --rollback`. The guard allows that flag and skips the age check.

Manual, from the admin key (this key is not forced through the guard):

```bash
ssh smsvio
/opt/smsvio/scripts/rollback.sh              # back to the release before the current one
/opt/smsvio/scripts/rollback.sh <git-sha>    # or to a specific earlier release
cat /opt/smsvio/releases.log                 # deploy history: <UTC time> <sha>
```

The CI key can do the same only by passing `--rollback`:

```bash
ssh -i ~/.ssh/smsvio_ci_deploy deploy@179.67.196.35 '/opt/smsvio/scripts/rollback.sh --rollback'
ssh -i ~/.ssh/smsvio_ci_deploy deploy@179.67.196.35 '/opt/smsvio/scripts/deploy.sh <git-sha> --rollback'
```

### 3.1 Refusing an older release

A queued GitHub Actions run keeps the workflow file from its own commit. Adding a check to the
current workflow does not stop a run that was queued earlier. The guard is on the server, and
the CI key cannot replace it or skip it.

For `deploy.sh <sha>` with no `--rollback`, the guard reads `APP_RELEASE` from
`/opt/smsvio/.release.env` and asks the public GitHub API whether `<sha>` is an ancestor of the
live release or has an earlier committer time. Either one is refused. The same sha is allowed.
Anything else is allowed only when it is not older. If the API cannot be read, the deploy is
refused. An empty `.release.env` (the first deploy) is allowed.

The CI key may only run these commands: `mkdir -p /opt/smsvio/scripts`,
`chmod 0755 /opt/smsvio/scripts/*.sh`, `docker login` and `docker logout` for `ghcr.io`,
`scp -t`/`scp -f` of `docker-compose.prod.yml` and the three scripts, `deploy.sh <sha>`,
`deploy.sh <sha> --rollback`, and `rollback.sh --rollback`.

Reinstall the guard from a current checkout after changing it. CI never copies this file.

```bash
scp infra/scripts/ssh-guard.sh infra/scripts/install-ssh-guard.sh smsvio:/tmp/
ssh smsvio 'sudo bash /tmp/install-ssh-guard.sh && rm /tmp/ssh-guard.sh /tmp/install-ssh-guard.sh'
```

Rollbacks do not undo database migrations. Migrations must stay backward compatible with the
previous release (add columns and tables first, remove them in a later release).

## 4. Backups and restore

**Not configured yet.** Automated nightly encrypted backups (spec section 13.4) were deferred by
the product owner until after the build; see `docs/DECISIONS.md`. Until then, take a manual
dump before risky changes:

```bash
ssh smsvio
cd /opt/smsvio
mkdir -p backups && chmod 700 backups
./scripts/compose.sh exec -T postgres pg_dump -U smsvio -d smsvio --format=custom \
  > "backups/smsvio-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Restore a dump (this replaces the current data; stop the writers first):

```bash
./scripts/compose.sh stop api worker
./scripts/compose.sh exec -T postgres pg_restore -U smsvio -d smsvio --clean --if-exists \
  < backups/<file>.dump
./scripts/compose.sh start api worker
curl -fsS https://smsvio.com/readyz
```

Copy dumps off the server (`scp smsvio:/opt/smsvio/backups/<file>.dump .`); a backup that only
lives on the same disk is not a backup.

## 5. Rotating secrets

Always edit `/opt/smsvio/.env` with `umask 077`. Passwords and `APP_ENCRYPTION_KEY` stay hex-only.

**Postgres password**

```bash
ssh smsvio && cd /opt/smsvio
NEW=$(openssl rand -hex 32)
./scripts/compose.sh exec -T postgres psql -U smsvio -d smsvio -c "ALTER ROLE smsvio PASSWORD '${NEW}';"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${NEW}/" .env && unset NEW
./scripts/compose.sh up -d --wait api worker   # recreate the apps with the new URL
```

**Redis password**

```bash
ssh smsvio && cd /opt/smsvio
sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$(openssl rand -hex 32)/" .env
./scripts/compose.sh up -d --wait redis api worker
```

**Application encryption key**

`APP_ENCRYPTION_KEY` encrypts TOTP secrets. Ciphertext is prefixed `v1.`. Replacing the key does
not re-encrypt existing rows: those users must set up two-factor authentication again. Generate
a replacement with `openssl rand -hex 32`, update `/opt/smsvio/.env`, and recreate the api.

**CI deploy key**: generate a new key pair (section 1.2). Give the public key the comment
`smsvio-github-actions`, append it to `/home/deploy/.ssh/authorized_keys`, then run
`install-ssh-guard.sh` so the new line is forced through the guard. Update the `VPS_SSH_KEY`
secret, run a deploy, then delete the old public key line. The guard script expects exactly one
key with that comment.

**Admin key**: same procedure; keep one working session open until the new key is verified.

**GHCR**: nothing to rotate; deploys use the workflow's short-lived `GITHUB_TOKEN`.

## 6. Logs and status

```bash
ssh smsvio
cd /opt/smsvio
./scripts/compose.sh ps                         # state and health of every service
./scripts/compose.sh logs -f --tail 100 api     # api | worker | web | caddy | migrate | postgres | redis
./scripts/compose.sh logs --since 1h caddy      # TLS and ACME messages
docker stats --no-stream                        # memory against each limit
```

The api and worker log one JSON object per line (pino) with `service`, `req.id` and the request
id from the `x-request-id` header, so a request can be followed across services. Health probe
successes are not logged; failures are. Docker rotates container logs at 10 MB × 5 files.

## 7. Monitoring

- **Uptime check (recommended):** point an external monitor such as Better Stack or UptimeRobot
  at `https://smsvio.com/readyz` every minute, alerting after two consecutive failures. It checks
  TLS, Caddy, the api, Postgres and Redis in one request. Add a keyword check for `"status":"ok"`.
- **Liveness:** `/healthz` returns 200 while the api process is running, without touching
  dependencies.
- **Errors:** set `SENTRY_DSN` in `.env` and redeploy (`/opt/smsvio/scripts/deploy.sh <current
sha>`) to enable Sentry for the api and worker. Request bodies, cookies, query strings and
  personal data are not sent.
