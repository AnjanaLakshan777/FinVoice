# ADR 0001: Repository foundation

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

FinVoice needs a web application, a backend API and a real-time voice gateway that share types, contracts and configuration. Step 1 sets up the foundation only, with no product features.

## Decisions

### Monorepo with pnpm workspaces

All applications and shared packages live in one repository (`apps/*`, `packages/*`), so cross-service changes are atomic and shared code has one version. pnpm's strict `node_modules` layout stops packages from importing dependencies they have not declared.

- `packageManager` pins the pnpm version (used by Corepack and CI).
- `engineStrict: true` together with `engines.node` enforces Node.js 24 LTS.
- pnpm's defaults stay on: dependency install scripts are blocked unless listed in `allowBuilds` (both current entries are denied because prebuilt binaries are used), and the minimum release age policy rejects packages published only hours ago. Where the newest version failed that check, an earlier patch release was chosen (for example `@nestjs/cli` 12.0.5) rather than adding an exclusion.
- Dependency versions are pinned exactly. Upgrades are deliberate changes.

### TypeScript 6.0, strict, native ES modules

- One `tsconfig.base.json` sets strict options for every project, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.
- Every package is ESM (`"type": "module"`, `NodeNext` resolution). NestJS 12 ships only as ESM, so this is required, not a style choice.
- We use TypeScript 6.0 rather than 7.x because `typescript-eslint` supports only `<6.1` and `@nestjs/cli` pins `~6.0`.

### Internal packages are compiled

`packages/*` compile with `tsc` to `dist/`, and their `exports` point at the compiled output. The Node.js services can then run their build output with plain `node`, with no runtime TypeScript loader in production. Root scripts (`dev`, `typecheck`, `lint`, `test`) build the packages first. `pnpm -r build` builds in dependency order.

### NestJS for the API; plain Node.js for the voice gateway

The API gets NestJS's structure: modules, dependency injection and testing utilities. The voice gateway will be a latency-sensitive streaming service built around raw TCP (AudioSocket) and model streaming. For now it only needs a health endpoint, so it uses `node:http` and no framework. That keeps it small and fully separate from the API.

### Web: Next.js App Router

Next.js 16 with the App Router, TypeScript and React 19. The web app has error (`error.tsx`, `global-error.tsx`), loading and not-found boundaries and a placeholder homepage. No UI framework or styling system is chosen yet.

### Configuration: validated environment through `packages/config`

Each service calls a loader (`loadApiConfig`, `loadVoiceGatewayConfig`) that validates `process.env` with zod and fails at startup with a list of every problem. Only non-secret values have defaults. Services bind to `127.0.0.1` by default. Containers must set `*_HOST=0.0.0.0` explicitly, so a service is never exposed by accident.

In development, services load the root `.env` with Node's `--env-file-if-exists`. In production, the environment is provided by the platform and no `.env` file is read.

### Testing: Vitest

Vitest runs the tests in `packages/config`, `apps/api` and `apps/voice-gateway`. The API health test boots the real Nest application on an ephemeral port and calls it with `fetch`, so no supertest dependency is needed. Vitest's default transform honours `emitDecoratorMetadata`, so NestJS constructor injection works in tests without an SWC plugin.

### Linting and formatting

- One root ESLint flat config: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` everywhere, with `eslint-config-next` (Core Web Vitals) applied to `apps/web` only. Prettier owns formatting (`eslint-config-prettier` goes last).
- ESLint stays on 9.x because `eslint-plugin-react`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` (used by `eslint-config-next`) do not support ESLint 10 yet.

### PostgreSQL 18 on Debian through Docker Compose

- Image `postgres:18.6-trixie` (Debian with glibc) instead of Alpine (musl). The database is initialised with UTF-8 and ICU root collation (`und`), so Sinhala, Tamil and English text sort correctly. Collation cannot be changed without re-initialising the database, so this is set from the start.
- The named volume is mounted at `/var/lib/postgresql`, as PostgreSQL 18+ images require.
- The port is published on `127.0.0.1` only. Credentials are required from `.env` and there is no default password.

## Consequences

- A fresh clone needs `pnpm install`. The root scripts take care of build order.
- Adding a shared package means adding a `build` script. The root `build:packages` script picks it up automatically.
- Moving to TypeScript 7 or ESLint 10 has to wait for the linting ecosystem to support them.
