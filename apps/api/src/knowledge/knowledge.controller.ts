import {
  getKnowledgeArticleQuerySchema,
  knowledgeArticleParamsSchema,
  listKnowledgeArticlesQuerySchema,
  type GetKnowledgeArticleQuery,
  type KnowledgeArticleParams,
  type KnowledgeArticleResponse,
  type KnowledgeCategoriesResponse,
  type KnowledgeSearchResponse,
  type ListKnowledgeArticlesQuery,
} from "@finvoice/contracts";
import { Controller, Get, Param, Query } from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service.js";

/**
 * Read-only knowledge API. There are deliberately no write endpoints: content is managed through
 * the controlled knowledge seed until authenticated administration exists.
 */
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get("categories")
  categories(): Promise<KnowledgeCategoriesResponse> {
    return this.knowledge.categories();
  }

  @Get("articles")
  list(
    @Query({ schema: listKnowledgeArticlesQuerySchema }) query: ListKnowledgeArticlesQuery,
  ): Promise<KnowledgeSearchResponse> {
    return this.knowledge.list(query);
  }

  @Get("articles/:slug")
  get(
    @Param({ schema: knowledgeArticleParamsSchema }) params: KnowledgeArticleParams,
    @Query({ schema: getKnowledgeArticleQuerySchema }) query: GetKnowledgeArticleQuery,
  ): Promise<KnowledgeArticleResponse> {
    return this.knowledge.get(params.slug, query.language);
  }
}
