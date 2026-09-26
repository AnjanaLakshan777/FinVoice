import { z } from "zod";

import { databaseEnvSchema } from "./database.js";
import { hostSchema, parseEnv, portSchema, type NodeEnv, type RawEnv } from "./env.js";

/** Default Gemini model; override with GEMINI_MODEL. The only place the default is defined. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

const apiEnvSchema = databaseEnvSchema.extend({
  API_HOST: hostSchema.default("127.0.0.1"),
  API_PORT: portSchema.default(4000),
  /**
   * Optional so the API can start without it (for example in local development and tests); the
   * AI agent then answers 503. Empty means "not set". Never logged or echoed in errors.
   */
  GEMINI_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value)),
  GEMINI_MODEL: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{0,99}$/, {
      error: 'Must be a Gemini model name, e.g. "gemini-3.8-flash"',
    })
    .default(DEFAULT_GEMINI_MODEL),
});

/** Contains credentials (`database.url`, `gemini.apiKey`): never log or serialize this object. */
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
};

export function loadApiConfig(env: RawEnv = process.env): ApiConfig {
  const parsed = parseEnv(apiEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    database: { url: parsed.DATABASE_URL },
    gemini: { apiKey: parsed.GEMINI_API_KEY, model: parsed.GEMINI_MODEL },
  };
}
