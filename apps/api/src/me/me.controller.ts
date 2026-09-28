import {
  createFinancialGoalRequestSchema,
  listFinancialGoalsQuerySchema,
  noQuerySchema,
  ownFinancialGoalParamsSchema,
  putFinancialProfileRequestSchema,
  updateFinancialGoalRequestSchema,
  updateUserRequestSchema,
  type CreateFinancialGoalCommand,
  type FinancialContextResponse,
  type FinancialGoalResponse,
  type FinancialProfileResponse,
  type ListFinancialGoalsQuery,
  type LiteracyContextResponse,
  type NoQuery,
  type OwnFinancialGoalParams,
  type PaginatedResponse,
  type PutFinancialProfileCommand,
  type UpdateFinancialGoalCommand,
  type UpdateUserCommand,
  type UserResponse,
} from "@finvoice/contracts";
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/auth.decorators.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { FinancialContextService } from "../financial-context/financial-context.service.js";
import { FinancialGoalsService } from "../financial-goals/financial-goals.service.js";
import { FinancialProfilesService } from "../financial-profiles/financial-profiles.service.js";
import { UsersService } from "../users/users.service.js";

/**
 * /api/v1/me: the authenticated caller's own data. The user is always the verified token's subject;
 * no route takes a user id (there is no :userId parameter, the bodies are strict, and routes
 * without query parameters reject any query string). Thin wrappers over the same services as
 * /users/:userId/..., so the business rules are shared.
 */
@Controller("me")
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: FinancialProfilesService,
    private readonly goals: FinancialGoalsService,
    private readonly context: FinancialContextService,
  ) {}

  @Get()
  get(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponse> {
    return this.users.get(user.userId);
  }

  @Patch()
  update(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: updateUserRequestSchema }) body: UpdateUserCommand,
  ): Promise<UserResponse> {
    return this.users.update(user.userId, body);
  }

  @Get("financial-profile")
  getFinancialProfile(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinancialProfileResponse> {
    return this.profiles.get(user.userId);
  }

  @Put("financial-profile")
  putFinancialProfile(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: putFinancialProfileRequestSchema }) body: PutFinancialProfileCommand,
  ): Promise<FinancialProfileResponse> {
    return this.profiles.put(user.userId, body);
  }

  @Post("goals")
  createGoal(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: createFinancialGoalRequestSchema }) body: CreateFinancialGoalCommand,
  ): Promise<FinancialGoalResponse> {
    return this.goals.create(user.userId, body);
  }

  /** Strict query: pagination and filters only (`?userId=` is rejected). */
  @Get("goals")
  listGoals(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: listFinancialGoalsQuerySchema }) query: ListFinancialGoalsQuery,
  ): Promise<PaginatedResponse<FinancialGoalResponse>> {
    return this.goals.list(user.userId, query);
  }

  /** Looked up within the caller's goals: another user's goal id answers 404. */
  @Get("goals/:goalId")
  getGoal(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Param({ schema: ownFinancialGoalParamsSchema }) params: OwnFinancialGoalParams,
  ): Promise<FinancialGoalResponse> {
    return this.goals.get(user.userId, params.goalId);
  }

  @Patch("goals/:goalId")
  updateGoal(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Param({ schema: ownFinancialGoalParamsSchema }) params: OwnFinancialGoalParams,
    @Body({ schema: updateFinancialGoalRequestSchema }) body: UpdateFinancialGoalCommand,
  ): Promise<FinancialGoalResponse> {
    return this.goals.update(user.userId, params.goalId, body);
  }

  /** The same read-only aggregation the internal user-context API serves, for the caller only. */
  @Get("financial-context")
  financialContext(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinancialContextResponse> {
    return this.context.getFinancialContext(user.userId);
  }

  @Get("literacy-context")
  literacyContext(
    @Query({ schema: noQuerySchema }) _query: NoQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LiteracyContextResponse> {
    return this.context.getLiteracyContext(user.userId);
  }
}
