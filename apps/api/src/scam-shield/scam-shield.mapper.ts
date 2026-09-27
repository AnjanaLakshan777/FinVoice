import type {
  KnowledgeArticleResponse,
  ScamShieldAnalysisResponse,
  ScamShieldKnowledgeReference,
} from "@finvoice/contracts";
import type { ScamAnalysisResult } from "@finvoice/scam-shield";

/** Every knowledge slug the result cites (indicator sources and actions), for one batch lookup. */
export function citedSlugs(result: ScamAnalysisResult): string[] {
  return [
    ...new Set([
      ...result.indicators.flatMap((indicator) => indicator.sources.map((source) => source.slug)),
      ...result.actions.flatMap((action) => [
        action.knowledgeSlug,
        ...action.relatedKnowledgeSlugs,
      ]),
    ]),
  ];
}

/**
 * A cited article with its current public metadata. An article that is not published (or not safe
 * to show) is reported as unavailable, with no title, text or source: unpublished content never
 * leaks, and the indicator stays in the result.
 */
export function toKnowledgeReference(
  slug: string,
  articles: ReadonlyMap<string, KnowledgeArticleResponse>,
): ScamShieldKnowledgeReference {
  const article = articles.get(slug);
  if (article === undefined) {
    return {
      slug,
      available: false,
      title: null,
      language: null,
      summary: null,
      source: null,
      reviewRequired: false,
    };
  }
  return {
    slug,
    available: true,
    title: article.title,
    language: article.language,
    summary: article.summary,
    source: {
      publisher: article.source.publisher,
      title: article.source.title,
      url: article.source.url,
      lastVerifiedAt: article.source.lastVerifiedAt,
    },
    reviewRequired: article.review.reviewRequired,
  };
}

/**
 * The public response: the engine result with its knowledge references resolved. Internal fields
 * (indicator strengths, rule details) are not returned, and nothing identifies the request.
 */
export function toScamShieldResponse(
  result: ScamAnalysisResult,
  articles: ReadonlyMap<string, KnowledgeArticleResponse>,
): ScamShieldAnalysisResponse {
  return {
    scamShieldVersion: result.scamShieldVersion,
    assessmentType: result.assessmentType,
    riskLevel: result.riskLevel,
    summaryCode: result.summaryCode,
    summary: result.summary,
    analysisLanguage: result.analysisLanguage,
    languageCoverage: result.languageCoverage,
    indicators: result.indicators.map((indicator) => ({
      code: indicator.code,
      explanation: indicator.explanation,
      evidence: indicator.evidence.map((item) => ({ type: item.type, text: item.text })),
      sources: indicator.sources.map((source) => toKnowledgeReference(source.slug, articles)),
    })),
    indicatorsTruncated: result.indicatorsTruncated,
    actions: result.actions.map((action) => ({
      code: action.code,
      priority: action.priority,
      knowledge: toKnowledgeReference(action.knowledgeSlug, articles),
      relatedKnowledge: action.relatedKnowledgeSlugs.map((slug) =>
        toKnowledgeReference(slug, articles),
      ),
    })),
  };
}
