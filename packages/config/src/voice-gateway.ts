import { z } from "zod";

import {
  geminiModelSchema,
  hostSchema,
  httpUrlSchema,
  internalApiTokenSchema,
  nodeEnvSchema,
  optionalSecretSchema,
  parseEnv,
  portSchema,
  type NodeEnv,
  type RawEnv,
} from "./env.js";

/** Default Gemini Live model; override with GEMINI_LIVE_MODEL. */
export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.8-live";

/**
 * Default Gemini Live prebuilt voice; override with GEMINI_LIVE_VOICE. The only place the default
 * is defined.
 */
export const DEFAULT_GEMINI_LIVE_VOICE = "Kore";

/** Browser origins allowed by default: the local Next.js dev server. */
export const DEFAULT_VOICE_WEB_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

/** An exact web origin (scheme, host and optional port), such as "https://finvoice.example". */
const originSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
    },
    {
      error: 'Must be comma-separated origins such as "http://localhost:3000" ("*" is not allowed)',
    },
  );

const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
  )
  .pipe(z.array(originSchema).min(1, { error: "Must list at least one origin" }));

const voiceGatewayEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  VOICE_GATEWAY_HOST: hostSchema.default("127.0.0.1"),
  VOICE_GATEWAY_PORT: portSchema.default(4100),
  /** Browser origins allowed to open voice sessions. Never "*". */
  VOICE_WEB_ORIGIN: originListSchema.default(DEFAULT_VOICE_WEB_ORIGINS),
  /** Maximum concurrent browser voice connections. */
  VOICE_MAX_SESSIONS: z.coerce.number().int().min(1).max(1000).default(10),
  /** Optional so the gateway (and its health check) can start without it; sessions then fail. */
  GEMINI_API_KEY: optionalSecretSchema,
  GEMINI_LIVE_MODEL: geminiModelSchema.default(DEFAULT_GEMINI_LIVE_MODEL),
  /** Prebuilt voice name (speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName). */
  GEMINI_LIVE_VOICE: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z-]{1,39}$/, {
      error: 'Must be a Gemini prebuilt voice name, e.g. "Kore"',
    })
    .default(DEFAULT_GEMINI_LIVE_VOICE),
  /** Base URL of the FinVoice API, used for the internal voice endpoints. */
  INTERNAL_API_URL: httpUrlSchema.default("http://127.0.0.1:4000"),
  /** Shared secret for the internal voice endpoints; must match the API's value. */
  INTERNAL_API_TOKEN: internalApiTokenSchema,
});

/** Contains credentials (`gemini.apiKey`, `internalApi.token`): never log or serialize it. */
export type VoiceGatewayConfig = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  /** Exact browser origins allowed to connect. */
  allowedOrigins: string[];
  maxSessions: number;
  gemini: {
    /** Null when GEMINI_API_KEY is not set: sessions then fail with VOICE_CONFIG_ERROR. */
    apiKey: string | null;
    liveModel: string;
    /** Prebuilt voice FinVoice speaks with. Server-controlled; browsers cannot choose it. */
    liveVoice: string;
  };
  internalApi: {
    url: string;
    /** Null when INTERNAL_API_TOKEN is not set: sessions then fail with VOICE_CONFIG_ERROR. */
    token: string | null;
  };
};

export function loadVoiceGatewayConfig(env: RawEnv = process.env): VoiceGatewayConfig {
  const parsed = parseEnv(voiceGatewayEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.VOICE_GATEWAY_HOST,
    port: parsed.VOICE_GATEWAY_PORT,
    allowedOrigins: parsed.VOICE_WEB_ORIGIN,
    maxSessions: parsed.VOICE_MAX_SESSIONS,
    gemini: {
      apiKey: parsed.GEMINI_API_KEY,
      liveModel: parsed.GEMINI_LIVE_MODEL,
      liveVoice: parsed.GEMINI_LIVE_VOICE,
    },
    internalApi: { url: parsed.INTERNAL_API_URL, token: parsed.INTERNAL_API_TOKEN },
  };
}
