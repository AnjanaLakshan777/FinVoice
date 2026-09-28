import {
  analyticsEventRequestSchema,
  analyticsRangeQuerySchema,
  type AnalyticsEventRequest,
  type AnalyticsHealthResponse,
  type AnalyticsKnowledgeResponse,
  type AnalyticsLanguageResponse,
  type AnalyticsLiteracyResponse,
  type AnalyticsOverviewResponse,
  type AnalyticsRangeQuery,
  type AnalyticsReviewQueueResponse,
  type AnalyticsScamShieldResponse,
  type AnalyticsToolResponse,
  type AnalyticsTrendResponse,
} from "@finvoice/contracts";
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";

import { InternalOnly } from "../auth/auth.decorators.js";
import { AnalyticsService } from "./analytics.service.js";

/**
 * Event ingestion for other FinVoice services (today: the voice gateway's session events).
 * INTERNAL: outside /api/v1 and protected by INTERNAL_API_TOKEN. There is deliberately no endpoint
 * that returns events.
 */
@Controller("internal/analytics")
@InternalOnly()
export class AnalyticsIngestController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** 202: accepted for recording. Storage happens in the background and never fails the caller. */
  @Post("events")
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(@Body({ schema: analyticsEventRequestSchema }) body: AnalyticsEventRequest): {
    status: "accepted";
  } {
    this.analytics.ingest(body);
    return { status: "accepted" };
  }
}

/**
 * Aggregate analytics for the temporary admin dashboard. INTERNAL: outside /api/v1, protected by
 * INTERNAL_API_TOKEN, read-only and aggregate-only (counts, shares and latencies; never events,
 * users, content or amounts). Replaced by authenticated administration in a later step.
 */
@Controller("internal/admin/analytics")
@InternalOnly()
export class AnalyticsAdminController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("overview")
  @Header("Cache-Control", "no-store")
  overview(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsOverviewResponse> {
    return this.analytics.overview(query);
  }

  @Get("trends")
  @Header("Cache-Control", "no-store")
  trends(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsTrendResponse> {
    return this.analytics.trends(query);
  }

  @Get("languages")
  @Header("Cache-Control", "no-store")
  languages(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsLanguageResponse> {
    return this.analytics.languages(query);
  }

  @Get("knowledge")
  @Header("Cache-Control", "no-store")
  knowledge(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsKnowledgeResponse> {
    return this.analytics.knowledgeUsage(query);
  }

  @Get("scamshield")
  @Header("Cache-Control", "no-store")
  scamShield(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsScamShieldResponse> {
    return this.analytics.scamShield(query);
  }

  @Get("literacy")
  @Header("Cache-Control", "no-store")
  literacy(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsLiteracyResponse> {
    return this.analytics.literacy(query);
  }

  @Get("tools")
  @Header("Cache-Control", "no-store")
  tools(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsToolResponse> {
    return this.analytics.tools(query);
  }

  @Get("health")
  @Header("Cache-Control", "no-store")
  health(
    @Query({ schema: analyticsRangeQuerySchema }) query: AnalyticsRangeQuery,
  ): Promise<AnalyticsHealthResponse> {
    return this.analytics.health(query);
  }

  /** The knowledge review queue (current state, not a date range). */
  @Get("knowledge-review")
  @Header("Cache-Control", "no-store")
  knowledgeReview(): Promise<AnalyticsReviewQueueResponse> {
    return this.analytics.reviewQueue();
  }
}
