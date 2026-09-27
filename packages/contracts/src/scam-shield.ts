import {
  ACTION_CODES,
  ACTION_PRIORITIES,
  INDICATOR_CODES,
  MAX_CONTENT_LENGTH,
  RISK_LEVELS,
  SCAM_LANGUAGES,
  SCAM_SOURCE_TYPES,
  SUMMARY_CODES,
} from "@finvoice/scam-shield";
import { z } from "zod";

import type { KnowledgeLanguage } from "./knowledge.js";

/**
 * Contracts of ScamShield (POST /api/v1/scamshield/analyze): a deterministic check of user-supplied
 * content for scam WARNING INDICATORS. The result is indicator-based, not a legal determination
 * that something is a scam, and it never says that content is safe.
 *
 * Codes, levels and limits come from @finvoice/scam-shield, the single definition of these rules.
 */

export {
  ACTION_CODES as SCAM_SHIELD_ACTION_CODES,
  INDICATOR_CODES as SCAM_SHIELD_INDICATOR_CODES,
  MAX_CONTENT_LENGTH as SCAM_SHIELD_MAX_CONTENT_LENGTH,
  RISK_LEVELS as SCAM_SHIELD_RISK_LEVELS,
  SCAM_SOURCE_TYPES,
  SUMMARY_CODES as SCAM_SHIELD_SUMMARY_CODES,
};

export type ScamShieldIndicatorCode = (typeof INDICATOR_CODES)[number];
export type ScamShieldActionCode = (typeof ACTION_CODES)[number];
export type ScamShieldActionPriority = (typeof ACTION_PRIORITIES)[number];
export type ScamShieldRiskLevel = (typeof RISK_LEVELS)[number];
export type ScamShieldSummaryCode = (typeof SUMMARY_CODES)[number];
export type ScamSourceType = (typeof SCAM_SOURCE_TYPES)[number];

/**
 * The request. Only these three fields are accepted: no metadata, no user id, no instructions.
 * `content` is what the user received or was told; it is analysed as data and never stored or logged.
 */
export const scamShieldAnalyzeRequestSchema = z.strictObject({
  content: z
    .string({ error: "Must be a string" })
    .trim()
    .min(1, { error: "Must not be empty" })
    .max(MAX_CONTENT_LENGTH, {
      error: `Must be at most ${String(MAX_CONTENT_LENGTH)} characters`,
    }),
  language: z.enum(SCAM_LANGUAGES, { error: "Must be one of: EN, SI, TA" }),
  sourceType: z.enum(SCAM_SOURCE_TYPES, {
    error: `Must be one of: ${SCAM_SOURCE_TYPES.join(", ")}`,
  }),
});
export type ScamShieldAnalyzeRequest = z.output<typeof scamShieldAnalyzeRequestSchema>;

/**
 * A FinVoice knowledge article cited by an indicator or action, resolved at request time so the
 * title and source are current. `available` is false if the article is not published (then the
 * other fields are null); unpublished content is never exposed.
 */
export type ScamShieldKnowledgeReference = {
  slug: string;
  available: boolean;
  /** Title in the requested language, or English when no translation exists. */
  title: string | null;
  /** The language of `title` and `summary`. */
  language: KnowledgeLanguage | null;
  summary: string | null;
  source: {
    publisher: string;
    title: string;
    url: string;
    lastVerifiedAt: string;
  } | null;
  /** The article is time-sensitive and past its review date: check the source before relying on it. */
  reviewRequired: boolean;
};

export type ScamShieldEvidence = {
  type: "phrase" | "link";
  /** A short excerpt of the submitted content (at most 160 characters). */
  text: string;
};

export type ScamShieldIndicator = {
  code: ScamShieldIndicatorCode;
  /** Plain-English explanation; never states that the content IS a scam. */
  explanation: string;
  /** At most 5 excerpts. */
  evidence: ScamShieldEvidence[];
  sources: ScamShieldKnowledgeReference[];
};

export type ScamShieldAction = {
  code: ScamShieldActionCode;
  /** IMMEDIATE (for example after an unrecognised transaction) or RECOMMENDED. */
  priority: ScamShieldActionPriority;
  /** The article with the guidance for this action. */
  knowledge: ScamShieldKnowledgeReference;
  /**
   * Further articles cited for information the primary article's source does not contain (for
   * REPORT_SUSPICIOUS_ACTIVITY: the Central Bank's FCRD inquiries hotline). Usually empty.
   */
  relatedKnowledge: ScamShieldKnowledgeReference[];
};

export type ScamShieldAnalysisResponse = {
  scamShieldVersion: string;
  assessmentType: "indicator_based";
  /** A level of detected warning indicators; there is no numeric score. */
  riskLevel: ScamShieldRiskLevel;
  summaryCode: ScamShieldSummaryCode;
  summary: string;
  analysisLanguage: KnowledgeLanguage;
  /** PARTIAL when the rule patterns do not fully cover the content's language. */
  languageCoverage: "FULL" | "PARTIAL";
  /** At most 5, strongest first. */
  indicators: ScamShieldIndicator[];
  /** More indicators were detected than returned (the risk level and actions consider all). */
  indicatorsTruncated: boolean;
  actions: ScamShieldAction[];
};
