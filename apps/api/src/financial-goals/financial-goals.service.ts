import {
  DEFAULT_CURRENCY,
  type CreateFinancialGoalCommand,
  type FinancialGoalResponse,
  type ListFinancialGoalsQuery,
  type PaginatedResponse,
  type UpdateFinancialGoalCommand,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { calendarDateToDate, dateToCalendarDate } from "../common/calendar-date.js";
import { toMoney, toMoneyString } from "../common/money.js";
import { omitUndefined } from "../common/omit-undefined.js";
import { isPrismaError } from "../common/prisma-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import type { FinancialGoal, Prisma } from "../generated/prisma/client.js";
import { userNotFound, UsersService } from "../users/users.service.js";

@Injectable()
export class FinancialGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async create(
    userId: string,
    command: CreateFinancialGoalCommand,
  ): Promise<FinancialGoalResponse> {
    await this.users.assertExists(userId);
    const currentAmount = command.currentAmount ?? "0";
    assertCurrentWithinTarget(currentAmount, command.targetAmount);

    try {
      const goal = await this.prisma.financialGoal.create({
        data: {
          userId,
          type: command.type,
          name: command.name,
          targetAmount: command.targetAmount,
          currentAmount,
          currency: command.currency ?? DEFAULT_CURRENCY,
          targetDate: command.targetDate ? calendarDateToDate(command.targetDate) : null,
        },
      });
      return toFinancialGoalResponse(goal);
    } catch (error) {
      // The user was deleted between the existence check and the write.
      if (isPrismaError(error, "P2003")) {
        throw userNotFound();
      }
      throw error;
    }
  }

  /** A page of the user's goals, newest first, optionally filtered by status and type. */
  async list(
    userId: string,
    query: ListFinancialGoalsQuery,
  ): Promise<PaginatedResponse<FinancialGoalResponse>> {
    await this.users.assertExists(userId);
    const where: Prisma.FinancialGoalWhereInput = omitUndefined({
      userId,
      status: query.status,
      type: query.type,
    });

    const [total, goals] = await this.prisma.$transaction([
      this.prisma.financialGoal.count({ where }),
      this.prisma.financialGoal.findMany({
        where,
        // UUIDv7 ids are time-ordered, so id breaks createdAt ties deterministically.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data: goals.map(toFinancialGoalResponse),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * Up to `limit` ACTIVE goals, soonest target date first (goals without one last), and whether
   * more exist. One query (limit + 1 rows) on the (user_id, status, target_date) index. For
   * callers that have already checked the user exists (the financial context).
   */
  async listActive(
    userId: string,
    limit: number,
  ): Promise<{ goals: FinancialGoalResponse[]; hasMore: boolean }> {
    const goals = await this.prisma.financialGoal.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [
        { targetDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      take: limit + 1,
    });
    return {
      goals: goals.slice(0, limit).map(toFinancialGoalResponse),
      hasMore: goals.length > limit,
    };
  }

  async get(userId: string, goalId: string): Promise<FinancialGoalResponse> {
    return toFinancialGoalResponse(await this.findOwnedGoal(userId, goalId));
  }

  /**
   * Applies a partial update, then re-checks the goal as a whole: the new values are merged with
   * the stored ones before validating currentAmount <= targetAmount. Status changes only when the
   * client sends one.
   */
  async update(
    userId: string,
    goalId: string,
    command: UpdateFinancialGoalCommand,
  ): Promise<FinancialGoalResponse> {
    const existing = await this.findOwnedGoal(userId, goalId);
    assertCurrentWithinTarget(
      command.currentAmount ?? existing.currentAmount,
      command.targetAmount ?? existing.targetAmount,
    );

    try {
      const goal = await this.prisma.financialGoal.update({
        where: { id: goalId, userId },
        data: omitUndefined({
          type: command.type,
          name: command.name,
          targetAmount: command.targetAmount,
          currentAmount: command.currentAmount,
          currency: command.currency,
          status: command.status,
          targetDate:
            command.targetDate === undefined
              ? undefined
              : command.targetDate === null
                ? null
                : calendarDateToDate(command.targetDate),
        }),
      });
      return toFinancialGoalResponse(goal);
    } catch (error) {
      // Deleted between the read and the write.
      if (isPrismaError(error, "P2025")) {
        throw goalNotFound();
      }
      throw error;
    }
  }

  /**
   * Loads a goal only if it belongs to the user. A goal owned by someone else gets the same 404 as
   * a goal that does not exist, so its existence is not revealed.
   */
  private async findOwnedGoal(userId: string, goalId: string): Promise<FinancialGoal> {
    await this.users.assertExists(userId);
    const goal = await this.prisma.financialGoal.findFirst({ where: { id: goalId, userId } });
    if (!goal) {
      throw goalNotFound();
    }
    return goal;
  }
}

/**
 * Domain rule: the amount saved or repaid so far cannot exceed the target. Checked here, before
 * writing, so clients get a clear validation error. The database CHECK constraint remains a
 * second line of defence.
 */
function assertCurrentWithinTarget(
  currentAmount: string | Prisma.Decimal,
  targetAmount: string | Prisma.Decimal,
): void {
  if (toMoney(currentAmount).greaterThan(toMoney(targetAmount))) {
    throw ApiException.validation([
      { field: "currentAmount", message: "Must not exceed targetAmount" },
    ]);
  }
}

function goalNotFound(): ApiException {
  return ApiException.notFound("Financial goal not found");
}

function toFinancialGoalResponse(goal: FinancialGoal): FinancialGoalResponse {
  return {
    id: goal.id,
    userId: goal.userId,
    type: goal.type,
    name: goal.name,
    targetAmount: toMoneyString(goal.targetAmount),
    currentAmount: toMoneyString(goal.currentAmount),
    currency: goal.currency,
    targetDate: goal.targetDate ? dateToCalendarDate(goal.targetDate) : null,
    status: goal.status,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}
