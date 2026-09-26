import { describe, expect, it } from "vitest";

import {
  getKnowledgeArticleQuerySchema,
  knowledgeArticleParamsSchema,
  listKnowledgeArticlesQuerySchema,
} from "../src/index.js";

describe("listKnowledgeArticlesQuerySchema", () => {
  it("defaults to English, page 1 and 20 results", () => {
    expect(listKnowledgeArticlesQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
      language: "EN",
    });
  });

  it("accepts every filter and trims the search text", () => {
    expect(
      listKnowledgeArticlesQuerySchema.parse({
        language: "TA",
        category: "SCAMS",
        query: "  otp  ",
        page: "2",
        limit: "100",
      }),
    ).toEqual({ language: "TA", category: "SCAMS", query: "otp", page: 2, limit: 100 });
  });

  it.each([
    { language: "FR" },
    { language: "si" },
    { category: "LOANS" },
    { query: "" },
    { query: "  " },
    { query: "x".repeat(101) },
    { limit: "101" },
    { page: "0" },
    { status: "DRAFT" },
  ])("rejects %j", (query) => {
    expect(listKnowledgeArticlesQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("knowledge article parameters", () => {
  it.each(["responsible-borrowing", "deposit-insurance", "a1"])("accepts the slug %s", (slug) => {
    expect(knowledgeArticleParamsSchema.safeParse({ slug }).success).toBe(true);
  });

  it.each(["Responsible", "under_score", "-x", "x-", "a--b", "a".repeat(101)])(
    "rejects the slug %s",
    (slug) => {
      expect(knowledgeArticleParamsSchema.safeParse({ slug }).success).toBe(false);
    },
  );

  it("defaults the article language to English and rejects other parameters", () => {
    expect(getKnowledgeArticleQuerySchema.parse({})).toEqual({ language: "EN" });
    expect(getKnowledgeArticleQuerySchema.safeParse({ preview: "true" }).success).toBe(false);
  });
});
