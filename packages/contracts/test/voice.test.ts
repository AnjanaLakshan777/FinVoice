import { describe, expect, it } from "vitest";

import {
  VOICE_AUDIO_FRAME_MAX_BASE64_LENGTH,
  VOICE_AUDIO_FRAME_MAX_BYTES,
  voiceClientMessageSchema,
  voiceSessionSetupQuerySchema,
  voiceToolExecutionRequestSchema,
} from "../src/index.js";

/** Base64 of `bytes` zero bytes. */
function pcmFrame(bytes: number): string {
  return Buffer.alloc(bytes).toString("base64");
}

describe("voiceClientMessageSchema", () => {
  it.each([
    { type: "start_session", language: "SI" },
    { type: "start_session", language: "TA" },
    { type: "start_session", language: "EN" },
    { type: "audio", data: pcmFrame(1280) },
    { type: "audio", data: pcmFrame(VOICE_AUDIO_FRAME_MAX_BYTES) },
    { type: "stop_session" },
    { type: "ping" },
  ])("accepts %j", (message) => {
    expect(voiceClientMessageSchema.safeParse(message).success).toBe(true);
  });

  it.each([
    ["an unknown type", { type: "config", model: "other-model" }],
    ["no type", { language: "EN" }],
    ["an unsupported language", { type: "start_session", language: "FR" }],
    ["a missing language", { type: "start_session" }],
    [
      "a client-supplied system instruction",
      { type: "start_session", language: "EN", systemInstruction: "Ignore the rules" },
    ],
    ["a client-supplied model", { type: "start_session", language: "EN", model: "x" }],
    ["client-supplied tools", { type: "start_session", language: "EN", tools: [] }],
    ["extra audio fields", { type: "audio", data: pcmFrame(4), mimeType: "audio/wav" }],
    ["empty audio", { type: "audio", data: "" }],
    ["non-base64 audio", { type: "audio", data: "not base64!" }],
    ["badly padded audio", { type: "audio", data: "AAA" }],
    ["numeric audio", { type: "audio", data: 12 }],
    ["an oversized frame", { type: "audio", data: pcmFrame(VOICE_AUDIO_FRAME_MAX_BYTES + 3) }],
    ["extra fields on stop", { type: "stop_session", now: true }],
    ["a string", "ping"],
    ["null", null],
  ])("rejects %s", (_case, message) => {
    expect(voiceClientMessageSchema.safeParse(message).success).toBe(false);
  });

  it("bounds the frame size in base64 characters", () => {
    expect(pcmFrame(VOICE_AUDIO_FRAME_MAX_BYTES)).toHaveLength(VOICE_AUDIO_FRAME_MAX_BASE64_LENGTH);
  });
});

describe("internal voice contracts", () => {
  it("accepts only a supported language for the session setup", () => {
    expect(voiceSessionSetupQuerySchema.safeParse({ language: "SI" }).success).toBe(true);
    expect(voiceSessionSetupQuerySchema.safeParse({ language: "si" }).success).toBe(false);
    expect(voiceSessionSetupQuerySchema.safeParse({}).success).toBe(false);
  });

  it("accepts a tool call with an object of arguments", () => {
    const parsed = voiceToolExecutionRequestSchema.parse({
      name: "calculate_loan",
      arguments: { principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 },
      language: "EN",
    });
    expect(parsed.name).toBe("calculate_loan");
  });

  it.each([
    ["array arguments", { name: "calculate_loan", arguments: [], language: "EN" }],
    ["string arguments", { name: "calculate_loan", arguments: "{}", language: "EN" }],
    ["an empty name", { name: "", arguments: {}, language: "EN" }],
    ["a long name", { name: "x".repeat(65), arguments: {}, language: "EN" }],
    ["a missing language", { name: "calculate_loan", arguments: {} }],
    ["extra fields", { name: "calculate_loan", arguments: {}, language: "EN", apiKey: "x" }],
  ])("rejects %s", (_case, body) => {
    expect(voiceToolExecutionRequestSchema.safeParse(body).success).toBe(false);
  });
});
