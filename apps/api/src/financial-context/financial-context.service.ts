import {
  FINANCIAL_CONTEXT_MAX_GOALS,
  type FinancialContextResponse,
  type LiteracyContextResponse,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { FinancialGoalsService } from "../financial-goals/financial-goals.service.js";
import { FinancialLiteracyProfileService } from "../financial-literacy/financial-literacy-profile.service.js";
import { FinancialLiteracyProgressService } from "../financial-literacy/financial-literacy-progress.service.js";
import { FinancialProfilesService } from "../financial-profiles/financial-profiles.service.js";
import { UsersService } from "../users/users.service.js";
import { toFinancialContext } from "./financial-context.mapper.js";

/**
 * Aggregates a user's personal financial context from the domain services. Read-only: it never
 * writes, calculates (no EMI, savings rate, affordability or recommendations) or infers anything.
 *
 * Five queries per context, whatever the data size: the user (404 if unknown), then the financial
 * profile, active goals, literacy profile and literacy progress in parallel. The result is a
 * snapshot of what those reads observed during the request; they are not one transaction, which
 * is acceptable for personalisation context.
 *
 * Callers must already know which user they act for from a trusted source (the internal API's
 * token, or later an authenticated session). Nothing public reaches this service.
 */
@Injectable()
export class FinancialContextService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: FinancialProfilesService,
    private readonly goals: FinancialGoalsService,
    private readonly literacyProfiles: FinancialLiteracyProfileService,
    private readonly literacyProgress: FinancialLiteracyProgressService,
  ) {}

  async getFinancialContext(userId: string): Promise<FinancialContextResponse> {
    const user = await this.users.get(userId);
    const [profile, active, literacy, progress] = await Promise.all([
      this.profiles.find(userId),
      this.goals.listActive(userId, FINANCIAL_CONTEXT_MAX_GOALS),
      this.literacyProfiles.find(userId),
      this.literacyProgress.find(userId),
    ]);
    return toFinancialContext({
      user,
      profile,
      activeGoals: active.goals,
      moreActiveGoals: active.hasMore,
      literacy,
      progress,
    });
  }

  /** The user's literacy level and recorded topic progress (with start/completion times). */
  async getLiteracyContext(userId: string): Promise<LiteracyContextResponse> {
    await this.users.assertExists(userId);
    const [literacy, topics] = await Promise.all([
      this.literacyProfiles.find(userId),
      this.literacyProgress.find(userId),
    ]);
    return { ...literacy, topics };
  }
}
