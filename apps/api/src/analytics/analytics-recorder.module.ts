import { Global, Module } from "@nestjs/common";

import { AnalyticsRecorder, PrismaAnalyticsRecorder } from "./analytics-recorder.js";

/**
 * Makes AnalyticsRecorder injectable in every feature module. It depends only on the database, so
 * features can record events without importing the analytics read side (no circular modules).
 */
@Global()
@Module({
  providers: [{ provide: AnalyticsRecorder, useClass: PrismaAnalyticsRecorder }],
  exports: [AnalyticsRecorder],
})
export class AnalyticsRecorderModule {}
