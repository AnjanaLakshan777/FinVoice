import { databaseEnvSchema } from "./database.js";
import {
  geminiModelSchema,
  hostSchema,
  internalApiTokenSchema,
  optionalSecretSchema,
  parseEnv,
  portSchema,
  type NodeEnv,
  type RawEnv,
} from "./env.js";

/** Default Gemini model; override with GEMINI_MODEL. The only place the default is defined. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

const apiEnvSchema = databaseEnvSchema.extend({
  API_HOST: hostSchema.default("127.0.0.1"),
  API_PORT: portSchema.default(4000),
  /**
   * Optional so the API can start without it (for example in local development and tests); the
   * AI agent then answers 503. Empty means "not set". Never logged or echoed in errors.
   */
  GEMINI_API_KEY: optionalSecretSchema,
  GEMINI_MODEL: geminiModelSchema.default(DEFAULT_GEMINI_MODEL),
  /**
   * Shared secret the voice gateway sends to the internal voice endpoints. Optional: without it
   * those endpoints answer 503 and the rest of the API is unaffected.
   */
  INTERNAL_API_TOKEN: internalApiTokenSchema,
});

/**
 * Contains credentials (`database.url`, `gemini.apiKey`, `internal.token`): never log or
 * serialize this object.
 */
export type ApiConfig = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  database: {
    url: string;
  };
  gemini: {
    /** Null when GEMINI_API_KEY is not set: the agent endpoint then reports 503. */
    apiKey: string | null;
    model: string;
  };
  internal: {
    /** Null when INTERNAL_API_TOKEN is not set: the internal endpoints then report 503. */
    token: string | null;
  };
};

export function loadApiConfig(env: RawEnv = process.env): ApiConfig {
  const parsed = parseEnv(apiEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    database: { url: parsed.DATABASE_URL },
    gemini: { apiKey: parsed.GEMINI_API_KEY, model: parsed.GEMINI_MODEL },
    internal: { token: parsed.INTERNAL_API_TOKEN },
  };
}
