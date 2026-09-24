# @finvoice/contracts

The single source of truth for the shapes of data that cross a service boundary:

- request/response bodies of the backend API (`apps/api`), consumed by the web app and the voice gateway;
- definitions of tools the voice agent can call (added in a later step).

This package is intentionally empty in Step 1. No speculative business models are defined here.

## Conventions

- Add a contract only when the endpoint or tool that uses it is implemented.
- Group contracts by domain in their own module (for example `src/<domain>.ts`) and re-export them from `src/index.ts`.
- Contracts describe the wire format only. Keep persistence models and business logic out of this package.
- Treat exported contracts as a public API: prefer additive changes and document breaking changes in `docs/decisions/`.
