import { describe, expect, it } from "vitest";

import {
  budgetCalculationRequestSchema,
  loanCalculationRequestSchema,
  savingsCalculationRequestSchema,
} from "../src/index.js";

const LOAN = { principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 };

describe("loanCalculationRequestSchema", () => {
  it("accepts inputs only", () => {
    expect(loanCalculationRequestSchema.parse(LOAN)).toEqual(LOAN);
  });

  it.each([
    "monthlyPayment",
    "finalPayment",
    "totalRepayment",
    "totalInterest",
    "calculationVersion",
  ])("rejects a client-supplied %s", (field) => {
    expect(loanCalculationRequestSchema.safeParse({ ...LOAN, [field]: "1234.56" }).success).toBe(
      false,
    );
  });

  it.each(["0", "1000", "1000.00", "12.5"])("accepts the rate %j", (annualInterestRate) => {
    expect(loanCalculationRequestSchema.safeParse({ ...LOAN, annualInterestRate }).success).toBe(
      true,
    );
  });

  it.each(["-1", "1000.01", "12.345", "abc", 12])("rejects the rate %j", (annualInterestRate) => {
    expect(loanCalculationRequestSchema.safeParse({ ...LOAN, annualInterestRate }).success).toBe(
      false,
    );
  });

  it.each([0, 601, 36.5, "36"])("rejects the term %j", (termMonths) => {
    expect(loanCalculationRequestSchema.safeParse({ ...LOAN, termMonths }).success).toBe(false);
  });

  it.each(["0", "-1", "100.123", 500000])("rejects the principal %j", (principal) => {
    expect(loanCalculationRequestSchema.safeParse({ ...LOAN, principal }).success).toBe(false);
  });
});

describe("savingsCalculationRequestSchema", () => {
  const SAVINGS = { targetAmount: "300000.00", currentAmount: "50000.00", months: 12 };

  it("accepts inputs only", () => {
    expect(savingsCalculationRequestSchema.parse(SAVINGS)).toEqual(SAVINGS);
  });

  it.each(["finalContribution", "plannedTotalContribution", "differenceFromTarget"])(
    "rejects a client-supplied %s",
    (field) => {
      expect(
        savingsCalculationRequestSchema.safeParse({ ...SAVINGS, [field]: "1.00" }).success,
      ).toBe(false);
    },
  );

  it("rejects a client-supplied requiredMonthlyContribution", () => {
    expect(
      savingsCalculationRequestSchema.safeParse({ ...SAVINGS, requiredMonthlyContribution: "1.00" })
        .success,
    ).toBe(false);
  });
});

describe("budgetCalculationRequestSchema", () => {
  const BUDGET = { monthlyIncome: "150000.00", monthlyExpenses: "100000.00" };

  it.each(["monthlySurplus", "savingsRate", "expenseRatio", "status"])(
    "rejects a client-supplied %s",
    (field) => {
      expect(budgetCalculationRequestSchema.safeParse({ ...BUDGET, [field]: "1" }).success).toBe(
        false,
      );
    },
  );
});
