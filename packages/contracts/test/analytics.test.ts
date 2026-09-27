import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_NAMES,
  ANALYTICS_ERROR_CODES,
  ANALYTICS_TOOL_NAMES,
  analyticsEventRequestSchema,
  analyticsEventSchema,
  analyticsRangeQuerySchema,
  API_ERROR_CODES,
  USER_CONTEXT_TOOL_NAMES,
  VOICE_ERROR_CODES,
} from "../src/index.js";

const VOICE_SESSION = {
  eventType: "VOICE_SESSION",
  source: "VOICE",
  language: "TA",
  success: true,
  durationMs: 12_000,
  sessionId: "0190f0a0-0000-7000-8000-00000000abcd",
};

describe("analytics event contract", () => {
  it("reuses the existing tool names and error codes", () => {
    expect(ANALYTICS_TOOL_NAMES).toEqual([...AGENT_TOOL_NAMES, ...USER_CONTEXT_TOOL_NAMES]);
    for (const code of [...API_ERROR_CODES, ...VOICE_ERROR_CODES]) {
      expect(ANALYTICS_ERROR_CODES).toContain(code);
    }
  });

  it("accepts the typed operational fields", () => {
    expect(analyticsEventRequestSchema.parse(VOICE_SESSION)).toEqual(VOICE_SESSION);
    expect(
      analyticsEventSchema.safeParse({
        eventType: "SCAM_ANALYSIS",
        source: "API",
        language: "SI",
        scamSourceType: "CALL",
        scamRiskLevel: "HIGH",
        success: true,
        durationMs: 12,
      }).success,
    ).toBe(true);
  });

  it.each([
    "message",
    "text",
    "transcript",
    "audio",
    "amount",
    "principal",
    "monthlyIncome",
    "monthlyExpenses",
    "targetAmount",
    "phoneNumber",
    "accountNumber",
    "cardNumber",
    "otp",
    "pin",
    "password",
    "credentials",
    "toolArguments",
    "arguments",
    "toolResult",
    "result",
    "evidence",
    "content",
    "query",
    "slug",
    "metadata",
    "userId",
    "ip",
    "userAgent",
    "deviceId",
    "occurredAt",
    "errorMessage",
    "stack",
  ])("rejects the forbidden field %s", (field) => {
    expect(analyticsEventSchema.safeParse({ ...VOICE_SESSION, [field]: "x" }).success).toBe(false);
    expect(analyticsEventRequestSchema.safeParse({ ...VOICE_SESSION, [field]: {} }).success).toBe(
      false,
    );
  });

  it.each([
    ["a negative duration", { durationMs: -1 }],
    ["a duration over 24 hours", { durationMs: 86_400_001 }],
    ["a fractional duration", { durationMs: 10.5 }],
    ["a string duration", { durationMs: "10" }],
    ["an arbitrary error text", { success: false, errorCode: "connection refused at 10.0.0.1" }],
    ["an error code on a success", { errorCode: "VOICE_SESSION_ERROR" }],
    ["a non-UUID session id", { sessionId: "caller-0771234567" }],
    ["a non-voice source for a voice event", { source: "API" }],
  ])("rejects %s", (_case, change) => {
    expect(analyticsEventSchema.safeParse({ ...VOICE_SESSION, ...change }).success).toBe(false);
  });

  it("enforces which fields belong to which event type", () => {
    const base = { source: "API", success: true } as const;
    for (const event of [
      { ...base, eventType: "AGENT_REQUEST", scamRiskLevel: "HIGH" },
      { ...base, eventType: "SCAM_ANALYSIS" },
      { ...base, eventType: "CALCULATION" },
      { ...base, eventType: "AGENT_REQUEST", toolName: "calculate_loan" },
      { ...base, eventType: "LITERACY_TOPIC_STARTED" },
      { ...base, eventType: "AGENT_REQUEST", knowledgeCategory: "SAVING" },
      { ...base, eventType: "AGENT_REQUEST", sessionId: VOICE_SESSION.sessionId },
      { ...base, eventType: "VOICE_TOOL_CALL", toolName: "calculate_loan" },
    ]) {
      expect(analyticsEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(false);
    }
  });

  it("accepts only externally observable events on the ingestion endpoint", () => {
    expect(
      analyticsEventRequestSchema.safeParse({
        eventType: "AGENT_REQUEST",
        source: "API",
        success: true,
      }).success,
    ).toBe(false);
  });
});

describe("analytics range query", () => {
  it.each([
    [{}, true],
    [{ from: "2026-09-01", to: "2026-09-27" }, true],
    [{ from: "2025-09-28", to: "2026-09-28" }, true],
    [{ from: "2025-09-27", to: "2026-09-28" }, false],
    [{ from: "2026-09-28", to: "2026-09-27" }, false],
    [{ from: "2026-02-30" }, false],
    [{ from: "2026-09-01T00:00:00+05:30" }, false],
    [{ from: "2026-09-01", userId: "x" }, false],
  ])("%j → valid: %s", (query, valid) => {
    expect(analyticsRangeQuerySchema.safeParse(query).success).toBe(valid);
  });
});
