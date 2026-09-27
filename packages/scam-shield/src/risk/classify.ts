/**
 * Risk level: a summary of the detected WARNING INDICATORS, not a legal or factual determination
 * that the content is a scam. There is no numeric score; the level follows explicit rules:
 *
 * - HIGH: two or more STRONG indicators; or one STRONG indicator with any other indicator (for
 *   example a credential request with urgency or with an unexpected offer, an advance payment with
 *   a suspicious offer, an unrecognised transaction with a request for details); or three or more
 *   indicators of which at least two are MODERATE (several supporting indicators).
 * - MEDIUM: at least one STRONG or MODERATE indicator, or two or more WEAK indicators.
 * - LOW: a single WEAK indicator, or no indicators in content long enough to assess.
 * - INSUFFICIENT_INFORMATION: no indicators, and the content is too short to assess.
 *
 * LOW never means "safe": the summary says that the check does not prove the content legitimate.
 */
import type { IndicatorStrength } from "../indicators/catalog.js";

export const RISK_LEVELS = ["INSUFFICIENT_INFORMATION", "LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SUMMARY_CODES = [
  "MULTIPLE_HIGH_RISK_INDICATORS",
  "WARNING_INDICATORS_DETECTED",
  "LIMITED_INDICATORS_DETECTED",
  "NO_STRONG_INDICATORS_DETECTED",
  "INSUFFICIENT_INFORMATION",
] as const;
export type SummaryCode = (typeof SUMMARY_CODES)[number];

export const SUMMARY_TEXT: Readonly<Record<SummaryCode, string>> = {
  MULTIPLE_HIGH_RISK_INDICATORS:
    "High-risk indicators detected. ScamShield detected the following warning indicators. Do not share details or send money until you have checked through an official channel.",
  WARNING_INDICATORS_DETECTED:
    "ScamShield detected the following warning indicators. Check through an official channel before you act.",
  LIMITED_INDICATORS_DETECTED:
    "ScamShield detected a limited warning indicator. This check does not prove the content is legitimate.",
  NO_STRONG_INDICATORS_DETECTED:
    "This check did not identify strong known warning indicators, but that does not prove the offer is legitimate.",
  INSUFFICIENT_INFORMATION:
    "There is not enough information to check for warning indicators. Describe what you were asked to do, for example to pay, share details or click a link.",
};

/** Content with fewer words than this, and no indicators, is too short to assess. */
export const MIN_WORDS_FOR_ASSESSMENT = 6;

export type RiskAssessment = { readonly riskLevel: RiskLevel; readonly summaryCode: SummaryCode };

export function classifyRisk(
  strengths: readonly IndicatorStrength[],
  wordCount: number,
): RiskAssessment {
  const strong = strengths.filter((strength) => strength === "STRONG").length;
  const moderate = strengths.filter((strength) => strength === "MODERATE").length;
  const weak = strengths.filter((strength) => strength === "WEAK").length;

  if (
    strong >= 2 ||
    (strong >= 1 && moderate + weak >= 1) ||
    (strengths.length >= 3 && moderate >= 2)
  ) {
    return { riskLevel: "HIGH", summaryCode: "MULTIPLE_HIGH_RISK_INDICATORS" };
  }
  if (strong >= 1 || moderate >= 1 || weak >= 2) {
    return { riskLevel: "MEDIUM", summaryCode: "WARNING_INDICATORS_DETECTED" };
  }
  if (weak === 1) {
    return { riskLevel: "LOW", summaryCode: "LIMITED_INDICATORS_DETECTED" };
  }
  if (wordCount < MIN_WORDS_FOR_ASSESSMENT) {
    return { riskLevel: "INSUFFICIENT_INFORMATION", summaryCode: "INSUFFICIENT_INFORMATION" };
  }
  return { riskLevel: "LOW", summaryCode: "NO_STRONG_INDICATORS_DETECTED" };
}
