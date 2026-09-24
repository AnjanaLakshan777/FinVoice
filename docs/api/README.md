# API documentation

HTTP interfaces exposed by FinVoice services. Endpoints are documented here when they are implemented; their request and response types live in `packages/contracts`.

## Backend API (`apps/api`)

Default local base URL: `http://127.0.0.1:4000`

### `GET /health`

Liveness check. Returns `200 OK`:

```json
{
  "status": "ok",
  "service": "finvoice-api"
}
```

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

Both health responses match the `ServiceHealth` type in `packages/shared`.
