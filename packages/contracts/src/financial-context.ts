import type { FinancialGoalStatus, FinancialGoalType } from "./financial-goals.js";
import type { LiteracyLevel, LiteracyTopic, LiteracyTopicStatus } from "./literacy.js";
import type { Language } from "./users.js";

/**
 * The personal financial context (Step 8): the minimum facts a future authenticated agent needs
 * to personalise financial-literacy explanations. Read and aggregated from stored data only:
 * nothing is calculated, inferred or recommended, and money stays an exact decimal string.
 *
 * It deliberately leaves out ids, phone number, display name, timestamps of records, completed
 * and cancelled goals, conversations and credentials. Only the token-protected internal API
 * returns it; there is no public endpoint.
 */

/** Fields checked for completeness, in this order. */
export const FINANCIAL_CONTEXT_COMPLETENESS_FIELDS = [
  "monthlyIncome",
  "monthlyExpenses",
  "activeGoal",
] as const;
export type FinancialContextCompletenessField =
  (typeof FINANCIAL_CONTEXT_COMPLETENESS_FIELDS)[number];

/** Maximum active goals included; see FinancialContextResponse.moreActiveGoals. */
export const FINANCIAL_CONTEXT_MAX_GOALS = 20;

export type FinancialContextCompleteness = {
  /** True when no field is missing. */
  profileComplete: boolean;
  /** Fields not provided yet, in FINANCIAL_CONTEXT_COMPLETENESS_FIELDS order. */
  missingFields: FinancialContextCompletenessField[];
};

export type FinancialContextGoal = {
  type: FinancialGoalType;
  name: string;
  targetAmount: string;
  currentAmount: string;
  /** Calendar date (YYYY-MM-DD) or null. */
  targetDate: string | null;
  currency: string;
  status: FinancialGoalStatus;
};

export type FinancialContextLiteracyTopic = {
  topic: LiteracyTopic;
  status: LiteracyTopicStatus;
  lastActivityAt: string | null;
};

export type FinancialContextResponse = {
  user: {
    preferredLanguage: Language;
    timezone: string;
  };
  /**
   * The stored financial profile, or null if the user has none. A null amount means "not
   * provided", which is different from "0.00".
   */
  profile: {
    monthlyIncome: string | null;
    monthlyExpenses: string | null;
    currency: string;
  } | null;
  /** ACTIVE goals only, soonest target date first (goals without one last), at most 20. */
  goals: FinancialContextGoal[];
  /** True when the user has more active goals than were included. */
  moreActiveGoals: boolean;
  literacy: {
    level: LiteracyLevel;
    assessmentVersion: string;
    /** Null: no formal literacy assessment completed yet. */
    assessedAt: string | null;
    /** Recorded topic progress only; topics not listed are NOT_STARTED. */
    topics: FinancialContextLiteracyTopic[];
  };
  completeness: FinancialContextCompleteness;
};

/**
 * Tools for a future authenticated agent to read the signed-in user's own context (Step 8). They
 * are not on the public agent's allowlist (AGENT_TOOL_NAMES).
 */
export const USER_CONTEXT_TOOL_NAMES = [
  "get_user_financial_context",
  "get_user_literacy_context",
] as const;
export type UserContextToolName = (typeof USER_CONTEXT_TOOL_NAMES)[number];
