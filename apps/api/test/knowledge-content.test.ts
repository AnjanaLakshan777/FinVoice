import { describe, expect, it } from "vitest";

import {
  knowledgeArticles,
  knowledgeSources,
  type KnowledgeTranslationContent,
} from "../prisma/knowledge/content.js";
import { isReviewOverdue } from "../src/knowledge/knowledge.mapper.js";
import { escapeLikeWildcards } from "../src/knowledge/knowledge.service.js";

// Deterministic checks on the curated knowledge content (prisma/knowledge/content.ts). No database.

type LanguageCode = "EN" | "SI" | "TA";

function translationsOf(article: (typeof knowledgeArticles)[number]) {
  return Object.entries(article.translations) as [LanguageCode, KnowledgeTranslationContent][];
}

function allText(translation: KnowledgeTranslationContent): string {
  return [translation.title, translation.summary, translation.body, ...translation.keywords].join(
    "\n",
  );
}

describe("knowledge sources", () => {
  it.each(knowledgeSources.map((source) => [source.url, source] as const))(
    "%s is an absolute HTTPS URL with complete metadata",
    (url, source) => {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.hostname).toContain(".");
      expect(source.publisher.trim()).not.toBe("");
      expect(source.title.trim()).not.toBe("");
      expect(Date.parse(source.nextReviewAt)).toBeGreaterThan(Date.parse(source.lastVerifiedAt));
      expect(Date.parse(source.lastVerifiedAt)).toBeGreaterThanOrEqual(
        Date.parse(source.retrievedAt),
      );
      if (source.publishedOn !== null) {
        expect(source.publishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    },
  );

  it("records each source once", () => {
    const urls = knowledgeSources.map((source) => source.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("uses only official Central Bank of Sri Lanka sources for the initial content", () => {
    for (const source of knowledgeSources) {
      expect(new URL(source.url).hostname).toBe("www.cbsl.gov.lk");
      expect(source).toMatchObject({
        publisher: "Central Bank of Sri Lanka",
        sourceType: "OFFICIAL_REGULATOR",
      });
    }
  });

  it("has no unused sources", () => {
    const cited = new Set(knowledgeArticles.map((article) => article.sourceUrl));
    expect(knowledgeSources.filter((source) => !cited.has(source.url))).toEqual([]);
  });
});

describe("knowledge articles", () => {
  it("has between 8 and 12 articles with unique, kebab-case slugs", () => {
    const slugs = knowledgeArticles.map((article) => article.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(8);
    expect(slugs.length).toBeLessThanOrEqual(12);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it.each(knowledgeArticles.map((article) => [article.slug, article] as const))(
    "%s cites a known source and has non-empty English content",
    (_slug, article) => {
      const sourceUrls = new Set(knowledgeSources.map((source) => source.url));
      expect(sourceUrls.has(article.sourceUrl)).toBe(true);
      expect(article.sourceSection.trim()).not.toBe("");
      expect(article.sourceSection.length).toBeLessThanOrEqual(300);
      for (const [, translation] of translationsOf(article)) {
        expect(translation.title.trim()).not.toBe("");
        expect(translation.summary.trim()).not.toBe("");
        expect(translation.body.trim()).not.toBe("");
        expect(translation.title.length).toBeLessThanOrEqual(200);
        expect(translation.summary.length).toBeLessThanOrEqual(500);
        expect(translation.keywords.length).toBeGreaterThan(0);
        for (const keyword of translation.keywords) {
          expect(keyword).toBe(keyword.toLowerCase().trim());
        }
      }
      expect(article.translations.EN.body.length).toBeGreaterThan(100);
    },
  );

  it("gives every time-sensitive article review dates, reviewed at most every 3 months", () => {
    const timeSensitive = knowledgeArticles.filter((article) => article.isTimeSensitive);
    expect(timeSensitive.map((article) => article.slug)).toEqual(["deposit-insurance"]);
    for (const article of timeSensitive) {
      const interval = Date.parse(article.nextReviewAt) - Date.parse(article.lastReviewedAt);
      expect(interval).toBeGreaterThan(0);
      expect(interval).toBeLessThanOrEqual(93 * 24 * 60 * 60 * 1000);
    }
  });

  it("keeps changeable figures only in time-sensitive articles", () => {
    // Amounts in rupees can change (e.g. the deposit insurance limit) and need regular review.
    for (const article of knowledgeArticles) {
      const mentionsRupees = translationsOf(article).some(([, translation]) =>
        /Rs\.?\s?\d/.test(allText(translation)),
      );
      if (mentionsRupees) {
        expect(article.isTimeSensitive, article.slug).toBe(true);
      }
    }
  });

  it("contains no placeholders", () => {
    const placeholders =
      /\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum|example\.com|<\s*placeholder\s*>|\[insert/i;
    for (const article of knowledgeArticles) {
      for (const [language, translation] of translationsOf(article)) {
        expect(allText(translation), `${article.slug}/${language}`).not.toMatch(placeholders);
      }
      expect(article.sourceUrl).not.toMatch(placeholders);
    }
  });

  it("does not promise returns, recommend products or institutions, or give personal advice", () => {
    const unsafe =
      /\bguarantee(d|s)?\b|risk[- ]free|high returns|\bwe recommend\b|\byou should (invest|take out|borrow)\b|\bbest bank\b|\bapproved\b/i;
    for (const article of knowledgeArticles) {
      expect(allText(article.translations.EN), article.slug).not.toMatch(unsafe);
    }
  });

  it("contains no calculation formulas (those belong to the finance engine)", () => {
    for (const article of knowledgeArticles) {
      expect(allText(article.translations.EN), article.slug).not.toMatch(
        /EMI|\(1 \+ r\)|\^n|=\s*P\b/,
      );
    }
  });
});

describe("translations", () => {
  it("are never marked OFFICIAL: no source provides an official translation", () => {
    for (const article of knowledgeArticles) {
      for (const [language, translation] of translationsOf(article)) {
        expect(translation.translationStatus, `${article.slug}/${language}`).toBe(
          "MACHINE_ASSISTED",
        );
      }
    }
  });

  it("add no numbers that are not in the English text", () => {
    for (const article of knowledgeArticles) {
      const englishNumbers = new Set(allText(article.translations.EN).match(/\d[\d,.]*/g) ?? []);
      for (const [language, translation] of translationsOf(article)) {
        for (const number of allText(translation).match(/\d[\d,.]*/g) ?? []) {
          expect(englishNumbers.has(number), `${article.slug}/${language}: ${number}`).toBe(true);
        }
      }
    }
  });

  it("have the same structure (paragraphs and list items) as the English text", () => {
    const shape = (text: string) => ({
      paragraphs: text.split("\n\n").length,
      listItems: text.split("\n").filter((line) => line.startsWith("- ")).length,
    });
    for (const article of knowledgeArticles) {
      for (const [language, translation] of translationsOf(article)) {
        expect(shape(translation.body), `${article.slug}/${language}`).toEqual(
          shape(article.translations.EN.body),
        );
      }
    }
  });
});

describe("retrieval helpers", () => {
  it("escapes LIKE wildcards so search text matches literally", () => {
    expect(escapeLikeWildcards("50%")).toBe("50\\%");
    expect(escapeLikeWildcards("a_b")).toBe("a\\_b");
    expect(escapeLikeWildcards("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikeWildcards("plain words")).toBe("plain words");
  });

  it("flags only time-sensitive articles past their review date", () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    const past = new Date("2026-09-25T00:00:00.000Z");
    const future = new Date("2026-09-27T00:00:00.000Z");

    expect(isReviewOverdue({ isTimeSensitive: true, nextReviewAt: past }, now)).toBe(true);
    expect(isReviewOverdue({ isTimeSensitive: true, nextReviewAt: future }, now)).toBe(false);
    expect(isReviewOverdue({ isTimeSensitive: false, nextReviewAt: past }, now)).toBe(false);
    expect(isReviewOverdue({ isTimeSensitive: false, nextReviewAt: null }, now)).toBe(false);
  });
});
