import { z } from "zod";

import { paginationQuerySchema, type PaginatedResponse } from "./common.js";
import { LANGUAGES, type Language } from "./users.js";

/**
 * Contracts of the read-only knowledge API (/api/v1/knowledge). Responses expose public metadata
 * only: no database ids, and no internal status or bookkeeping fields.
 */

export const KNOWLEDGE_CATEGORIES = [
  "SAVING",
  "BUDGETING",
  "BORROWING",
  "DIGITAL_FINANCE",
  "CONSUMER_PROTECTION",
  "SCAMS",
  "DEPOSIT_PROTECTION",
  "GENERAL_FINANCIAL_LITERACY",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];
export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES, {
  error: `Must be one of: ${KNOWLEDGE_CATEGORIES.join(", ")}`,
});

export type KnowledgeLanguage = Language;
export const knowledgeLanguageSchema = z.enum(LANGUAGES, { error: "Must be one of: SI, TA, EN" });

export const KNOWLEDGE_AUDIENCES = [
  "GENERAL_PUBLIC",
  "YOUNG_ADULT",
  "LOW_DIGITAL_LITERACY",
  "SMALL_BUSINESS",
  "OTHER",
] as const;
export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number];

export const KNOWLEDGE_SOURCE_TYPES = [
  "OFFICIAL_GOVERNMENT",
  "OFFICIAL_REGULATOR",
  "OFFICIAL_FINANCIAL_INSTITUTION",
  "EDUCATIONAL",
  "OTHER",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/**
 * How a translation was produced. Only OFFICIAL text is the source's own wording; MACHINE_ASSISTED
 * text has not been reviewed by a qualified translator.
 */
export const KNOWLEDGE_TRANSLATION_STATUSES = [
  "OFFICIAL",
  "HUMAN_REVIEWED",
  "MACHINE_ASSISTED",
] as const;
export type KnowledgeTranslationStatus = (typeof KNOWLEDGE_TRANSLATION_STATUSES)[number];

export const knowledgeSlugSchema = z
  .string({ error: "Must be a string" })
  .max(100, { error: "Must be at most 100 characters" })
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: 'Must be a lower-case, hyphen-separated slug, e.g. "responsible-borrowing"',
  });

export const knowledgeArticleParamsSchema = z.strictObject({ slug: knowledgeSlugSchema });
export type KnowledgeArticleParams = z.output<typeof knowledgeArticleParamsSchema>;

export const getKnowledgeArticleQuerySchema = z.strictObject({
  language: knowledgeLanguageSchema.default("EN"),
});
export type GetKnowledgeArticleQuery = z.output<typeof getKnowledgeArticleQuerySchema>;

export const listKnowledgeArticlesQuerySchema = z.strictObject({
  ...paginationQuerySchema.shape,
  language: knowledgeLanguageSchema.default("EN"),
  category: knowledgeCategorySchema.optional(),
  /** Words to look for in the title, summary, body or keywords (case-insensitive). */
  query: z
    .string({ error: "Must be a string" })
    .trim()
    .min(1, { error: "Must not be empty" })
    .max(100, { error: "Must be at most 100 characters" })
    .optional(),
});
export type ListKnowledgeArticlesQuery = z.output<typeof listKnowledgeArticlesQuerySchema>;

/** Where the knowledge comes from. */
export type KnowledgeSourceResponse = {
  publisher: string;
  title: string;
  /** Link to the original document or page. */
  url: string;
  type: KnowledgeSourceType;
  /** The part of the source the article is based on (chapter, section or page), if recorded. */
  section: string | null;
  /** When FinVoice last confirmed the source says what the article says (ISO 8601). */
  lastVerifiedAt: string;
};

export type KnowledgeReviewResponse = {
  /** The article contains facts that can change, such as amounts or limits. */
  isTimeSensitive: boolean;
  /** Time-sensitive and past its review date: do not present its facts as current without checking the source. */
  reviewRequired: boolean;
  /** When the article's content was last reviewed (ISO 8601), if recorded. */
  lastReviewedAt: string | null;
};

export type KnowledgeArticleResponse = {
  slug: string;
  category: KnowledgeCategory;
  audience: KnowledgeAudience;
  /** The language the client asked for. */
  requestedLanguage: KnowledgeLanguage;
  /** The language of the returned text: requestedLanguage, or EN when no translation exists. */
  language: KnowledgeLanguage;
  translationStatus: KnowledgeTranslationStatus;
  title: string;
  summary: string;
  /** Plain text. Paragraphs are separated by blank lines; list items start with "- ". */
  body: string;
  keywords: string[];
  source: KnowledgeSourceResponse;
  review: KnowledgeReviewResponse;
};

export type KnowledgeSearchResponse = PaginatedResponse<KnowledgeArticleResponse>;

export type KnowledgeCategorySummary = {
  category: KnowledgeCategory;
  /** Number of published articles in the category. */
  articleCount: number;
};

export type KnowledgeCategoriesResponse = {
  data: KnowledgeCategorySummary[];
};
