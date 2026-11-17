# Phase 8 — Hardening

Completed 2026-11-17. Spec section 15 Phase 8: a security review against section 11, a dependency
audit, backup and restore, an end-to-end check, a performance look at the main list queries, and
the final notes. There is no Phase 9.

## Completeness

| Requirement                        | Status           | Where                                                                  |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| Security review against section 11 | Partial          | Retention, export, upload sniffing, and log redaction below            |
| Dependency audit                   | Done             | `pnpm audit --audit-level=high` in `.github/workflows/ci.yml`          |
| Backup and restore                 | Scripts only     | `infra/scripts/backup.sh`, `infra/scripts/restore.sh`                  |
| Restore drill                      | Not run          | No local Postgres, and a restore would replace production              |
| End-to-end run                     | Local gates only | Playwright and the compose smoke test stay in CI                       |
| One million messages, 300 ms lists | Not measured     | `audit_logs_createdAt_idx` added; message indexes were already present |
| Final documentation                | Done             | `docs/DECISIONS.md`, `docs/DEPLOY.md` section 4, this report           |

## What was built

Message bodies older than `messageRetentionDays` (default 365) become `[redacted]` on the
existing 15-minute usage tick. The row, status, and price stay. A retention failure is logged on
its own and does not replace a usage failure.

An owner can download `GET /api/internal/organization/export` from Settings. The JSON omits
password hashes, API key hashes, webhook secrets, TOTP secrets, and document ciphertext. It
includes at most 10,000 messages and sets `messagesTruncated` when more exist. The download is
audited as `organization.exported`.

Compliance uploads are checked against their declared type. PDF, PNG, JPEG, and WEBP must carry
their magic bytes. Text must not contain a NUL. The Phase 6 cap stays 512 KB, ciphertext in
Postgres. Spec section 11's 10 MB store outside the web root was not added.

Logs drop `*.body`, `*.phone`, and `*.phoneE164` as well as the credential paths already there.
Query strings were already removed.

`backup.sh` encrypts a custom-format `pg_dump` with `BACKUP_PASSPHRASE`, keeps 14 days, and
copies to S3 only when `BACKUP_S3_URI` is set. `restore.sh <file> --yes` stops the API and
worker, restores, and starts them again. Neither script was executed. The passphrase is not
required for Compose to boot, and it must not be placed in `/opt/smsvio/.env`.

## How to verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed on this machine. Shared
branch coverage is 95.22%. API branch coverage is 80.25%. Worker branch coverage is 81.51%.
Server branch coverage is 100%. `pnpm audit --audit-level=high` exits 0.

CI also shellchecks `infra/scripts/*.sh` and runs Playwright. Those jobs were not run locally.
The dashboard export button was not clicked in a browser here.

## Known limitations

- The restore drill was not run. `docs/DEPLOY.md` section 4 has the commands. Running them on
  the server would replace the live database.
- One million messages were not seeded, and no list query was timed. The admin audit list orders
  by `createdAt` descending across every organization, so that column now has its own index.
  Message lists already had `(organizationId, createdAt desc)` and the status indexes. The admin
  message search uses `contains`, which a btree cannot serve. `pg_trgm` was not added without a
  measurement.
- Spec section 11 asks for an automatic pause and an operator alert when traffic to one prefix
  spikes. No threshold was ever given, so the control stays off.
- Compliance files stay at 512 KB in Postgres, including WEBP and plain text. They are not the
  10 MB files-outside-the-web-root store in section 11.
- The export stops at 10,000 messages. Older rows remain in the database until retention redacts
  the body.
- `pnpm audit` still reports one moderate `minimatch` advisory (`GHSA-g3hv-75wg-m249`) through
  typescript-eslint. It is not a runtime dependency. No override was added. High and critical
  are clean, and CI fails on those.
- Checkout remains 503 `payments_unconfigured`. The Phase 7 handset test was not run.
- `AUTO_APPROVE_TEMPLATES` stays `false` in the repository. Production `/opt/smsvio/.env` may
  still be `true` until the owner turns it off.
