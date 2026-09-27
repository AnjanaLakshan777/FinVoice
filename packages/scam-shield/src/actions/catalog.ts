/**
 * Safe, educational action categories. Each is backed by a FinVoice knowledge article: the API
 * resolves the article's current text and source, so no advice or contact detail is written here.
 *
 * Actions are recommendations to the user. ScamShield never acts itself: it does not freeze accounts,
 * block cards, contact banks, file reports, move money or change credentials.
 */
import type { IndicatorCode, ScamShieldSourceSlug } from "../indicators/catalog.js";

/** In the order they are shown. */
export const ACTION_CODES = [
  "DO_NOT_SHARE_CREDENTIALS",
  "DO_NOT_SEND_MONEY_YET",
  "CONTACT_BANK",
  "CHECK_ACCOUNT_ACTIVITY",
  "VERIFY_WITH_OFFICIAL_CHANNEL",
  "REPORT_SUSPICIOUS_ACTIVITY",
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];

/** IMMEDIATE: do this now (after an unrecognised transaction). RECOMMENDED: before acting. */
export const ACTION_PRIORITIES = ["IMMEDIATE", "RECOMMENDED"] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

/** The primary knowledge article behind each action: its guidance. */
export const ACTION_KNOWLEDGE: Readonly<Record<ActionCode, ScamShieldSourceSlug>> = {
  DO_NOT_SHARE_CREDENTIALS: "protect-pin-otp-passwords",
  DO_NOT_SEND_MONEY_YET: "recognise-scams",
  CONTACT_BANK: "report-suspicious-activity",
  CHECK_ACCOUNT_ACTIVITY: "report-suspicious-activity",
  VERIFY_WITH_OFFICIAL_CHANNEL: "recognise-scams",
  REPORT_SUSPICIOUS_ACTIVITY: "report-suspicious-activity",
};

/**
 * Further articles an action also cites, each for information the primary article's source does
 * not contain. REPORT_SUSPICIOUS_ACTIVITY: the reporting steps come from Be Scam Proof
 * (report-suspicious-activity), and the Central Bank's inquiries hotline from the FCRD page
 * (consumer-rights-and-complaints). Only slugs are listed; the contact details themselves live in
 * the knowledge base, never here.
 */
export const ACTION_RELATED_KNOWLEDGE: Readonly<
  Partial<Record<ActionCode, readonly ScamShieldSourceSlug[]>>
> = {
  REPORT_SUSPICIOUS_ACTIVITY: ["consumer-rights-and-complaints"],
};

/** The actions each detected indicator calls for. */
export const INDICATOR_ACTIONS: Readonly<Record<IndicatorCode, readonly ActionCode[]>> = {
  CREDENTIAL_REQUEST: ["DO_NOT_SHARE_CREDENTIALS", "CONTACT_BANK", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  URGENCY_PRESSURE: ["VERIFY_WITH_OFFICIAL_CHANNEL"],
  UNREALISTIC_RETURN: ["DO_NOT_SEND_MONEY_YET", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  UNSOLICITED_OFFER: ["VERIFY_WITH_OFFICIAL_CHANNEL"],
  IMPERSONATION: ["VERIFY_WITH_OFFICIAL_CHANNEL"],
  ADVANCE_PAYMENT: ["DO_NOT_SEND_MONEY_YET", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  UNKNOWN_TRANSACTION: ["CONTACT_BANK", "CHECK_ACCOUNT_ACTIVITY", "REPORT_SUSPICIOUS_ACTIVITY"],
  SUSPICIOUS_LINK: ["VERIFY_WITH_OFFICIAL_CHANNEL"],
  PERSONAL_INFORMATION_REQUEST: ["VERIFY_WITH_OFFICIAL_CHANNEL"],
  ACCOUNT_ACCESS_REQUEST: ["DO_NOT_SHARE_CREDENTIALS", "CONTACT_BANK"],
  INVESTMENT_SCHEME: ["DO_NOT_SEND_MONEY_YET", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  UNAUTHORIZED_DEPOSIT_INDICATOR: ["DO_NOT_SEND_MONEY_YET", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  PYRAMID_SCHEME_INDICATOR: ["DO_NOT_SEND_MONEY_YET", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  FAKE_LOAN_OFFER: [
    "DO_NOT_SHARE_CREDENTIALS",
    "DO_NOT_SEND_MONEY_YET",
    "VERIFY_WITH_OFFICIAL_CHANNEL",
  ],
  PAYMENT_TRANSFER_REQUEST: ["DO_NOT_SEND_MONEY_YET", "VERIFY_WITH_OFFICIAL_CHANNEL"],
  OTHER_SUSPICIOUS_PATTERN: ["VERIFY_WITH_OFFICIAL_CHANNEL"],
};

/** Actions that become IMMEDIATE when these indicators are present. */
export const IMMEDIATE_ACTIONS: Readonly<Partial<Record<IndicatorCode, readonly ActionCode[]>>> = {
  UNKNOWN_TRANSACTION: ["CONTACT_BANK", "CHECK_ACCOUNT_ACTIVITY"],
};
