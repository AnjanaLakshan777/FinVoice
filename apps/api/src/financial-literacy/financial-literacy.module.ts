import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module.js";
import { FinancialLiteracyProfileService } from "./financial-literacy-profile.service.js";
import { FinancialLiteracyProgressService } from "./financial-literacy-progress.service.js";

/** Financial-literacy level and topic progress (Step 8). No public controller. */
@Module({
  imports: [UsersModule],
  providers: [FinancialLiteracyProfileService, FinancialLiteracyProgressService],
  exports: [FinancialLiteracyProfileService, FinancialLiteracyProgressService],
})
export class FinancialLiteracyModule {}
