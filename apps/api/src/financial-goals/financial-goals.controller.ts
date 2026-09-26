import {
  createFinancialGoalRequestSchema,
  financialGoalParamsSchema,
  listFinancialGoalsQuerySchema,
  updateFinancialGoalRequestSchema,
  userParamsSchema,
  type CreateFinancialGoalCommand,
  type FinancialGoalParams,
  type FinancialGoalResponse,
  type ListFinancialGoalsQuery,
  type PaginatedResponse,
  type UpdateFinancialGoalCommand,
  type UserParams,
} from "@finvoice/contracts";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { FinancialGoalsService } from "./financial-goals.service.js";

@Controller("users/:userId/goals")
export class FinancialGoalsController {
  constructor(private readonly goals: FinancialGoalsService) {}

  @Post()
  create(
    @Param({ schema: userParamsSchema }) params: UserParams,
    @Body({ schema: createFinancialGoalRequestSchema }) body: CreateFinancialGoalCommand,
  ): Promise<FinancialGoalResponse> {
    return this.goals.create(params.userId, body);
  }

  @Get()
  list(
    @Param({ schema: userParamsSchema }) params: UserParams,
    @Query({ schema: listFinancialGoalsQuerySchema }) query: ListFinancialGoalsQuery,
  ): Promise<PaginatedResponse<FinancialGoalResponse>> {
    return this.goals.list(params.userId, query);
  }

  @Get(":goalId")
  get(
    @Param({ schema: financialGoalParamsSchema }) params: FinancialGoalParams,
  ): Promise<FinancialGoalResponse> {
    return this.goals.get(params.userId, params.goalId);
  }

  @Patch(":goalId")
  update(
    @Param({ schema: financialGoalParamsSchema }) params: FinancialGoalParams,
    @Body({ schema: updateFinancialGoalRequestSchema }) body: UpdateFinancialGoalCommand,
  ): Promise<FinancialGoalResponse> {
    return this.goals.update(params.userId, params.goalId, body);
  }
}
