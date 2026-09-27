/**
 * Structured, privacy-safe logging. Only the fields below can be logged: there is deliberately no
 * way to log audio, transcripts, tool arguments or results, API keys, tokens or URLs with
 * credentials.
 */
import type { TurnMetricsSummary } from "./diagnostics/turn-metrics.js";

export type LogFields = {
  sessionId?: string;
  language?: string;
  state?: string;
  tool?: string;
  durationMs?: number;
  code?: string;
  /** WebSocket close code (browser or provider). */
  closeCode?: number;
  /** A short provider close reason, sanitized by {@link sanitizeProviderText}. */
  providerReason?: string;
  /** HTTP status of a failed internal API call. */
  httpStatus?: number;
  count?: number;
  /** Audio counters of a session (frames and bytes, never content). */
  audioChunksIn?: number;
  audioBytesIn?: number;
  audioChunksOut?: number;
  audioBytesOut?: number;
  /** Duration of the speech Gemini sent (from its byte count), in ms. */
  speechMs?: number;
  /** Wall-clock time over which that speech arrived (first to last chunk of each answer), in ms. */
  speechArrivalMs?: number;
  /** Development diagnostics of one model turn: timing and size numbers only. */
  turnMetrics?: TurnMetricsSummary & { maxBrowserBacklogBytes: number; interactionStatus?: string };
  /** Session totals of stall handling (diagnostics). */
  responseStartTimeouts?: number;
  generationStalls?: number;
  geminiInterruptions?: number;
  /** Error class name only, never its message. */
  errorName?: string;
};

export type LogLevel = "info" | "warn" | "error";

export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

/** Writes one JSON object per line: `{ time, level, service, event, ...fields }`. */
export function createJsonLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const log = (level: LogLevel, event: string, fields: LogFields = {}) => {
    write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        service: "voice-gateway",
        event,
        ...fields,
      }),
    );
  };
  return {
    info: (event, fields) => {
      log("info", event, fields);
    },
    warn: (event, fields) => {
      log("warn", event, fields);
    },
    error: (event, fields) => {
      log("error", event, fields);
    },
  };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const PROVIDER_REASON_MAX_LENGTH = 160;

/**
 * Makes a provider-supplied text (such as a WebSocket close reason) safe to log: removes anything
 * that looks like a key or token and truncates it. Never sent to the browser.
 */
export function sanitizeProviderText(text: string): string {
  return text
    .replace(/(key|token|access_token)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/\b(AIza|AQ\.)[A-Za-z0-9._-]{8,}/g, "[redacted]")
    .slice(0, PROVIDER_REASON_MAX_LENGTH);
}
