/**
 * @finvoice/finance-engine: deterministic financial calculations with exact decimal arithmetic.
 * Pure, synchronous functions with no framework, database or network dependencies.
 * See docs/architecture/financial-calculation-engine.md.
 */
export { CALCULATION_VERSION, type CalculationVersion } from "./version.js";
export {
  FinanceValidationError,
  type FinanceValidationIssue,
} from "./errors/finance-validation.error.js";
export {
  isMoneyString,
  isPercentageString,
  isPositiveMoneyString,
  MONEY_FORMAT_DESCRIPTION,
  MONEY_PATTERN,
  PERCENTAGE_FORMAT_DESCRIPTION,
  PERCENTAGE_PATTERN,
} from "./money/money.js";
export {
  calculateLoanRepayment,
  isValidAnnualInterestRate,
  LOAN_LIMITS,
  type LoanRepaymentAssumptions,
  type LoanRepaymentInput,
  type LoanRepaymentResult,
} from "./loan/loan-repayment.js";
export {
  calculateSavingsPlan,
  SAVINGS_LIMITS,
  type SavingsPlanInput,
  type SavingsPlanResult,
} from "./savings/savings-plan.js";
export {
  BUDGET_STATUSES,
  calculateBudgetSummary,
  type BudgetStatus,
  type BudgetSummaryInput,
  type BudgetSummaryResult,
} from "./budget/budget-summary.js";
