import { z } from "zod";

import {
  hostSchema,
  nodeEnvSchema,
  parseEnv,
  portSchema,
  type NodeEnv,
  type RawEnv,
} from "./env.js";

const voiceGatewayEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  VOICE_GATEWAY_HOST: hostSchema.default("127.0.0.1"),
  VOICE_GATEWAY_PORT: portSchema.default(4100),
});

export type VoiceGatewayConfig = {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
};

export function loadVoiceGatewayConfig(env: RawEnv = process.env): VoiceGatewayConfig {
  const parsed = parseEnv(voiceGatewayEnvSchema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.VOICE_GATEWAY_HOST,
    port: parsed.VOICE_GATEWAY_PORT,
  };
}
