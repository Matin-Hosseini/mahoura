# Docker operations

## Layout and isolation

Both stacks are independent Compose projects (`mahoura-dev`, `mahoura-prod`), with their own app/data bridges, PostgreSQL and Redis instances, credentials, and named persistent volumes. Never combine the two Compose files with multiple `-f` flags. Do not override the project names with the same `-p` or `COMPOSE_PROJECT_NAME`. BuildKit may reuse dependency layers and build cache; this is not runtime data sharing.

| Service    | Development host port | Production host port | Container port |
| ---------- | --------------------: | -------------------: | -------------: |
| Next.js    |                  3000 |                 8080 |           3000 |
| NestJS     |                  3001 |                 8081 |           3001 |
| PostgreSQL |                  5433 |                 5434 |           5432 |
| Redis      |                  6380 |                 6381 |           6379 |

All published ports bind to 127.0.0.1 by design. The web service connects to the API through the `app` bridge, and only the API is attached to both `app` and `data`. The data bridge is project-scoped, not an `internal: true` network, so loopback DB ports remain available for local tooling. Network names, volume names, and image tags are different between environments.

PostgreSQL 18 persists at `/var/lib/postgresql` (not the pre-18 `/var/lib/postgresql/data` mount). Redis uses AOF with every-second fsync and `/data`. Application containers are disposable and non-root; production has no source bind mounts or development dependencies. Images use versioned major tags; their patch versions may change when rebuilding. Record image digests and scan images before actual release.

## First run

Prerequisites: Docker Desktop running Linux containers, Compose v2.32 or newer, Node 24 for the local scripts, and network access to Docker Hub and npm. Check `docker compose version`. The initial patch introduces `pg`, `ioredis` and `@types/pg`; run `pnpm install --no-frozen-lockfile` once with the pinned pnpm version to resolve the new dependencies, and commit the regenerated `pnpm-lock.yaml` together with the API manifest. After that, use frozen installs.

```powershell
node scripts/init-docker-env.mjs
docker compose --env-file .env.dev -f compose.dev.yaml config --quiet
docker compose --env-file .env.prod -f compose.prod.yaml config --quiet
```

The script creates `.env.dev` and `.env.prod` with independent cryptographically random admin, application and Redis passwords. It never overwrites an existing file. The files are gitignored and excluded from the build context and source snapshot. Protect them with host file permissions, especially on Windows. Do not print full interpolated Compose configuration or commit these files.

Compose injects credentials as environment variables: Docker administrators can inspect them. This is suitable for the local isolated stacks, not a replacement for a production secret manager. External deployment must inject credentials securely, remove unnecessary database/API port publications, and terminate TLS at an appropriately configured reverse proxy. The development and production databases must not share credentials or volumes.

## Development

For daily development, start from existing images without pulling or building, then start Watch in a separate terminal:

```powershell
docker compose --env-file .env.dev -f compose.dev.yaml up -d --no-build --pull never --wait
docker compose --env-file .env.dev -f compose.dev.yaml watch --no-up
```

On the first run, or when images need to be refreshed, use `up --build -d --wait` instead of the first command. Compose Watch syncs explicitly selected source paths into the two separate application containers. Next.js HMR and NestJS watch execute on Linux; Windows `node_modules`, `.next`, `.turbo` and `dist` are neither mounted nor selected for sync. Dependency manifests and lockfile edits trigger a rebuild even with `watch --no-up`. Changes outside watched paths require a rebuild to reach the containers. Update the Dockerfile manifest COPY list and watch rebuild triggers when adding a workspace. Restart Watch after editing Compose rules; apply runtime configuration changes with `up` and rebuild when image contents change. Recreating a container from an old image discards its previously synced files; start Watch again to sync the configured paths.

To install a dependency, update the workspace manifest and lockfile together using the pinned pnpm version on the host, then let Watch rebuild. Do not modify a container's manifest as a substitute for committing the lockfile.

```powershell
docker compose --env-file .env.dev -f compose.dev.yaml ps
docker compose --env-file .env.dev -f compose.dev.yaml logs -f api web
```

## Production (local production-mode validation)

```powershell
docker compose --env-file .env.prod -f compose.prod.yaml up --build -d --wait --wait-timeout 300
docker compose --env-file .env.prod -f compose.prod.yaml ps
```

The web image uses Next.js standalone output and copies static/public assets. The API image uses a production-only pnpm deploy and starts `node dist/main.js`. Both run as `node`, drop Linux capabilities, have init processes, bounded logging and graceful shutdown. PostgreSQL creates a dedicated non-superuser application role on first initialization, separate from the admin role. The application role may create tables in `public`; define migrations and a separate migration role before implementing the product schema. No ORM, business schema, migration runner or Redis business state is introduced yet.

## Health and smoke tests

`/health/live` reports API process liveness. `/health/ready` executes authenticated PostgreSQL `SELECT 1` and Redis `PING`, returns 200 only if both are reachable, otherwise 503 with dependency statuses. Next.js `/api/health` calls the API over Docker networking and returns 200 or 503 without revealing internal addresses. The ordinary unit and API E2E suite overrides the dependency checker; the smoke script exercises real services.

```powershell
node scripts/docker-smoke.mjs dev
node scripts/docker-smoke.mjs prod
# With both environments running:
node scripts/docker-smoke.mjs both
```

The `both` mode also writes a temporary table and expiring Redis key to development, verifies both are absent from production, and cleans them up. CI runs both stacks alongside each other, verifies the published database ports, then exercises a development Redis outage and recreates the development data containers to verify persistence while production remains available. Use the optional `--exercise-dev-recovery` flag only in a disposable development stack. To test HMR manually, edit an existing visible web heading and an API response, verify both change without rebuilding, and revert the edits. To test dependency outages safely, stop Redis in **development**, verify API readiness becomes 503 while liveness stays 200, restart Redis, and wait for readiness to recover.

## Shutdown, persistence and backup

```powershell
docker compose --env-file .env.dev -f compose.dev.yaml down
docker compose --env-file .env.prod -f compose.prod.yaml down
```

`down` keeps named data volumes. The expected names are `mahoura-dev_postgres_data`, `mahoura-dev_redis_data`, `mahoura-prod_postgres_data` and `mahoura-prod_redis_data`. Verify using `docker volume ls`. Run `down -v` only when intentionally destroying that environment's databases (CI uses it for ephemeral data). Old volumes from earlier Docker experiments are not used by these projects; inspect them before removing them. Do not use `docker system prune --volumes`.

PostgreSQL initialization scripts only run on an empty volume. Changing `.env` does not rotate the initialized PostgreSQL roles. Rotate passwords explicitly using a maintenance procedure and update the environment files consistently. Back up PostgreSQL using `pg_dump` and test restore; configure Redis persistence/backup according to future data retention needs. Persistent volumes alone are not backups. No automated backup or public deployment is configured in this scaffold.
