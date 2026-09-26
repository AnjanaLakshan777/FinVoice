import {
  budgetCalculationRequestSchema,
  loanCalculationRequestSchema,
  savingsCalculationRequestSchema,
  type BudgetCalculationRequest,
  type BudgetCalculationResponse,
  type LoanCalculationRequest,
  type LoanCalculationResponse,
  type SavingsCalculationRequest,
  type SavingsCalculationResponse,
} from "@finvoice/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { CalculationsService } from "./calculations.service.js";

/**
 * Stateless calculations. POST because the inputs are a structured body, but nothing is created
 * or stored, hence 200 rather than 201.
 */
@Controller("calculations")
export class CalculationsController {
  constructor(private readonly calculations: CalculationsService) {}

  @Post("loan")
  @HttpCode(HttpStatus.OK)
  loan(
    @Body({ schema: loanCalculationRequestSchema }) body: LoanCalculationRequest,
  ): LoanCalculationResponse {
    return this.calculations.loan(body);
  }

  @Post("savings")
  @HttpCode(HttpStatus.OK)
  savings(
    @Body({ schema: savingsCalculationRequestSchema }) body: SavingsCalculationRequest,
  ): SavingsCalculationResponse {
    return this.calculations.savings(body);
  }

  @Post("budget")
  @HttpCode(HttpStatus.OK)
  budget(
    @Body({ schema: budgetCalculationRequestSchema }) body: BudgetCalculationRequest,
  ): BudgetCalculationResponse {
    return this.calculations.budget(body);
  }
}
