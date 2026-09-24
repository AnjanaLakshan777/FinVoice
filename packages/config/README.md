# @finvoice/config

Central place for reading and validating environment configuration.

- Each service has its own loader (`loadApiConfig`, `loadVoiceGatewayConfig`) that validates `process.env` with [zod](https://zod.dev) and returns a typed, camelCase config object.
- Invalid configuration throws `ConfigValidationError` at startup, listing every problem at once.
- Only non-secret values may have defaults. Secrets (database credentials, API keys) must be required and supplied through the environment, never committed. See `.env.example` at the repository root for the variable names.
