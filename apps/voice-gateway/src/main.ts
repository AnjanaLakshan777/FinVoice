import { loadVoiceGatewayConfig } from "@finvoice/config";

import { HttpVoiceBackend } from "./backend/voice-backend.js";
import { createVoiceGatewayServer, VOICE_WEBSOCKET_PATH } from "./gateway/voice-gateway-server.js";
import { VOICE_GATEWAY_SERVICE_NAME } from "./health-server.js";
import { GeminiLiveConnector } from "./live/gemini-live-connector.js";
import { createJsonLogger } from "./logger.js";

const config = loadVoiceGatewayConfig();
const logger = createJsonLogger();

if (config.gemini.apiKey === null) {
  logger.warn("gemini_api_key_not_configured");
}
if (config.internalApi.token === null) {
  logger.warn("internal_api_token_not_configured");
}

const gateway = createVoiceGatewayServer({
  allowedOrigins: config.allowedOrigins,
  maxSessions: config.maxSessions,
  backend: new HttpVoiceBackend(config.internalApi),
  connector: new GeminiLiveConnector({
    apiKey: config.gemini.apiKey,
    model: config.gemini.liveModel,
    voice: config.gemini.liveVoice,
  }),
  logger,
  // Per-turn audio metrics and the synthetic test-signal path: development only.
  diagnostics: config.nodeEnv !== "production",
});

gateway.server.listen(config.port, config.host, () => {
  console.info(
    `${VOICE_GATEWAY_SERVICE_NAME} listening on http://${config.host}:${String(config.port)} (voice WebSocket: ws://${config.host}:${String(config.port)}${VOICE_WEBSOCKET_PATH})`,
  );
});

// Every async path in the gateway handles its own errors; this is a last-resort guard that logs
// only the error class, never its message (which could contain provider details).
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    errorName: reason instanceof Error ? reason.name : "unknown",
  });
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`${VOICE_GATEWAY_SERVICE_NAME} received ${signal}, shutting down`);
  gateway.close().then(
    () => {
      process.exitCode = 0;
    },
    () => {
      process.exitCode = 1;
    },
  );
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
