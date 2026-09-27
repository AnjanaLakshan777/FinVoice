import {
  DEFAULT_ASSESSMENT_VERSION,
  type LiteracyProfileResponse,
  type UpdateLiteracyProfileCommand,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { isPrismaError } from "../common/prisma-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import type { FinancialLiteracyProfile } from "../generated/prisma/client.js";
import { userNotFound, UsersService } from "../users/users.service.js";

/**
 * The state of a user who has no literacy profile row yet: a beginner who has not completed a
 * formal assessment. Returned without writing anything.
 */
export const UNASSESSED_LITERACY_PROFILE: LiteracyProfileResponse = {
  level: "BEGINNER",
  assessmentVersion: DEFAULT_ASSESSMENT_VERSION,
  assessedAt: null,
};

/**
 * The user's financial-literacy learning level. It changes only through `updateProfileLevel`, an
 * explicit call by assessment logic or an authorised system; nothing here infers a level from
 * conversations, and there is no numeric score.
 */
@Injectable()
export class FinancialLiteracyProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** The stored profile, or the unassessed default. 404 for an unknown user. */
  async getProfile(userId: string): Promise<LiteracyProfileResponse> {
    await this.users.assertExists(userId);
    return this.find(userId);
  }

  /** Like getProfile, for callers that have already checked the user exists. One query. */
  async find(userId: string): Promise<LiteracyProfileResponse> {
    const profile = await this.prisma.financialLiteracyProfile.findUnique({ where: { userId } });
    return profile ? toLiteracyProfileResponse(profile) : UNASSESSED_LITERACY_PROFILE;
  }

  /**
   * Returns the stored profile, creating the unassessed default row if there is none. A single
   * atomic upsert on the unique user_id: concurrent calls cannot create two rows, and an existing
   * profile is never changed. assessedAt stays null: creating the row is not an assessment.
   */
  async createOrGetProfile(userId: string): Promise<LiteracyProfileResponse> {
    await this.users.assertExists(userId);
    try {
      const profile = await this.prisma.financialLiteracyProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      return toLiteracyProfileResponse(profile);
    } catch (error) {
      throw mapMissingUser(error);
    }
  }

  /**
   * Sets the level explicitly, as the result of an assessment (assessedAt = when it happened) or
   * an authorised update (assessedAt = null). assessedAt must not be in the future.
   */
  async updateProfileLevel(
    userId: string,
    command: UpdateLiteracyProfileCommand,
  ): Promise<LiteracyProfileResponse> {
    await this.users.assertExists(userId);
    const assessedAt = command.assessedAt === null ? null : new Date(command.assessedAt);
    if (assessedAt !== null && assessedAt.getTime() > Date.now()) {
      throw ApiException.validation([
        { field: "assessedAt", message: "Must not be in the future" },
      ]);
    }
    const values = {
      level: command.level,
      assessmentVersion: command.assessmentVersion,
      assessedAt,
    };
    try {
      const profile = await this.prisma.financialLiteracyProfile.upsert({
        where: { userId },
        create: { userId, ...values },
        update: values,
      });
      return toLiteracyProfileResponse(profile);
    } catch (error) {
      throw mapMissingUser(error);
    }
  }
}

function mapMissingUser(error: unknown): unknown {
  // The user was deleted between the existence check and the write.
  return isPrismaError(error, "P2003") ? userNotFound() : error;
}

function toLiteracyProfileResponse(profile: FinancialLiteracyProfile): LiteracyProfileResponse {
  return {
    level: profile.level,
    assessmentVersion: profile.assessmentVersion,
    assessedAt: profile.assessedAt ? profile.assessedAt.toISOString() : null,
  };
}
