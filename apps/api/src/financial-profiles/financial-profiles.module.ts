import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module.js";
import { FinancialProfilesController } from "./financial-profiles.controller.js";
import { FinancialProfilesService } from "./financial-profiles.service.js";

@Module({
  imports: [UsersModule],
  controllers: [FinancialProfilesController],
  providers: [FinancialProfilesService],
})
export class FinancialProfilesModule {}
