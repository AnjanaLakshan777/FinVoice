import { createServer, type Server, type ServerResponse } from "node:http";

import type { ServiceHealth } from "@finvoice/shared";

export const VOICE_GATEWAY_SERVICE_NAME = "finvoice-voice-gateway";

/**
 * Minimal HTTP server exposing `GET /health` for liveness probes.
 * Real-time audio transport is added in a later step and is not served here.
 */
export function createHealthServer(): Server {
  return createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && pathname === "/health") {
      const health: ServiceHealth = { status: "ok", service: VOICE_GATEWAY_SERVICE_NAME };
      sendJson(response, 200, health);
      return;
    }

    sendJson(response, 404, { error: "Not Found" });
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
