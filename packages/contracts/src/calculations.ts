import {
  isValidAnnualInterestRate,
  LOAN_LIMITS,
  PERCENTAGE_FORMAT_DESCRIPTION,
  SAVINGS_LIMITS,
  type BudgetSummaryResult,
  type LoanRepaymentResult,
  type SavingsPlanResult,
} from "@finvoice/finance-engine";
import { z } from "zod";

import { moneyAmountSchema, positiveMoneyAmountSchema } from "./common.js";

/**
 * Calculation requests carry inputs only. Results such as `monthlyPayment`, `totalInterest` or
 * `savingsRate` are rejected as unknown properties: the server calculates them, it never accepts
 * them from a client, a voice flow or an AI model.
 *
 * Limits and formats come from @finvoice/finance-engine, which validates the same inputs again
 * (including cross-field rules such as currentAmount <= targetAmount).
 */

function wholeMonthsSchema(min: number, max: number) {
  const message = `Must be a whole number from ${String(min)} to ${String(max)}`;
  return z
    .number({ error: message })
    .int({ error: message })
    .min(min, { error: message })
    .max(max, { error: message });
}

export const annualInterestRateSchema = z
  .string({ error: 'Must be a decimal string, e.g. "12.50" (JSON numbers are not accepted)' })
  .refine(isValidAnnualInterestRate, {
    error: `Must be ${PERCENTAGE_FORMAT_DESCRIPTION}, at most ${LOAN_LIMITS.maxAnnualInterestRate}`,
  });

export const loanCalculationRequestSchema = z.strictObject({
  principal: positiveMoneyAmountSchema,
  annualInterestRate: annualInterestRateSchema,
  termMonths: wholeMonthsSchema(LOAN_LIMITS.minTermMonths, LOAN_LIMITS.maxTermMonths),
});
export type LoanCalculationRequest = z.input<typeof loanCalculationRequestSchema>;
export type LoanCalculationResponse = LoanRepaymentResult;

export const savingsCalculationRequestSchema = z.strictObject({
  targetAmount: positiveMoneyAmountSchema,
  currentAmount: moneyAmountSchema,
  months: wholeMonthsSchema(SAVINGS_LIMITS.minMonths, SAVINGS_LIMITS.maxMonths),
});
export type SavingsCalculationRequest = z.input<typeof savingsCalculationRequestSchema>;
export type SavingsCalculationResponse = SavingsPlanResult;

export const budgetCalculationRequestSchema = z.strictObject({
  monthlyIncome: moneyAmountSchema,
  monthlyExpenses: moneyAmountSchema,
});
export type BudgetCalculationRequest = z.input<typeof budgetCalculationRequestSchema>;
export type BudgetCalculationResponse = BudgetSummaryResult;
