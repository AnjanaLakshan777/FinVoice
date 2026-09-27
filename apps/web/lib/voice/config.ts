/** Used when NEXT_PUBLIC_VOICE_GATEWAY_URL is not set: the local voice gateway. */
export const DEFAULT_VOICE_GATEWAY_URL = "ws://127.0.0.1:4100/voice";

/**
 * The voice gateway WebSocket URL. Public by design (it is used by the browser); it is not a
 * secret. Server secrets (API keys, internal tokens) must never be put in NEXT_PUBLIC_* variables.
 */
export function voiceGatewayUrl(): string {
  const configured = process.env.NEXT_PUBLIC_VOICE_GATEWAY_URL;
  return configured !== undefined && configured !== "" ? configured : DEFAULT_VOICE_GATEWAY_URL;
}
