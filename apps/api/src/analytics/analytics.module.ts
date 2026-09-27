import { Module } from "@nestjs/common";

import { InternalTokenGuard } from "../common/internal-token.guard.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { AnalyticsAdminController, AnalyticsIngestController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";

/**
 * The read side of analytics: internal ingestion (/internal/analytics/events) and the internal
 * admin aggregates (/internal/admin/analytics/*). Recording lives in the separate, global
 * AnalyticsRecorderModule, so feature modules never depend on this one.
 */
@Module({
  imports: [KnowledgeModule],
  controllers: [AnalyticsIngestController, AnalyticsAdminController],
  providers: [AnalyticsService, InternalTokenGuard],
})
export class AnalyticsModule {}
