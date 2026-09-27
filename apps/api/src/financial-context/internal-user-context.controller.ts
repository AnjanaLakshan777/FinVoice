import {
  literacyTopicParamsSchema,
  updateLiteracyProfileRequestSchema,
  userParamsSchema,
  type FinancialContextResponse,
  type LiteracyContextResponse,
  type LiteracyProfileResponse,
  type LiteracyTopicParams,
  type LiteracyTopicProgressResponse,
  type UpdateLiteracyProfileCommand,
  type UserParams,
} from "@finvoice/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";

import { InternalTokenGuard } from "../common/internal-token.guard.js";
import { FinancialLiteracyProfileService } from "../financial-literacy/financial-literacy-profile.service.js";
import { FinancialLiteracyProgressService } from "../financial-literacy/financial-literacy-progress.service.js";
import { FinancialContextService } from "./financial-context.service.js";

/**
 * INTERNAL, token-protected user-context endpoints (not part of /api/v1). The caller is a trusted
 * FinVoice service that has already decided which user it acts for; the token check runs before
 * anything else, so without the token even an unknown user id gets 401, never 404.
 *
 * Deliberately minimal: two reads and three literacy writes. There is no endpoint to change
 * income, expenses, goals, phone numbers or other user data here.
 */
@Controller("internal/users")
@UseGuards(InternalTokenGuard)
export class InternalUserContextController {
  constructor(
    private readonly context: FinancialContextService,
    private readonly literacyProfiles: FinancialLiteracyProfileService,
    private readonly literacyProgress: FinancialLiteracyProgressService,
  ) {}

  @Get(":userId/financial-context")
  financialContext(
    @Param({ schema: userParamsSchema }) params: UserParams,
  ): Promise<FinancialContextResponse> {
    return this.context.getFinancialContext(params.userId);
  }

  @Get(":userId/literacy-context")
  literacyContext(
    @Param({ schema: userParamsSchema }) params: UserParams,
  ): Promise<LiteracyContextResponse> {
    return this.context.getLiteracyContext(params.userId);
  }

  /** Explicit level change by an assessment or an authorised system. */
  @Put(":userId/literacy/profile")
  updateLiteracyProfile(
    @Param({ schema: userParamsSchema }) params: UserParams,
    @Body({ schema: updateLiteracyProfileRequestSchema }) body: UpdateLiteracyProfileCommand,
  ): Promise<LiteracyProfileResponse> {
    return this.literacyProfiles.updateProfileLevel(params.userId, body);
  }

  /** Records that the user started a topic. No body: timestamps are set by the server. */
  @Post(":userId/literacy/topics/:topic/start")
  @HttpCode(HttpStatus.OK)
  startTopic(
    @Param({ schema: literacyTopicParamsSchema }) params: LiteracyTopicParams,
  ): Promise<LiteracyTopicProgressResponse> {
    return this.literacyProgress.startTopic(params.userId, params.topic);
  }

  /** Records that the user completed a topic. No body: timestamps are set by the server. */
  @Post(":userId/literacy/topics/:topic/complete")
  @HttpCode(HttpStatus.OK)
  completeTopic(
    @Param({ schema: literacyTopicParamsSchema }) params: LiteracyTopicParams,
  ): Promise<LiteracyTopicProgressResponse> {
    return this.literacyProgress.completeTopic(params.userId, params.topic);
  }
}
