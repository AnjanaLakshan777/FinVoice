import type { KnowledgeArticleResponse, KnowledgeLanguage } from "@finvoice/contracts";

import type {
  KnowledgeArticle,
  KnowledgeArticleTranslation,
  KnowledgeSource,
} from "../generated/prisma/client.js";

export type ArticleWithRelations = KnowledgeArticle & {
  source: KnowledgeSource | null;
  translations: KnowledgeArticleTranslation[];
};

/** The language used when a requested translation does not exist. */
export const CANONICAL_LANGUAGE: KnowledgeLanguage = "EN";

/**
 * Maps a published article to its public representation, in the requested language or, if that
 * translation does not exist, in English. `language` tells the client which one it got; text is
 * never generated or machine-translated on the fly.
 *
 * Returns null for an article that cannot be shown safely (no source, or no English text). Queries
 * already exclude such articles; this is a second line of defence.
 */
export function toKnowledgeArticleResponse(
  article: ArticleWithRelations,
  requestedLanguage: KnowledgeLanguage,
  now: Date,
): KnowledgeArticleResponse | null {
  const translation =
    article.translations.find((candidate) => candidate.language === requestedLanguage) ??
    article.translations.find((candidate) => candidate.language === CANONICAL_LANGUAGE);
  const { source } = article;
  if (!translation || !source) {
    return null;
  }

  return {
    slug: article.slug,
    category: article.category,
    audience: article.audience,
    requestedLanguage,
    language: translation.language,
    translationStatus: translation.translationStatus,
    title: translation.title,
    summary: translation.summary,
    body: translation.body,
    keywords: translation.keywords,
    source: {
      publisher: source.publisher,
      title: source.title,
      url: source.url,
      type: source.sourceType,
      section: article.sourceSection,
      lastVerifiedAt: source.lastVerifiedAt.toISOString(),
    },
    review: {
      isTimeSensitive: article.isTimeSensitive,
      reviewRequired: isReviewOverdue(article, now),
      lastReviewedAt: article.lastReviewedAt?.toISOString() ?? null,
    },
  };
}

/**
 * A time-sensitive article past its review date may state outdated facts (for example an old
 * coverage limit). It is still returned, flagged, so clients never present it as current.
 */
export function isReviewOverdue(
  article: Pick<KnowledgeArticle, "isTimeSensitive" | "nextReviewAt">,
  now: Date,
): boolean {
  return (
    article.isTimeSensitive &&
    article.nextReviewAt !== null &&
    article.nextReviewAt.getTime() < now.getTime()
  );
}
