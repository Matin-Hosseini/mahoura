# Mahoura Party

**Mahoura Party** is a private watch-party project for watching videos together from separate locations. The product is in early development; the current web screen and API endpoints are still starter scaffolding.

The intended approach synchronizes player commands across clients. Each participant must access video they are permitted to watch; the project does not bundle or redistribute copyrighted media.

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Web**: Next.js, React, TypeScript
- **API**: NestJS, TypeScript
- **Realtime (planned)**: NestJS WebSocket gateway + Socket.IO
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

## Quick start

Install Node.js 24, use the pnpm version specified in `package.json`, then:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The web UI runs on http://localhost:3000 and the API on http://localhost:3001.

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
