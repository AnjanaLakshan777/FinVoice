# API documentation

HTTP interfaces exposed by FinVoice services. Endpoints are documented here when they are implemented; their request and response types live in `packages/contracts`.

## Backend API (`apps/api`)

Default local base URL: `http://127.0.0.1:4000`

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
