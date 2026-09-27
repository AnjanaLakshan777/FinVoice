import {
  voiceClientMessageSchema,
  type VoiceClientMessage,
  type VoiceServerMessage,
} from "@finvoice/contracts";

export type ParsedClientMessage =
  { ok: true; message: VoiceClientMessage } | { ok: false; reason: string };

/**
 * Parses one WebSocket message from the browser. Only JSON text frames matching the voice
 * protocol are accepted; the size limit is enforced earlier by the WebSocket server
 * (`maxPayload`). The reason is client-safe and never echoes the message.
 */
export function parseClientMessage(data: string | null): ParsedClientMessage {
  if (data === null) {
    return { ok: false, reason: "Only JSON text messages are accepted." };
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { ok: false, reason: "The message is not valid JSON." };
  }
  const parsed = voiceClientMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: describeInvalidMessage(json) };
  }
  if (parsed.data.type === "audio" && decodedLength(parsed.data.data) % 2 !== 0) {
    return { ok: false, reason: "Audio must be whole 16-bit samples." };
  }
  return { ok: true, message: parsed.data };
}

export function serializeServerMessage(message: VoiceServerMessage): string {
  return JSON.stringify(message);
}

const KNOWN_TYPES = new Set(["start_session", "audio", "stop_session", "ping"]);

function describeInvalidMessage(json: unknown): string {
  const type = typeof json === "object" && json !== null && "type" in json ? json.type : undefined;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
    return "Unknown message type.";
  }
  return `Invalid ${type} message.`;
}

/** Number of bytes encoded by a (valid, padded) base64 string. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}
