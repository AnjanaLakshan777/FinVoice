# @finvoice/contracts

The single source of truth for the shapes of data that cross a service boundary:

- request/response bodies of the backend API (`apps/api`), consumed by the web app and the voice gateway;
- the input contracts of the agent's tools, used by the text agent and by voice;
- the browser voice WebSocket protocol and the internal voice endpoints.

## Contents

| Module                      | Contents                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/common.ts`             | Money, currency, calendar date, UUID and pagination schemas; the paginated and error response types |
| `src/users.ts`              | User request schemas and `UserResponse`                                                             |
| `src/financial-profiles.ts` | Financial profile request schema and `FinancialProfileResponse`                                     |
| `src/financial-goals.ts`    | Financial goal request/query schemas and `FinancialGoalResponse`                                    |
| `src/calculations.ts`       | Loan, savings and budget calculation request schemas and response types                             |
| `src/knowledge.ts`          | Knowledge query schemas and article, source, search and category response types                     |
| `src/agent.ts`              | Agent chat request/response and the input contracts of the agent's tools                            |
| `src/voice.ts`              | Browser voice WebSocket messages, audio format constants, internal voice endpoint contracts         |

Request schemas are [zod](https://zod.dev) schemas. zod implements [Standard Schema](https://standardschema.dev), which NestJS uses to validate requests (`@Body({ schema })`). The same schemas can validate data on the client side before a request is sent, but the API always validates again: client-side checks are a convenience, never a guarantee.

Each request schema exports two types: `…Request` (what a client sends, `z.input`) and `…Command` (what the API receives after parsing, `z.output`; for example with trimmed strings).

The full API reference is [docs/api/domain-api.md](../../docs/api/domain-api.md).

## Conventions

- Add a contract only when the endpoint or tool that uses it is implemented.
- Group contracts by domain in their own module (for example `src/<domain>.ts`) and re-export them from `src/index.ts`.
- Contracts describe the wire format only. Keep persistence models and business logic out of this package. Rules that need stored data (for example "current amount must not exceed the stored target") belong in the API services.
- Request objects are strict: unknown properties are rejected.
- ScamShield codes, risk levels and the content limit are defined once, in `@finvoice/scam-shield`, and imported by `scamShieldAnalyzeRequestSchema`.
- Money is always a decimal string, never a number. The money format and calculation limits are defined once, in `@finvoice/finance-engine`, and imported here, so they are not duplicated.
- Calculation requests carry inputs only. Result fields (`monthlyPayment`, `savingsRate`, …) are rejected, so a client can never supply a figure the server should calculate.
- Treat exported contracts as a public API: prefer additive changes and document breaking changes in `docs/decisions/`.
