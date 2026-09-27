import type { IndicatorCode } from "../indicators/catalog.js";
import type { RiskLevel } from "../risk/classify.js";
import {
  ACTION_CODES,
  ACTION_KNOWLEDGE,
  ACTION_RELATED_KNOWLEDGE,
  IMMEDIATE_ACTIONS,
  INDICATOR_ACTIONS,
  type ActionCode,
  type ActionPriority,
} from "./catalog.js";

export type RecommendedAction = {
  readonly code: ActionCode;
  readonly priority: ActionPriority;
  /** The knowledge article with the current, source-backed guidance for this action. */
  readonly knowledgeSlug: string;
  /** Further articles cited for information the primary article's source does not contain. */
  readonly relatedKnowledgeSlugs: readonly string[];
};

/**
 * The actions called for by ALL detected indicators (including any not shown because of the
 * indicator limit), plus reporting guidance for HIGH risk. With no indicators, the one action is to
 * verify through an official channel, because a clean check proves nothing.
 */
export function selectActions(
  indicators: readonly IndicatorCode[],
  riskLevel: RiskLevel,
): RecommendedAction[] {
  const codes = new Set<ActionCode>(indicators.flatMap((code) => INDICATOR_ACTIONS[code]));
  if (riskLevel === "HIGH") {
    codes.add("REPORT_SUSPICIOUS_ACTIVITY");
  }
  if (codes.size === 0) {
    codes.add("VERIFY_WITH_OFFICIAL_CHANNEL");
  }
  const immediate = new Set<ActionCode>(
    indicators.flatMap((code) => IMMEDIATE_ACTIONS[code] ?? []),
  );
  const ordered = ACTION_CODES.filter((code) => codes.has(code));
  // Immediate actions first, each group in the catalog order.
  return [
    ...ordered.filter((code) => immediate.has(code)),
    ...ordered.filter((code) => !immediate.has(code)),
  ].map((code) => ({
    code,
    priority: immediate.has(code) ? "IMMEDIATE" : "RECOMMENDED",
    knowledgeSlug: ACTION_KNOWLEDGE[code],
    relatedKnowledgeSlugs: ACTION_RELATED_KNOWLEDGE[code] ?? [],
  }));
}
