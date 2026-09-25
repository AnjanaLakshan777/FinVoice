import { z } from "zod";

import { databaseUrlSchema, nodeEnvSchema, parseEnv, type NodeEnv, type RawEnv } from "./env.js";

export const databaseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: databaseUrlSchema,
});

/** Contains credentials: never log or serialize this object. */
export type DatabaseConfig = {
  nodeEnv: NodeEnv;
  url: string;
};

/** Database settings for tooling that needs only the database (e.g. the seed script). */
export function loadDatabaseConfig(env: RawEnv = process.env): DatabaseConfig {
  const parsed = parseEnv(databaseEnvSchema, env);
  return { nodeEnv: parsed.NODE_ENV, url: parsed.DATABASE_URL };
}
