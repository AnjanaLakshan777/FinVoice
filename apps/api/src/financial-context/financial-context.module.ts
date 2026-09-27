import { Module } from "@nestjs/common";

import { UserContextToolRegistry } from "../ai/tools/user-context.tools.js";
import { InternalTokenGuard } from "../common/internal-token.guard.js";
import { FinancialGoalsModule } from "../financial-goals/financial-goals.module.js";
import { FinancialLiteracyModule } from "../financial-literacy/financial-literacy.module.js";
import { FinancialProfilesModule } from "../financial-profiles/financial-profiles.module.js";
import { UsersModule } from "../users/users.module.js";
import { FinancialContextService } from "./financial-context.service.js";
import { InternalUserContextController } from "./internal-user-context.controller.js";

/**
 * Personal financial context (Step 8): aggregation service and the token-protected internal
 * user-context API (/internal/users/*), and the trusted user-context tools. No public endpoint.
 */
@Module({
  imports: [UsersModule, FinancialProfilesModule, FinancialGoalsModule, FinancialLiteracyModule],
  controllers: [InternalUserContextController],
  // UserContextToolRegistry is prepared for a future authenticated agent; the public agent
  // (AgentModule) does not import it.
  providers: [FinancialContextService, InternalTokenGuard, UserContextToolRegistry],
  exports: [FinancialContextService, UserContextToolRegistry],
})
export class FinancialContextModule {}
