import type {
  AgentLanguage,
  VoiceClientMessage,
  VoiceErrorCode,
  VoiceServerMessage,
} from "@finvoice/contracts";

// Types only: importing @finvoice/contracts at runtime would ship its validation code to the
// browser. The constants below mirror the contracts; a test keeps them in sync.

export type { AgentLanguage, VoiceClientMessage, VoiceErrorCode, VoiceServerMessage };

export const VOICE_OUTPUT_SAMPLE_RATE = 24_000;
export const VOICE_INPUT_SAMPLE_RATE = 16_000;
/** Microphone frames: 40 ms of 16 kHz 16-bit mono PCM (set by the capture worklet). */
export const CAPTURE_FRAME_SAMPLES = 640;
export const CAPTURE_FRAME_BYTES = CAPTURE_FRAME_SAMPLES * 2;

export const VOICE_LANGUAGES: readonly { value: AgentLanguage; label: string }[] = [
  { value: "SI", label: "සිංහල (Sinhala)" },
  { value: "TA", label: "தமிழ் (Tamil)" },
  { value: "EN", label: "English" },
];

const SERVER_MESSAGE_TYPES = new Set<VoiceServerMessage["type"]>([
  "session_started",
  "audio",
  "input_transcript",
  "output_transcript",
  "tool_status",
  "interrupted",
  "turn_complete",
  "turn_stalled",
  "pong",
  "error",
  "session_closed",
]);

/**
 * Parses a message from the voice gateway. Returns null for anything that is not a well-formed
 * protocol message, which the client then ignores.
 */
export function parseServerMessage(data: unknown): VoiceServerMessage | null {
  if (typeof data !== "string") {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || !("type" in json)) {
    return null;
  }
  const message = json as Record<string, unknown>;
  const type = message.type as VoiceServerMessage["type"];
  if (!SERVER_MESSAGE_TYPES.has(type)) {
    return null;
  }
  const hasString = (key: string) => typeof message[key] === "string";
  switch (type) {
    case "audio":
      return hasString("data") ? (json as VoiceServerMessage) : null;
    case "input_transcript":
      return hasString("text") && (message.languageCode === undefined || hasString("languageCode"))
        ? (json as VoiceServerMessage)
        : null;
    case "output_transcript":
      return hasString("text") ? (json as VoiceServerMessage) : null;
    case "tool_status":
      return hasString("name") ? (json as VoiceServerMessage) : null;
    case "error":
      return hasString("code") && hasString("message") ? (json as VoiceServerMessage) : null;
    case "session_started":
      return hasString("language") ? (json as VoiceServerMessage) : null;
    default:
      return json as VoiceServerMessage;
  }
}

export function serializeClientMessage(message: VoiceClientMessage): string {
  return JSON.stringify(message);
}
