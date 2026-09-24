import { z } from "zod";

import {
  hostSchema,
  nodeEnvSchema,
  parseEnv,
  portSchema,
  type NodeEnv,
  type RawEnv,
} from "./env.js";

const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  API_HOST: hostSchema.default("127.0.0.1"),
  API_PORT: portSchema.default(4000),
});

export type ApiConfig = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
};

export function loadApiConfig(env: RawEnv = process.env): ApiConfig {
  const parsed = parseEnv(apiEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
  };
}
