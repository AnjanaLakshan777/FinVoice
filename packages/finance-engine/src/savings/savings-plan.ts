import { InputReader } from "../input.js";
import { splitIntoInstalments } from "../money/instalments.js";
import { formatMoney } from "../money/money.js";
import { CALCULATION_VERSION, type CalculationVersion } from "../version.js";

export const SAVINGS_LIMITS = {
  minMonths: 1,
  maxMonths: 600,
} as const;

const INPUT_FIELDS = ["targetAmount", "currentAmount", "months"] as const;

export type SavingsPlanInput = {
  /** Money string > 0. */
  targetAmount: string;
  /** Money string ≥ 0 and ≤ targetAmount. */
  currentAmount: string;
  /** Number of monthly contributions, 1–600. */
  months: number;
};

export type SavingsPlanResult = {
  calculationVersion: CalculationVersion;
  targetAmount: string;
  currentAmount: string;
  /** targetAmount − currentAmount. */
  remainingAmount: string;
  months: number;
  /**
   * The regular contribution for months 1 to months − 1: remainingAmount / months rounded
   * half-up to cents. For a one-month plan, the single contribution.
   */
  requiredMonthlyContribution: string;
  /** The last contribution. It absorbs cent rounding, so it can differ by a few cents. */
  finalContribution: string;
  /** requiredMonthlyContribution × (months − 1) + finalContribution; always = remainingAmount. */
  plannedTotalContribution: string;
  /** remainingAmount − plannedTotalContribution: "0.00", because the final contribution reconciles the plan. */
  differenceFromTarget: string;
};

/**
 * Monthly contributions needed to reach a target from a current amount in a number of months:
 * equal regular contributions rounded to cents, and a final contribution that absorbs the
 * rounding so the plan reaches the target exactly (see splitIntoInstalments).
 * Pure arithmetic: no interest, investment returns, inflation or recommendations.
 */
export function calculateSavingsPlan(input: SavingsPlanInput): SavingsPlanResult {
  const reader = new InputReader(input, INPUT_FIELDS);
  const values = {
    targetAmount: reader.money("targetAmount", "positive"),
    currentAmount: reader.money("currentAmount", "zero"),
    months: reader.integer("months", SAVINGS_LIMITS.minMonths, SAVINGS_LIMITS.maxMonths),
  };
  if (values.targetAmount && values.currentAmount?.greaterThan(values.targetAmount)) {
    reader.addIssue("currentAmount", "Must not exceed targetAmount");
  }
  const { targetAmount, currentAmount, months } = reader.finish(values);

  const remainingAmount = targetAmount.minus(currentAmount);
  const contributions = splitIntoInstalments(
    remainingAmount.dividedBy(months),
    remainingAmount,
    months,
  );
  const plannedTotalContribution = contributions.regular
    .times(months - 1)
    .plus(contributions.final);

  return {
    calculationVersion: CALCULATION_VERSION,
    targetAmount: formatMoney(targetAmount),
    currentAmount: formatMoney(currentAmount),
    remainingAmount: formatMoney(remainingAmount),
    months,
    requiredMonthlyContribution: formatMoney(contributions.regular),
    finalContribution: formatMoney(contributions.final),
    plannedTotalContribution: formatMoney(plannedTotalContribution),
    differenceFromTarget: formatMoney(remainingAmount.minus(plannedTotalContribution)),
  };
}
