# Database

> **Status:** Step 2. The database foundation and the first core domain tables exist. No business APIs read or write them yet.

## Choice of database and toolkit

**PostgreSQL 18** is the primary system of record: relational integrity, strong constraints, exact `NUMERIC` arithmetic for money, ICU collations for Sinhala, Tamil and English text, and native `uuidv7()`. See [ADR 0001](../decisions/0001-repository-foundation.md) for the container setup.

**Prisma 7** is the database toolkit, used for the schema, migrations and a typed client:

- The schema (`apps/api/prisma/schema.prisma`) is the single readable description of the tables.
- `prisma migrate` produces plain, reviewable SQL migrations and tracks what has been applied.
- The generated client is fully typed and compiled into the API's own source (`src/generated/prisma`, git-ignored and regenerated on install and build).
- Prisma 7 runs queries through a **driver adapter** (`@prisma/adapter-pg` on the standard `pg` driver), so there is no separate query-engine binary at runtime.

The database belongs to the **backend API** (`apps/api`), which is the only service that connects to it (see [system overview](system-overview.md)). The schema, migrations and seed live in `apps/api/prisma/`.

### Connection

- The API reads `DATABASE_URL` through the existing `@finvoice/config` loader (`loadApiConfig`), which validates it as a `postgres://` / `postgresql://` URL. It is never hard-coded, logged or echoed in validation errors.
- `DatabaseModule` (global) provides `PrismaService`, the application's single client and `pg` connection pool. The pool closes when the application shuts down (`enableShutdownHooks`).
- Connections open lazily, with a 5 s connection timeout. The API starts even if PostgreSQL is briefly down; `GET /health/ready` reports whether the database is reachable (503 when it is not), while `GET /health` stays a pure liveness check.
- The Prisma CLI reads `DATABASE_URL` in `apps/api/prisma.config.ts`, loading the root `.env` only when the file exists. It never overrides variables that are already set.

## Entities and relationships

```text
users 1 ──── 0..1 financial_profiles      (financial_profiles.user_id UNIQUE)
users 1 ──── 0..N financial_goals
```

Both foreign keys are `ON DELETE CASCADE ON UPDATE RESTRICT`:

- A profile or goal has no meaning without its user. Deleting a user is reserved for deliberate erasure of their personal data (as Sri Lanka's Personal Data Protection Act allows), and cascading makes that erasure complete.
- In normal operation a user is deactivated (`status = INACTIVE`), not deleted.
- Primary keys never change, so updates to them are restricted.

### `users`

| Column               | Type             | Rules                                                    |
| -------------------- | ---------------- | -------------------------------------------------------- |
| `id`                 | `uuid`           | PK, default `uuidv7()`                                   |
| `phone_number`       | `varchar(16)`    | NOT NULL, UNIQUE, E.164 (`^\+[1-9][0-9]{7,14}$`)         |
| `display_name`       | `varchar(100)`   | nullable; not blank when present                         |
| `preferred_language` | `language`       | NOT NULL (`SI`, `TA`, `EN`), no default                  |
| `timezone`           | `varchar(64)`    | NOT NULL, default `Asia/Colombo` (IANA name), not blank  |
| `status`             | `user_status`    | NOT NULL, default `ACTIVE` (`ACTIVE`, `INACTIVE`)        |
| `created_at`         | `timestamptz(3)` | NOT NULL, default `now()`                                |
| `updated_at`         | `timestamptz(3)` | NOT NULL, default `now()`, set by Prisma on every update |

- A caller is identified by their phone number, so it is required and unique. Numbers are stored normalised to E.164, and normalisation is the application's job. The database only enforces the format.
- The display name is optional: callers may not give one.
- There is no default preferred language. The code that creates a user must choose one explicitly (for example from the language the caller selected), rather than silently falling back.
- No external identifier yet. Nothing outside FinVoice identifies users today, and adding a nullable unique column later is a non-breaking migration.
- No passwords or credentials are stored.

### `financial_profiles`

| Column             | Type             | Rules                                 |
| ------------------ | ---------------- | ------------------------------------- |
| `id`               | `uuid`           | PK, default `uuidv7()`                |
| `user_id`          | `uuid`           | NOT NULL, UNIQUE, FK → `users.id`     |
| `monthly_income`   | `numeric(14,2)`  | nullable; `>= 0`, not NaN             |
| `monthly_expenses` | `numeric(14,2)`  | nullable; `>= 0`, not NaN             |
| `currency`         | `char(3)`        | NOT NULL, default `LKR`, `^[A-Z]{3}$` |
| `created_at`       | `timestamptz(3)` | NOT NULL, default `now()`             |
| `updated_at`       | `timestamptz(3)` | NOT NULL, default `now()`             |

Monthly amounts are nullable because users give this information during conversations, often one figure at a time. `NULL` means "not provided yet", which is different from `0`.

### `financial_goals`

| Column           | Type                    | Rules                                                      |
| ---------------- | ----------------------- | ---------------------------------------------------------- |
| `id`             | `uuid`                  | PK, default `uuidv7()`                                     |
| `user_id`        | `uuid`                  | NOT NULL, FK → `users.id`                                  |
| `type`           | `financial_goal_type`   | NOT NULL                                                   |
| `name`           | `varchar(120)`          | NOT NULL, not blank                                        |
| `target_amount`  | `numeric(14,2)`         | NOT NULL, `> 0`, not NaN                                   |
| `current_amount` | `numeric(14,2)`         | NOT NULL, default `0`, `>= 0`, not NaN, `<= target_amount` |
| `currency`       | `char(3)`               | NOT NULL, default `LKR`, `^[A-Z]{3}$`                      |
| `target_date`    | `date`                  | nullable                                                   |
| `status`         | `financial_goal_status` | NOT NULL, default `ACTIVE`                                 |
| `created_at`     | `timestamptz(3)`        | NOT NULL, default `now()`                                  |
| `updated_at`     | `timestamptz(3)`        | NOT NULL, default `now()`                                  |

`currency` is an addition to the originally specified fields. An amount without a currency is ambiguous, and a goal can exist without a financial profile, so the goal must say which currency it is in. `target_date` is a calendar `date`, not a timestamp: a deadline is a day, independent of time zone.

## Identifiers: UUIDv7

All primary keys are `uuid` values generated **in the database** by PostgreSQL 18's native `uuidv7()`.

- **UUIDs rather than sequential integers:** ids don't reveal how many users exist or in what order they joined. They can be generated anywhere (for example by the voice gateway, later) without coordination, and they are safe to expose in URLs and logs.
- **Version 7 rather than random v4:** v7 UUIDs start with a timestamp, so new rows are appended to the end of the primary-key B-tree instead of scattered across it. That keeps index pages dense and inserts fast as tables grow, while the ids stay unguessable enough for identifiers. They are not secrets and must not be used as access tokens.
- **Database default rather than application-generated:** every writer (Prisma, raw SQL, `psql`, future services) gets the same behaviour.

## Money

**Decision:** money is stored as `NUMERIC(14,2)` together with an ISO 4217 `currency` column, and handled in TypeScript as `Prisma.Decimal` (decimal.js). Floating-point types (`real`, `double precision`, JS `number` arithmetic) are never used for money.

- **Why `NUMERIC`:** it is exact decimal arithmetic. `0.1 + 0.2` is exactly `0.3`, which binary floating point cannot represent. Future calculations such as budgets, interest and repayment schedules can be done exactly in SQL or with `Decimal` in TypeScript.
- **Why scale 2:** the Sri Lankan rupee (LKR, the default and expected currency) has 2 minor units (cents). All stored values are whole cents.
- **Why precision 14:** this allows up to 999,999,999,999.99, about one trillion. That is far beyond any individual's income, expenses or goal, while keeping values bounded. Larger values are rejected with a numeric overflow error (Prisma `P2020`).
- **Why not integer minor units (`BIGINT` cents):** that is also exact, but every read and write needs manual scaling, JSON has no 64-bit integer, and interest or percentage calculations still need decimal arithmetic. `NUMERIC` keeps the stored value, the API value and the spoken value identical.
- **Rounding:** PostgreSQL silently rounds values with more than 2 decimal places to the column's scale (half away from zero). The database cannot detect this, so **the application must reject amounts with more than 2 decimal places** before writing them, once write APIs exist.
- **Sign rules** are enforced by CHECK constraints (see below). They also reject `NaN`: PostgreSQL `NUMERIC` accepts `'NaN'` and orders it above every number, so `>= 0` alone would let it through.
- **Other currencies:** the column is ready for them, but scale 2 matches LKR and most currencies. Supporting a currency with a different number of minor units (for example 3 or 0) would need a deliberate migration and a per-currency validation rule.
- **In API payloads** (future), amounts should be sent as decimal **strings** (`"150000.00"`), never as JSON numbers.

## Enumerations

Enumerations are native PostgreSQL enum types, with the same names in TypeScript:

| PostgreSQL type         | Values                                                 |
| ----------------------- | ------------------------------------------------------ |
| `language`              | `SI` (Sinhala), `TA` (Tamil), `EN` (English)           |
| `user_status`           | `ACTIVE`, `INACTIVE`                                   |
| `financial_goal_type`   | `SAVINGS`, `EMERGENCY_FUND`, `DEBT_REPAYMENT`, `OTHER` |
| `financial_goal_status` | `ACTIVE`, `COMPLETED`, `CANCELLED`                     |

Adding a value is a cheap, non-blocking migration (`ALTER TYPE … ADD VALUE`). Removing or renaming one needs a data migration, so new values should be added only when they are really needed. The language codes are FinVoice's own uppercase codes, which map to ISO 639-1 `si`, `ta` and `en`.

## Constraints

Prisma's schema language cannot express CHECK constraints, so they are written by hand at the end of the migration SQL and listed in comments in `schema.prisma`. The integration tests assert that every one of them exists.

| Constraint                                               | Rule                              |
| -------------------------------------------------------- | --------------------------------- |
| `users_phone_number_e164_check`                          | E.164 format                      |
| `users_display_name_not_blank_check`                     | `NULL` or not blank               |
| `users_timezone_not_blank_check`                         | not blank                         |
| `financial_profiles_currency_iso4217_check`              | three uppercase letters           |
| `financial_profiles_monthly_income_non_negative_check`   | `NULL` or `>= 0` (not NaN)        |
| `financial_profiles_monthly_expenses_non_negative_check` | `NULL` or `>= 0` (not NaN)        |
| `financial_goals_name_not_blank_check`                   | not blank                         |
| `financial_goals_currency_iso4217_check`                 | three uppercase letters           |
| `financial_goals_target_amount_positive_check`           | `> 0` (not NaN)                   |
| `financial_goals_current_amount_non_negative_check`      | `>= 0` (not NaN)                  |
| `financial_goals_current_amount_within_target_check`     | `current_amount <= target_amount` |

The database is the last line of defence, not the only one. Future write APIs will validate the same rules first, so users get friendly errors instead of constraint violations.

## Indexing strategy

Every index has a named query behind it. Indexes are not added speculatively: each one costs write time and storage.

| Index                                            | Columns                        | Serves                                                                                                                                              |
| ------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users_pkey`                                     | `id`                           | Lookup by id                                                                                                                                        |
| `users_phone_number_key` (unique)                | `phone_number`                 | **Identify a caller by phone number**, the main lookup for incoming calls. The unique index also enforces uniqueness, so no second index is needed. |
| `financial_profiles_user_id_key` (unique)        | `user_id`                      | Load a user's profile; enforces one profile per user; indexes the FK                                                                                |
| `financial_goals_user_id_status_target_date_idx` | `user_id, status, target_date` | **A user's goals** (leftmost column; also serves the FK for cascading deletes), **a user's goals with a given status**, sorted by target date       |
| `financial_goals_status_target_date_idx`         | `status, target_date`          | **Active goals due soon, across all users** (for example reminders and follow-ups)                                                                  |

The requirement for indexes on `financial_goals.user_id`, `status` and `target_date` is met by these two composite indexes rather than three single-column ones:

- A separate `user_id` index would duplicate the leftmost column of the first composite index.
- A stand-alone `status` index has very low selectivity (three values), so PostgreSQL would rarely use it.
- A stand-alone `target_date` index serves no query that is not better served, filtered by status, by the second composite index.

Revisit these indexes when real query patterns exist (`pg_stat_user_indexes`, `EXPLAIN ANALYZE`).

## Migration strategy

- **Every schema change is a migration.** Migrations are SQL files in `apps/api/prisma/migrations/`, reviewed and committed with the code that needs them, and applied in order. The `_prisma_migrations` table records what has been applied.
- **The same command applies migrations everywhere**: `prisma migrate deploy` (`pnpm db:migrate`), locally, in CI, in the integration tests and in production. It only applies committed, pending migrations. It never generates SQL, never resets and never prompts.
- **Creating a migration** is a development-only step. Change `schema.prisma`, then run `pnpm db:migrate:create --name <change>`. That generates the SQL without applying it, so it can be reviewed and extended (for example with CHECK constraints) before `pnpm db:migrate` applies it.
- **Applied migrations are immutable.** Fix mistakes with a new migration. Never edit or delete one that has run anywhere, because Prisma detects the checksum change.
- **Deploy expand, then contract.** Prefer additive changes: add a nullable column, backfill it, then enforce it. Old and new application versions can then run during a rollout, and rollback does not need a destructive down-migration.
- **Destructive commands are for disposable databases only.** `prisma migrate reset` and `prisma db push` must never be run against a shared or production database. The project's scripts never call them.
- The integration tests apply all migrations to a fresh PostgreSQL 18 container. They then check that `prisma migrate status` reports up to date, and that `prisma migrate diff` finds no drift between the migrated database and `schema.prisma`.

### Why there is no automatic schema synchronisation

Tools that make the database match the model at startup (`synchronize: true`, `prisma db push`) are not used, in any environment:

- **Data safety:** they infer changes. A renamed column looks like "drop column + add column", and the data is lost.
- **Reviewability and audit:** a migration is a file that gets code review and appears in history. Synchronisation leaves no record of what ran against the database.
- **Deployment control:** migrations run once, as a deliberate deployment step, not implicitly on every application start, where several instances could race each other.
- **Same path everywhere:** development uses the same migrations as production, so problems appear on a laptop, not during a release.
- **Hand-written constraints:** CHECK constraints (and, later, functions and partial indexes) exist only in migration SQL. A sync tool would ignore them or remove them.

## Development seed

`pnpm db:seed` loads a small, deterministic set of demo data from `apps/api/prisma/seed.ts`: three users, one per language, plus profiles and goals.

- **Fake phone numbers only:** `+9400000000x`. Sri Lanka's numbering plan never assigns a `0` after `+94`, so these numbers cannot belong to a real person.
- **Deterministic:** fixed ids and upserts. Running it again restores the same records and leaves other data alone.
- **Local only:** it refuses to run when `NODE_ENV=production` or when `DATABASE_URL` does not point at `localhost`, `127.0.0.1` or `::1`.
- **Never automatic:** no migration or deployment command runs it.
