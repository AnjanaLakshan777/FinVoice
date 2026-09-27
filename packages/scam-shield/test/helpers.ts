import {
  analyzeScam,
  type IndicatorCode,
  type ScamAnalysisResult,
  type ScamLanguage,
  type ScamSourceType,
} from "../src/index.js";

export function analyze(
  content: string,
  language: ScamLanguage = "EN",
  sourceType: ScamSourceType = "MESSAGE",
): ScamAnalysisResult {
  return analyzeScam({ content, language, sourceType });
}

export function codesOf(result: ScamAnalysisResult): IndicatorCode[] {
  return result.indicators.map((indicator) => indicator.code);
}

export function indicatorOf(result: ScamAnalysisResult, code: IndicatorCode) {
  const indicator = result.indicators.find((candidate) => candidate.code === code);
  if (indicator === undefined) {
    throw new Error(`Expected indicator ${code}, got ${codesOf(result).join(", ") || "none"}`);
  }
  return indicator;
}

export function evidenceOf(result: ScamAnalysisResult, code: IndicatorCode): string[] {
  return indicatorOf(result, code).evidence.map((item) => item.text);
}
