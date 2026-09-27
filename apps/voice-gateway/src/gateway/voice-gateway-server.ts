import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import { VOICE_CLIENT_MESSAGE_MAX_BYTES, type VoiceServerMessage } from "@finvoice/contracts";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { VoiceBackend } from "../backend/voice-backend.js";
import { createHealthServer } from "../health-server.js";
import type { LiveConnector } from "../live/live-session.js";
import type { Logger } from "../logger.js";
import { parseTestSignalParams, streamTestSignal } from "../diagnostics/test-signal.js";
import { serializeServerMessage } from "./protocol.js";
import { VoiceSession, type VoiceSessionLimits } from "./voice-session.js";

/** Path of the browser voice WebSocket endpoint. */
export const VOICE_WEBSOCKET_PATH = "/voice";

/**
 * Above this many bytes queued for a slow browser, further speech chunks are dropped instead of
 * buffering without bound. Control messages are always sent.
 */
export const MAX_BUFFERED_AUDIO_BYTES = 2 * 1024 * 1024;

/** Development-only transport test path (see diagnostics/test-signal.ts). */
export const TEST_SIGNAL_WEBSOCKET_PATH = "/voice/test-signal";

/** WebSocket close code "try again later", used when the gateway is at capacity. */
const CLOSE_TRY_AGAIN_LATER = 1013;

export type VoiceGatewayServerOptions = {
  /** Exact browser origins allowed to open a voice WebSocket. */
  allowedOrigins: readonly string[];
  /** Maximum concurrent voice connections. */
  maxSessions: number;
  backend: VoiceBackend;
  connector: LiveConnector;
  logger: Logger;
  sessionLimits?: Partial<VoiceSessionLimits>;
  /**
   * Development diagnostics: per-turn audio metrics in the logs, and the synthetic test-signal
   * WebSocket path. Never enabled in production.
   */
  diagnostics?: boolean;
};

export type VoiceGatewayServer = {
  /** HTTP server: GET /health, plus WebSocket upgrades on /voice. */
  server: Server;
  activeSessions(): number;
  /** Ends every session (session_closed, close 1001) and stops accepting connections. */
  close(): Promise<void>;
};

/**
 * The voice gateway's network edge. `GET /health` does not depend on Gemini or the API.
 *
 * WebSocket upgrades are accepted only on /voice and only from an allowed Origin. Browsers always
 * send Origin on WebSocket handshakes, and CORS does not apply to WebSockets, so this check is
 * what stops other websites from opening voice sessions from a visitor's browser. It is not
 * authentication: non-browser clients can set any Origin (see docs/architecture/browser-voice.md).
 */
export function createVoiceGatewayServer(options: VoiceGatewayServerOptions): VoiceGatewayServer {
  const { logger } = options;
  const server = createHealthServer();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: VOICE_CLIENT_MESSAGE_MAX_BYTES,
    perMessageDeflate: false,
  });
  const sessions = new Map<WebSocket, VoiceSession>();
  const testStreams = new Set<WebSocket>();
  const diagnostics = options.diagnostics === true;
  let closing = false;

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => undefined);
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (closing) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    const testSignal = diagnostics && pathname === TEST_SIGNAL_WEBSOCKET_PATH;
    if (pathname !== VOICE_WEBSOCKET_PATH && !testSignal) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = request.headers.origin;
    if (origin === undefined || !options.allowedOrigins.includes(origin)) {
      logger.warn("origin_rejected");
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (testSignal) {
        acceptTestSignal(ws, new URL(request.url ?? "/", "http://localhost").searchParams);
      } else {
        accept(ws);
      }
    });
  });

  function acceptTestSignal(ws: WebSocket, search: URLSearchParams): void {
    if (testStreams.size >= options.maxSessions) {
      ws.close(CLOSE_TRY_AGAIN_LATER, "at capacity");
      return;
    }
    testStreams.add(ws);
    ws.on("close", () => {
      testStreams.delete(ws);
    });
    ws.on("error", () => undefined);
    // Incoming messages are ignored: this path only sends the synthetic signal.
    const params = parseTestSignalParams(search);
    logger.info("test_signal_started", { durationMs: params.seconds * 1000 });
    void streamTestSignal(
      {
        send: (message) => {
          send(ws, message);
        },
        isOpen: () => ws.readyState === WebSocket.OPEN,
        close: () => {
          ws.close(1000, "test signal complete");
        },
      },
      params,
      logger,
    );
  }

  function accept(ws: WebSocket): void {
    if (sessions.size >= options.maxSessions) {
      logger.warn("capacity_reached", { count: sessions.size });
      ws.send(
        serializeServerMessage({
          type: "error",
          code: "VOICE_LIMIT_REACHED",
          message: "The voice service is busy. Please try again later.",
        }),
      );
      ws.close(CLOSE_TRY_AGAIN_LATER, "at capacity");
      return;
    }

    const session = new VoiceSession({
      id: randomUUID(),
      send: (message) => {
        send(ws, message);
      },
      closeSocket: (code, reason) => {
        ws.close(code, reason);
      },
      backend: options.backend,
      connector: options.connector,
      logger,
      ...(options.sessionLimits ? { limits: options.sessionLimits } : {}),
      diagnostics,
      browserBacklog: () => ws.bufferedAmount,
    });
    sessions.set(ws, session);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      session.handleMessage(isBinary ? null : rawDataToString(data));
    });
    ws.on("close", (code: number) => {
      sessions.delete(ws);
      session.handleSocketClosed(code);
    });
    // Oversized or malformed frames: ws closes the socket (e.g. 1009) and "close" follows.
    ws.on("error", (error: Error) => {
      logger.warn("browser_socket_error", { errorName: error.name });
    });
  }

  return {
    server,
    activeSessions: () => sessions.size,
    close: async () => {
      closing = true;
      for (const session of sessions.values()) {
        session.shutdown();
      }
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
      for (const ws of [...sessions.keys(), ...testStreams]) {
        ws.terminate();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

function send(ws: WebSocket, message: VoiceServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (message.type === "audio" && ws.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) {
    return;
  }
  ws.send(serializeServerMessage(message));
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(
    `HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
