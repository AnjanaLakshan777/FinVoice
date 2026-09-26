import type { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  knowledgeArticles,
  knowledgeSources,
  type KnowledgeArticleContent,
  type KnowledgeSourceContent,
  type KnowledgeTranslationContent,
} from "./content.js";

export type KnowledgeSeedReport = {
  created: { sources: number; articles: number; translations: number };
  /** Records already present and identical to the seed content. */
  unchanged: number;
  /** Records already present but different from the seed content: left untouched. */
  differing: string[];
};

/**
 * Inserts the curated knowledge content (./content.ts) where it is missing.
 *
 * Insert-only, by natural key (source URL, article slug, article + language): existing records are
 * never updated or deleted, so edits made in the database are never overwritten and running the
 * seed again changes nothing. Records that differ from the seed content are reported, not changed.
 * Everything runs in one transaction.
 */
export async function seedKnowledge(prisma: PrismaClient): Promise<KnowledgeSeedReport> {
  const report: KnowledgeSeedReport = {
    created: { sources: 0, articles: 0, translations: 0 },
    unchanged: 0,
    differing: [],
  };

  await prisma.$transaction(async (tx) => {
    const sourceIds = new Map<string, string>();
    for (const source of knowledgeSources) {
      const existing = await tx.knowledgeSource.findUnique({ where: { url: source.url } });
      if (existing) {
        track(report, `source ${source.url}`, sameSource(existing, source));
        sourceIds.set(source.url, existing.id);
        continue;
      }
      const created = await tx.knowledgeSource.create({ data: toSourceData(source) });
      report.created.sources += 1;
      sourceIds.set(source.url, created.id);
    }

    for (const article of knowledgeArticles) {
      const sourceId = sourceIds.get(article.sourceUrl);
      if (!sourceId) {
        throw new Error(`Article "${article.slug}" cites an unknown source: ${article.sourceUrl}`);
      }
      let stored = await tx.knowledgeArticle.findUnique({ where: { slug: article.slug } });
      if (stored) {
        track(report, `article ${article.slug}`, sameArticle(stored, article, sourceId));
      } else {
        stored = await tx.knowledgeArticle.create({ data: toArticleData(article, sourceId) });
        report.created.articles += 1;
      }

      for (const [language, translation] of Object.entries(article.translations) as [
        "EN" | "SI" | "TA",
        KnowledgeTranslationContent,
      ][]) {
        const existing = await tx.knowledgeArticleTranslation.findUnique({
          where: { articleId_language: { articleId: stored.id, language } },
        });
        if (existing) {
          track(
            report,
            `translation ${article.slug}/${language}`,
            sameTranslation(existing, translation),
          );
          continue;
        }
        await tx.knowledgeArticleTranslation.create({
          data: { articleId: stored.id, language, ...translation },
        });
        report.created.translations += 1;
      }
    }
  });

  return report;
}

function track(report: KnowledgeSeedReport, label: string, same: boolean): void {
  if (same) {
    report.unchanged += 1;
  } else {
    report.differing.push(label);
  }
}

function toSourceData(source: KnowledgeSourceContent) {
  return {
    url: source.url,
    publisher: source.publisher,
    title: source.title,
    sourceType: source.sourceType,
    originalLanguage: source.originalLanguage,
    publishedOn: source.publishedOn ? new Date(`${source.publishedOn}T00:00:00.000Z`) : null,
    retrievedAt: new Date(source.retrievedAt),
    lastVerifiedAt: new Date(source.lastVerifiedAt),
    nextReviewAt: new Date(source.nextReviewAt),
  };
}

function toArticleData(article: KnowledgeArticleContent, sourceId: string) {
  return {
    slug: article.slug,
    category: article.category,
    status: article.status,
    audience: article.audience,
    sourceId,
    sourceSection: article.sourceSection,
    isTimeSensitive: article.isTimeSensitive,
    lastReviewedAt: new Date(article.lastReviewedAt),
    nextReviewAt: new Date(article.nextReviewAt),
  };
}

function sameSource(stored: Record<string, unknown>, source: KnowledgeSourceContent): boolean {
  return sameFields(stored, toSourceData(source));
}

function sameArticle(
  stored: Record<string, unknown>,
  article: KnowledgeArticleContent,
  sourceId: string,
): boolean {
  return sameFields(stored, toArticleData(article, sourceId));
}

function sameTranslation(
  stored: Record<string, unknown>,
  translation: KnowledgeTranslationContent,
): boolean {
  return sameFields(stored, translation);
}

/** Compares the seed-controlled fields only (not ids or timestamps managed by the database). */
function sameFields(stored: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([field, value]) => {
    const actual = stored[field];
    if (value instanceof Date || actual instanceof Date) {
      return (
        value instanceof Date && actual instanceof Date && value.getTime() === actual.getTime()
      );
    }
    return JSON.stringify(actual) === JSON.stringify(value);
  });
}
