# API documentation

HTTP interfaces exposed by FinVoice services. Endpoints are documented when they are implemented; their request schemas and response types live in `packages/contracts`.

## Backend API (`apps/api`)

Default local base URL: `http://127.0.0.1:4000`

### Domain API: `/api/v1`

Users, financial profiles, financial goals, financial calculations, financial-literacy knowledge, the AI agent and ScamShield: endpoints, validation rules, money and date formats, pagination and the error format are documented in **[domain-api.md](domain-api.md)**.

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
| `POST`  | `/api/v1/agent/chat`                      |
| `POST`  | `/api/v1/scamshield/analyze`              |

Health checks are not versioned and stay at the root, for load balancers and orchestrators.

The token-protected internal endpoints used by the voice gateway (`/internal/voice/session-setup`, `/internal/voice/tools/execute`) are documented in [domain-api.md](domain-api.md#internal-voice-endpoints-not-part-of-apiv1).

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

Any other path returns `404 Not Found`. It does not depend on Gemini or the API.

### WebSocket `/voice`

The browser voice connection (`ws://127.0.0.1:4100/voice`). The handshake is accepted only from an Origin listed in `VOICE_WEB_ORIGIN` (otherwise `403`); other paths get `404`. The JSON message protocol, audio formats, error codes and limits are documented in [browser-voice.md](../architecture/browser-voice.md#4-websocket-protocol).

Health responses match the `ServiceHealth` type, and readiness responses match the `ServiceReadiness` type, both in `packages/shared`.
