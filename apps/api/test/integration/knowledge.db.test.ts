import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPrismaClient,
  expectCheckViolation,
  expectDatabaseError,
  truncateAllTables,
} from "./database.js";

const prisma = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(prisma);
});

const DAY = 24 * 60 * 60 * 1000;

function createSource(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return prisma.knowledgeSource.create({
    data: {
      publisher: "Test Publisher",
      title: "Test source",
      url: `https://source.test/${randomUUID()}`,
      sourceType: "OFFICIAL_REGULATOR",
      originalLanguage: "EN",
      retrievedAt: new Date(now),
      lastVerifiedAt: new Date(now),
      nextReviewAt: new Date(now + 365 * DAY),
      ...overrides,
    },
  });
}

function createArticle(data: Record<string, unknown>) {
  return prisma.knowledgeArticle.create({
    data: { slug: `article-${randomUUID()}`, category: "SAVING", ...data },
  });
}

function createTranslation(articleId: string, language: "EN" | "SI" | "TA" = "EN") {
  return prisma.knowledgeArticleTranslation.create({
    data: {
      articleId,
      language,
      title: "Title",
      summary: "Summary",
      body: "Body",
      translationStatus: "MACHINE_ASSISTED",
    },
  });
}

describe("KnowledgeSource", () => {
  it("can be created, with a database-generated UUIDv7 id", async () => {
    const source = await createSource();

    expect(source.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(source.publishedOn).toBeNull();
  });

  it("records each URL once", async () => {
    await createSource({ url: "https://source.test/same" });

    await expectDatabaseError(createSource({ url: "https://source.test/same" }), { code: "P2002" });
  });

  it.each(["http://source.test/insecure", "ftp://source.test/file", "https://has space.test"])(
    "rejects the non-HTTPS or malformed URL %s",
    async (url) => {
      await expectCheckViolation(createSource({ url }), "knowledge_sources_url_https_check");
    },
  );

  it("requires the next review to be after the last verification", async () => {
    await expectCheckViolation(
      createSource({ nextReviewAt: new Date(Date.now() - DAY) }),
      "knowledge_sources_review_after_verification_check",
    );
  });

  it("cannot be deleted while an article cites it", async () => {
    const source = await createSource();
    await createArticle({ sourceId: source.id, status: "PUBLISHED" });

    await expectDatabaseError(prisma.knowledgeSource.delete({ where: { id: source.id } }), {
      code: "P2003",
    });
    expect(await prisma.knowledgeSource.count()).toBe(1);
  });
});

describe("KnowledgeArticle", () => {
  it("defaults to a DRAFT for the general public, and may be drafted without a source", async () => {
    const article = await createArticle({});

    expect(article).toMatchObject({ status: "DRAFT", audience: "GENERAL_PUBLIC", sourceId: null });
  });

  it("requires a source that exists", async () => {
    await expectDatabaseError(createArticle({ sourceId: randomUUID() }), { code: "P2003" });
  });

  it("cannot be PUBLISHED without a source", async () => {
    await expectCheckViolation(
      createArticle({ status: "PUBLISHED" }),
      "knowledge_articles_published_has_source_check",
    );

    const draft = await createArticle({});
    await expectCheckViolation(
      prisma.knowledgeArticle.update({ where: { id: draft.id }, data: { status: "PUBLISHED" } }),
      "knowledge_articles_published_has_source_check",
    );
  });

  it("links to its source", async () => {
    const source = await createSource();
    const article = await createArticle({ sourceId: source.id, status: "PUBLISHED" });

    const loaded = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: source.id },
      include: { articles: true },
    });
    expect(loaded.articles.map((candidate) => candidate.id)).toEqual([article.id]);
  });

  it("has a unique, kebab-case slug", async () => {
    await createArticle({ slug: "same-slug" });

    await expectDatabaseError(createArticle({ slug: "same-slug" }), { code: "P2002" });
    await expectCheckViolation(
      createArticle({ slug: "Not_Kebab" }),
      "knowledge_articles_slug_format_check",
    );
  });

  it("requires review dates when time-sensitive", async () => {
    await expectCheckViolation(
      createArticle({ isTimeSensitive: true }),
      "knowledge_articles_time_sensitive_review_dates_check",
    );
    await expectCheckViolation(
      createArticle({
        isTimeSensitive: true,
        lastReviewedAt: new Date(),
        nextReviewAt: new Date(Date.now() - DAY),
      }),
      "knowledge_articles_review_order_check",
    );
  });

  it.each([
    ["category", "LOANS"],
    ["status", "LIVE"],
    ["audience", "EVERYONE"],
  ])("rejects an unknown %s at the database level", async (column, value) => {
    const insert =
      column === "category"
        ? prisma.$executeRaw`INSERT INTO knowledge_articles (slug, category) VALUES ('raw-article', ${value}::knowledge_category)`
        : column === "status"
          ? prisma.$executeRaw`INSERT INTO knowledge_articles (slug, category, status) VALUES ('raw-article', 'SAVING', ${value}::knowledge_article_status)`
          : prisma.$executeRaw`INSERT INTO knowledge_articles (slug, category, audience) VALUES ('raw-article', 'SAVING', ${value}::knowledge_audience)`;

    await expectDatabaseError(insert, { code: "P2010", message: "invalid input value for enum" });
  });
});

describe("KnowledgeArticleTranslation", () => {
  it("links to its article, and is deleted with it", async () => {
    const article = await createArticle({});
    await createTranslation(article.id, "EN");
    await createTranslation(article.id, "SI");

    expect(
      await prisma.knowledgeArticleTranslation.count({ where: { articleId: article.id } }),
    ).toBe(2);
    await prisma.knowledgeArticle.delete({ where: { id: article.id } });
    expect(await prisma.knowledgeArticleTranslation.count()).toBe(0);
  });

  it("allows only one translation per article and language", async () => {
    const article = await createArticle({});
    await createTranslation(article.id, "EN");

    await expectDatabaseError(createTranslation(article.id, "EN"), { code: "P2002" });
  });

  it("requires an existing article", async () => {
    await expectDatabaseError(createTranslation(randomUUID()), { code: "P2003" });
  });

  it("rejects an unsupported language at the database level", async () => {
    const article = await createArticle({});

    await expectDatabaseError(
      prisma.$executeRaw`
        INSERT INTO knowledge_article_translations (article_id, language, title, summary, body, translation_status)
        VALUES (${article.id}::uuid, ${"FR"}::language, 'T', 'S', 'B', 'MACHINE_ASSISTED')`,
      { code: "P2010", message: "invalid input value for enum" },
    );
  });

  it("rejects blank text and NULL keywords", async () => {
    const article = await createArticle({});

    await expectCheckViolation(
      prisma.knowledgeArticleTranslation.create({
        data: {
          articleId: article.id,
          language: "EN",
          title: "  ",
          summary: "S",
          body: "B",
          translationStatus: "MACHINE_ASSISTED",
        },
      }),
      "knowledge_article_translations_title_not_blank_check",
    );
    await expectDatabaseError(
      prisma.$executeRaw`
        INSERT INTO knowledge_article_translations (article_id, language, title, summary, body, keywords, translation_status)
        VALUES (${article.id}::uuid, 'EN', 'T', 'S', 'B', NULL, 'MACHINE_ASSISTED')`,
      { code: "P2010", message: "knowledge_article_translations_keywords_not_null_check" },
    );
  });
});
