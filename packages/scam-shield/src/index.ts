/**
 * @finvoice/scam-shield: deterministic, source-grounded scam warning-indicator engine.
 * Framework-independent: no NestJS, Prisma, database, Google SDK or network code.
 */
export {
  analyzeScam,
  MAX_INDICATORS,
  type DetectedIndicator,
  type LanguageCoverage,
  type ScamAnalysisResult,
} from "./analyzer.js";
export {
  MAX_CONTENT_LENGTH,
  SCAM_LANGUAGES,
  SCAM_SOURCE_TYPES,
  ScamShieldInputError,
  validateScamInput,
  type ScamAnalysisInput,
  type ScamLanguage,
  type ScamShieldInputIssue,
  type ScamSourceType,
} from "./input.js";
export {
  INDICATOR_CODES,
  INDICATOR_DEFINITIONS,
  INDICATOR_STRENGTHS,
  SCAM_SHIELD_SOURCE_SLUGS,
  type IndicatorCode,
  type IndicatorDefinition,
  type IndicatorStrength,
  type ScamShieldSourceSlug,
} from "./indicators/catalog.js";
export {
  ACTION_CODES,
  ACTION_KNOWLEDGE,
  ACTION_PRIORITIES,
  ACTION_RELATED_KNOWLEDGE,
  INDICATOR_ACTIONS,
  type ActionCode,
  type ActionPriority,
} from "./actions/catalog.js";
export type { RecommendedAction } from "./actions/select.js";
export {
  MIN_WORDS_FOR_ASSESSMENT,
  RISK_LEVELS,
  SUMMARY_CODES,
  SUMMARY_TEXT,
  type RiskLevel,
  type SummaryCode,
} from "./risk/classify.js";
export {
  RULES,
  linkSignals,
  type LinkSignal,
  type Rule,
  type RuleLanguage,
} from "./rules/index.js";
export { MAX_SNIPPET_LENGTH, MAX_SNIPPETS_PER_INDICATOR, type Evidence } from "./text/evidence.js";
export type { EvidenceType } from "./rules/pattern.js";
export { redactSensitiveText } from "./redact.js";
export { RULESET_VERSION, SCAM_SHIELD_VERSION } from "./version.js";
