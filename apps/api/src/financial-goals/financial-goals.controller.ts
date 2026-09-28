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

import { OwnUserOnly } from "../auth/auth.decorators.js";
import { FinancialGoalsService } from "./financial-goals.service.js";

/**
 * The caller's own goals only: another user's id answers 404, and a goal id is always looked up
 * within the caller's user id, so another user's goal is indistinguishable from a missing one. See
 * also /me/goals.
 */
@Controller("users/:userId/goals")
@OwnUserOnly()
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
