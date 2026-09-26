import { describe, expect, it } from "vitest";

import {
  calculateLoanRepayment,
  FinanceValidationError,
  type LoanRepaymentInput,
} from "../src/index.js";
import { referenceLoan, seededRandom, toCents } from "./reference.js";

// Expected values come from test/reference.ts, an independent implementation with exact rational
// arithmetic on BigInt (no decimal.js).

function loan(principal: string, annualInterestRate: string, termMonths: number) {
  return calculateLoanRepayment({ principal, annualInterestRate, termMonths });
}

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FinanceValidationError);
    return (error as FinanceValidationError).issues;
  }
  throw new Error("Expected a FinanceValidationError");
}

describe("calculateLoanRepayment", () => {
  it("calculates a standard reducing-balance loan exactly (500,000 at 12% for 36 months)", () => {
    expect(loan("500000.00", "12.00", 36)).toEqual({
      calculationVersion: "1",
      principal: "500000.00",
      annualInterestRate: "12.00",
      termMonths: 36,
      monthlyPayment: "16607.15",
      finalPayment: "16607.33",
      totalRepayment: "597857.58",
      totalInterest: "97857.58",
      assumptions: {
        interestMethod: "reducing_balance",
        paymentFrequency: "monthly",
        monthlyRateMethod: "annual_rate_divided_by_12",
        feesIncluded: false,
        insuranceIncluded: false,
        earlyRepaymentIncluded: false,
      },
    });
  });

  it.each([
    ["1000000", "10.5", 240, "9983.80", "9983.53", "2396111.73", "1396111.73"],
    ["100000", "0.01", 600, "167.08", "169.70", "100250.62", "250.62"],
    ["1000", "1000.00", 12, "833.91", "833.93", "10006.94", "9006.94"],
    [
      "999999999999.99",
      "1000",
      600,
      "833333333333.33",
      "833333333330.33",
      "499999999999995.00",
      "498999999999995.01",
    ],
  ])(
    "calculates %s at %s%% for %i months",
    (principal, rate, months, monthlyPayment, finalPayment, totalRepayment, totalInterest) => {
      expect(loan(principal, rate, months)).toMatchObject({
        monthlyPayment,
        finalPayment,
        totalRepayment,
        totalInterest,
      });
    },
  );

  it("handles a one-month term: one payment of principal plus one month of interest", () => {
    expect(loan("50000", "12", 1)).toMatchObject({
      monthlyPayment: "50500.00",
      finalPayment: "50500.00",
      totalRepayment: "50500.00",
      totalInterest: "500.00",
    });
  });

  it("handles the longest term (600 months)", () => {
    expect(loan("2500000", "8.25", 600)).toMatchObject({
      termMonths: 600,
      monthlyPayment: "17473.96",
      finalPayment: "17471.02",
      totalRepayment: "10484373.06",
      totalInterest: "7984373.06",
    });
  });

  it("repays exactly the principal on a 0% loan that divides evenly", () => {
    expect(loan("120000", "0", 12)).toMatchObject({
      annualInterestRate: "0.00",
      monthlyPayment: "10000.00",
      finalPayment: "10000.00",
      totalRepayment: "120000.00",
      totalInterest: "0.00",
    });
  });

  it("lets the final payment absorb the rounding on a 0% loan that does not divide evenly", () => {
    // 100000 / 12 = 8333.333…: 11 × 8333.33 + 8333.37 = 100000.00 exactly, interest 0.00.
    expect(loan("100000", "0", 12)).toMatchObject({
      monthlyPayment: "8333.33",
      finalPayment: "8333.37",
      totalRepayment: "100000.00",
      totalInterest: "0.00",
    });
    expect(loan("100", "0", 3)).toMatchObject({
      monthlyPayment: "33.33",
      finalPayment: "33.34",
      totalRepayment: "100.00",
      totalInterest: "0.00",
    });
  });

  it("never reports negative interest on a 0% loan", () => {
    const random = seededRandom(20260926);
    for (let run = 0; run < 300; run += 1) {
      const principal = `${String(Math.floor(random() * 10_000_000) + 1)}.${String(Math.floor(random() * 100)).padStart(2, "0")}`;
      const termMonths = Math.floor(random() * 600) + 1;
      let result;
      try {
        result = loan(principal, "0", termMonths);
      } catch {
        continue; // principal too small for the term
      }
      expect(result.totalRepayment).toBe(result.principal);
      expect(result.totalInterest).toBe("0.00");
    }
  });

  it("rounds the regular payment down when rounding up would leave nothing for the final payment", () => {
    // 5.00 over 600 months: regular 0.01 would make 599 × 0.01 = 5.99 > 5.00; rounding down gives
    // regular payments of 0.00, which is not a repayment plan, so the input is rejected.
    expect(issuesOf(() => loan("5", "0", 600)).map((issue) => issue.field)).toEqual(["principal"]);
    // 29.95 over 600 months: 0.0499… rounds to 0.05, and 599 × 0.05 = 29.95 would leave 0.00;
    // rounding down gives 599 × 0.04 = 23.96 and a final payment of 5.99.
    expect(loan("29.95", "0", 600)).toMatchObject({
      monthlyPayment: "0.04",
      finalPayment: "5.99",
      totalRepayment: "29.95",
      totalInterest: "0.00",
    });
  });

  it("matches the independent reference and stays internally consistent (1,000 generated loans)", () => {
    const random = seededRandom(42);
    for (let run = 0; run < 1000; run += 1) {
      const principal = `${String(Math.floor(random() * 100_000_000) + 1)}.${String(Math.floor(random() * 100)).padStart(2, "0")}`;
      const rate = `${String(Math.floor(random() * 60))}.${String(Math.floor(random() * 100)).padStart(2, "0")}`;
      const termMonths = Math.floor(random() * 600) + 1;

      const result = loan(principal, rate, termMonths);

      expect(result).toMatchObject(referenceLoan(principal, rate, termMonths));
      const regular = toCents(result.monthlyPayment);
      const final = toCents(result.finalPayment);
      const total = toCents(result.totalRepayment);
      expect(regular * BigInt(termMonths - 1) + final).toBe(total);
      expect(total - toCents(result.principal)).toBe(toCents(result.totalInterest));
      expect(final > 0n).toBe(true);
      expect(toCents(result.totalInterest) >= 0n).toBe(true);
    }
  });

  it("normalises the echoed inputs to 2 decimal places without changing their value", () => {
    expect(loan("500000", "12", 36)).toMatchObject({
      principal: "500000.00",
      annualInterestRate: "12.00",
      monthlyPayment: "16607.15",
    });
  });

  it("returns every monetary value with exactly 2 decimal places", () => {
    const result = loan("123456.7", "7.5", 47);

    for (const value of [
      result.principal,
      result.monthlyPayment,
      result.finalPayment,
      result.totalRepayment,
      result.totalInterest,
    ]) {
      expect(value).toMatch(/^[0-9]+\.[0-9]{2}$/);
    }
  });

  it("is deterministic", () => {
    const input: LoanRepaymentInput = {
      principal: "735000.55",
      annualInterestRate: "13.37",
      termMonths: 83,
    };
    const first = calculateLoanRepayment(input);

    for (let run = 0; run < 50; run += 1) {
      expect(calculateLoanRepayment({ ...input })).toEqual(first);
    }
  });

  it("does not modify its input", () => {
    const input = Object.freeze({ principal: "500000", annualInterestRate: "12", termMonths: 36 });

    calculateLoanRepayment(input);

    expect(input).toEqual({ principal: "500000", annualInterestRate: "12", termMonths: 36 });
  });

  describe("validation", () => {
    it.each(["0", "0.00", "-1", "-500000.00"])("rejects the principal %j", (principal) => {
      expect(issuesOf(() => loan(principal, "12", 36))).toEqual([
        { field: "principal", message: expect.any(String) as unknown },
      ]);
    });

    it.each([
      "-1",
      "-0.01",
      "1000.01",
      "1001",
      "abc",
      "12%",
      "NaN",
      "Infinity",
      "1e1",
      "12.345",
      "",
    ])("rejects the annual interest rate %j", (rate) => {
      expect(issuesOf(() => loan("500000", rate, 36)).map((issue) => issue.field)).toEqual([
        "annualInterestRate",
      ]);
    });

    it("accepts the boundary rates 0 and 1000.00", () => {
      expect(loan("1000", "0", 12).monthlyPayment).toBe("83.33");
      expect(loan("1000", "1000.00", 12).monthlyPayment).toBe("833.91");
    });

    it.each([0, -1, 601, 36.5, Number.NaN, Number.POSITIVE_INFINITY, "36"])(
      "rejects the term %j",
      (termMonths) => {
        const issues = issuesOf(() =>
          calculateLoanRepayment({
            principal: "500000",
            annualInterestRate: "12",
            termMonths: termMonths as number,
          }),
        );
        expect(issues.map((issue) => issue.field)).toEqual(["termMonths"]);
      },
    );

    it.each(["100.123", "1.999", "1e5", "NaN", "Infinity", "abc", " 100", "007", "1000000000000"])(
      "rejects the invalid principal %j instead of rounding it",
      (principal) => {
        expect(issuesOf(() => loan(principal, "12", 36)).map((issue) => issue.field)).toEqual([
          "principal",
        ]);
      },
    );

    it("rejects money passed as a number", () => {
      const input = {
        principal: 500000,
        annualInterestRate: "12",
        termMonths: 36,
      } as unknown as LoanRepaymentInput;

      expect(issuesOf(() => calculateLoanRepayment(input)).map((issue) => issue.field)).toEqual([
        "principal",
      ]);
    });

    it("rejects client-supplied results as unknown fields", () => {
      const input = {
        principal: "500000.00",
        annualInterestRate: "12.00",
        termMonths: 36,
        monthlyPayment: "1234.56",
      } as LoanRepaymentInput;

      expect(issuesOf(() => calculateLoanRepayment(input))).toEqual([
        { field: "monthlyPayment", message: "Unknown field" },
      ]);
    });

    it("reports every problem at once", () => {
      expect(issuesOf(() => loan("-1", "2000", 0)).map((issue) => issue.field)).toEqual([
        "principal",
        "annualInterestRate",
        "termMonths",
      ]);
    });

    it("rejects a principal too small for the term, which would give a 0.00 payment", () => {
      expect(issuesOf(() => loan("0.01", "0", 600))).toEqual([
        {
          field: "principal",
          message: "Too small for this term: the monthly payment would round to 0.00",
        },
      ]);
      expect(loan("0.01", "0", 1).monthlyPayment).toBe("0.01");
    });
  });
});
