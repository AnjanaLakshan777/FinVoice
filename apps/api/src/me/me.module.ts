import { Module } from "@nestjs/common";

import { FinancialContextModule } from "../financial-context/financial-context.module.js";
import { FinancialGoalsModule } from "../financial-goals/financial-goals.module.js";
import { FinancialProfilesModule } from "../financial-profiles/financial-profiles.module.js";
import { UsersModule } from "../users/users.module.js";
import { MeController } from "./me.controller.js";

/** The authenticated /me API (Step 11): the caller's own data through the existing services. */
@Module({
  imports: [UsersModule, FinancialProfilesModule, FinancialGoalsModule, FinancialContextModule],
  controllers: [MeController],
})
export class MeModule {}
