# API documentation

HTTP interfaces exposed by FinVoice services. Endpoints are documented when they are implemented; their request schemas and response types live in `packages/contracts`.

## Backend API (`apps/api`)

Default local base URL: `http://127.0.0.1:4000`

### Domain API: `/api/v1`

Users, financial profiles, financial goals, financial calculations and financial-literacy knowledge: endpoints, validation rules, money and date formats, pagination and the error format are documented in **[domain-api.md](domain-api.md)**.

| Method  | Path                                      |
| ------- | ----------------------------------------- |
| `POST`  | `/api/v1/users`                           |
| `GET`   | `/api/v1/users/:userId`                   |
| `PATCH` | `/api/v1/users/:userId`                   |
| `GET`   | `/api/v1/users/:userId/financial-profile` |
| `PUT`   | `/api/v1/users/:userId/financial-profile` |
| `POST`  | `/api/v1/users/:userId/goals`             |
| `GET`   | `/api/v1/users/:userId/goals`             |
| `GET`   | `/api/v1/users/:userId/goals/:goalId`     |
| `PATCH` | `/api/v1/users/:userId/goals/:goalId`     |
| `POST`  | `/api/v1/calculations/loan`               |
| `POST`  | `/api/v1/calculations/savings`            |
| `POST`  | `/api/v1/calculations/budget`             |
| `GET`   | `/api/v1/knowledge/categories`            |
| `GET`   | `/api/v1/knowledge/articles`              |
| `GET`   | `/api/v1/knowledge/articles/:slug`        |

Health checks are not versioned and stay at the root, for load balancers and orchestrators.

### `GET /health`

Liveness check: the process is up. It does not check dependencies. Returns `200 OK`:

```json
{
  "status": "ok",
  "service": "finvoice-api"
}
```

### `GET /health/ready`

Readiness check: the API can reach PostgreSQL. Returns `200 OK`:

```json
{
  "status": "ok",
  "service": "finvoice-api",
  "checks": { "database": "up" }
}
```

If the database is unreachable, it returns `503 Service Unavailable` with `"status": "error"` and `"database": "down"`. Failure details are logged by the API (error class and code only) and are never included in the response.

## Voice gateway (`apps/voice-gateway`)

Default local base URL: `http://127.0.0.1:4100`

### `GET /health`

Liveness check. Returns `200 OK`:

```json
{
  "status": "ok",
  "service": "finvoice-voice-gateway"
}
```

Any other path returns `404 Not Found`.

Health responses match the `ServiceHealth` type, and readiness responses match the `ServiceReadiness` type, both in `packages/shared`.
