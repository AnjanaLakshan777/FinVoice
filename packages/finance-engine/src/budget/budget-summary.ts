import { InputReader } from "../input.js";
import type { Decimal } from "../money/decimal.js";
import { formatMoney, formatPercentage } from "../money/money.js";
import { CALCULATION_VERSION, type CalculationVersion } from "../version.js";

const INPUT_FIELDS = ["monthlyIncome", "monthlyExpenses"] as const;

export const BUDGET_STATUSES = ["SURPLUS", "BREAK_EVEN", "DEFICIT"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export type BudgetSummaryInput = {
  /** Money string ≥ 0. */
  monthlyIncome: string;
  /** Money string ≥ 0. */
  monthlyExpenses: string;
};

export type BudgetSummaryResult = {
  calculationVersion: CalculationVersion;
  monthlyIncome: string;
  monthlyExpenses: string;
  /** monthlyIncome − monthlyExpenses; negative for a deficit. */
  monthlySurplus: string;
  /** monthlyExpenses / monthlyIncome × 100 (percent), or null when income is 0. */
  expenseRatio: string | null;
  /** monthlySurplus / monthlyIncome × 100 (percent, negative for a deficit), or null when income is 0. */
  savingsRate: string | null;
  status: BudgetStatus;
};

/** Monthly surplus or deficit and the related percentages of income. Arithmetic only, no advice. */
export function calculateBudgetSummary(input: BudgetSummaryInput): BudgetSummaryResult {
  const reader = new InputReader(input, INPUT_FIELDS);
  const { monthlyIncome, monthlyExpenses } = reader.finish({
    monthlyIncome: reader.money("monthlyIncome", "zero"),
    monthlyExpenses: reader.money("monthlyExpenses", "zero"),
  });

  const monthlySurplus = monthlyIncome.minus(monthlyExpenses);
  const hasIncome = !monthlyIncome.isZero();

  return {
    calculationVersion: CALCULATION_VERSION,
    monthlyIncome: formatMoney(monthlyIncome),
    monthlyExpenses: formatMoney(monthlyExpenses),
    monthlySurplus: formatMoney(monthlySurplus),
    expenseRatio: hasIncome
      ? formatPercentage(monthlyExpenses.dividedBy(monthlyIncome).times(100))
      : null,
    savingsRate: hasIncome
      ? formatPercentage(monthlySurplus.dividedBy(monthlyIncome).times(100))
      : null,
    status: budgetStatus(monthlySurplus),
  };
}

function budgetStatus(monthlySurplus: Decimal): BudgetStatus {
  const sign = monthlySurplus.comparedTo(0);
  if (sign > 0) {
    return "SURPLUS";
  }
  return sign === 0 ? "BREAK_EVEN" : "DEFICIT";
}
