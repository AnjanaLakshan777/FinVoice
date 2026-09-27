import type {
  AnalyticsEventSource,
  KnowledgeArticleResponse,
  KnowledgeCategoriesResponse,
  KnowledgeCategory,
  KnowledgeLanguage,
  KnowledgeSearchResponse,
  ListKnowledgeArticlesQuery,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { AnalyticsRecorder, elapsedMs, errorCodeOf } from "../analytics/analytics-recorder.js";
import { ApiException } from "../common/api.exception.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { CANONICAL_LANGUAGE, toKnowledgeArticleResponse } from "./knowledge.mapper.js";

/** A published article's review data, for the admin review queue (no article text). */
export type KnowledgeReviewItem = {
  slug: string;
  /** English title. */
  title: string;
  category: KnowledgeCategory;
  isTimeSensitive: boolean;
  nextReviewAt: Date | null;
  /** Has a Sinhala or Tamil translation. */
  translated: boolean;
};

/**
 * Read-only retrieval of published knowledge with deterministic PostgreSQL queries: exact filters,
 * case-insensitive substring search and a stable order. No embeddings, ranking or generated text.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsRecorder,
  ) {}

  /**
   * Lists or searches published articles. With `source` (the public knowledge API), the search is
   * counted as a KNOWLEDGE_SEARCH analytics event: language and category filter only, never the
   * search text. Callers such as the agent's tools omit it: their use is counted as tool calls.
   */
  async list(
    query: ListKnowledgeArticlesQuery,
    source?: AnalyticsEventSource,
  ): Promise<KnowledgeSearchResponse> {
    const started = performance.now();
    try {
      const result = await this.search(query);
      this.track(source, "KNOWLEDGE_SEARCH", query.language, query.category, started);
      return result;
    } catch (error) {
      this.track(source, "KNOWLEDGE_SEARCH", query.language, query.category, started, error);
      throw error;
    }
  }

  /**
   * A published article by slug. Drafts, archived and unknown slugs are indistinguishable (404).
   * With `source`, the view is counted as a KNOWLEDGE_ARTICLE_VIEW event (language and category
   * only, not the slug).
   */
  async get(
    slug: string,
    language: KnowledgeLanguage,
    source?: AnalyticsEventSource,
  ): Promise<KnowledgeArticleResponse> {
    const started = performance.now();
    try {
      const article = await this.find(slug, language);
      this.track(source, "KNOWLEDGE_ARTICLE_VIEW", language, article.category, started);
      return article;
    } catch (error) {
      this.track(source, "KNOWLEDGE_ARTICLE_VIEW", language, undefined, started, error);
      throw error;
    }
  }

  /**
   * Every published article with its English title and review data, for the read-only review
   * queue of the admin dashboard. The knowledge tables stay the single source of truth.
   */
  async reviewItems(): Promise<KnowledgeReviewItem[]> {
    const articles = await this.prisma.knowledgeArticle.findMany({
      where: publishedArticles({}),
      select: {
        slug: true,
        category: true,
        isTimeSensitive: true,
        nextReviewAt: true,
        translations: { select: { language: true, title: true } },
      },
      orderBy: { slug: "asc" },
    });
    return articles.map((article) => ({
      slug: article.slug,
      title:
        article.translations.find((translation) => translation.language === CANONICAL_LANGUAGE)
          ?.title ?? article.slug,
      category: article.category,
      isTimeSensitive: article.isTimeSensitive,
      nextReviewAt: article.nextReviewAt,
      translated: article.translations.some(
        (translation) => translation.language !== CANONICAL_LANGUAGE,
      ),
    }));
  }

  private track(
    source: AnalyticsEventSource | undefined,
    eventType: "KNOWLEDGE_SEARCH" | "KNOWLEDGE_ARTICLE_VIEW",
    language: KnowledgeLanguage,
    category: KnowledgeCategory | undefined,
    started: number,
    error?: unknown,
  ): void {
    if (source === undefined) {
      return;
    }
    this.analytics.record({
      eventType,
      source,
      language,
      ...(category === undefined ? {} : { knowledgeCategory: category }),
      success: error === undefined,
      durationMs: elapsedMs(started),
      ...(error === undefined ? {} : { errorCode: errorCodeOf(error) }),
    });
  }

  private async search(query: ListKnowledgeArticlesQuery): Promise<KnowledgeSearchResponse> {
    const where = publishedArticles({
      ...(query.category ? { category: query.category } : {}),
      ...(query.query ? { translations: { some: matching(query.query, query.language) } } : {}),
    });

    const [total, articles] = await this.prisma.$transaction([
      this.prisma.knowledgeArticle.count({ where }),
      this.prisma.knowledgeArticle.findMany({
        where,
        include: includeFor(query.language),
        orderBy: [{ category: "asc" }, { slug: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const now = new Date();
    return {
      data: articles.flatMap((article) => {
        const response = toKnowledgeArticleResponse(article, query.language, now);
        return response ? [response] : [];
      }),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  private async find(slug: string, language: KnowledgeLanguage): Promise<KnowledgeArticleResponse> {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: publishedArticles({ slug }),
      include: includeFor(language),
    });
    const response = article ? toKnowledgeArticleResponse(article, language, new Date()) : null;
    if (!response) {
      throw ApiException.notFound("Knowledge article not found");
    }
    return response;
  }

  /**
   * Published articles for several slugs in ONE query, keyed by slug (for callers that cite many
   * articles, such as ScamShield). Unknown, draft, archived and unsafe articles are simply absent.
   */
  async getPublishedMany(
    slugs: readonly string[],
    language: KnowledgeLanguage,
  ): Promise<Map<string, KnowledgeArticleResponse>> {
    const unique = [...new Set(slugs)];
    if (unique.length === 0) {
      return new Map();
    }
    const articles = await this.prisma.knowledgeArticle.findMany({
      where: publishedArticles({ slug: { in: unique } }),
      include: includeFor(language),
    });
    const now = new Date();
    return new Map(
      articles.flatMap((article) => {
        const response = toKnowledgeArticleResponse(article, language, now);
        return response ? [[response.slug, response] as const] : [];
      }),
    );
  }

  /** Categories that currently have at least one published article. */
  async categories(): Promise<KnowledgeCategoriesResponse> {
    const groups = await this.prisma.knowledgeArticle.groupBy({
      by: ["category"],
      where: publishedArticles({}),
      _count: { _all: true },
      orderBy: { category: "asc" },
    });
    return {
      data: groups.map((group) => ({ category: group.category, articleCount: group._count._all })),
    };
  }
}

/**
 * Only PUBLISHED articles that have a source and English text are public. (The database already
 * requires a source for PUBLISHED articles; English text cannot be enforced there.)
 */
function publishedArticles(
  filter: Prisma.KnowledgeArticleWhereInput,
): Prisma.KnowledgeArticleWhereInput {
  return {
    AND: [
      { status: "PUBLISHED", sourceId: { not: null } },
      { translations: { some: { language: CANONICAL_LANGUAGE } } },
      filter,
    ],
  };
}

/** The requested language and the English fallback. */
function candidateLanguages(language: KnowledgeLanguage): KnowledgeLanguage[] {
  return language === CANONICAL_LANGUAGE ? [language] : [language, CANONICAL_LANGUAGE];
}

/** Only the translations a response can use: the requested language and the English fallback. */
function includeFor(language: KnowledgeLanguage) {
  return {
    source: true,
    translations: { where: { language: { in: candidateLanguages(language) } } },
  } satisfies Prisma.KnowledgeArticleInclude;
}

/**
 * Lexical search: the text matches if the requested-language or English translation contains the
 * words (case-insensitive) in its title, summary or body, or has the words as a keyword.
 */
function matching(
  text: string,
  language: KnowledgeLanguage,
): Prisma.KnowledgeArticleTranslationWhereInput {
  const pattern = escapeLikeWildcards(text);
  return {
    language: { in: candidateLanguages(language) },
    OR: [
      { title: { contains: pattern, mode: "insensitive" } },
      { summary: { contains: pattern, mode: "insensitive" } },
      { body: { contains: pattern, mode: "insensitive" } },
      { keywords: { has: text.toLowerCase() } },
    ],
  };
}

/**
 * Prisma passes `contains` to SQL LIKE without escaping, so "%" or "_" in the search text would act
 * as wildcards and match everything. Escape them (and the escape character) so they match literally.
 */
export function escapeLikeWildcards(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
