# FinVoice

FinVoice is a voice-first financial inclusion and financial literacy platform for Sri Lankan users. People will be able to talk to FinVoice in **Sinhala, Tamil or English**, both in the browser and over an ordinary **telephone call**, to get clear and trustworthy help with everyday financial questions.

## Current status

**Step 1: project foundation.** This repository has:

- a pnpm monorepo with strict TypeScript, ESLint, Prettier, Vitest and CI;
- a placeholder **web app** (Next.js);
- a **backend API** (NestJS) with `GET /health`;
- a **voice gateway** service (Node.js) with `GET /health`;
- shared `shared`, `contracts` and `config` packages;
- **PostgreSQL 18** for local development through Docker Compose.

There are no product features yet: no AI or voice integration, telephony, financial logic or authentication. The target architecture is described in [docs/architecture/system-overview.md](docs/architecture/system-overview.md).

## Repository structure

```text
finvoice/
├── apps/
│   ├── web/              Next.js web application            → http://localhost:3000
│   ├── api/              NestJS backend API                 → http://127.0.0.1:4000
│   └── voice-gateway/    Node.js real-time voice service    → http://127.0.0.1:4100
├── packages/
│   ├── shared/           Framework-agnostic shared types (e.g. ServiceHealth)
│   ├── contracts/        API and voice-tool contracts (empty until endpoints exist)
│   └── config/           Validated environment configuration for each service
├── infrastructure/
│   ├── docker/           Container build files (future)
│   └── postgres/         Database infrastructure notes
├── docs/
│   ├── architecture/     System architecture
│   ├── api/              HTTP endpoint documentation
│   └── decisions/        Architecture decision records (ADRs)
├── .github/workflows/    CI pipeline
├── docker-compose.yml    Local PostgreSQL
├── .env.example          Environment variable template (placeholders only)
└── tsconfig.base.json    Shared strict TypeScript settings
```

## Prerequisites

- **Node.js 24 LTS** (see `.nvmrc`)
- **pnpm 12**: run `corepack enable` once and the version pinned in `package.json` is used automatically
- **Docker** with Docker Compose v2, for PostgreSQL

## Getting started

### 1. Install dependencies

```sh
corepack enable
pnpm install
```

### 2. Create your local environment file

```sh
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

Edit `.env` and replace the placeholder values, especially `POSTGRES_PASSWORD`. `.env` is git-ignored. Never commit it.

### 3. Start PostgreSQL

```sh
pnpm db:up        # docker compose up --detach --wait postgres
```

This waits until the container's health check passes. PostgreSQL is then available on `127.0.0.1:5432` (or `POSTGRES_PORT`). Related commands:

```sh
pnpm db:logs                    # follow PostgreSQL logs
pnpm db:down                    # stop the container (data is kept)
docker compose down --volumes   # stop and delete all local data
```

## Running the applications

Each command below builds the shared packages first when needed. The API and the voice gateway read the root `.env` in development. Without one, they use their built-in local defaults.

| Application   | Command                  | URL                          |
| ------------- | ------------------------ | ---------------------------- |
| Web app       | `pnpm dev:web`           | http://localhost:3000        |
| Backend API   | `pnpm dev:api`           | http://127.0.0.1:4000/health |
| Voice gateway | `pnpm dev:voice-gateway` | http://127.0.0.1:4100/health |
| All three     | `pnpm dev`               | as above                     |

All dev servers reload on change. To run the production builds instead:

```sh
pnpm build
pnpm --filter @finvoice/web start
pnpm --filter @finvoice/api start
pnpm --filter @finvoice/voice-gateway start
```

## Quality checks

| Task                        | Command             |
| --------------------------- | ------------------- |
| Run all tests               | `pnpm test`         |
| Lint                        | `pnpm lint`         |
| Lint and auto-fix           | `pnpm lint:fix`     |
| Type-check every project    | `pnpm typecheck`    |
| Check formatting            | `pnpm format:check` |
| Format all files            | `pnpm format`       |
| Build all apps and packages | `pnpm build`        |
| Remove build output         | `pnpm clean`        |

To run a command in one project only, use a filter, for example `pnpm --filter @finvoice/api test`.

CI (`.github/workflows/ci.yml`) runs formatting, lint, type-check, test and build, and validates the Docker Compose file, on every pull request and on every push to `main`.

## Configuration

Environment variables are documented in [.env.example](.env.example) and validated at startup by [`packages/config`](packages/config). A service with invalid configuration refuses to start and lists every problem. Secrets must come from the environment and must never be committed to the repository.

## Documentation

- [System overview](docs/architecture/system-overview.md): the target voice and web architecture
- [API endpoints](docs/api/README.md)
- [ADR 0001: Repository foundation](docs/decisions/0001-repository-foundation.md): why the foundation looks the way it does
