import {
  DEFAULT_CURRENCY,
  type FinancialProfileResponse,
  type PutFinancialProfileCommand,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { toNullableMoneyString } from "../common/money.js";
import { isPrismaError } from "../common/prisma-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import type { FinancialProfile } from "../generated/prisma/client.js";
import { userNotFound, UsersService } from "../users/users.service.js";

@Injectable()
export class FinancialProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async get(userId: string): Promise<FinancialProfileResponse> {
    await this.users.assertExists(userId);
    const profile = await this.prisma.financialProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw ApiException.notFound("Financial profile not found");
    }
    return toFinancialProfileResponse(profile);
  }

  /**
   * The stored profile, or null if the user has none. For callers that have already checked the
   * user exists (the financial context), so it costs a single query.
   */
  async find(userId: string): Promise<FinancialProfileResponse | null> {
    const profile = await this.prisma.financialProfile.findUnique({ where: { userId } });
    return profile ? toFinancialProfileResponse(profile) : null;
  }

  /**
   * Creates the user's profile or replaces it entirely: omitted amounts become null ("not provided
   * yet") and an omitted currency becomes the default. A single atomic upsert on the unique
   * user_id, so concurrent requests cannot create two profiles.
   */
  async put(
    userId: string,
    command: PutFinancialProfileCommand,
  ): Promise<FinancialProfileResponse> {
    await this.users.assertExists(userId);
    const values = {
      monthlyIncome: command.monthlyIncome ?? null,
      monthlyExpenses: command.monthlyExpenses ?? null,
      currency: command.currency ?? DEFAULT_CURRENCY,
    };
    try {
      const profile = await this.prisma.financialProfile.upsert({
        where: { userId },
        create: { userId, ...values },
        update: values,
      });
      return toFinancialProfileResponse(profile);
    } catch (error) {
      // The user was deleted between the existence check and the write.
      if (isPrismaError(error, "P2003")) {
        throw userNotFound();
      }
      throw error;
    }
  }
}

function toFinancialProfileResponse(profile: FinancialProfile): FinancialProfileResponse {
  return {
    userId: profile.userId,
    monthlyIncome: toNullableMoneyString(profile.monthlyIncome),
    monthlyExpenses: toNullableMoneyString(profile.monthlyExpenses),
    currency: profile.currency,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
