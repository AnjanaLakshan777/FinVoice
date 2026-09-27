import {
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_TIMEZONE,
  KNOWLEDGE_CATEGORIES,
  LANGUAGES,
  LITERACY_LEVELS,
  SCAM_SHIELD_RISK_LEVELS,
  SCAM_SOURCE_TYPES,
  type AnalyticsCategoryCount,
  type AnalyticsEventRequest,
  type AnalyticsEventType,
  type AnalyticsHealthResponse,
  type AnalyticsKnowledgeResponse,
  type AnalyticsLanguageCount,
  type AnalyticsLanguageResponse,
  type AnalyticsLiteracyResponse,
  type AnalyticsOverviewResponse,
  type AnalyticsRangeQuery,
  type AnalyticsReviewQueueResponse,
  type AnalyticsScamShieldResponse,
  type AnalyticsToolResponse,
  type AnalyticsToolUsage,
  type AnalyticsTrendResponse,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { KnowledgeService } from "../knowledge/knowledge.service.js";
import { resolveRange, type ResolvedRange } from "./analytics-range.js";
import { AnalyticsRecorder } from "./analytics-recorder.js";
import { percentage, toLatency, toReviewQueue, type LatencyRow } from "./analytics.mapper.js";

/** User-facing operations counted as interactions (tool calls and literacy updates are not). */
const INTERACTION_TYPES = [
  "AGENT_REQUEST",
  "VOICE_SESSION",
  "SCAM_ANALYSIS",
  "CALCULATION",
  "KNOWLEDGE_SEARCH",
  "KNOWLEDGE_ARTICLE_VIEW",
] as const satisfies readonly AnalyticsEventType[];

/** Request/response interactions whose duration is a response time (voice sessions are not). */
const RESPONSE_TIME_TYPES = [
  "AGENT_REQUEST",
  "SCAM_ANALYSIS",
  "CALCULATION",
  "KNOWLEDGE_SEARCH",
  "KNOWLEDGE_ARTICLE_VIEW",
] as const satisfies readonly AnalyticsEventType[];

const KNOWLEDGE_TYPES = [
  "KNOWLEDGE_SEARCH",
  "KNOWLEDGE_ARTICLE_VIEW",
] as const satisfies readonly AnalyticsEventType[];
const LITERACY_TYPES = [
  "LITERACY_TOPIC_STARTED",
  "LITERACY_TOPIC_COMPLETED",
] as const satisfies readonly AnalyticsEventType[];
const TOOL_CALL_TYPES = [
  "AGENT_TOOL_CALL",
  "VOICE_TOOL_CALL",
] as const satisfies readonly AnalyticsEventType[];

/**
 * Aggregates analytics events for the internal admin API. Every figure is computed in PostgreSQL
 * (COUNT with GROUP BY, AVG, PERCENTILE_CONT): no event rows are loaded into Node.js, and no
 * endpoint returns rows. All ranges come from resolveRange, so every endpoint uses the same
 * Asia/Colombo calendar days.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly recorder: AnalyticsRecorder,
  ) {}

  /** An event from another FinVoice service; the recorder sets the timestamp and validates it. */
  ingest(event: AnalyticsEventRequest): void {
    this.recorder.record(event);
  }

  async overview(query: AnalyticsRangeQuery, now = new Date()): Promise<AnalyticsOverviewResponse> {
    const range = resolveRange(query, now);
    const [groups, latency] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ["eventType", "success"],
        where: inRange(range, INTERACTION_TYPES),
        _count: { _all: true },
      }),
      this.latency(range, RESPONSE_TIME_TYPES),
    ]);
    const count = (...types: AnalyticsEventType[]): number =>
      sum(groups.filter((group) => types.includes(group.eventType)).map((g) => g._count._all));
    const total = count(...INTERACTION_TYPES);
    const succeeded = sum(groups.filter((g) => g.success).map((g) => g._count._all));
    const stats = toLatency(latency);
    return {
      range: range.range,
      interactions: {
        total,
        agent: count("AGENT_REQUEST"),
        voice: count("VOICE_SESSION"),
        scamshield: count("SCAM_ANALYSIS"),
        calculations: count("CALCULATION"),
        knowledge: count(...KNOWLEDGE_TYPES),
      },
      successRate: percentage(succeeded, total),
      averageResponseMs: stats.averageMs,
      p95ResponseMs: stats.p95Ms,
      responseSampleSize: stats.sampleSize,
    };
  }

  async trends(query: AnalyticsRangeQuery, now = new Date()): Promise<AnalyticsTrendResponse> {
    const range = resolveRange(query, now);
    // Raw SQL: grouping by the calendar day in Asia/Colombo needs AT TIME ZONE, which Prisma's
    // groupBy cannot express. Every value is a bound parameter.
    const rows = await this.prisma.$queryRaw<{ date: string; eventType: string; count: number }[]>`
      SELECT to_char("occurred_at" AT TIME ZONE ${ANALYTICS_TIMEZONE}, 'YYYY-MM-DD') AS "date",
             "event_type"::text AS "eventType",
             count(*)::int AS "count"
      FROM "analytics_events"
      WHERE "occurred_at" >= ${range.start} AND "occurred_at" < ${range.end}
        AND "event_type"::text IN (${Prisma.join(INTERACTION_TYPES)})
      GROUP BY 1, 2`;
    const byDay = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const day = byDay.get(row.date) ?? new Map<string, number>();
      day.set(row.eventType, row.count);
      byDay.set(row.date, day);
    }
    return {
      range: range.range,
      data: range.dates.map((date) => {
        const day = byDay.get(date);
        const get = (type: AnalyticsEventType): number => day?.get(type) ?? 0;
        const counts = {
          agentRequests: get("AGENT_REQUEST"),
          voiceSessions: get("VOICE_SESSION"),
          scamAnalyses: get("SCAM_ANALYSIS"),
          calculations: get("CALCULATION"),
          knowledgeRequests: get("KNOWLEDGE_SEARCH") + get("KNOWLEDGE_ARTICLE_VIEW"),
        };
        return { date, ...counts, total: sum(Object.values(counts)) };
      }),
    };
  }

  async languages(
    query: AnalyticsRangeQuery,
    now = new Date(),
  ): Promise<AnalyticsLanguageResponse> {
    const range = resolveRange(query, now);
    const data = await this.languageCounts(range);
    return { range: range.range, total: sum(data.map((entry) => entry.count)), data };
  }

  async knowledgeUsage(
    query: AnalyticsRangeQuery,
    now = new Date(),
  ): Promise<AnalyticsKnowledgeResponse> {
    const range = resolveRange(query, now);
    const [types, categories, languages, items] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ["eventType"],
        where: inRange(range, KNOWLEDGE_TYPES),
        _count: { _all: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ["knowledgeCategory"],
        where: { ...inRange(range, KNOWLEDGE_TYPES), knowledgeCategory: { not: null } },
        _count: { _all: true },
      }),
      this.languageCounts(range, KNOWLEDGE_TYPES),
      this.knowledge.reviewItems(),
    ]);
    const categoryTotal = sum(categories.map((group) => group._count._all));
    const categoryCounts: AnalyticsCategoryCount[] = KNOWLEDGE_CATEGORIES.map((category) => {
      const count =
        categories.find((group) => group.knowledgeCategory === category)?._count._all ?? 0;
      return { category, count, percentage: percentage(count, categoryTotal) };
    }).sort((a, b) => b.count - a.count);
    const queue = toReviewQueue(items, now);
    return {
      range: range.range,
      searches: types.find((g) => g.eventType === "KNOWLEDGE_SEARCH")?._count._all ?? 0,
      articleViews: types.find((g) => g.eventType === "KNOWLEDGE_ARTICLE_VIEW")?._count._all ?? 0,
      categories: categoryCounts,
      languages,
      articles: {
        published: queue.publishedArticles,
        translated: items.filter((item) => item.translated).length,
        timeSensitive: queue.timeSensitiveArticles,
        reviewRequired: queue.reviewRequired,
      },
    };
  }

  async scamShield(
    query: AnalyticsRangeQuery,
    now = new Date(),
  ): Promise<AnalyticsScamShieldResponse> {
    const range = resolveRange(query, now);
    const where = inRange(range, ["SCAM_ANALYSIS"]);
    const [outcomes, levels, sourceTypes, languages] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({ by: ["success"], where, _count: { _all: true } }),
      this.prisma.analyticsEvent.groupBy({
        by: ["scamRiskLevel"],
        where: { ...where, scamRiskLevel: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ["scamSourceType"],
        where,
        _count: { _all: true },
      }),
      this.languageCounts(range, ["SCAM_ANALYSIS"]),
    ]);
    const total = sum(outcomes.map((group) => group._count._all));
    const succeeded = outcomes.find((group) => group.success)?._count._all ?? 0;
    const levelTotal = sum(levels.map((group) => group._count._all));
    return {
      range: range.range,
      total,
      successRate: percentage(succeeded, total),
      riskLevels: SCAM_SHIELD_RISK_LEVELS.map((riskLevel) => {
        const count = levels.find((group) => group.scamRiskLevel === riskLevel)?._count._all ?? 0;
        return { riskLevel, count, percentage: percentage(count, levelTotal) };
      }),
      sourceTypes: SCAM_SOURCE_TYPES.map((sourceType) => {
        const count =
          sourceTypes.find((group) => group.scamSourceType === sourceType)?._count._all ?? 0;
        return { sourceType, count, percentage: percentage(count, total) };
      }),
      languages,
    };
  }

  async literacy(query: AnalyticsRangeQuery, now = new Date()): Promise<AnalyticsLiteracyResponse> {
    const range = resolveRange(query, now);
    const [groups, languages, levels, assessed] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ["eventType", "knowledgeCategory"],
        where: inRange(range, LITERACY_TYPES),
        _count: { _all: true },
      }),
      this.languageCounts(range, LITERACY_TYPES),
      // Current profiles, counts only: no user, no individual profile leaves the database.
      this.prisma.financialLiteracyProfile.groupBy({ by: ["level"], _count: { _all: true } }),
      this.prisma.financialLiteracyProfile.count({ where: { assessedAt: { not: null } } }),
    ]);
    const count = (type: AnalyticsEventType, category?: string): number =>
      sum(
        groups
          .filter(
            (group) =>
              group.eventType === type &&
              (category === undefined || group.knowledgeCategory === category),
          )
          .map((group) => group._count._all),
      );
    const profileTotal = sum(levels.map((group) => group._count._all));
    return {
      range: range.range,
      topicsStarted: count("LITERACY_TOPIC_STARTED"),
      topicsCompleted: count("LITERACY_TOPIC_COMPLETED"),
      byCategory: KNOWLEDGE_CATEGORIES.map((category) => ({
        category,
        started: count("LITERACY_TOPIC_STARTED", category),
        completed: count("LITERACY_TOPIC_COMPLETED", category),
      })),
      languages,
      profiles: {
        total: profileTotal,
        assessed,
        unassessed: profileTotal - assessed,
        levels: LITERACY_LEVELS.map((level) => ({
          level,
          count: levels.find((group) => group.level === level)?._count._all ?? 0,
        })),
      },
    };
  }

  async tools(query: AnalyticsRangeQuery, now = new Date()): Promise<AnalyticsToolResponse> {
    const range = resolveRange(query, now);
    const groups = await this.prisma.analyticsEvent.groupBy({
      by: ["toolName", "eventType", "success"],
      where: { ...inRange(range, TOOL_CALL_TYPES), toolName: { not: null } },
      _count: { _all: true },
    });
    const usage = new Map<string, AnalyticsToolUsage>();
    for (const group of groups) {
      if (group.toolName === null) {
        continue;
      }
      const entry = usage.get(group.toolName) ?? {
        toolName: group.toolName,
        calls: 0,
        agentCalls: 0,
        voiceCalls: 0,
        failed: 0,
      };
      const calls = group._count._all;
      entry.calls += calls;
      if (group.eventType === "AGENT_TOOL_CALL") {
        entry.agentCalls += calls;
      } else {
        entry.voiceCalls += calls;
      }
      if (!group.success) {
        entry.failed += calls;
      }
      usage.set(group.toolName, entry);
    }
    const data = [...usage.values()].sort(
      (a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName),
    );
    return { range: range.range, total: sum(data.map((entry) => entry.calls)), data };
  }

  async health(query: AnalyticsRangeQuery, now = new Date()): Promise<AnalyticsHealthResponse> {
    const range = resolveRange(query, now);
    const [groups, errorCodes, latency] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ["eventType", "success"],
        where: inRange(range),
        _count: { _all: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ["errorCode"],
        where: { ...inRange(range), errorCode: { not: null } },
        _count: { _all: true },
      }),
      this.latencyByType(range),
    ]);
    const totalEvents = sum(groups.map((group) => group._count._all));
    const failedEvents = sum(groups.filter((g) => !g.success).map((g) => g._count._all));
    return {
      range: range.range,
      totalEvents,
      failedEvents,
      failureRate: percentage(failedEvents, totalEvents),
      recordingFailuresSinceStart: this.recorder.failuresSinceStart,
      byEventType: ANALYTICS_EVENT_TYPES.map((eventType) => ({
        eventType,
        total: sum(groups.filter((g) => g.eventType === eventType).map((g) => g._count._all)),
        failed: sum(
          groups.filter((g) => g.eventType === eventType && !g.success).map((g) => g._count._all),
        ),
        latency: toLatency(latency.get(eventType)),
      })),
      errorCodes: errorCodes
        .flatMap((group) =>
          group.errorCode === null
            ? []
            : [{ errorCode: group.errorCode, count: group._count._all }],
        )
        .sort((a, b) => b.count - a.count || a.errorCode.localeCompare(b.errorCode)),
    };
  }

  /** The read-only knowledge review queue, from the current knowledge tables. */
  async reviewQueue(now = new Date()): Promise<AnalyticsReviewQueueResponse> {
    return toReviewQueue(await this.knowledge.reviewItems(), now);
  }

  private async languageCounts(
    range: ResolvedRange,
    types?: readonly AnalyticsEventType[],
  ): Promise<AnalyticsLanguageCount[]> {
    const groups = await this.prisma.analyticsEvent.groupBy({
      by: ["language"],
      where: { ...inRange(range, types), language: { not: null } },
      _count: { _all: true },
    });
    const total = sum(groups.map((group) => group._count._all));
    return LANGUAGES.map((language) => {
      const count = groups.find((group) => group.language === language)?._count._all ?? 0;
      return { language, count, percentage: percentage(count, total) };
    });
  }

  /**
   * Raw SQL: PERCENTILE_CONT has no Prisma equivalent. Every value is a bound parameter; the
   * event types come from the constants above, never from a request.
   */
  private async latency(
    range: ResolvedRange,
    types: readonly AnalyticsEventType[],
  ): Promise<LatencyRow | undefined> {
    const [row] = await this.prisma.$queryRaw<LatencyRow[]>`
      SELECT count("duration_ms")::int AS "sampleSize",
             avg("duration_ms")::float8 AS "average",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "duration_ms") AS "p50",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "duration_ms") AS "p95"
      FROM "analytics_events"
      WHERE "occurred_at" >= ${range.start} AND "occurred_at" < ${range.end}
        AND "event_type"::text IN (${Prisma.join(types)})
        AND "duration_ms" IS NOT NULL`;
    return row;
  }

  private async latencyByType(range: ResolvedRange): Promise<Map<string, LatencyRow>> {
    const rows = await this.prisma.$queryRaw<(LatencyRow & { eventType: string })[]>`
      SELECT "event_type"::text AS "eventType",
             count("duration_ms")::int AS "sampleSize",
             avg("duration_ms")::float8 AS "average",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "duration_ms") AS "p50",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "duration_ms") AS "p95"
      FROM "analytics_events"
      WHERE "occurred_at" >= ${range.start} AND "occurred_at" < ${range.end}
        AND "duration_ms" IS NOT NULL
      GROUP BY "event_type"`;
    return new Map(rows.map((row) => [row.eventType, row]));
  }
}

function inRange(
  range: ResolvedRange,
  types?: readonly AnalyticsEventType[],
): Prisma.AnalyticsEventWhereInput {
  return {
    occurredAt: { gte: range.start, lt: range.end },
    ...(types === undefined ? {} : { eventType: { in: [...types] } }),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
