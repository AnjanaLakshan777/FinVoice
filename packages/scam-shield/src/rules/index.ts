/**
 * The ScamShield rule set (version: RULESET_VERSION). Pattern rules run first; composite rules run
 * after them and may use their results. Every rule belongs to an indicator in the catalog, which
 * names its sources (indicators/catalog.ts).
 */
import { LINK_RULES } from "./links.js";
import {
  ADVANCE_PAYMENT_RULES,
  UNKNOWN_TRANSACTION_RULES,
  UNREALISTIC_RETURN_RULES,
} from "./money.js";
import type { Rule } from "./pattern.js";
import { OTHER_RULES, UNSOLICITED_RULES, URGENCY_RULES } from "./pressure.js";
import {
  ACCOUNT_ACCESS_RULES,
  CREDENTIAL_RULES,
  PAYMENT_RULES,
  PERSONAL_INFORMATION_RULES,
} from "./requests.js";
import { SCHEME_RULES } from "./schemes.js";

export const RULES: readonly Rule[] = [
  ...CREDENTIAL_RULES,
  ...URGENCY_RULES,
  ...UNREALISTIC_RETURN_RULES,
  ...UNSOLICITED_RULES,
  ...ADVANCE_PAYMENT_RULES,
  ...UNKNOWN_TRANSACTION_RULES,
  ...LINK_RULES,
  ...PERSONAL_INFORMATION_RULES,
  ...ACCOUNT_ACCESS_RULES,
  ...PAYMENT_RULES,
  ...OTHER_RULES,
  ...SCHEME_RULES,
];

export type { Rule, RuleLanguage, RuleMatch, EvidenceType } from "./pattern.js";
export { linkSignals, type LinkSignal } from "./links.js";
