import { Module } from "@nestjs/common";

import { CalculationsController } from "./calculations.controller.js";
import { CalculationsService } from "./calculations.service.js";

/** Stateless financial calculations; no database access. */
@Module({
  controllers: [CalculationsController],
  providers: [CalculationsService],
})
export class CalculationsModule {}
