import type {
  ApiErrorResponse,
  KnowledgeArticleResponse,
  KnowledgeCategoriesResponse,
  KnowledgeSearchResponse,
} from "@finvoice/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";
import { createKnowledgeFixtures, FIXTURE_SOURCE, PUBLIC_SLUGS } from "./knowledge-fixtures.js";

const ARTICLES = "/api/v1/knowledge/articles";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  await createKnowledgeFixtures(api.prisma);
});

function search(query: Record<string, string> = {}) {
  const params = new URLSearchParams(query).toString();
  return api.request<KnowledgeSearchResponse>("GET", `${ARTICLES}${params ? `?${params}` : ""}`);
}

async function slugsFor(query: Record<string, string>) {
  const response = await search(query);
  expect(response.status).toBe(200);
  return response.body.data.map((article) => article.slug).sort();
}

describe("GET /api/v1/knowledge/articles", () => {
  it("lists only published articles that have English text", async () => {
    const response = await search();

    expect(response.status).toBe(200);
    expect(response.body.data.map((article) => article.slug).sort()).toEqual(PUBLIC_SLUGS);
    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
  });

  it("never includes drafts or archived articles, even when they match a search", async () => {
    const slugs = await slugsFor({ query: "saving" });

    expect(slugs).toEqual(["saving-basics"]);
    const everything = await search({ limit: "100" });
    expect(everything.text).not.toContain("budget-draft");
    expect(everything.text).not.toContain("Draft budget secret");
    expect(everything.text).not.toContain("rights-archived");
    expect(everything.text).not.toContain("Withdrawn archived text");
  });

  it("filters by category", async () => {
    expect(await slugsFor({ category: "DEPOSIT_PROTECTION" })).toEqual([
      "coverage-current",
      "coverage-overdue",
    ]);
    expect(await slugsFor({ category: "BUDGETING" })).toEqual([]);
  });

  it("returns the requested language where a translation exists and falls back to English", async () => {
    const response = await search({ language: "SI" });

    const byslug = new Map(response.body.data.map((article) => [article.slug, article]));
    expect(byslug.get("saving-basics")).toMatchObject({
      requestedLanguage: "SI",
      language: "SI",
      title: "ඉතිරි කිරීමේ මූලික කරුණු",
    });
    expect(byslug.get("spot-a-scam")).toMatchObject({
      requestedLanguage: "SI",
      language: "EN",
      title: "Spot a scam",
    });
  });

  it("searches titles, summaries, bodies and keywords, case-insensitively", async () => {
    expect(await slugsFor({ query: "RAINY" })).toEqual(["saving-basics"]);
    expect(await slugsFor({ query: "warning signs" })).toEqual(["spot-a-scam"]);
    expect(await slugsFor({ query: "fraud" })).toEqual(["spot-a-scam"]);
    expect(await slugsFor({ query: "nothing matches this" })).toEqual([]);
  });

  it("searches Sinhala text when Sinhala is requested", async () => {
    expect(await slugsFor({ query: "හදිසි", language: "SI" })).toEqual(["saving-basics"]);
    expect(await slugsFor({ query: "ඉතිරි කිරීම", language: "SI" })).toEqual(["saving-basics"]);
  });

  it("treats % and _ in the search text literally, not as wildcards", async () => {
    expect(await slugsFor({ query: "%" })).toEqual(["spot-a-scam"]);
    expect(await slugsFor({ query: "50%" })).toEqual(["spot-a-scam"]);
    expect(await slugsFor({ query: "_" })).toEqual([]);
  });

  it("paginates with a stable order", async () => {
    const page1 = await search({ page: "1", limit: "3" });
    const page2 = await search({ page: "2", limit: "3" });

    expect(page1.body.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect(page2.body.data).toHaveLength(1);
    const all = [...page1.body.data, ...page2.body.data].map((article) => article.slug);
    expect(new Set(all).size).toBe(4);
    expect((await search({ page: "3", limit: "3" })).body.data).toEqual([]);
  });

  it("flags overdue time-sensitive articles as requiring review instead of hiding them", async () => {
    const response = await search({ category: "DEPOSIT_PROTECTION" });

    const byslug = new Map(response.body.data.map((article) => [article.slug, article]));
    expect(byslug.get("coverage-overdue")?.review).toMatchObject({
      isTimeSensitive: true,
      reviewRequired: true,
    });
    expect(byslug.get("coverage-current")?.review).toMatchObject({
      isTimeSensitive: true,
      reviewRequired: false,
    });
    expect(byslug.get("coverage-current")?.review.lastReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it.each([
    { unknown: "1" },
    { page: "0" },
    { page: "abc" },
    { limit: "0" },
    { limit: "101" },
    { category: "LOANS" },
    { language: "FR" },
    { language: "en" },
    { query: "   " },
    { query: "x".repeat(101) },
  ])("rejects the query %j", async (query) => {
    const response = await search(query);

    expect(response.status).toBe(400);
    expect((response.body as unknown as ApiErrorResponse).code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/knowledge/articles/:slug", () => {
  it("returns the article with source attribution and no internal fields", async () => {
    const response = await api.request<KnowledgeArticleResponse>("GET", `${ARTICLES}/spot-a-scam`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      slug: "spot-a-scam",
      category: "SCAMS",
      audience: "GENERAL_PUBLIC",
      requestedLanguage: "EN",
      language: "EN",
      translationStatus: "MACHINE_ASSISTED",
      title: "Spot a scam",
      summary: "Warning signs of fraud.",
      body: "A promise of 50% returns in a month is a warning sign.",
      keywords: ["scam", "fraud"],
      source: {
        publisher: FIXTURE_SOURCE.publisher,
        title: FIXTURE_SOURCE.title,
        url: FIXTURE_SOURCE.url,
        type: "OFFICIAL_REGULATOR",
        section: "Section 1",
        lastVerifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      },
      review: { isTimeSensitive: false, reviewRequired: false, lastReviewedAt: null },
    });
    for (const internal of [
      '"id"',
      "sourceId",
      "articleId",
      '"status"',
      "createdAt",
      "updatedAt",
      "nextReviewAt",
    ]) {
      expect(response.text).not.toContain(internal);
    }
  });

  it("returns the Sinhala translation when it exists", async () => {
    const response = await api.request<KnowledgeArticleResponse>(
      "GET",
      `${ARTICLES}/saving-basics?language=SI`,
    );

    expect(response.body).toMatchObject({ requestedLanguage: "SI", language: "SI" });
  });

  it("falls back to English, and says so, when the translation does not exist", async () => {
    const response = await api.request<KnowledgeArticleResponse>(
      "GET",
      `${ARTICLES}/saving-basics?language=TA`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requestedLanguage: "TA",
      language: "EN",
      title: "Saving basics",
    });
  });

  it.each(["no-such-article", "budget-draft", "rights-archived", "borrowing-sinhala-only"])(
    "answers %s with the same 404, revealing nothing about unpublished articles",
    async (slug) => {
      const response = await api.request("GET", `${ARTICLES}/${slug}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Knowledge article not found",
      });
    },
  );

  it.each(["Not_A_Slug", "UPPER", "-leading", "a".repeat(101)])(
    "rejects the malformed slug %s with 400",
    async (slug) => {
      const response = await api.request("GET", `${ARTICLES}/${slug}`);

      expect(response.status).toBe(400);
    },
  );

  it("rejects unknown query parameters", async () => {
    const response = await api.request("GET", `${ARTICLES}/saving-basics?language=SI&draft=true`);

    expect(response.status).toBe(400);
  });
});

describe("GET /api/v1/knowledge/categories", () => {
  it("lists only categories with published articles, with their counts", async () => {
    const response = await api.request<KnowledgeCategoriesResponse>(
      "GET",
      "/api/v1/knowledge/categories",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        { category: "SAVING", articleCount: 1 },
        { category: "SCAMS", articleCount: 1 },
        { category: "DEPOSIT_PROTECTION", articleCount: 2 },
      ],
    });
  });
});

describe("knowledge API surface", () => {
  it.each([
    ["POST", ARTICLES],
    ["PUT", `${ARTICLES}/saving-basics`],
    ["PATCH", `${ARTICLES}/saving-basics`],
    ["DELETE", `${ARTICLES}/saving-basics`],
    ["POST", "/api/v1/knowledge/sources"],
  ])("has no write endpoint: %s %s → 404", async (method, path) => {
    const response = await api.request(method, path, method === "DELETE" ? undefined : {});

    expect(response.status).toBe(404);
    expect(await api.prisma.knowledgeArticle.count()).toBe(7);
  });
});
