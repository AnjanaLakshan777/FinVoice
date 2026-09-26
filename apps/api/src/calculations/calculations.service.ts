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

import { ApiException } from "../common/api.exception.js";

/**
 * Runs calculations with @finvoice/finance-engine. No formulas live here, and nothing is stored:
 * the engine's result (JSON-safe strings and numbers) is the response.
 */
@Injectable()
export class CalculationsService {
  loan(request: LoanCalculationRequest): LoanCalculationResponse {
    return runCalculation(() => calculateLoanRepayment(request));
  }

  savings(request: SavingsCalculationRequest): SavingsCalculationResponse {
    return runCalculation(() => calculateSavingsPlan(request));
  }

  budget(request: BudgetCalculationRequest): BudgetCalculationResponse {
    return runCalculation(() => calculateBudgetSummary(request));
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
