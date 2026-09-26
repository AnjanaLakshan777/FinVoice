import { describe, expect, it } from "vitest";

import {
  calculateBudgetSummary,
  FinanceValidationError,
  type BudgetSummaryInput,
} from "../src/index.js";

// Expected values computed independently with exact BigInt arithmetic (see loan-repayment.test.ts).

function budget(monthlyIncome: string, monthlyExpenses: string) {
  return calculateBudgetSummary({ monthlyIncome, monthlyExpenses });
}

function fieldsOf(fn: () => unknown): (string | null)[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FinanceValidationError);
    return (error as FinanceValidationError).issues.map((issue) => issue.field);
  }
  throw new Error("Expected a FinanceValidationError");
}

describe("calculateBudgetSummary", () => {
  it("summarises a surplus budget", () => {
    expect(budget("150000.00", "100000.00")).toEqual({
      calculationVersion: "1",
      monthlyIncome: "150000.00",
      monthlyExpenses: "100000.00",
      monthlySurplus: "50000.00",
      expenseRatio: "66.67",
      savingsRate: "33.33",
      status: "SURPLUS",
    });
  });

  it("summarises a break-even budget", () => {
    expect(budget("100000", "100000")).toMatchObject({
      monthlySurplus: "0.00",
      expenseRatio: "100.00",
      savingsRate: "0.00",
      status: "BREAK_EVEN",
    });
  });

  it("summarises a deficit budget with a negative savings rate", () => {
    expect(budget("80000", "100000")).toMatchObject({
      monthlySurplus: "-20000.00",
      expenseRatio: "125.00",
      savingsRate: "-25.00",
      status: "DEFICIT",
    });
  });

  it("returns null ratios for zero income instead of dividing by zero", () => {
    expect(budget("0", "5000")).toMatchObject({
      monthlySurplus: "-5000.00",
      expenseRatio: null,
      savingsRate: null,
      status: "DEFICIT",
    });
    expect(budget("0", "0")).toMatchObject({
      monthlySurplus: "0.00",
      expenseRatio: null,
      savingsRate: null,
      status: "BREAK_EVEN",
    });
  });

  it("handles zero expenses", () => {
    expect(budget("150000", "0")).toMatchObject({
      monthlySurplus: "150000.00",
      expenseRatio: "0.00",
      savingsRate: "100.00",
      status: "SURPLUS",
    });
  });

  it("rounds percentages half-up to exactly 2 decimal places", () => {
    expect(budget("3", "1")).toMatchObject({ expenseRatio: "33.33", savingsRate: "66.67" });
    // 0.01 / 8 × 100 = 0.125 → 0.13 (half-up), and −0.125 → −0.13.
    expect(budget("8", "0.01")).toMatchObject({ expenseRatio: "0.13" });
    expect(budget("8", "8.01")).toMatchObject({ savingsRate: "-0.13", status: "DEFICIT" });
  });

  it("never outputs negative zero", () => {
    // Surplus −0.01 on 1,000,000,000 income: savings rate −0.000000001% rounds to 0.
    expect(budget("1000000000", "1000000000.01")).toMatchObject({
      monthlySurplus: "-0.01",
      expenseRatio: "100.00",
      savingsRate: "0.00",
      status: "DEFICIT",
    });
  });

  it("stays exact at the largest amounts", () => {
    expect(budget("999999999999.99", "999999999999.98")).toMatchObject({
      monthlySurplus: "0.01",
      expenseRatio: "100.00",
      savingsRate: "0.00",
      status: "SURPLUS",
    });
  });

  it("is deterministic", () => {
    const input: BudgetSummaryInput = { monthlyIncome: "123456.78", monthlyExpenses: "98765.43" };
    const first = calculateBudgetSummary(input);

    for (let run = 0; run < 50; run += 1) {
      expect(calculateBudgetSummary({ ...input })).toEqual(first);
    }
  });

  describe("validation", () => {
    it.each(["-1", "-0.01"])("rejects the negative income %j", (income) => {
      expect(fieldsOf(() => budget(income, "0"))).toEqual(["monthlyIncome"]);
    });

    it.each(["-1", "-0.01"])("rejects the negative expenses %j", (expenses) => {
      expect(fieldsOf(() => budget("100", expenses))).toEqual(["monthlyExpenses"]);
    });

    it.each(["100.001", "1e5", "NaN", "Infinity", "abc"])(
      "rejects the invalid income %j",
      (income) => {
        expect(fieldsOf(() => budget(income, "0"))).toEqual(["monthlyIncome"]);
      },
    );

    it("rejects client-supplied results as unknown fields", () => {
      const input = {
        monthlyIncome: "100",
        monthlyExpenses: "50",
        monthlySurplus: "999",
        savingsRate: "90.00",
      } as BudgetSummaryInput;

      expect(fieldsOf(() => calculateBudgetSummary(input))).toEqual([
        "monthlySurplus",
        "savingsRate",
      ]);
    });

    it("rejects input that is not an object", () => {
      expect(
        fieldsOf(() => calculateBudgetSummary(null as unknown as BudgetSummaryInput)),
      ).toContain(null);
    });
  });
});
