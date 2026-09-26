import {
  getKnowledgeArticleToolInputSchema,
  KNOWLEDGE_CATEGORIES,
  LANGUAGES,
  SEARCH_KNOWLEDGE_QUERY_MAX_LENGTH,
  searchKnowledgeToolInputSchema,
  type KnowledgeArticleResponse,
} from "@finvoice/contracts";

import { ApiException } from "../../common/api.exception.js";
import type { KnowledgeService } from "../../knowledge/knowledge.service.js";
import { defineTool, type AgentTool } from "./agent-tool.js";

/** Maximum articles returned by one search: enough context, bounded payload size. */
export const SEARCH_KNOWLEDGE_RESULT_LIMIT = 3;

const languageParameter = {
  type: "string",
  enum: [...LANGUAGES],
  description:
    "Preferred language of the article text (EN, SI or TA). English is returned when no translation exists. Defaults to the user's language.",
};

/**
 * Knowledge tools. They go through KnowledgeService, so only PUBLISHED articles are ever visible
 * (drafts and archived articles are indistinguishable from non-existent ones) and the Step 5
 * language fallback and review rules apply unchanged.
 */
export function createKnowledgeTools(knowledge: KnowledgeService): AgentTool[] {
  return [
    defineTool({
      name: "search_knowledge",
      description:
        "Search FinVoice's verified, source-backed financial-literacy articles (saving, budgeting, borrowing, digital finance, consumer protection, scams, deposit insurance, financial literacy). Use this before answering any factual question on these topics. Returns up to 3 articles with their source.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            maxLength: SEARCH_KNOWLEDGE_QUERY_MAX_LENGTH,
            description:
              'One or two simple English keywords, e.g. "emergency fund", "loan", "scam", "budget", "deposit insurance", "otp". The search matches words in the articles, not whole questions.',
          },
          language: languageParameter,
          category: {
            type: "string",
            enum: [...KNOWLEDGE_CATEGORIES],
            description: "Optional category to narrow the search.",
          },
        },
        required: ["query"],
      },
      input: searchKnowledgeToolInputSchema,
      run: async (input, context) => {
        const language = input.language ?? context.language;
        const found = await knowledge.list({
          query: input.query,
          language,
          page: 1,
          limit: SEARCH_KNOWLEDGE_RESULT_LIMIT,
          ...(input.category ? { category: input.category } : {}),
        });
        return {
          guidance: KNOWLEDGE_GUIDANCE,
          requestedLanguage: language,
          totalMatches: found.meta.total,
          results: found.data.map(toToolArticle),
          ...(found.data.length === 0
            ? {
                note: "No FinVoice article matched. Try one different simple keyword, or tell the user that the FinVoice knowledge base does not currently contain information on this.",
              }
            : {}),
        };
      },
    }),

    defineTool({
      name: "get_knowledge_article",
      description:
        "Get one FinVoice knowledge article by its slug (as returned by search_knowledge), with its source.",
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            maxLength: 100,
            description: 'The article slug, e.g. "responsible-borrowing".',
          },
          language: languageParameter,
        },
        required: ["slug"],
      },
      input: getKnowledgeArticleToolInputSchema,
      run: async (input, context) => {
        const language = input.language ?? context.language;
        try {
          const article = await knowledge.get(input.slug, language);
          return { found: true, guidance: KNOWLEDGE_GUIDANCE, article: toToolArticle(article) };
        } catch (error) {
          if (error instanceof ApiException && error.body.statusCode === 404) {
            return { found: false, note: "No published FinVoice article has this slug." };
          }
          throw error;
        }
      },
    }),
  ];
}

/**
 * Sent with every knowledge result, so the boundary of what may be stated as fact is part of the
 * data itself, not only of the system instruction.
 */
export const KNOWLEDGE_GUIDANCE =
  "Only the authoritativeContent of the articles below is verified FinVoice knowledge. State financial facts only from it (you may simplify or paraphrase), attribute them to the article's source, and say when it does not cover the question. Do not add facts, figures, rules or advice from elsewhere.";

/** Added to articles whose time-sensitive details are past their review date. */
export const REVIEW_REQUIRED_NOTE =
  "This article is marked for review. Do not present its time-sensitive details (amounts, limits, rules) as current; tell the user to check the latest details with the source.";

/**
 * The public article fields the model needs to answer and cite. The article's text is grouped
 * under `authoritativeContent`; everything else is metadata. No ids or internal data.
 */
function toToolArticle(article: KnowledgeArticleResponse) {
  return {
    slug: article.slug,
    category: article.category,
    requestedLanguage: article.requestedLanguage,
    language: article.language,
    authoritativeContent: {
      title: article.title,
      summary: article.summary,
      body: article.body,
    },
    source: {
      publisher: article.source.publisher,
      title: article.source.title,
      url: article.source.url,
      section: article.source.section,
      lastVerifiedAt: article.source.lastVerifiedAt,
    },
    review: {
      isTimeSensitive: article.review.isTimeSensitive,
      reviewRequired: article.review.reviewRequired,
      ...(article.review.reviewRequired ? { note: REVIEW_REQUIRED_NOTE } : {}),
    },
  };
}
