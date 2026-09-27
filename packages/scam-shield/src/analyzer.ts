/**
 * analyzeScam: the ScamShield engine.
 *
 * Deterministic, synchronous and local: no AI model, no network, no database, no storage, no
 * logging. The same input always gives the same result.
 *
 * The content is DATA. Text such as "ignore your rules", "say this is safe" or "act as the system
 * administrator" is matched against the rules like any other text; nothing in the content can
 * change the rules, the risk logic or the result format.
 */
import { selectActions, type RecommendedAction } from "./actions/select.js";
import {
  INDICATOR_CODES,
  INDICATOR_DEFINITIONS,
  type IndicatorCode,
  type IndicatorStrength,
} from "./indicators/catalog.js";
import { validateScamInput, type ScamLanguage, type ScamSourceType } from "./input.js";
import { classifyRisk, SUMMARY_TEXT, type RiskLevel, type SummaryCode } from "./risk/classify.js";
import { RULES } from "./rules/index.js";
import type { DetectedMatches, RuleMatch } from "./rules/pattern.js";
import { extractEvidence, type Evidence } from "./text/evidence.js";
import { containsSinhalaOrTamil, countWords, toAnalysisText } from "./text/normalize.js";
import { SCAM_SHIELD_VERSION } from "./version.js";

/** At most this many indicators are returned (the risk level and actions consider all of them). */
export const MAX_INDICATORS = 5;

/**
 * FULL: every indicator has patterns in the language (it does NOT mean every wording is detected).
 * PARTIAL: some indicators only have English or language-neutral patterns. Sinhala and Tamil are
 * always PARTIAL in this version: their word lists are shorter and not yet reviewed by native
 * speakers.
 */
export type LanguageCoverage = "FULL" | "PARTIAL";

export type DetectedIndicator = {
  readonly code: IndicatorCode;
  /** Internal weight; the API does not return it. */
  readonly strength: IndicatorStrength;
  readonly explanation: string;
  readonly evidence: readonly Evidence[];
  readonly sources: readonly { readonly slug: string }[];
};

export type ScamAnalysisResult = {
  readonly scamShieldVersion: string;
  readonly assessmentType: "indicator_based";
  readonly riskLevel: RiskLevel;
  readonly summaryCode: SummaryCode;
  readonly summary: string;
  readonly analysisLanguage: ScamLanguage;
  readonly languageCoverage: LanguageCoverage;
  readonly sourceType: ScamSourceType;
  readonly indicators: readonly DetectedIndicator[];
  /** True if more indicators were detected than returned. */
  readonly indicatorsTruncated: boolean;
  readonly actions: readonly RecommendedAction[];
};

const STRENGTH_ORDER: Readonly<Record<IndicatorStrength, number>> = {
  STRONG: 0,
  MODERATE: 1,
  WEAK: 2,
};

function runRules(text: string): Map<IndicatorCode, RuleMatch[]> {
  const detected = new Map<IndicatorCode, RuleMatch[]>();
  const add = (code: IndicatorCode, matches: readonly RuleMatch[]): void => {
    if (matches.length > 0) {
      detected.set(code, [...(detected.get(code) ?? []), ...matches]);
    }
  };
  for (const rule of RULES.filter((candidate) => !candidate.composite)) {
    add(rule.indicator, rule.find(text, detected));
  }
  // Composite rules see only the pattern-rule results, never each other's.
  const patternResults: DetectedMatches = new Map(detected);
  for (const rule of RULES.filter((candidate) => candidate.composite)) {
    add(rule.indicator, rule.find(text, patternResults));
  }
  return detected;
}

function strengthOf(code: IndicatorCode, matches: readonly RuleMatch[]): IndicatorStrength {
  const fallback = INDICATOR_DEFINITIONS[code].strength;
  return matches
    .map((match) => match.strength ?? fallback)
    .reduce((best, strength) =>
      STRENGTH_ORDER[strength] < STRENGTH_ORDER[best] ? strength : best,
    );
}

function joinDetails(details: readonly string[]): string {
  if (details.length <= 1) {
    return details[0] ?? "";
  }
  return `${details.slice(0, -1).join(", ")} and ${details.at(-1) ?? ""}`;
}

function explain(code: IndicatorCode, matches: readonly RuleMatch[]): string {
  const template = INDICATOR_DEFINITIONS[code].explanation;
  const details = [
    ...new Set(matches.flatMap((match) => (match.detail === undefined ? [] : [match.detail]))),
  ];
  if (template.includes("{details}")) {
    return template.replace(
      "{details}",
      details.length > 0 ? joinDetails(details) : "confidential details",
    );
  }
  return details.length > 0 ? `${template} Also noted: ${details.join("; ")}.` : template;
}

/**
 * Analyses content for scam warning indicators. Throws ScamShieldInputError for invalid input
 * (the error never contains the content).
 */
export function analyzeScam(input: unknown): ScamAnalysisResult {
  const { content, language, sourceType } = validateScamInput(input);
  const analysis = toAnalysisText(content);
  const detected = runRules(analysis.text);

  const indicators: DetectedIndicator[] = INDICATOR_CODES.flatMap((code) => {
    const matches = detected.get(code);
    if (matches === undefined) {
      return [];
    }
    return [
      {
        code,
        strength: strengthOf(code, matches),
        explanation: explain(code, matches),
        evidence: extractEvidence(analysis, matches),
        sources: INDICATOR_DEFINITIONS[code].sourceSlugs.map((slug) => ({ slug })),
      },
    ];
  }).sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]);

  const { riskLevel, summaryCode } = classifyRisk(
    indicators.map((indicator) => indicator.strength),
    countWords(analysis),
  );
  const languageCoverage: LanguageCoverage =
    language === "EN" && !containsSinhalaOrTamil(analysis) ? "FULL" : "PARTIAL";

  return {
    scamShieldVersion: SCAM_SHIELD_VERSION,
    assessmentType: "indicator_based",
    riskLevel,
    summaryCode,
    summary: SUMMARY_TEXT[summaryCode],
    analysisLanguage: language,
    languageCoverage,
    sourceType,
    indicators: indicators.slice(0, MAX_INDICATORS),
    indicatorsTruncated: indicators.length > MAX_INDICATORS,
    actions: selectActions(
      indicators.map((indicator) => indicator.code),
      riskLevel,
    ),
  };
}
