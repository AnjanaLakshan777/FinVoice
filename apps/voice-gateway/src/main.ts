import { loadVoiceGatewayConfig } from "@finvoice/config";

import { createHealthServer, VOICE_GATEWAY_SERVICE_NAME } from "./health-server.js";

const config = loadVoiceGatewayConfig();
const server = createHealthServer();

server.listen(config.port, config.host, () => {
  console.info(
    `${VOICE_GATEWAY_SERVICE_NAME} listening on http://${config.host}:${String(config.port)}`,
  );
});

function shutdown(signal: NodeJS.Signals): void {
  console.info(`${VOICE_GATEWAY_SERVICE_NAME} received ${signal}, shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
