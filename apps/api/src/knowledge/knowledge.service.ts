import type {
  KnowledgeArticleResponse,
  KnowledgeCategoriesResponse,
  KnowledgeLanguage,
  KnowledgeSearchResponse,
  ListKnowledgeArticlesQuery,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { CANONICAL_LANGUAGE, toKnowledgeArticleResponse } from "./knowledge.mapper.js";

/**
 * Read-only retrieval of published knowledge with deterministic PostgreSQL queries: exact filters,
 * case-insensitive substring search and a stable order. No embeddings, ranking or generated text.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListKnowledgeArticlesQuery): Promise<KnowledgeSearchResponse> {
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

  /** A published article by slug. Drafts, archived and unknown slugs are indistinguishable (404). */
  async get(slug: string, language: KnowledgeLanguage): Promise<KnowledgeArticleResponse> {
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
