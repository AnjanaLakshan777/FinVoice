import type { FinancialGoalStatus, FinancialGoalType, Language } from "@finvoice/contracts";

// Types only: importing @finvoice/contracts at runtime would ship its validation code (zod) to the
// browser. The values below mirror the contracts, and test/account-constants.test.ts keeps them in
// sync. The API remains authoritative for every one of them.

export const LANGUAGE_OPTIONS: readonly { value: Language; label: string }[] = [
  { value: "SI", label: "සිංහල (Sinhala)" },
  { value: "TA", label: "தமிழ் (Tamil)" },
  { value: "EN", label: "English" },
];

export const GOAL_TYPE_OPTIONS: readonly { value: FinancialGoalType; label: string }[] = [
  { value: "SAVINGS", label: "Savings" },
  { value: "EMERGENCY_FUND", label: "Emergency fund" },
  { value: "DEBT_REPAYMENT", label: "Paying off a debt" },
  { value: "OTHER", label: "Something else" },
];

export const GOAL_STATUS_OPTIONS: readonly { value: FinancialGoalStatus; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Mirrors AUTH_ERROR_MESSAGES in @finvoice/contracts (the API's exact messages). */
export const AUTH_API_MESSAGES = {
  authenticationFailed: "Authentication failed",
} as const;

export function languageLabel(language: Language): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? language;
}

export function goalTypeLabel(type: FinancialGoalType): string {
  return GOAL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function goalStatusLabel(status: FinancialGoalStatus): string {
  return GOAL_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}
