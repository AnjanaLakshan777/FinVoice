/**
 * Evidence snippets: short excerpts of the ORIGINAL content (never the normalized copy) that show
 * why an indicator was detected. Limits keep responses small and avoid echoing the whole message:
 * at most MAX_SNIPPETS_PER_INDICATOR snippets of at most MAX_SNIPPET_LENGTH characters each.
 *
 * A snippet is the exact original text of the matched span, except that control characters and
 * line breaks are shown as spaces, long card-like digit sequences are masked, and a snippet longer
 * than the limit is cut at a character boundary and ends with "…".
 */
import type { EvidenceType, RuleMatch } from "../rules/pattern.js";
import { maskCardNumbers } from "../redact.js";
import { toOriginalSpan, type AnalysisText } from "./normalize.js";

export const MAX_SNIPPET_LENGTH = 160;
export const MAX_SNIPPETS_PER_INDICATOR = 5;

export type Evidence = { readonly type: EvidenceType; readonly text: string };

const CONTROL = /[\p{Cc}\u2028\u2029]/gu;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const ELLIPSIS = "…";

function truncate(value: string): string {
  if (value.length <= MAX_SNIPPET_LENGTH) {
    return value;
  }
  let cut = "";
  for (const { segment } of segmenter.segment(value)) {
    if (cut.length + segment.length > MAX_SNIPPET_LENGTH - ELLIPSIS.length) {
      break;
    }
    cut += segment;
  }
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

export function toSnippet(analysis: AnalysisText, start: number, end: number): string {
  const span = toOriginalSpan(analysis, start, end);
  const raw = analysis.original.slice(span.start, span.end).replace(CONTROL, " ").trim();
  return truncate(maskCardNumbers(raw));
}

/** Merges overlapping matches and returns up to the maximum number of distinct snippets. */
export function extractEvidence(analysis: AnalysisText, matches: readonly RuleMatch[]): Evidence[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number; type: EvidenceType }[] = [];
  for (const match of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && match.start <= last.end) {
      last.end = Math.max(last.end, match.end);
      if (match.evidenceType === "link") {
        last.type = "link";
      }
      continue;
    }
    merged.push({ start: match.start, end: match.end, type: match.evidenceType });
  }

  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  for (const span of merged) {
    if (evidence.length >= MAX_SNIPPETS_PER_INDICATOR) {
      break;
    }
    const text = toSnippet(analysis, span.start, span.end);
    if (text === "" || seen.has(text)) {
      continue;
    }
    seen.add(text);
    evidence.push({ type: span.type, text });
  }
  return evidence;
}
