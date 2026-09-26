import { describe, expect, it } from "vitest";

import {
  calculateSavingsPlan,
  FinanceValidationError,
  type SavingsPlanInput,
} from "../src/index.js";
import { formatCents, referenceSavings, seededRandom, toCents } from "./reference.js";

// Expected values come from test/reference.ts, an independent implementation with exact rational
// arithmetic on BigInt (no decimal.js).

function plan(targetAmount: string, currentAmount: string, months: number) {
  return calculateSavingsPlan({ targetAmount, currentAmount, months });
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

describe("calculateSavingsPlan", () => {
  it("reaches the target exactly: the final contribution absorbs the former 0.04 shortfall", () => {
    // 250000 / 12 = 20833.333…: 11 × 20833.33 + 20833.37 = 250000.00.
    expect(plan("300000.00", "50000.00", 12)).toEqual({
      calculationVersion: "1",
      targetAmount: "300000.00",
      currentAmount: "50000.00",
      remainingAmount: "250000.00",
      months: 12,
      requiredMonthlyContribution: "20833.33",
      finalContribution: "20833.37",
      plannedTotalContribution: "250000.00",
      differenceFromTarget: "0.00",
    });
  });

  it("uses equal contributions when the amount divides exactly", () => {
    expect(plan("300000", "0", 12)).toMatchObject({
      currentAmount: "0.00",
      remainingAmount: "300000.00",
      requiredMonthlyContribution: "25000.00",
      finalContribution: "25000.00",
      plannedTotalContribution: "300000.00",
      differenceFromTarget: "0.00",
    });
  });

  it("returns zeros when the target is already reached", () => {
    expect(plan("300000", "300000", 12)).toMatchObject({
      remainingAmount: "0.00",
      requiredMonthlyContribution: "0.00",
      finalContribution: "0.00",
      plannedTotalContribution: "0.00",
      differenceFromTarget: "0.00",
    });
  });

  it("uses a single contribution for a one-month plan", () => {
    expect(plan("1000", "0.01", 1)).toMatchObject({
      requiredMonthlyContribution: "999.99",
      finalContribution: "999.99",
      plannedTotalContribution: "999.99",
      differenceFromTarget: "0.00",
    });
  });

  it("works when the current amount is just below the target", () => {
    expect(plan("1000", "999.99", 600)).toMatchObject({
      remainingAmount: "0.01",
      requiredMonthlyContribution: "0.00",
      finalContribution: "0.01",
      plannedTotalContribution: "0.01",
      differenceFromTarget: "0.00",
    });
  });

  it("lets the final contribution be smaller when the regular one was rounded up", () => {
    // 0.05 / 2 = 0.025 → 0.03, final 0.02.
    expect(plan("0.05", "0", 2)).toMatchObject({
      requiredMonthlyContribution: "0.03",
      finalContribution: "0.02",
      plannedTotalContribution: "0.05",
      differenceFromTarget: "0.00",
    });
  });

  it("rounds the regular contribution down when rounding up would overshoot before the last month", () => {
    // 1000 / 600 = 1.666… → 1.67 would reach 1000.33 after 599 months; 1.66 leaves a final 5.66.
    expect(plan("1000", "0", 600)).toMatchObject({
      requiredMonthlyContribution: "1.66",
      finalContribution: "5.66",
      plannedTotalContribution: "1000.00",
      differenceFromTarget: "0.00",
    });
  });

  it("matches the independent reference and always reaches the target (1,000 generated plans)", () => {
    const random = seededRandom(7);
    for (let run = 0; run < 1000; run += 1) {
      const targetCents = BigInt(Math.floor(random() * 100_000_000_000)) + 1n;
      const currentCents = BigInt(Math.floor(random() * Number(targetCents)));
      const target = formatCents(targetCents);
      const current = formatCents(currentCents);
      const months = Math.floor(random() * 600) + 1;

      const result = plan(target, current, months);

      expect(result).toMatchObject(referenceSavings(target, current, months));
      expect(result.plannedTotalContribution).toBe(result.remainingAmount);
      expect(result.differenceFromTarget).toBe("0.00");
      expect(toCents(result.finalContribution) >= 0n).toBe(true);
    }
  });

  it("is deterministic", () => {
    const input: SavingsPlanInput = {
      targetAmount: "987654.32",
      currentAmount: "12345.67",
      months: 37,
    };
    const first = calculateSavingsPlan(input);
    expect(first).toMatchObject({
      requiredMonthlyContribution: "26359.69",
      finalContribution: "26359.81",
      plannedTotalContribution: "975308.65",
    });

    for (let run = 0; run < 50; run += 1) {
      expect(calculateSavingsPlan({ ...input })).toEqual(first);
    }
  });

  describe("validation", () => {
    it("rejects a current amount above the target", () => {
      expect(fieldsOf(() => plan("1000.00", "1000.01", 12))).toEqual(["currentAmount"]);
    });

    it.each(["0", "0.00", "-100"])("rejects the target %j", (target) => {
      expect(fieldsOf(() => plan(target, "0", 12))).toEqual(["targetAmount"]);
    });

    it.each(["-0.01", "-1", "abc"])("rejects the current amount %j", (current) => {
      expect(fieldsOf(() => plan("1000", current, 12))).toEqual(["currentAmount"]);
    });

    it.each([0, -1, 601, 12.5, Number.NaN])("rejects the number of months %j", (months) => {
      expect(fieldsOf(() => plan("1000", "0", months))).toEqual(["months"]);
    });

    it.each([
      ["100.001", "0"],
      ["100", "1.999"],
    ])("rejects more than 2 decimal places (%j, %j)", (target, current) => {
      expect(fieldsOf(() => plan(target, current, 12))).toHaveLength(1);
    });

    it("rejects client-supplied results as unknown fields", () => {
      const input = {
        targetAmount: "1000",
        currentAmount: "0",
        months: 10,
        requiredMonthlyContribution: "1.00",
      } as SavingsPlanInput;

      expect(fieldsOf(() => calculateSavingsPlan(input))).toEqual(["requiredMonthlyContribution"]);
    });
  });
});
