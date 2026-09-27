import { describe, expect, it } from "vitest";

import { SCAM_SHIELD_MAX_CONTENT_LENGTH, scamShieldAnalyzeRequestSchema } from "../src/index.js";

const valid = { content: "  Send me your OTP  ", language: "SI", sourceType: "CALL" };

describe("scamShieldAnalyzeRequestSchema", () => {
  it("accepts a request and trims the content", () => {
    expect(scamShieldAnalyzeRequestSchema.parse(valid)).toEqual({
      content: "Send me your OTP",
      language: "SI",
      sourceType: "CALL",
    });
  });

  it.each([
    ["empty content", { ...valid, content: "   " }],
    ["too long content", { ...valid, content: "a".repeat(SCAM_SHIELD_MAX_CONTENT_LENGTH + 1) }],
    ["a non-string content", { ...valid, content: 42 }],
    ["an unknown language", { ...valid, language: "FR" }],
    ["a missing language", { content: "x", sourceType: "MESSAGE" }],
    ["an unknown source type", { ...valid, sourceType: "SMS" }],
    ["a user id", { ...valid, userId: "0190f0a0-0000-7000-8000-000000000001" }],
    ["client metadata", { ...valid, metadata: { phone: "+94000000000" } }],
    ["a client risk level", { ...valid, riskLevel: "LOW" }],
  ])("rejects %s", (_case, body) => {
    expect(scamShieldAnalyzeRequestSchema.safeParse(body).success).toBe(false);
  });

  it("accepts content of exactly the maximum length", () => {
    expect(
      scamShieldAnalyzeRequestSchema.safeParse({
        ...valid,
        content: "a".repeat(SCAM_SHIELD_MAX_CONTENT_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("never echoes the content in validation messages", () => {
    const secret = `SECRET-OTP-482913 ${"x".repeat(SCAM_SHIELD_MAX_CONTENT_LENGTH)}`;
    const result = scamShieldAnalyzeRequestSchema.safeParse({ ...valid, content: secret });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("SECRET-OTP");
  });
});
