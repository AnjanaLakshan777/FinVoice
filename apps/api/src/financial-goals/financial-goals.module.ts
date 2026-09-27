import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module.js";
import { FinancialGoalsController } from "./financial-goals.controller.js";
import { FinancialGoalsService } from "./financial-goals.service.js";

@Module({
  imports: [UsersModule],
  controllers: [FinancialGoalsController],
  providers: [FinancialGoalsService],
  exports: [FinancialGoalsService],
})
export class FinancialGoalsModule {}
