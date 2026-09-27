import type { AgentToolName } from "@finvoice/contracts";

import type { ToolExecution } from "../tools/tool-registry.js";

/** The money fields of each calculation result (rates, months and statuses are not money). */
const MONEY_FIELDS: Partial<Record<AgentToolName, readonly string[]>> = {
  calculate_loan: [
    "principal",
    "monthlyPayment",
    "finalPayment",
    "totalRepayment",
    "totalInterest",
  ],
  calculate_savings: [
    "targetAmount",
    "currentAmount",
    "remainingAmount",
    "requiredMonthlyContribution",
    "finalContribution",
    "plannedTotalContribution",
    "differenceFromTarget",
  ],
  calculate_budget: ["monthlyIncome", "monthlyExpenses", "monthlySurplus"],
};

const DECIMAL = /^(-?)(\d+)(\.\d+)?$/;

/**
 * Formats a finance-engine money string for reading aloud: "16607.15" → "Rs. 16,607.15",
 * "-2500.50" → "-Rs. 2,500.50". Pure text formatting: digits are only grouped, never changed,
 * rounded or recalculated. Returns null for anything that is not a plain decimal string.
 */
export function formatRupees(amount: string): string | null {
  const match = DECIMAL.exec(amount);
  if (!match) {
    return null;
  }
  const [, sign = "", whole = "", fraction = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}Rs. ${grouped}${fraction}`;
}

/**
 * Adds `spokenAmounts` to a successful calculation result for the voice model: each money field
 * written as "Rs. 16,607.15", next to the unchanged engine values. Other results are returned
 * as they are.
 */
export function withSpokenAmounts(execution: ToolExecution): ToolExecution {
  const fields = execution.tool === null ? undefined : MONEY_FIELDS[execution.tool];
  if (execution.isError || !fields) {
    return execution;
  }
  const spokenAmounts: Record<string, string> = {};
  for (const field of fields) {
    const value = execution.result[field];
    const formatted = typeof value === "string" ? formatRupees(value) : null;
    if (formatted !== null) {
      spokenAmounts[field] = formatted;
    }
  }
  return { ...execution, result: { ...execution.result, spokenAmounts } };
}
