import {
  putFinancialProfileRequestSchema,
  userParamsSchema,
  type FinancialProfileResponse,
  type PutFinancialProfileCommand,
  type UserParams,
} from "@finvoice/contracts";
import { Body, Controller, Get, Param, Put } from "@nestjs/common";

import { FinancialProfilesService } from "./financial-profiles.service.js";

@Controller("users/:userId/financial-profile")
export class FinancialProfilesController {
  constructor(private readonly profiles: FinancialProfilesService) {}

  @Get()
  get(@Param({ schema: userParamsSchema }) params: UserParams): Promise<FinancialProfileResponse> {
    return this.profiles.get(params.userId);
  }

  @Put()
  put(
    @Param({ schema: userParamsSchema }) params: UserParams,
    @Body({ schema: putFinancialProfileRequestSchema }) body: PutFinancialProfileCommand,
  ): Promise<FinancialProfileResponse> {
    return this.profiles.put(params.userId, body);
  }
}
