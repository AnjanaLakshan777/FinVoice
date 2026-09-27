import { readdirSync, readFileSync } from "node:fs";

import type { KnowledgeArticleResponse } from "@finvoice/contracts";
import { analyzeScam } from "@finvoice/scam-shield";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "../../src/common/api.exception.js";
import type { KnowledgeService } from "../../src/knowledge/knowledge.service.js";
import { citedSlugs, toScamShieldResponse } from "../../src/scam-shield/scam-shield.mapper.js";
import { ScamShieldService } from "../../src/scam-shield/scam-shield.service.js";

const engine = vi.hoisted(() => ({ fail: null as Error | null }));

vi.mock("@finvoice/scam-shield", async (importOriginal) => {
  const original = await importOriginal<typeof import("@finvoice/scam-shield")>();
  return {
    ...original,
    analyzeScam: (input: unknown) => {
      if (engine.fail) {
        throw engine.fail;
      }
      return original.analyzeScam(input);
    },
  };
});

const SECRET = "Send your OTP 482913 to ZZSECRET";

function knowledgeReturning(articles: Map<string, KnowledgeArticleResponse>) {
  const getPublishedMany = vi.fn().mockResolvedValue(articles);
  return {
    service: new ScamShieldService({ getPublishedMany } as unknown as KnowledgeService),
    getPublishedMany,
  };
}

afterEach(() => {
  engine.fail = null;
});

describe("ScamShieldService", () => {
  it("looks up every cited article in one batch, in the request language", async () => {
    const { service, getPublishedMany } = knowledgeReturning(new Map());

    const response = await service.analyze({
      content: SECRET,
      language: "TA",
      sourceType: "MESSAGE",
    });

    expect(getPublishedMany).toHaveBeenCalledTimes(1);
    expect(getPublishedMany).toHaveBeenCalledWith(
      expect.arrayContaining(["protect-pin-otp-passwords", "recognise-scams"]),
      "TA",
    );
    expect(response.indicators[0]?.sources[0]).toMatchObject({ available: false, title: null });
  });

  it("replaces an unexpected engine error with one that names only the error type", async () => {
    engine.fail = new TypeError(`cannot analyse "${SECRET}"`);
    const { service } = knowledgeReturning(new Map());

    const error = await service
      .analyze({ content: SECRET, language: "EN", sourceType: "MESSAGE" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("ScamShield analysis failed (TypeError)");
    expect(String((error as Error).stack)).not.toContain("ZZSECRET");
    expect((error as Error).cause).toBeUndefined();
  });

  it("turns engine input errors into validation errors", async () => {
    const { service } = knowledgeReturning(new Map());

    const error = await service
      .analyze({ content: "x", language: "XX" as "EN", sourceType: "MESSAGE" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).body).toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      details: [{ field: "language" }],
    });
  });
});

describe("toScamShieldResponse", () => {
  it("drops internal fields and resolves references", () => {
    const result = analyzeScam({
      content: "Send me your OTP",
      language: "EN",
      sourceType: "MESSAGE",
    });
    const response = toScamShieldResponse(result, new Map());

    expect(citedSlugs(result).sort()).toEqual([
      "protect-pin-otp-passwords",
      "recognise-scams",
      "report-suspicious-activity",
    ]);
    expect(JSON.stringify(response)).not.toMatch(/strength|sourceType/u);
    expect(response.indicators[0]).toEqual({
      code: "CREDENTIAL_REQUEST",
      explanation: expect.stringContaining("an OTP") as unknown,
      evidence: [{ type: "phrase", text: "Send me your OTP" }],
      sources: [
        {
          slug: "protect-pin-otp-passwords",
          available: false,
          title: null,
          language: null,
          summary: null,
          source: null,
          reviewRequired: false,
        },
      ],
    });
  });
});

describe("ScamShield API code", () => {
  it("contains no contact details: they come from the knowledge base", () => {
    const directory = new URL("../../src/scam-shield/", import.meta.url);
    for (const name of readdirSync(directory)) {
      const text = readFileSync(new URL(name, directory), "utf8");
      expect(text, name).not.toContain("1935");
      expect(text, name).not.toMatch(/https?:\/\/[a-z0-9]|[\w.+-]+@[\w-]+\.[a-z]{2,}/iu);
    }
  });
});
