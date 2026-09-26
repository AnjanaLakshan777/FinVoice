import type { KnowledgeArticleResponse, KnowledgeCategoriesResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { knowledgeArticles, knowledgeSources } from "../../prisma/knowledge/content.js";
import { seedKnowledge } from "../../prisma/knowledge/seed-knowledge.js";
import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const TRANSLATION_COUNT = knowledgeArticles.reduce(
  (count, article) => count + Object.keys(article.translations).length,
  0,
);

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
});

describe("knowledge seed", () => {
  it("loads every source, article and translation", async () => {
    const report = await seedKnowledge(api.prisma);

    expect(report).toEqual({
      created: {
        sources: knowledgeSources.length,
        articles: knowledgeArticles.length,
        translations: TRANSLATION_COUNT,
      },
      unchanged: 0,
      differing: [],
    });
    expect(await api.prisma.knowledgeArticle.count({ where: { status: "PUBLISHED" } })).toBe(
      knowledgeArticles.length,
    );
  });

  it("is idempotent: a second run creates nothing", async () => {
    await seedKnowledge(api.prisma);

    const second = await seedKnowledge(api.prisma);

    expect(second.created).toEqual({ sources: 0, articles: 0, translations: 0 });
    expect(second.unchanged).toBe(
      knowledgeSources.length + knowledgeArticles.length + TRANSLATION_COUNT,
    );
    expect(await api.prisma.knowledgeSource.count()).toBe(knowledgeSources.length);
    expect(await api.prisma.knowledgeArticle.count()).toBe(knowledgeArticles.length);
    expect(await api.prisma.knowledgeArticleTranslation.count()).toBe(TRANSLATION_COUNT);
  });

  it("never overwrites content changed in the database, and reports it", async () => {
    await seedKnowledge(api.prisma);
    const article = await api.prisma.knowledgeArticle.findUniqueOrThrow({
      where: { slug: "deposit-insurance" },
    });
    await api.prisma.knowledgeArticleTranslation.update({
      where: { articleId_language: { articleId: article.id, language: "EN" } },
      data: { title: "Reviewed title" },
    });

    const report = await seedKnowledge(api.prisma);

    expect(report.differing).toEqual(["translation deposit-insurance/EN"]);
    const translation = await api.prisma.knowledgeArticleTranslation.findUniqueOrThrow({
      where: { articleId_language: { articleId: article.id, language: "EN" } },
    });
    expect(translation.title).toBe("Reviewed title");
  });

  it("serves the seeded, source-backed content through the public API", async () => {
    await seedKnowledge(api.prisma);

    const deposit = await api.request<KnowledgeArticleResponse>(
      "GET",
      "/api/v1/knowledge/articles/deposit-insurance?language=SI",
    );
    const categories = await api.request<KnowledgeCategoriesResponse>(
      "GET",
      "/api/v1/knowledge/categories",
    );

    expect(deposit.status).toBe(200);
    expect(deposit.body).toMatchObject({
      requestedLanguage: "SI",
      language: "EN",
      category: "DEPOSIT_PROTECTION",
      translationStatus: "MACHINE_ASSISTED",
      source: {
        publisher: "Central Bank of Sri Lanka",
        url: "https://www.cbsl.gov.lk/en/sri-lanka-deposit-insurance-scheme",
        type: "OFFICIAL_REGULATOR",
      },
      review: { isTimeSensitive: true },
    });
    expect(deposit.body.body).toContain("Rs. 1,100,000");
    expect(categories.body.data).toHaveLength(8);
  });
});
