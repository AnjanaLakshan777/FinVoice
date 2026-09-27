import type { VoiceToolDeclaration } from "@finvoice/contracts";

/**
 * Provider-neutral view of a real-time voice model session. The voice session logic depends only
 * on these types; the Gemini Live adapter (gemini-live-connector.ts) is the one implementation.
 */

/** Server-controlled inputs of a Live session. Nothing here comes from the browser. */
export type LiveSessionSetup = {
  systemInstruction: string;
  tools: VoiceToolDeclaration[];
  /** Handle of an earlier session to resume, or null for a new session. */
  resumptionHandle: string | null;
};

export type LiveFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LiveEvent =
  /** Base64 16-bit PCM speech at 24 kHz. */
  | { type: "audio"; data: string }
  | { type: "input_transcript"; text: string; languageCode?: string }
  /** Low-latency interim transcription while the user speaks (text not kept: it may be revised). */
  | { type: "input_activity" }
  /** Server voice activity detection, when the provider sends it. */
  | { type: "voice_activity"; activity: "start" | "end" }
  | { type: "output_transcript"; text: string }
  /** The user spoke over the model (barge-in): queued speech must be dropped. */
  | { type: "interrupted" }
  /** The model has finished generating this answer (its speech may still be playing). */
  | { type: "generation_complete" }
  /** The model is deliberately not generating: it expects the user to continue. */
  | { type: "waiting_for_input" }
  /** The turn is complete. `interactionStatus` (e.g. "IDLE", "IN_PROGRESS") when provided. */
  | { type: "turn_complete"; interactionStatus?: string }
  | { type: "tool_call"; calls: LiveFunctionCall[] }
  | { type: "tool_call_cancellation"; ids: string[] }
  /** A new handle for resuming this session later. */
  | { type: "resumption_update"; handle: string }
  /** The provider will close the connection soon. */
  | { type: "go_away" };

export type LiveCloseInfo = {
  code: number;
  reason: string;
};

export type LiveHandlers = {
  onEvent(event: LiveEvent): void;
  /** Called once when the provider closes the connection. Not called after `close()`. */
  onClose(info: LiveCloseInfo): void;
};

export type LiveToolResponse = {
  id: string;
  name: string;
  response: Record<string, unknown>;
};

export type LiveConnection = {
  /** Sends one frame of base64 16 kHz 16-bit mono PCM microphone audio. */
  sendAudio(data: string): void;
  sendToolResponses(responses: LiveToolResponse[]): void;
  /** Closes the connection. Idempotent; no events or onClose are delivered afterwards. */
  close(): void;
};

export type LiveConnector = {
  connect(setup: LiveSessionSetup, handlers: LiveHandlers): Promise<LiveConnection>;
};

export type LiveConnectFailure =
  /** No API key is configured. */
  | "not_configured"
  /** The provider could not be reached in time. */
  | "unavailable"
  /** The provider closed the connection during setup (for example quota, key or model). */
  | "rejected";

/** A failed connection attempt. `message` and `closeInfo` are for logs only, never for browsers. */
export class LiveConnectError extends Error {
  constructor(
    readonly failure: LiveConnectFailure,
    message: string,
    readonly closeInfo?: LiveCloseInfo,
  ) {
    super(message);
    this.name = "LiveConnectError";
  }
}
