import { Module } from "@nestjs/common";

import { CalculationsModule } from "./calculations/calculations.module.js";
import { ApiConfigModule } from "./config/api-config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { FinancialGoalsModule } from "./financial-goals/financial-goals.module.js";
import { FinancialProfilesModule } from "./financial-profiles/financial-profiles.module.js";
import { HealthModule } from "./health/health.module.js";
import { KnowledgeModule } from "./knowledge/knowledge.module.js";
import { UsersModule } from "./users/users.module.js";

@Module({
  imports: [
    ApiConfigModule,
    DatabaseModule,
    HealthModule,
    UsersModule,
    FinancialProfilesModule,
    FinancialGoalsModule,
    CalculationsModule,
    KnowledgeModule,
  ],
})
export class AppModule {}
