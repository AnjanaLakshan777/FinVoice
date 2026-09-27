import { calculateBudgetSummary, calculateLoanRepayment } from "@finvoice/finance-engine";
import { describe, expect, it } from "vitest";

import type { ToolExecution } from "../../src/ai/tools/tool-registry.js";
import { formatRupees, withSpokenAmounts } from "../../src/ai/voice/spoken-amounts.js";

describe("formatRupees", () => {
  it.each([
    ["16607.15", "Rs. 16,607.15"],
    ["16607.33", "Rs. 16,607.33"],
    ["597857.58", "Rs. 597,857.58"],
    ["500000.00", "Rs. 500,000.00"],
    ["1234567890.05", "Rs. 1,234,567,890.05"],
    ["999.99", "Rs. 999.99"],
    ["0.00", "Rs. 0.00"],
    ["1000", "Rs. 1,000"],
    ["-2500.50", "-Rs. 2,500.50"],
  ])("formats %s as %s", (amount, spoken) => {
    expect(formatRupees(amount)).toBe(spoken);
  });

  it.each(["", "abc", "1e5", "1,000.00", "Rs. 5", "12.3.4", " 100"])("rejects %j", (amount) => {
    expect(formatRupees(amount)).toBeNull();
  });

  it("only groups digits: removing the formatting gives back the exact engine value", () => {
    for (const amount of ["16607.15", "97857.58", "0.01", "-123456.78"]) {
      expect(formatRupees(amount)?.replace("Rs. ", "").replaceAll(",", "")).toBe(amount);
    }
  });
});

describe("withSpokenAmounts", () => {
  const loan = calculateLoanRepayment({
    principal: "500000.00",
    annualInterestRate: "12.00",
    termMonths: 36,
  });

  it("adds spoken amounts next to the unchanged loan result", () => {
    const execution: ToolExecution = { tool: "calculate_loan", isError: false, result: loan };

    const { result } = withSpokenAmounts(execution);

    expect(result).toEqual({
      ...loan,
      spokenAmounts: {
        principal: "Rs. 500,000.00",
        monthlyPayment: "Rs. 16,607.15",
        finalPayment: "Rs. 16,607.33",
        totalRepayment: "Rs. 597,857.58",
        totalInterest: "Rs. 97,857.58",
      },
    });
  });

  it("formats a budget deficit and leaves percentages alone", () => {
    const budget = calculateBudgetSummary({
      monthlyIncome: "100000.00",
      monthlyExpenses: "112500.00",
    });

    const { result } = withSpokenAmounts({
      tool: "calculate_budget",
      isError: false,
      result: budget,
    });

    expect(result.spokenAmounts).toEqual({
      monthlyIncome: "Rs. 100,000.00",
      monthlyExpenses: "Rs. 112,500.00",
      monthlySurplus: "-Rs. 12,500.00",
    });
  });

  it.each<ToolExecution>([
    { tool: "search_knowledge", isError: false, result: { totalMatches: 0 } },
    { tool: "calculate_loan", isError: true, result: { error: { code: "INVALID_ARGUMENTS" } } },
    { tool: null, isError: true, result: { error: { code: "UNKNOWN_TOOL" } } },
  ])("leaves other results unchanged (%j)", (execution) => {
    expect(withSpokenAmounts(execution)).toBe(execution);
  });
});
