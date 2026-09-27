import { z } from "zod";

import type { AgentLanguage, AgentToolName } from "./agent.js";
import { knowledgeLanguageSchema } from "./knowledge.js";

/**
 * Contracts of the browser voice experience:
 *
 * - the WebSocket protocol between the browser and the voice gateway (JSON text frames), and
 * - the internal API the voice gateway uses to get its session setup and to run agent tools.
 *
 * The browser only chooses a language and streams microphone audio. Model, system instruction,
 * tools and generation settings are controlled by the server, so no message can carry them.
 */

// ---------------------------------------------------------------------------
// Audio format
// ---------------------------------------------------------------------------

/** Microphone audio sent by the browser: mono, 16 kHz, 16-bit signed little-endian PCM. */
export const VOICE_INPUT_SAMPLE_RATE = 16_000;
export const VOICE_INPUT_MIME_TYPE = "audio/pcm;rate=16000";

/** Speech sent to the browser: mono, 24 kHz, 16-bit signed little-endian PCM. */
export const VOICE_OUTPUT_SAMPLE_RATE = 24_000;
export const VOICE_OUTPUT_MIME_TYPE = "audio/pcm;rate=24000";

/**
 * Largest accepted microphone frame: 100 ms of 16 kHz 16-bit mono PCM. The browser sends 40 ms
 * frames (1,280 bytes); the headroom tolerates timing jitter without allowing large buffers.
 */
export const VOICE_AUDIO_FRAME_MAX_BYTES = 3200;

/** Base64 length of the largest accepted frame. */
export const VOICE_AUDIO_FRAME_MAX_BASE64_LENGTH = Math.ceil(VOICE_AUDIO_FRAME_MAX_BYTES / 3) * 4;

/** Largest accepted WebSocket message from the browser, in bytes (JSON envelope included). */
export const VOICE_CLIENT_MESSAGE_MAX_BYTES = 8 * 1024;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const audioFrameSchema = z
  .string({ error: "Must be a base64 string" })
  .min(4, { error: "Must not be empty" })
  .max(VOICE_AUDIO_FRAME_MAX_BASE64_LENGTH, {
    error: `Must be at most ${String(VOICE_AUDIO_FRAME_MAX_BYTES)} bytes of audio`,
  })
  .regex(BASE64_PATTERN, { error: "Must be a base64 string" });

// ---------------------------------------------------------------------------
// Browser → gateway
// ---------------------------------------------------------------------------

export const voiceClientMessageSchema = z.discriminatedUnion(
  "type",
  [
    /** Starts the one voice session of this connection, answering in `language`. */
    z.strictObject({ type: z.literal("start_session"), language: knowledgeLanguageSchema }),
    /** One microphone frame: base64 of 16 kHz mono Int16 little-endian PCM. */
    z.strictObject({ type: z.literal("audio"), data: audioFrameSchema }),
    /** Ends the voice session; the gateway replies with session_closed and closes the socket. */
    z.strictObject({ type: z.literal("stop_session") }),
    /** Keep-alive; the gateway replies with pong. */
    z.strictObject({ type: z.literal("ping") }),
  ],
  { error: "Unknown message type" },
);
export type VoiceClientMessage = z.output<typeof voiceClientMessageSchema>;

// ---------------------------------------------------------------------------
// Gateway → browser
// ---------------------------------------------------------------------------

export const VOICE_ERROR_CODES = [
  /** The server is not configured for voice (for example, no Gemini API key). */
  "VOICE_CONFIG_ERROR",
  /** The voice provider could not be reached or refused the session. */
  "VOICE_PROVIDER_UNAVAILABLE",
  /** The voice session failed or ended unexpectedly. */
  "VOICE_SESSION_ERROR",
  /** The browser sent a message that is invalid or not allowed in the current state. */
  "VOICE_INVALID_MESSAGE",
  /** A tool needed for the answer could not be run. */
  "VOICE_TOOL_ERROR",
  /** A limit was reached (sessions, message rate or tool calls). */
  "VOICE_LIMIT_REACHED",
] as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number];

export type VoiceServerMessage =
  /** The voice session is ready: the browser may now send audio. */
  | { type: "session_started"; language: AgentLanguage }
  /** A chunk of FinVoice's speech. */
  | { type: "audio"; data: string; mimeType: typeof VOICE_OUTPUT_MIME_TYPE }
  /**
   * Transcription of what the user said (incremental text), with the language Gemini detected
   * (BCP-47, e.g. "si-LK") when it reports one. For display and diagnostics only.
   */
  | { type: "input_transcript"; text: string; languageCode?: string }
  /** Transcription of what FinVoice said (incremental text). */
  | { type: "output_transcript"; text: string }
  /** FinVoice is running an allowlisted tool (name only, never arguments or results). */
  | { type: "tool_status"; name: AgentToolName }
  /** The user started speaking over FinVoice: stop playback and drop queued audio now. */
  | { type: "interrupted" }
  /** FinVoice finished its answer for this turn. */
  | { type: "turn_complete" }
  /**
   * FinVoice's answer stopped making progress (no speech or transcription for a long time) and
   * was ended. The session stays open: the user can ask again.
   */
  | { type: "turn_stalled"; reason?: VoiceStallReason }
  | { type: "pong" }
  /** A client-safe error. Never contains provider details. */
  | { type: "error"; code: VoiceErrorCode; message: string }
  /** The voice session has ended; the gateway closes the socket next. */
  | { type: "session_closed" };

export type VoiceServerMessageType = VoiceServerMessage["type"];

/**
 * Why an answer was ended: "no_response" when the model showed no progress after the user
 * finished speaking; "no_progress" when an answer in progress stopped making progress.
 */
export type VoiceStallReason = "no_response" | "no_progress";

// ---------------------------------------------------------------------------
// Internal API used by the voice gateway (not for browsers; token-protected)
// ---------------------------------------------------------------------------

/** Header carrying the shared internal token on internal API requests. */
export const INTERNAL_TOKEN_HEADER = "x-finvoice-internal-token";

export const voiceSessionSetupQuerySchema = z.strictObject({
  language: knowledgeLanguageSchema,
});
export type VoiceSessionSetupQuery = z.output<typeof voiceSessionSetupQuerySchema>;

export type VoiceToolDeclaration = {
  name: string;
  description: string;
  /** JSON Schema of the tool's arguments. */
  parameters: Record<string, unknown>;
};

/** Everything the gateway needs to open a Live session. Built by the API, never by the browser. */
export type VoiceSessionSetupResponse = {
  agentVersion: string;
  language: AgentLanguage;
  systemInstruction: string;
  tools: VoiceToolDeclaration[];
  maxToolCallsPerTurn: number;
};

export const VOICE_TOOL_NAME_MAX_LENGTH = 64;

/**
 * A tool call requested by the Live model, forwarded by the gateway. `name` is not restricted
 * here: an unknown name must reach the tool registry, which answers with an UNKNOWN_TOOL result
 * for the model. `arguments` are validated by the tool's own input contract.
 */
export const voiceToolExecutionRequestSchema = z.strictObject({
  name: z
    .string({ error: "Must be a string" })
    .min(1, { error: "Must not be empty" })
    .max(VOICE_TOOL_NAME_MAX_LENGTH, {
      error: `Must be at most ${String(VOICE_TOOL_NAME_MAX_LENGTH)} characters`,
    }),
  arguments: z.record(z.string(), z.unknown(), { error: "Must be a JSON object" }),
  language: knowledgeLanguageSchema,
});
export type VoiceToolExecutionRequest = z.output<typeof voiceToolExecutionRequestSchema>;

export type VoiceToolExecutionResponse = {
  /** The allowlisted tool that ran, or null when the name was not on the allowlist. */
  tool: AgentToolName | null;
  /** JSON for the model: the tool's result, or a structured error. */
  result: Record<string, unknown>;
  isError: boolean;
};
