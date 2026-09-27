import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_CATEGORIES,
  LITERACY_TOPICS,
  literacyTopicParamsSchema,
  updateLiteracyProfileRequestSchema,
  voiceClientMessageSchema,
} from "../src/index.js";

const USER_ID = "0190f0a0-0000-7000-8000-000000000001";

describe("literacy contracts", () => {
  it("uses the knowledge categories as literacy topics", () => {
    expect(LITERACY_TOPICS).toEqual(KNOWLEDGE_CATEGORIES);
  });

  it("accepts an explicit level update", () => {
    expect(
      updateLiteracyProfileRequestSchema.parse({
        level: "DEVELOPING",
        assessmentVersion: "1",
        assessedAt: "2026-09-01T10:00:00Z",
      }),
    ).toEqual({ level: "DEVELOPING", assessmentVersion: "1", assessedAt: "2026-09-01T10:00:00Z" });
    expect(
      updateLiteracyProfileRequestSchema.safeParse({
        level: "BEGINNER",
        assessmentVersion: "2026.1",
        assessedAt: null,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["an unknown level", { level: "EXPERT", assessmentVersion: "1", assessedAt: null }],
    ["a score", { level: "BEGINNER", assessmentVersion: "1", assessedAt: null, score: 80 }],
    [
      "an AI-inferred flag",
      { level: "BEGINNER", assessmentVersion: "1", assessedAt: null, inferredBy: "llm" },
    ],
    ["no assessedAt", { level: "BEGINNER", assessmentVersion: "1" }],
    ["no assessment version", { level: "BEGINNER", assessedAt: null }],
    ["a blank version", { level: "BEGINNER", assessmentVersion: "", assessedAt: null }],
    [
      "a date without offset",
      { level: "BEGINNER", assessmentVersion: "1", assessedAt: "2026-09-01T10:00:00" },
    ],
  ])("rejects %s", (_case, body) => {
    expect(updateLiteracyProfileRequestSchema.safeParse(body).success).toBe(false);
  });

  it("validates topic path parameters", () => {
    expect(literacyTopicParamsSchema.safeParse({ userId: USER_ID, topic: "SCAMS" }).success).toBe(
      true,
    );
    expect(literacyTopicParamsSchema.safeParse({ userId: USER_ID, topic: "scams" }).success).toBe(
      false,
    );
    expect(literacyTopicParamsSchema.safeParse({ userId: "1", topic: "SCAMS" }).success).toBe(
      false,
    );
  });
});

describe("browser voice cannot carry a user identity", () => {
  it.each([{ userId: USER_ID }, { user: { id: USER_ID } }, { phoneNumber: "+94000000001" }])(
    "rejects start_session with %j",
    (identity) => {
      expect(
        voiceClientMessageSchema.safeParse({ type: "start_session", language: "EN", ...identity })
          .success,
      ).toBe(false);
    },
  );
});
