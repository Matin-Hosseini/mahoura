# Mahoura Party — Development workflow

## Repository layout

- `apps/web`: Next.js UI and Vitest/Testing Library unit tests.
- `apps/api`: NestJS API, Jest unit tests and Supertest API E2E tests.
- `packages/ui`: shared React UI components.
- `packages/eslint-config` and `packages/typescript-config`: shared tooling configs.
- `scripts/snapshot.mjs`: sanitized source ZIP export.

Use Node.js 24 and the pinned pnpm version from the root `packageManager` field.
Run all commands from the repository root unless noted.

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
pnpm snapshot
```

Docker is the recommended runtime. See [Docker operations](docker.md) for the two independent environments, source synchronization and data lifecycle. The ordinary host unit/API E2E checks use mocks for readiness; CI additionally exercises the actual databases and both running stacks.

## Git Flow

Production: `main`. Integration: `develop`. Develop features from `develop`.

```powershell
git flow init
git flow feature start rooms-create
# Implement in small commits: feat(rooms): ...
git flow feature publish rooms-create
# Open a pull request: feature/rooms-create -> develop
```

Use GitHub pull requests as the source of truth for merges. When merging via GitHub,
do **not** also use `git flow feature finish` to merge the same branch locally.
Do not push direct feature changes to `main`. Hotfix and release branches follow
Git Flow conventions; coordinate their merges and tags through pull requests.

## Quality gates

- On save: Prettier plus ESLint through VS Code settings.
- Before commit: Husky invokes lint-staged, which runs ESLint on staged workspace files and Prettier.
- For commit messages: Commitlint enforces Conventional Commits.
- Before PR: `pnpm verify` (format, lint, types, unit, Nest API E2E, build).
- In GitHub: `.github/workflows/ci.yml` runs the same checks.

Examples: `feat(rooms): create room`, `fix(playback): handle stale seek`,
`test(api): add room creation scenarios`, `chore: update development tooling`.

## Testing strategy

- Frontend behavior: Vitest + Testing Library, tests near components/features.
- Backend service logic: Jest unit tests near each module.
- Backend HTTP integration: Jest + Supertest in `apps/api/test`.
- Browser E2E: **temporarily deferred** (Playwright download unavailable).

Avoid brittle snapshot-only tests; prefer observable behavior and boundary cases.
Treat synchronization conflicts, reconnects, duplicate events, authorization,
and malformed payloads as high-priority test cases when implemented.

## Snapshot for review

```powershell
pnpm snapshot
```

Creates `exports/mahoura-party-<timestamp>.zip` with tracked and untracked
(non-ignored) source files; excludes dependencies, caches, common secret
filenames and large media. Includes `SNAPSHOT_MANIFEST.json` for inspection.
**Always review the archive before sharing**: embedded credentials in ordinary
source files cannot be detected reliably by the exporter.

## Tooling maintenance

- Keep `pnpm-lock.yaml` under version control and update it using pnpm,
  not by editing it by hand.
- Do not duplicate independent copies of root Prettier config.
- Git hooks are local safeguards; CI checks are the authoritative gate.
- Run `pnpm --filter @repo/eslint-config remove eslint-plugin-only-warn`
  when updating the lockfile; this plugin is no longer referenced by config.
