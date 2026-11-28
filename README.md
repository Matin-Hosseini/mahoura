# Mahoura Party

**Mahoura Party** is a private watch-party project for watching videos together from separate locations. The first watch-party feature includes private two-person rooms, host-uploaded sequential movies, synchronized playback, live chat with typing indicators, and reactions.

The host uploads a video to the environment-specific media volume. Only authorized room members can stream it. Upload and share only media you have permission to share. See [Watch party](docs/watch-party.md) for the workflow, limits, and tests.

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Web**: Next.js, React, TypeScript
- **API**: NestJS, TypeScript
- **Data**: PostgreSQL 18 + Redis 8 (isolated development and production stacks)
- **Realtime**: server-sent events (SSE) + HTTP commands, PostgreSQL room state
- **Quality**: ESLint, Prettier, Husky, lint-staged, Commitlint
- **Tests**: Vitest + Testing Library (web); Jest + Supertest (API)

## Workspace

```text
apps/
  web/    Next.js web application
  api/    NestJS API
packages/
  ui/
  eslint-config/
  typescript-config/
scripts/
  snapshot.mjs
docs/
  development.md
```

## Docker-first quick start

Install Docker Desktop with Compose v2.32+ and start Docker Engine. Builds use the frozen lockfile. Generate local database and Redis credentials:

```powershell
node scripts/init-docker-env.mjs
```

Development (first build):

```powershell
docker compose --env-file .env.dev -f compose.dev.yaml up --build -d --wait
```

Daily development with existing images (run Watch in a separate terminal):

```powershell
docker compose --env-file .env.dev -f compose.dev.yaml up -d --no-build --pull never --wait
docker compose --env-file .env.dev -f compose.dev.yaml watch --no-up
```

Open http://localhost:3000, enter your name and create a room. Send the invitation link to your guest. Neither person needs a password. Keep the application on localhost or a private network accessible only to the two participants.

Production (separate stack, may run simultaneously):

```powershell
docker compose --env-file .env.prod -f compose.prod.yaml up --build -d --wait
```

See [Docker operations](docs/docker.md) for ports, smoke checks, persistence, secrets and deployment limitations.

## Optional host-only development

Install Node.js 24, use the pnpm version specified in `package.json`, then:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The host-only UI runs on http://localhost:3000 and the API on http://localhost:3001. Stop the Docker development stack first. Without database configuration, API liveness works but readiness returns 503. Watch parties require configured PostgreSQL and API_INTERNAL_URL; Docker is the supported end-to-end development path.

## Checks

```powershell
pnpm verify        # format + lint + types + unit + API E2E + build
pnpm test          # web and API unit tests
pnpm test:e2e:api  # NestJS HTTP E2E tests (no browser download)
pnpm test:coverage
pnpm snapshot      # ZIP source for review, in exports/
```

Browser-based E2E with Playwright is **temporarily disabled** because the browser binary could not be downloaded in the current environment. Its package may still be present, but CI does not use it.

For Git Flow, Conventional Commits, test strategy, CI details and snapshot security notes, see [Development workflow](docs/development.md).
