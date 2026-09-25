import { databaseEnvSchema } from "./database.js";
import { hostSchema, parseEnv, portSchema, type NodeEnv, type RawEnv } from "./env.js";

const apiEnvSchema = databaseEnvSchema.extend({
  API_HOST: hostSchema.default("127.0.0.1"),
  API_PORT: portSchema.default(4000),
});

/** Contains credentials (`database.url`): never log or serialize this object. */
export type ApiConfig = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  database: {
    url: string;
  };
};

export function loadApiConfig(env: RawEnv = process.env): ApiConfig {
  const parsed = parseEnv(apiEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    database: { url: parsed.DATABASE_URL },
  };
}
