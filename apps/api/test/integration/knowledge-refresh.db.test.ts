import { readFileSync } from "node:fs";

import type { KnowledgeArticleResponse, KnowledgeSearchResponse } from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FCRD_HOTLINE_REFRESH as REFRESH } from "../../prisma/knowledge/refresh/20260927-fcrd-hotline.js";
import { seedKnowledge } from "../../prisma/knowledge/seed-knowledge.js";
import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

/** The refresh's data migrations, in the order `prisma migrate deploy` applies them. */
const MIGRATIONS = [
  "20260927200000_knowledge_fcrd_hotline",
  "20260927210000_knowledge_fcrd_hotline_summary",
].map((name) => new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url));

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

/** Runs the refresh migrations again, one statement at a time (as `prisma migrate deploy` did). */
async function runRefreshMigration(): Promise<void> {
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(migration, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n");
    for (const statement of sql.split(/;\s*\n\s*\n(?=UPDATE)/u)) {
      await api.prisma.$executeRawUnsafe(statement.trim().replace(/;$/u, ""));
    }
  }
}

/** Puts the three refreshed records back to the content seeded before the refresh. */
async function restorePreviousContent(): Promise<void> {
  const { before } = REFRESH;
  await api.prisma.knowledgeSource.update({
    where: { url: REFRESH.sourceUrl },
    data: {
      retrievedAt: new Date(before.source.retrievedAt),
      lastVerifiedAt: new Date(before.source.lastVerifiedAt),
      nextReviewAt: new Date(before.source.nextReviewAt),
    },
  });
  const article = await api.prisma.knowledgeArticle.update({
    where: { slug: REFRESH.articleSlug },
    data: {
      sourceSection: before.article.sourceSection,
      isTimeSensitive: before.article.isTimeSensitive,
      lastReviewedAt: new Date(before.article.lastReviewedAt),
      nextReviewAt: new Date(before.article.nextReviewAt),
    },
  });
  await api.prisma.knowledgeArticleTranslation.update({
    where: { articleId_language: { articleId: article.id, language: "EN" } },
    data: {
      summary: before.english.summary,
      body: before.english.body,
      keywords: [...before.english.keywords],
    },
  });
}

describe("knowledge refresh migration (FCRD hotline)", () => {
  it("does nothing on an empty database, where the seed inserts the current content", async () => {
    await runRefreshMigration();
    expect(await api.prisma.knowledgeArticle.count()).toBe(0);
  });

  it("updates a database seeded before the refresh to exactly the current content", async () => {
    await seedKnowledge(api.prisma);
    await restorePreviousContent();
    const stale = await seedKnowledge(api.prisma);
    expect(stale.differing.sort()).toEqual([
      "article consumer-rights-and-complaints",
      "source https://www.cbsl.gov.lk/en/fcrd",
      "translation consumer-rights-and-complaints/EN",
    ]);

    await runRefreshMigration();

    // The seed now finds every record identical to the current content, and creates nothing.
    const report = await seedKnowledge(api.prisma);
    expect(report.differing).toEqual([]);
    expect(report.created).toEqual({ sources: 0, articles: 0, translations: 0 });
  });

  it("never overwrites content that was edited in the database", async () => {
    await seedKnowledge(api.prisma);
    await restorePreviousContent();
    const article = await api.prisma.knowledgeArticle.findUniqueOrThrow({
      where: { slug: REFRESH.articleSlug },
    });
    await api.prisma.knowledgeArticleTranslation.update({
      where: { articleId_language: { articleId: article.id, language: "EN" } },
      data: { summary: "Summary edited by a reviewer.", body: "Text edited by a reviewer." },
    });

    await runRefreshMigration();

    const translation = await api.prisma.knowledgeArticleTranslation.findUniqueOrThrow({
      where: { articleId_language: { articleId: article.id, language: "EN" } },
    });
    expect(translation.summary).toBe("Summary edited by a reviewer.");
    expect(translation.body).toBe("Text edited by a reviewer.");
    expect(translation.keywords).toEqual([...REFRESH.before.english.keywords]);
  });

  it("serves the 1935 hotline through the knowledge API, time-sensitive and attributed to FCRD", async () => {
    await seedKnowledge(api.prisma);

    const response = await api.request<KnowledgeArticleResponse>(
      "GET",
      `/api/v1/knowledge/articles/${REFRESH.articleSlug}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.body).toContain("For inquiries, the FCRD has a hotline: 1935.");
    expect(response.body.source).toMatchObject({
      publisher: "Central Bank of Sri Lanka",
      title: "Financial Consumer Relations Department (FCRD)",
      url: "https://www.cbsl.gov.lk/en/fcrd",
      lastVerifiedAt: "2026-09-27T12:00:00.000Z",
    });
    expect(response.body.review).toMatchObject({
      isTimeSensitive: true,
      lastReviewedAt: "2026-09-27T12:00:00.000Z",
    });

    const search = await api.request<KnowledgeSearchResponse>(
      "GET",
      "/api/v1/knowledge/articles?query=1935",
    );
    expect(search.body.data.map((article) => article.slug)).toEqual([REFRESH.articleSlug]);
  });
});
