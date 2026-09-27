import type {
  BudgetCalculationRequest,
  BudgetCalculationResponse,
  LoanCalculationRequest,
  LoanCalculationResponse,
  SavingsCalculationRequest,
  SavingsCalculationResponse,
} from "@finvoice/contracts";
import {
  calculateBudgetSummary,
  calculateLoanRepayment,
  calculateSavingsPlan,
  FinanceValidationError,
} from "@finvoice/finance-engine";
import { Injectable } from "@nestjs/common";

import { AnalyticsRecorder, elapsedMs, errorCodeOf } from "../analytics/analytics-recorder.js";
import { ApiException } from "../common/api.exception.js";

/**
 * Runs calculations with @finvoice/finance-engine. No formulas live here, and nothing is stored:
 * the engine's result (JSON-safe strings and numbers) is the response.
 *
 * Each calculation is counted as a CALCULATION analytics event: which calculator, success and
 * duration only. Inputs and results (amounts, rates, income) are never recorded.
 */
@Injectable()
export class CalculationsService {
  constructor(private readonly analytics: AnalyticsRecorder) {}

  loan(request: LoanCalculationRequest): LoanCalculationResponse {
    return this.run("calculate_loan", () => calculateLoanRepayment(request));
  }

  savings(request: SavingsCalculationRequest): SavingsCalculationResponse {
    return this.run("calculate_savings", () => calculateSavingsPlan(request));
  }

  budget(request: BudgetCalculationRequest): BudgetCalculationResponse {
    return this.run("calculate_budget", () => calculateBudgetSummary(request));
  }

  private run<T>(
    toolName: "calculate_loan" | "calculate_savings" | "calculate_budget",
    calculate: () => T,
  ): T {
    const started = performance.now();
    try {
      const result = runCalculation(calculate);
      this.analytics.record({
        eventType: "CALCULATION",
        source: "API",
        toolName,
        success: true,
        durationMs: elapsedMs(started),
      });
      return result;
    } catch (error) {
      this.analytics.record({
        eventType: "CALCULATION",
        source: "API",
        toolName,
        success: false,
        durationMs: elapsedMs(started),
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  }
}

/**
 * Maps the engine's input validation errors (for example currentAmount > targetAmount, which spans
 * two fields) to 400 responses. Any other error is unexpected and becomes a 500.
 */
function runCalculation<T>(calculate: () => T): T {
  try {
    return calculate();
  } catch (error) {
    if (error instanceof FinanceValidationError) {
      throw ApiException.validation(error.issues.map(({ field, message }) => ({ field, message })));
    }
    throw error;
  }
}
