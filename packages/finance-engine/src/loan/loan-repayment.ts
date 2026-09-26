import { FinanceValidationError } from "../errors/finance-validation.error.js";
import { InputReader } from "../input.js";
import { Decimal } from "../money/decimal.js";
import { splitIntoInstalments } from "../money/instalments.js";
import { formatMoney, formatPercentage, isPercentageString, roundToCents } from "../money/money.js";
import { CALCULATION_VERSION, type CalculationVersion } from "../version.js";

export const LOAN_LIMITS = {
  /** Upper bound on the annual interest rate, in percent. A technical limit, not a legal one. */
  maxAnnualInterestRate: "1000.00",
  minTermMonths: 1,
  maxTermMonths: 600,
} as const;

const MAX_ANNUAL_INTEREST_RATE = new Decimal(LOAN_LIMITS.maxAnnualInterestRate);
const INPUT_FIELDS = ["principal", "annualInterestRate", "termMonths"] as const;

/** True for a percentage string from 0 to LOAN_LIMITS.maxAnnualInterestRate. */
export function isValidAnnualInterestRate(value: unknown): value is string {
  return isPercentageString(value) && !new Decimal(value).greaterThan(MAX_ANNUAL_INTEREST_RATE);
}

export type LoanRepaymentInput = {
  /** Amount borrowed: money string > 0, e.g. "500000.00". */
  principal: string;
  /** Nominal annual interest rate in percent, 0–1000, e.g. "12.00". */
  annualInterestRate: string;
  /** Number of monthly payments, 1–600. */
  termMonths: number;
};

/** Exactly what the calculation assumes. Nothing else is modelled. */
export type LoanRepaymentAssumptions = {
  interestMethod: "reducing_balance";
  paymentFrequency: "monthly";
  monthlyRateMethod: "annual_rate_divided_by_12";
  feesIncluded: false;
  insuranceIncluded: false;
  earlyRepaymentIncluded: false;
};

export type LoanRepaymentResult = {
  calculationVersion: CalculationVersion;
  principal: string;
  annualInterestRate: string;
  termMonths: number;
  /**
   * The regular monthly payment (payments 1 to termMonths − 1): the exact level payment rounded
   * half-up to cents. For a one-month loan, the single payment.
   */
  monthlyPayment: string;
  /** The last payment. It absorbs cent rounding, so it can differ from monthlyPayment by a few cents. */
  finalPayment: string;
  /** Exact level payment × termMonths, rounded once to cents; = monthlyPayment × (termMonths − 1) + finalPayment. */
  totalRepayment: string;
  /** totalRepayment − principal; exactly 0.00 for a 0% loan. */
  totalInterest: string;
  assumptions: LoanRepaymentAssumptions;
};

const ASSUMPTIONS: LoanRepaymentAssumptions = {
  interestMethod: "reducing_balance",
  paymentFrequency: "monthly",
  monthlyRateMethod: "annual_rate_divided_by_12",
  feesIncluded: false,
  insuranceIncluded: false,
  earlyRepaymentIncluded: false,
};

/**
 * Repayment of a standard reducing-balance (amortising) loan with equal monthly payments.
 *
 *   r   = annualInterestRate / 100 / 12
 *   EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)      (r > 0)
 *   EMI = P / n                                    (r = 0)
 *
 * Computed with 50 significant digits. Payments are whole cents, so:
 *
 *   totalRepayment = EMI × n, rounded half-up to cents (once)
 *   monthlyPayment = EMI rounded half-up to cents, for payments 1 … n − 1
 *   finalPayment   = totalRepayment − monthlyPayment × (n − 1)
 *   totalInterest  = totalRepayment − P
 *
 * The final payment absorbs the cent rounding, so the payments add up to the total exactly and
 * a 0% loan repays exactly the principal (interest 0.00). See splitIntoInstalments for the rule
 * that keeps the final payment positive.
 *
 * Illustrative only, not a lender quote: real schedules can differ (fees, insurance, taxes,
 * other rounding, compounding or day-count conventions).
 */
export function calculateLoanRepayment(input: LoanRepaymentInput): LoanRepaymentResult {
  const reader = new InputReader(input, INPUT_FIELDS);
  const values = {
    principal: reader.money("principal", "positive"),
    annualInterestRate: reader.percentage("annualInterestRate", MAX_ANNUAL_INTEREST_RATE),
    termMonths: reader.integer("termMonths", LOAN_LIMITS.minTermMonths, LOAN_LIMITS.maxTermMonths),
  };
  const { principal, annualInterestRate, termMonths } = reader.finish(values);

  const exactPayment = exactMonthlyPayment(principal, annualInterestRate, termMonths);
  const totalRepayment = roundToCents(exactPayment.times(termMonths));
  const payments = splitIntoInstalments(exactPayment, totalRepayment, termMonths);
  if (payments.regular.isZero()) {
    // e.g. 0.01 over 600 months: regular payments of 0.00 would not be a repayment plan.
    throw new FinanceValidationError([
      {
        field: "principal",
        message: "Too small for this term: the monthly payment would round to 0.00",
      },
    ]);
  }

  return {
    calculationVersion: CALCULATION_VERSION,
    principal: formatMoney(principal),
    annualInterestRate: formatPercentage(annualInterestRate),
    termMonths,
    monthlyPayment: formatMoney(payments.regular),
    finalPayment: formatMoney(payments.final),
    totalRepayment: formatMoney(totalRepayment),
    totalInterest: formatMoney(totalRepayment.minus(principal)),
    assumptions: { ...ASSUMPTIONS },
  };
}

/** The exact level monthly payment (EMI), unrounded. */
function exactMonthlyPayment(
  principal: Decimal,
  annualInterestRate: Decimal,
  termMonths: number,
): Decimal {
  const monthlyRate = annualInterestRate.dividedBy(100).dividedBy(12);
  if (monthlyRate.isZero()) {
    return principal.dividedBy(termMonths);
  }
  const growth = monthlyRate.plus(1).pow(termMonths);
  return principal.times(monthlyRate).times(growth).dividedBy(growth.minus(1));
}
