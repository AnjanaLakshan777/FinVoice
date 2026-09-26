# FinVoice

FinVoice is a voice-first financial inclusion and financial literacy platform for Sri Lankan users. People will be able to talk to FinVoice in **Sinhala, Tamil or English**, both in the browser and over an ordinary **telephone call**, to get clear and trustworthy help with everyday financial questions.

## Current status

**Step 5: financial knowledge base.** This repository has:

- a pnpm monorepo with strict TypeScript, ESLint, Prettier, Vitest and CI;
- a placeholder **web app** (Next.js);
- a **backend API** (NestJS) with a validated REST API for users, financial profiles and financial goals under `/api/v1`, plus liveness (`GET /health`) and database readiness (`GET /health/ready`) checks;
- a framework-independent **financial calculation engine** (loan repayment, savings plan, budget summary) with exact decimal arithmetic, exposed under `/api/v1/calculations`;
- a curated, source-backed **financial knowledge base** (12 articles based on Central Bank of Sri Lanka material, in English with some Sinhala and Tamil) with read-only retrieval under `/api/v1/knowledge`;
- a **PostgreSQL 18** schema managed by **Prisma migrations**: users, financial profiles and goals, and knowledge sources, articles and translations;
- a **voice gateway** service (Node.js) with `GET /health`;
- shared `shared`, `contracts`, `config` and `finance-engine` packages.

There is no authentication yet, and no AI or voice integration or telephony. The target architecture is described in [docs/architecture/system-overview.md](docs/architecture/system-overview.md), the database design in [docs/architecture/database.md](docs/architecture/database.md), the calculation engine in [docs/architecture/financial-calculation-engine.md](docs/architecture/financial-calculation-engine.md), the knowledge base in [docs/architecture/financial-knowledge-base.md](docs/architecture/financial-knowledge-base.md) and the API in [docs/api/domain-api.md](docs/api/domain-api.md).

## Repository structure

```text
finvoice/
├── apps/
│   ├── web/              Next.js web application            → http://localhost:3000
│   ├── api/              NestJS backend API                 → http://127.0.0.1:4000
│   │   └── prisma/       Database schema, migrations and development seed
│   └── voice-gateway/    Node.js real-time voice service    → http://127.0.0.1:4100
├── packages/
│   ├── shared/           Framework-agnostic shared types (e.g. ServiceHealth)
│   ├── contracts/        API request schemas and response types (shared by API and clients)
│   ├── finance-engine/   Deterministic financial calculations (exact decimals, no framework)
│   └── config/           Validated environment configuration for each service
├── infrastructure/
│   ├── docker/           Container build files (future)
│   └── postgres/         Database infrastructure notes
├── docs/
│   ├── architecture/     System architecture and database design
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
- **Docker** with Docker Compose v2, for PostgreSQL and the database integration tests

## Getting started

### 1. Install dependencies

```sh
corepack enable
pnpm install          # also generates the Prisma client
```

### 2. Create your local environment file

```sh
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

Edit `.env` and replace the placeholder values. Set `POSTGRES_PASSWORD`, and use the same password in `DATABASE_URL`. `.env` is git-ignored. Never commit it.

### 3. Start PostgreSQL

```sh
pnpm db:up        # docker compose up --detach --wait postgres
```

This waits until the container's health check passes. PostgreSQL is then available on `127.0.0.1:5432`, or on `POSTGRES_PORT` if you set it.

> **Port 5432 already in use?** If another PostgreSQL (for example a Windows installation) is running on this machine, set another port in **your** `.env`: `POSTGRES_PORT=5433`, and use the same port in `DATABASE_URL` (`…@localhost:5433/finvoice`). `.env` is machine-specific; the project default stays 5432.

Related commands:

```sh
pnpm db:logs                    # follow PostgreSQL logs
pnpm db:down                    # stop the container (data is kept)
docker compose down --volumes   # stop and delete all local data
```

### 4. Apply database migrations

```sh
pnpm db:migrate          # prisma migrate deploy: applies pending migrations
pnpm db:seed:knowledge   # loads the curated knowledge base (insert-only, safe to repeat)
pnpm db:seed             # optional: loads fake demo users and goals (local databases only)
```

## Running the applications

Each command below builds the shared packages first when needed. In development, the API and the voice gateway read the root `.env`. The API requires `DATABASE_URL`. Other variables have local defaults.

| Application   | Command                  | URL                          |
| ------------- | ------------------------ | ---------------------------- |
| Web app       | `pnpm dev:web`           | http://localhost:3000        |
| Backend API   | `pnpm dev:api`           | http://127.0.0.1:4000/health |
| Voice gateway | `pnpm dev:voice-gateway` | http://127.0.0.1:4100/health |
| All three     | `pnpm dev`               | as above                     |

To confirm the API can reach PostgreSQL, open http://127.0.0.1:4000/health/ready. It returns `200` with `"database": "up"`, or `503` if the database is unreachable.

### Trying the API

With `pnpm dev:api` running and migrations applied, the domain API is at `http://127.0.0.1:4000/api/v1`. For example, in PowerShell:

```powershell
$api = "http://127.0.0.1:4000/api/v1"
$user = Invoke-RestMethod -Method Post "$api/users" -ContentType "application/json" `
  -Body '{"phoneNumber":"+94000000901","preferredLanguage":"SI","displayName":"Demo"}'
Invoke-RestMethod -Method Put "$api/users/$($user.id)/financial-profile" -ContentType "application/json" `
  -Body '{"monthlyIncome":"150000.00","monthlyExpenses":"100000.00"}'
Invoke-RestMethod -Method Post "$api/users/$($user.id)/goals" -ContentType "application/json" `
  -Body '{"type":"EMERGENCY_FUND","name":"Emergency Fund","targetAmount":"300000.00","targetDate":"2027-06-30"}'
Invoke-RestMethod "$api/users/$($user.id)/goals?status=ACTIVE"
```

Calculations need no stored data:

```powershell
Invoke-RestMethod -Method Post "$api/calculations/loan" -ContentType "application/json" `
  -Body '{"principal":"500000.00","annualInterestRate":"12.00","termMonths":36}'
# monthlyPayment 16607.15 (×35), finalPayment 16607.33, totalRepayment 597857.58, totalInterest 97857.58
```

Money is always sent as a string (`"150000.00"`), never as a number. See [docs/api/domain-api.md](docs/api/domain-api.md) for every endpoint, rule and error, and for curl examples.

All dev servers reload on change. To run the production builds instead:

```sh
pnpm build
pnpm --filter @finvoice/web start
pnpm --filter @finvoice/api start
pnpm --filter @finvoice/voice-gateway start
```

## Database

The schema lives in [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma), and every change to it ships as a SQL migration in `apps/api/prisma/migrations/`. The schema is never synchronised automatically; see [docs/architecture/database.md](docs/architecture/database.md) for the design and the reasons.

| Task                                        | Command                                   |
| ------------------------------------------- | ----------------------------------------- |
| Apply pending migrations                    | `pnpm db:migrate`                         |
| Show migration status                       | `pnpm db:migrate:status`                  |
| Create a migration after editing the schema | `pnpm db:migrate:create --name <change>`  |
| Load the curated knowledge base             | `pnpm db:seed:knowledge`                  |
| Load the fake development seed data         | `pnpm db:seed`                            |
| Regenerate the Prisma client                | `pnpm --filter @finvoice/api db:generate` |

- `db:migrate` runs `prisma migrate deploy`. It only applies committed migrations, and it is the same command used in CI and production.
- `db:migrate:create` writes the SQL for your schema change **without applying it**. Review it, add any CHECK constraints, then run `pnpm db:migrate`.
- `db:migrate:status` lists applied and pending migrations and exits non-zero if the database is behind.
- Never edit a migration that has been applied anywhere, and never run `prisma migrate reset` or `prisma db push` against a shared database.
- `db:seed:knowledge` inserts only missing knowledge records and never updates or deletes existing ones, so it is safe to repeat and never overwrites edited content. With `NODE_ENV=production` it needs `--allow-production`.
- `db:seed` is deterministic, uses fake phone numbers, and refuses to run when `NODE_ENV=production` or the database is not local.

## Tests and quality checks

| Task                                      | Command                 |
| ----------------------------------------- | ----------------------- |
| Unit tests (no Docker needed)             | `pnpm test`             |
| Database integration tests (needs Docker) | `pnpm test:integration` |
| Lint                                      | `pnpm lint`             |
| Lint and auto-fix                         | `pnpm lint:fix`         |
| Type-check every project                  | `pnpm typecheck`        |
| Check formatting                          | `pnpm format:check`     |
| Format all files                          | `pnpm format`           |
| Build all apps and packages               | `pnpm build`            |
| Remove build output                       | `pnpm clean`            |

**Database integration tests** (`apps/api/test/integration`) need a running Docker engine, but **not** your development database, which they never touch:

1. They start a disposable PostgreSQL container, with the same image and ICU settings as `docker-compose.yml`, using [Testcontainers](https://testcontainers.com/).
2. They apply every migration with `prisma migrate deploy`.
3. They check the constraints, indexes, relationships and migration state, and exercise every `/api/v1` endpoint over HTTP against that database.
4. They remove the container.

The first run downloads the PostgreSQL image.

To run a command in one project only, use a filter, for example `pnpm --filter @finvoice/api test`.

CI (`.github/workflows/ci.yml`) runs on every pull request and on every push to `main`. It checks formatting, lint and types, runs the unit and database integration tests and the build, and validates the Docker Compose file.

## Configuration

Environment variables are documented in [.env.example](.env.example) and validated at startup by [`packages/config`](packages/config). A service with invalid configuration refuses to start and lists every problem, without echoing secret values. Secrets must come from the environment and must never be committed to the repository.

## Documentation

- [System overview](docs/architecture/system-overview.md): the target voice and web architecture
- [Database](docs/architecture/database.md): schema, money representation, indexing and migration strategy
- [Financial calculation engine](docs/architecture/financial-calculation-engine.md): formulas, rounding policy, and why AI never does the maths
- [Financial knowledge base](docs/architecture/financial-knowledge-base.md): sources, translations, review dates, retrieval, and why there is no RAG yet
- [API endpoints](docs/api/README.md) and the [domain API reference](docs/api/domain-api.md)
- [ADR 0001: Repository foundation](docs/decisions/0001-repository-foundation.md): why the foundation looks the way it does
