# @finvoice/contracts

The single source of truth for the shapes of data that cross a service boundary:

- request/response bodies of the backend API (`apps/api`), consumed by the web app and the voice gateway;
- definitions of tools the voice agent can call (added in a later step).

## Contents

| Module                      | Contents                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/common.ts`             | Money, currency, calendar date, UUID and pagination schemas; the paginated and error response types |
| `src/users.ts`              | User request schemas and `UserResponse`                                                             |
| `src/financial-profiles.ts` | Financial profile request schema and `FinancialProfileResponse`                                     |
| `src/financial-goals.ts`    | Financial goal request/query schemas and `FinancialGoalResponse`                                    |

Request schemas are [zod](https://zod.dev) schemas. zod implements [Standard Schema](https://standardschema.dev), which NestJS uses to validate requests (`@Body({ schema })`). The same schemas can validate data on the client side before a request is sent, but the API always validates again: client-side checks are a convenience, never a guarantee.

Each request schema exports two types: `…Request` (what a client sends, `z.input`) and `…Command` (what the API receives after parsing, `z.output`; for example with trimmed strings).

The full API reference is [docs/api/domain-api.md](../../docs/api/domain-api.md).

## Conventions

- Add a contract only when the endpoint or tool that uses it is implemented.
- Group contracts by domain in their own module (for example `src/<domain>.ts`) and re-export them from `src/index.ts`.
- Contracts describe the wire format only. Keep persistence models and business logic out of this package. Rules that need stored data (for example "current amount must not exceed the stored target") belong in the API services.
- Request objects are strict: unknown properties are rejected.
- Money is always a decimal string, never a number.
- Treat exported contracts as a public API: prefer additive changes and document breaking changes in `docs/decisions/`.
