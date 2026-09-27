import type {
  AnalyticsHealthResponse,
  AnalyticsKnowledgeResponse,
  AnalyticsLanguageResponse,
  AnalyticsLiteracyResponse,
  AnalyticsOverviewResponse,
  AnalyticsReviewQueueResponse,
  AnalyticsScamShieldResponse,
  AnalyticsToolResponse,
  AnalyticsTrendResponse,
  ApiErrorResponse,
} from "@finvoice/contracts";
import type { LoggerService } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { knowledgeArticles } from "../../prisma/knowledge/content.js";
import { seedKnowledge } from "../../prisma/knowledge/seed-knowledge.js";
import { deleteExpiredAnalyticsEvents } from "../../src/analytics/analytics-cleanup.js";
import {
  AnalyticsRecorder,
  type PrismaAnalyticsRecorder,
} from "../../src/analytics/analytics-recorder.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import {
  FakeLanguageModel,
  toolsThenAnswer,
  type FakeScript,
} from "../support/fake-language-model.js";
import { startTestApi, type TestApi } from "./api-app.js";
import { truncateAllTables } from "./database.js";

const TOKEN = "analytics-integration-test-token-0123456789abcdef";
const HEADERS = { "x-finvoice-internal-token": TOKEN };
const ADMIN = "/internal/admin/analytics";
const EVENTS = "/internal/analytics/events";
const DAY = 86_400_000;

class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private add(values: unknown[]): void {
    this.lines.push(
      values
        .map((value) => (value instanceof Error ? `${value.name} ${value.message}` : String(value)))
        .join(" "),
    );
  }
  log(...values: unknown[]): void {
    this.add(values);
  }
  error(...values: unknown[]): void {
    this.add(values);
  }
  warn(...values: unknown[]): void {
    this.add(values);
  }
  debug(...values: unknown[]): void {
    this.add(values);
  }
  verbose(...values: unknown[]): void {
    this.add(values);
  }
  fatal(...values: unknown[]): void {
    this.add(values);
  }
}

let script: FakeScript = toolsThenAnswer([]);
const model = new FakeLanguageModel((context) => script(context));
const logger = new CapturingLogger();
let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({
    internalToken: TOKEN,
    languageModel: model,
    gemini: { apiKey: "fake-gemini-key-for-analytics-tests", model: "gemini-test-model" },
    logger,
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await truncateAllTables(api.prisma);
  logger.lines.length = 0;
});

function recorder(): PrismaAnalyticsRecorder {
  return api.get(AnalyticsRecorder) as PrismaAnalyticsRecorder;
}

/** Waits for background analytics writes. */
async function flush(): Promise<void> {
  await recorder().flush();
}

function admin<T>(path: string, query = "") {
  return api.request<T>("GET", `${ADMIN}/${path}${query}`, undefined, HEADERS);
}

function ingest(body: unknown, headers: Record<string, string> = HEADERS) {
  return api.request<ApiErrorResponse>("POST", EVENTS, body, headers);
}

/** Inserts events at fixed instants, for deterministic aggregation tests. */
async function insert(
  ...events: (Partial<Prisma.AnalyticsEventCreateManyInput> & { at: string })[]
): Promise<void> {
  await api.prisma.analyticsEvent.createMany({
    data: events.map(({ at, ...event }) => ({
      eventType: "AGENT_REQUEST",
      source: "API",
      success: true,
      ...event,
      occurredAt: new Date(at),
    })),
  });
}

const VOICE_EVENT = {
  eventType: "VOICE_SESSION",
  source: "VOICE",
  language: "SI",
  success: true,
  durationMs: 65_000,
  sessionId: "0190f0a0-0000-7000-8000-00000000abcd",
};

// ---------------------------------------------------------------------------------------------

describe("event ingestion (POST /internal/analytics/events)", () => {
  it("records a valid event with a server-side timestamp", async () => {
    const before = Date.now();
    const response = await ingest(VOICE_EVENT);
    expect(response.status).toBe(202);
    await flush();

    const rows = await api.prisma.analyticsEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: "VOICE_SESSION",
      source: "VOICE",
      language: "SI",
      success: true,
      durationMs: 65_000,
      sessionId: VOICE_EVENT.sessionId,
      errorCode: null,
    });
    expect(rows[0]?.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(rows[0]?.occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it.each([
    [
      "an event type the API records itself",
      {
        ...VOICE_EVENT,
        eventType: "SCAM_ANALYSIS",
        scamSourceType: "CALL",
        source: "API",
        sessionId: undefined,
      },
    ],
    ["a voice event with another source", { ...VOICE_EVENT, source: "WEB" }],
    ["an error code on a success", { ...VOICE_EVENT, errorCode: "VOICE_SESSION_ERROR" }],
    ["a negative duration", { ...VOICE_EVENT, durationMs: -1 }],
    ["a duration over 24 hours", { ...VOICE_EVENT, durationMs: 86_400_001 }],
    ["a fractional duration", { ...VOICE_EVENT, durationMs: 1.5 }],
    [
      "an unknown error code",
      { ...VOICE_EVENT, success: false, errorCode: "Gemini said: quota exceeded" },
    ],
    ["an unknown language", { ...VOICE_EVENT, language: "FR" }],
    ["a non-UUID session id", { ...VOICE_EVENT, sessionId: "+94771234567" }],
    ["a missing success flag", { ...VOICE_EVENT, success: undefined }],
  ])("rejects %s (400)", async (_case, body) => {
    const response = await ingest(body);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    await flush();
    expect(await api.prisma.analyticsEvent.count()).toBe(0);
  });

  it.each([
    ["message", "Send me your OTP"],
    ["transcript", "what is my loan"],
    ["audio", "UklGRiQAAABXQVZF"],
    ["amount", "500000.00"],
    ["monthlyIncome", "150000.00"],
    ["phoneNumber", "+94771234567"],
    ["accountNumber", "1234567890"],
    ["cardNumber", "4111111111111111"],
    ["otp", "482913"],
    ["pin", "1234"],
    ["password", "hunter2"],
    ["toolArguments", { principal: "500000.00" }],
    ["toolResult", { monthlyPayment: "16607.15" }],
    ["evidence", ["Send us your OTP"]],
    ["query", "my savings"],
    ["metadata", {}],
    ["userId", "0190f0a0-0000-7000-8000-000000000001"],
    ["ipAddress", "203.0.113.9"],
    ["userAgent", "Mozilla/5.0"],
    ["occurredAt", "2020-01-01T00:00:00Z"],
  ])("rejects the forbidden field %s (400) and stores nothing", async (field, value) => {
    const response = await ingest({ ...VOICE_EVENT, [field]: value });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain(JSON.stringify(value));
    await flush();
    expect(await api.prisma.analyticsEvent.count()).toBe(0);
  });
});

describe("internal token security", () => {
  it.each([
    ["no token", {}],
    ["a wrong token", { "x-finvoice-internal-token": "wrong-token-wrong-token-wrong-token-0" }],
    ["a Bearer-prefixed token", { "x-finvoice-internal-token": `Bearer ${TOKEN}` }],
  ])("answers 401 to ingestion and every admin read with %s", async (_case, headers) => {
    expect((await ingest(VOICE_EVENT, headers)).status).toBe(401);
    for (const path of [
      "overview",
      "trends",
      "languages",
      "knowledge",
      "scamshield",
      "literacy",
      "tools",
      "health",
      "knowledge-review",
    ]) {
      const response = await api.request("GET", `${ADMIN}/${path}`, undefined, headers);
      expect(response.status, path).toBe(401);
      expect(response.text).not.toContain(TOKEN);
    }
    await flush();
    expect(await api.prisma.analyticsEvent.count()).toBe(0);
  });

  it("has no raw event endpoint and nothing under /api/v1", async () => {
    expect((await api.request("GET", EVENTS, undefined, HEADERS)).status).toBe(404);
    expect((await api.request("GET", `${EVENTS}/1`, undefined, HEADERS)).status).toBe(404);
    expect((await api.request("GET", `/api/v1${ADMIN}/overview`, undefined, HEADERS)).status).toBe(
      404,
    );
    expect((await api.request("POST", `/api/v1${EVENTS}`, VOICE_EVENT, HEADERS)).status).toBe(404);
  });

  it("accepts no user or filter parameters beyond the date range", async () => {
    const response = await admin("overview", "?userId=0190f0a0-0000-7000-8000-000000000001");
    expect(response.status).toBe(400);
  });

  it("never returns or logs the token", async () => {
    const responses = await Promise.all([
      ingest(VOICE_EVENT),
      admin("overview"),
      admin("health"),
      ingest(VOICE_EVENT, {}),
    ]);
    for (const response of responses) {
      expect(response.text).not.toContain(TOKEN);
    }
    expect(logger.lines.join("\n")).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------------------------

describe("aggregation", () => {
  // 2026-09-01 .. 2026-09-03 in Asia/Colombo = [2026-08-31T18:30Z, 2026-09-03T18:30Z).
  const RANGE = "?from=2026-09-01&to=2026-09-03";

  it("validates the date range", async () => {
    for (const [query, status] of [
      ["?from=2026-09-03&to=2026-09-01", 400],
      ["?from=2025-09-01&to=2026-09-02", 400],
      ["?from=2026-02-30&to=2026-03-01", 400],
      ["?from=2026-09-01T00:00:00Z", 400],
      ["?from=2025-09-02&to=2026-09-02", 200],
      [RANGE, 200],
    ] as const) {
      expect((await admin("overview", query)).status, query).toBe(status);
    }
  });

  it("defaults to the 30 calendar days ending today (Asia/Colombo)", async () => {
    const response = await admin<AnalyticsTrendResponse>("trends");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
    expect(response.body.range).toMatchObject({ to: today, days: 30, timezone: "Asia/Colombo" });
    expect(response.body.data).toHaveLength(30);
    expect(response.body.data.at(-1)?.date).toBe(today);
  });

  it("returns zeros and nulls, not errors, for an empty dataset", async () => {
    const overview = await admin<AnalyticsOverviewResponse>("overview", RANGE);
    expect(overview.body).toEqual({
      range: { from: "2026-09-01", to: "2026-09-03", timezone: "Asia/Colombo", days: 3 },
      interactions: { total: 0, agent: 0, voice: 0, scamshield: 0, calculations: 0, knowledge: 0 },
      successRate: null,
      averageResponseMs: null,
      p95ResponseMs: null,
      responseSampleSize: 0,
    });
    const trends = await admin<AnalyticsTrendResponse>("trends", RANGE);
    expect(trends.body.data.map((day) => [day.date, day.total])).toEqual([
      ["2026-09-01", 0],
      ["2026-09-02", 0],
      ["2026-09-03", 0],
    ]);
    const languages = await admin<AnalyticsLanguageResponse>("languages", RANGE);
    expect(languages.body.data).toEqual([
      { language: "SI", count: 0, percentage: null },
      { language: "TA", count: 0, percentage: null },
      { language: "EN", count: 0, percentage: null },
    ]);
    for (const path of [
      "knowledge",
      "scamshield",
      "literacy",
      "tools",
      "health",
      "knowledge-review",
    ]) {
      expect((await admin(path, RANGE)).status, path).toBe(200);
    }
  });

  it("groups days in Asia/Colombo and fills missing days", async () => {
    await insert(
      { at: "2026-08-31T18:29:59.999Z" }, // 23:59:59.999 on 31 August in Colombo: outside
      { at: "2026-08-31T18:30:00.000Z" }, // 00:00 on 1 September in Colombo
      { at: "2026-09-01T18:29:59.999Z" }, // still 1 September
      { at: "2026-09-02T18:30:00.000Z", eventType: "CALCULATION", toolName: "calculate_loan" }, // 3 September
      { at: "2026-09-03T18:30:00.000Z" }, // 4 September: outside
    );

    const trends = await admin<AnalyticsTrendResponse>("trends", RANGE);
    expect(trends.body.data).toEqual([
      {
        date: "2026-09-01",
        agentRequests: 2,
        voiceSessions: 0,
        scamAnalyses: 0,
        calculations: 0,
        knowledgeRequests: 0,
        total: 2,
      },
      {
        date: "2026-09-02",
        agentRequests: 0,
        voiceSessions: 0,
        scamAnalyses: 0,
        calculations: 0,
        knowledgeRequests: 0,
        total: 0,
      },
      {
        date: "2026-09-03",
        agentRequests: 0,
        voiceSessions: 0,
        scamAnalyses: 0,
        calculations: 1,
        knowledgeRequests: 0,
        total: 1,
      },
    ]);
    // The other endpoints use the same boundaries.
    const overview = await admin<AnalyticsOverviewResponse>("overview", RANGE);
    expect(overview.body.interactions.total).toBe(3);
  });

  it("computes the overview: counts, success rate, average and p95", async () => {
    const at = "2026-09-02T06:00:00Z";
    await insert(
      { at, durationMs: 100 },
      { at, durationMs: 200 },
      { at, durationMs: 300 },
      { at, durationMs: 400 },
      {
        at,
        eventType: "SCAM_ANALYSIS",
        scamSourceType: "MESSAGE",
        scamRiskLevel: "HIGH",
        durationMs: 1000,
      },
      { at, eventType: "VOICE_SESSION", source: "VOICE", durationMs: 600_000 },
      {
        at,
        eventType: "CALCULATION",
        toolName: "calculate_budget",
        success: false,
        errorCode: "VALIDATION_ERROR",
        durationMs: 5,
      },
      { at, eventType: "KNOWLEDGE_SEARCH", durationMs: 50 },
      { at, eventType: "AGENT_TOOL_CALL", toolName: "search_knowledge", durationMs: 70 },
      { at, eventType: "LITERACY_TOPIC_STARTED", source: "INTERNAL", knowledgeCategory: "SAVING" },
    );

    const response = await admin<AnalyticsOverviewResponse>("overview", RANGE);
    expect(response.body.interactions).toEqual({
      total: 8,
      agent: 4,
      voice: 1,
      scamshield: 1,
      calculations: 1,
      knowledge: 1,
    });
    expect(response.body.successRate).toBe("87.50");
    // Response times: 100, 200, 300, 400, 1000, 5, 50 (voice sessions and tool calls excluded).
    expect(response.body.responseSampleSize).toBe(7);
    expect(response.body.averageResponseMs).toBe(294);
    expect(response.body.p95ResponseMs).toBe(820);
  });

  it("withholds percentiles below 5 samples", async () => {
    const at = "2026-09-02T06:00:00Z";
    await insert({ at, durationMs: 100 }, { at, durationMs: 300 });

    const overview = await admin<AnalyticsOverviewResponse>("overview", RANGE);
    expect(overview.body).toMatchObject({
      averageResponseMs: 200,
      p95ResponseMs: null,
      responseSampleSize: 2,
    });
    const health = await admin<AnalyticsHealthResponse>("health", RANGE);
    expect(
      health.body.byEventType.find((entry) => entry.eventType === "AGENT_REQUEST")?.latency,
    ).toEqual({
      sampleSize: 2,
      averageMs: 200,
      p50Ms: null,
      p95Ms: null,
    });
  });

  it("counts languages with two-decimal percentages", async () => {
    const at = "2026-09-02T06:00:00Z";
    await insert(
      { at, language: "SI" },
      { at, language: "SI" },
      { at, language: "TA" },
      { at, language: "EN" },
      { at, language: "EN" },
      { at, language: "EN" },
      { at },
    );

    const response = await admin<AnalyticsLanguageResponse>("languages", RANGE);
    expect(response.body).toMatchObject({
      total: 6,
      data: [
        { language: "SI", count: 2, percentage: "33.33" },
        { language: "TA", count: 1, percentage: "16.67" },
        { language: "EN", count: 3, percentage: "50.00" },
      ],
    });
  });

  it("aggregates knowledge usage by category and reads the knowledge base state", async () => {
    await seedKnowledge(api.prisma);
    const at = "2026-09-02T06:00:00Z";
    await insert(
      { at, eventType: "KNOWLEDGE_SEARCH", language: "EN" },
      { at, eventType: "KNOWLEDGE_SEARCH", language: "SI", knowledgeCategory: "SCAMS" },
      { at, eventType: "KNOWLEDGE_ARTICLE_VIEW", language: "SI", knowledgeCategory: "SCAMS" },
      { at, eventType: "KNOWLEDGE_ARTICLE_VIEW", language: "TA", knowledgeCategory: "SAVING" },
    );

    const response = await admin<AnalyticsKnowledgeResponse>("knowledge", RANGE);
    expect(response.body).toMatchObject({ searches: 2, articleViews: 2 });
    expect(response.body.categories.slice(0, 2)).toEqual([
      { category: "SCAMS", count: 2, percentage: "66.67" },
      { category: "SAVING", count: 1, percentage: "33.33" },
    ]);
    expect(response.body.categories).toHaveLength(8);
    expect(response.body.articles).toEqual({
      published: 12,
      translated: knowledgeArticles.filter(
        (article) => Object.keys(article.translations).length > 1,
      ).length,
      timeSensitive: 2,
      reviewRequired: 0,
    });
  });

  it("aggregates ScamShield risk levels, content types and success", async () => {
    const at = "2026-09-02T06:00:00Z";
    await insert(
      {
        at,
        eventType: "SCAM_ANALYSIS",
        scamSourceType: "MESSAGE",
        scamRiskLevel: "HIGH",
        language: "EN",
      },
      {
        at,
        eventType: "SCAM_ANALYSIS",
        scamSourceType: "MESSAGE",
        scamRiskLevel: "HIGH",
        language: "SI",
      },
      {
        at,
        eventType: "SCAM_ANALYSIS",
        scamSourceType: "CALL",
        scamRiskLevel: "LOW",
        language: "EN",
      },
      {
        at,
        eventType: "SCAM_ANALYSIS",
        scamSourceType: "EMAIL",
        success: false,
        errorCode: "SERVICE_UNAVAILABLE",
      },
    );

    const response = await admin<AnalyticsScamShieldResponse>("scamshield", RANGE);
    expect(response.body.total).toBe(4);
    expect(response.body.successRate).toBe("75.00");
    expect(response.body.riskLevels).toEqual([
      { riskLevel: "INSUFFICIENT_INFORMATION", count: 0, percentage: "0.00" },
      { riskLevel: "LOW", count: 1, percentage: "33.33" },
      { riskLevel: "MEDIUM", count: 0, percentage: "0.00" },
      { riskLevel: "HIGH", count: 2, percentage: "66.67" },
    ]);
    expect(response.body.sourceTypes.filter((entry) => entry.count > 0)).toEqual([
      { sourceType: "MESSAGE", count: 2, percentage: "50.00" },
      { sourceType: "EMAIL", count: 1, percentage: "25.00" },
      { sourceType: "CALL", count: 1, percentage: "25.00" },
    ]);
  });

  it("aggregates literacy progress and current profile levels, counts only", async () => {
    const user = await api.prisma.user.create({
      data: { phoneNumber: "+94000000501", preferredLanguage: "EN" },
    });
    const other = await api.prisma.user.create({
      data: { phoneNumber: "+94000000502", preferredLanguage: "SI" },
    });
    await api.prisma.financialLiteracyProfile.create({
      data: { userId: user.id, level: "DEVELOPING", assessedAt: new Date("2026-09-01T00:00:00Z") },
    });
    await api.prisma.financialLiteracyProfile.create({ data: { userId: other.id } });
    const at = "2026-09-02T06:00:00Z";
    await insert(
      { at, eventType: "LITERACY_TOPIC_STARTED", source: "INTERNAL", knowledgeCategory: "SAVING" },
      { at, eventType: "LITERACY_TOPIC_STARTED", source: "INTERNAL", knowledgeCategory: "SCAMS" },
      {
        at,
        eventType: "LITERACY_TOPIC_COMPLETED",
        source: "INTERNAL",
        knowledgeCategory: "SAVING",
      },
    );

    const response = await admin<AnalyticsLiteracyResponse>("literacy", RANGE);
    expect(response.body).toMatchObject({ topicsStarted: 2, topicsCompleted: 1 });
    expect(response.body.byCategory.filter((entry) => entry.started + entry.completed > 0)).toEqual(
      [
        { category: "SAVING", started: 1, completed: 1 },
        { category: "SCAMS", started: 1, completed: 0 },
      ],
    );
    expect(response.body.profiles).toEqual({
      total: 2,
      assessed: 1,
      unassessed: 1,
      levels: [
        { level: "BEGINNER", count: 1 },
        { level: "DEVELOPING", count: 1 },
        { level: "CONFIDENT", count: 0 },
      ],
    });
    expect(response.text).not.toContain(user.id);
    expect(response.text).not.toContain("+94000000501");
  });

  it("counts only tools that were used, split by channel", async () => {
    const at = "2026-09-02T06:00:00Z";
    await insert(
      { at, eventType: "AGENT_TOOL_CALL", toolName: "calculate_loan" },
      {
        at,
        eventType: "AGENT_TOOL_CALL",
        toolName: "calculate_loan",
        success: false,
        errorCode: "INVALID_ARGUMENTS",
      },
      { at, eventType: "VOICE_TOOL_CALL", source: "VOICE", toolName: "calculate_loan" },
      { at, eventType: "VOICE_TOOL_CALL", source: "VOICE", toolName: "search_knowledge" },
      { at, eventType: "AGENT_TOOL_CALL", success: false, errorCode: "UNKNOWN_TOOL" },
      { at, eventType: "CALCULATION", toolName: "calculate_savings" },
    );

    const response = await admin<AnalyticsToolResponse>("tools", RANGE);
    expect(response.body).toMatchObject({
      total: 4,
      data: [
        { toolName: "calculate_loan", calls: 3, agentCalls: 2, voiceCalls: 1, failed: 1 },
        { toolName: "search_knowledge", calls: 1, agentCalls: 0, voiceCalls: 1, failed: 0 },
      ],
    });
  });

  it("reports health: failures, error codes and latency per operation", async () => {
    const at = "2026-09-02T06:00:00Z";
    await insert(
      ...[100, 200, 300, 400, 500].map((durationMs) => ({ at, durationMs })),
      { at, success: false, errorCode: "BAD_GATEWAY", durationMs: 30_000 },
      {
        at,
        eventType: "VOICE_SESSION",
        source: "VOICE",
        success: false,
        errorCode: "VOICE_PROVIDER_UNAVAILABLE",
      },
    );

    const response = await admin<AnalyticsHealthResponse>("health", RANGE);
    expect(response.body).toMatchObject({ totalEvents: 7, failedEvents: 2, failureRate: "28.57" });
    const agent = response.body.byEventType.find((entry) => entry.eventType === "AGENT_REQUEST");
    expect(agent).toEqual({
      eventType: "AGENT_REQUEST",
      total: 6,
      failed: 1,
      latency: { sampleSize: 6, averageMs: 5250, p50Ms: 350, p95Ms: 22625 },
    });
    expect(response.body.errorCodes).toEqual([
      { errorCode: "BAD_GATEWAY", count: 1 },
      { errorCode: "VOICE_PROVIDER_UNAVAILABLE", count: 1 },
    ]);
    expect(response.body.byEventType).toHaveLength(10);
  });

  it("builds the knowledge review queue from the knowledge tables, read-only", async () => {
    await seedKnowledge(api.prisma);
    const now = Date.now();
    await api.prisma.knowledgeArticle.update({
      where: { slug: "deposit-insurance" },
      data: { lastReviewedAt: new Date(now - 100 * DAY), nextReviewAt: new Date(now - DAY) },
    });
    await api.prisma.knowledgeArticle.update({
      where: { slug: "consumer-rights-and-complaints" },
      data: { nextReviewAt: new Date(now + 3 * DAY) },
    });
    await api.prisma.knowledgeArticle.update({
      where: { slug: "recognise-scams" },
      data: { nextReviewAt: new Date(now + 20 * DAY) },
    });
    const before = await api.prisma.knowledgeArticle.findMany({ orderBy: { slug: "asc" } });

    const response = await admin<AnalyticsReviewQueueResponse>("knowledge-review");
    expect(response.body).toMatchObject({
      publishedArticles: 12,
      timeSensitiveArticles: 2,
      reviewRequired: 1,
      buckets: { OVERDUE: 1, DUE_WITHIN_7_DAYS: 1, DUE_WITHIN_30_DAYS: 1, LATER: 9 },
    });
    expect(
      response.body.articles
        .slice(0, 3)
        .map((article) => [article.slug, article.bucket, article.reviewRequired]),
    ).toEqual([
      ["deposit-insurance", "OVERDUE", true],
      ["consumer-rights-and-complaints", "DUE_WITHIN_7_DAYS", false],
      ["recognise-scams", "DUE_WITHIN_30_DAYS", false],
    ]);
    expect(await api.prisma.knowledgeArticle.findMany({ orderBy: { slug: "asc" } })).toEqual(
      before,
    );
    expect(await api.prisma.analyticsEvent.count()).toBe(0);
  });

  it("exposes no rows, ids, session ids or personal data", async () => {
    await insert({
      at: "2026-09-02T06:00:00Z",
      eventType: "VOICE_SESSION",
      source: "VOICE",
      sessionId: VOICE_EVENT.sessionId,
    });
    for (const path of [
      "overview",
      "trends",
      "languages",
      "knowledge",
      "scamshield",
      "literacy",
      "tools",
      "health",
    ]) {
      const response = await admin(path, RANGE);
      expect(response.text, path).not.toContain(VOICE_EVENT.sessionId);
      expect(response.text, path).not.toMatch(
        /"id"|"sessionId"|"userId"|"occurredAt"|"durationMs"/u,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe("instrumentation", () => {
  const MARKER = "ZZANALYTICSMARKER";

  it("records one privacy-safe event per operation, without content", async () => {
    await seedKnowledge(api.prisma);
    const user = await api.prisma.user.create({
      data: { phoneNumber: "+94000000601", preferredLanguage: "TA" },
    });
    script = toolsThenAnswer([
      ["calculate_loan", { principal: "500000.00", annualInterestRate: "12.00", termMonths: 36 }],
    ]);

    const responses = await Promise.all([
      api.request("POST", "/api/v1/calculations/loan", {
        principal: "500000.00",
        annualInterestRate: "12.00",
        termMonths: 36,
      }),
      api.request("POST", "/api/v1/scamshield/analyze", {
        content: `Send your ${MARKER} OTP now`,
        language: "SI",
        sourceType: "CALL",
      }),
      api.request("GET", `/api/v1/knowledge/articles?language=TA&category=SCAMS&query=${MARKER}`),
      api.request("GET", "/api/v1/knowledge/articles/recognise-scams?language=SI"),
      api.request("POST", "/api/v1/agent/chat", { message: `My loan ${MARKER}`, language: "EN" }),
      api.request(
        "POST",
        "/internal/voice/tools/execute",
        {
          name: "calculate_savings",
          arguments: { targetAmount: "100000.00", currentAmount: "0.00", months: 10 },
          language: "TA",
        },
        HEADERS,
      ),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    await api.request(
      "POST",
      `/internal/users/${user.id}/literacy/topics/SAVING/start`,
      undefined,
      HEADERS,
    );
    await api.request(
      "POST",
      `/internal/users/${user.id}/literacy/topics/SAVING/start`,
      undefined,
      HEADERS,
    ); // activity only
    await api.request(
      "POST",
      `/internal/users/${user.id}/literacy/topics/SAVING/complete`,
      undefined,
      HEADERS,
    );
    await api.request(
      "POST",
      `/internal/users/${user.id}/literacy/topics/SAVING/complete`,
      undefined,
      HEADERS,
    ); // no change
    await flush();

    const rows = await api.prisma.analyticsEvent.findMany();
    const summary = rows
      .map((row) => ({
        eventType: row.eventType,
        source: row.source,
        language: row.language,
        knowledgeCategory: row.knowledgeCategory,
        toolName: row.toolName,
        scamSourceType: row.scamSourceType,
        scamRiskLevel: row.scamRiskLevel,
        success: row.success,
      }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType));
    const event = (
      fields: Partial<(typeof summary)[number]> & { eventType: string; source: string },
    ) => ({
      language: null,
      knowledgeCategory: null,
      toolName: null,
      scamSourceType: null,
      scamRiskLevel: null,
      success: true,
      ...fields,
    });
    expect(summary).toEqual([
      event({ eventType: "AGENT_REQUEST", source: "API", language: "EN" }),
      event({
        eventType: "AGENT_TOOL_CALL",
        source: "API",
        language: "EN",
        toolName: "calculate_loan",
      }),
      event({ eventType: "CALCULATION", source: "API", toolName: "calculate_loan" }),
      event({
        eventType: "KNOWLEDGE_ARTICLE_VIEW",
        source: "API",
        language: "SI",
        knowledgeCategory: "SCAMS",
      }),
      event({
        eventType: "KNOWLEDGE_SEARCH",
        source: "API",
        language: "TA",
        knowledgeCategory: "SCAMS",
      }),
      event({
        eventType: "LITERACY_TOPIC_COMPLETED",
        source: "INTERNAL",
        knowledgeCategory: "SAVING",
      }),
      event({
        eventType: "LITERACY_TOPIC_STARTED",
        source: "INTERNAL",
        knowledgeCategory: "SAVING",
      }),
      event({
        eventType: "SCAM_ANALYSIS",
        source: "API",
        language: "SI",
        scamSourceType: "CALL",
        scamRiskLevel: "MEDIUM",
      }),
      event({
        eventType: "VOICE_TOOL_CALL",
        source: "VOICE",
        language: "TA",
        toolName: "calculate_savings",
      }),
    ]);
    for (const row of rows) {
      expect(row.durationMs === null || (row.durationMs >= 0 && row.durationMs < 60_000)).toBe(
        true,
      );
    }
    // Nothing from any request is stored: not the content, amounts, query, slug or user.
    const stored = JSON.stringify(rows);
    for (const secret of [
      MARKER,
      "500000",
      "16607",
      "100000",
      "recognise-scams",
      user.id,
      "+94000000601",
    ]) {
      expect(stored, secret).not.toContain(secret);
    }
  });

  it("records failures with a controlled code", async () => {
    await api.request("POST", "/api/v1/calculations/savings", {
      targetAmount: "100.00",
      currentAmount: "200.00",
      months: 3,
    });
    await api.request("GET", "/api/v1/knowledge/articles/does-not-exist");
    await flush();

    const rows = await api.prisma.analyticsEvent.findMany();
    const outcomes = rows
      .map((row) => [row.eventType, row.success, row.errorCode] as const)
      .sort((x, y) => x[0].localeCompare(y[0]));
    expect(outcomes).toEqual([
      ["CALCULATION", false, "VALIDATION_ERROR"],
      ["KNOWLEDGE_ARTICLE_VIEW", false, "NOT_FOUND"],
    ]);
  });

  it("keeps every feature working when analytics cannot be stored", async () => {
    await seedKnowledge(api.prisma);
    const user = await api.prisma.user.create({
      data: { phoneNumber: "+94000000701", preferredLanguage: "EN" },
    });
    script = toolsThenAnswer([]);
    const failuresBefore = recorder().failuresSinceStart;
    await api.prisma.$executeRawUnsafe(
      `ALTER TABLE "analytics_events" RENAME TO "analytics_events_unavailable"`,
    );
    try {
      const results = await Promise.all([
        api.request("POST", "/api/v1/scamshield/analyze", {
          content: `Send your ${MARKER} OTP now`,
          language: "EN",
          sourceType: "MESSAGE",
        }),
        api.request("POST", "/api/v1/calculations/budget", {
          monthlyIncome: "150000.00",
          monthlyExpenses: "100000.00",
        }),
        api.request("GET", "/api/v1/knowledge/articles?query=scam"),
        api.request("POST", "/api/v1/agent/chat", { message: "What is a budget?", language: "EN" }),
        api.request(
          "POST",
          `/internal/users/${user.id}/literacy/topics/SCAMS/start`,
          undefined,
          HEADERS,
        ),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
      expect((results[0].body as { riskLevel: string }).riskLevel).toBe("MEDIUM");
      await flush();
      expect(recorder().failuresSinceStart - failuresBefore).toBe(5);
    } finally {
      await api.prisma.$executeRawUnsafe(
        `ALTER TABLE "analytics_events_unavailable" RENAME TO "analytics_events"`,
      );
    }
    const logs = logger.lines.join("\n");
    expect(logs).toContain("Analytics recording failed (database error");
    expect(logs).not.toContain(MARKER);
    expect(logs).not.toContain("analytics_events");
  });
});

// ---------------------------------------------------------------------------------------------

describe("retention cleanup", () => {
  async function tableCounts(): Promise<Record<string, number>> {
    const tables = await api.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('_prisma_migrations', 'analytics_events')`;
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables) {
      const [row] = await api.prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "${table}"`,
      );
      counts[table] = row?.count ?? 0;
    }
    return counts;
  }

  it("deletes only analytics events older than the retention period, and nothing else", async () => {
    await seedKnowledge(api.prisma);
    const user = await api.prisma.user.create({
      data: { phoneNumber: "+94000000801", preferredLanguage: "EN" },
    });
    await api.prisma.financialLiteracyProfile.create({ data: { userId: user.id } });
    const now = new Date("2026-09-27T12:00:00Z");
    await insert(
      { at: "2026-06-01T00:00:00Z" }, // 118 days old
      { at: "2026-06-29T11:59:59Z" }, // just over 90 days
      { at: "2026-06-29T12:00:01Z" }, // just under 90 days
      { at: "2026-09-27T11:00:00Z" },
    );
    const before = await tableCounts();

    const first = await deleteExpiredAnalyticsEvents(api.prisma, 90, now);
    expect(first).toEqual({ cutoff: new Date("2026-06-29T12:00:00Z"), deleted: 2 });
    const remaining = await api.prisma.analyticsEvent.findMany({ orderBy: { occurredAt: "asc" } });
    expect(remaining.map((row) => row.occurredAt.toISOString())).toEqual([
      "2026-06-29T12:00:01.000Z",
      "2026-09-27T11:00:00.000Z",
    ]);
    expect(await tableCounts()).toEqual(before);
    expect(before.users).toBe(1);
    expect(before.knowledge_articles).toBe(12);

    // Safe to repeat.
    expect((await deleteExpiredAnalyticsEvents(api.prisma, 90, now)).deleted).toBe(0);
  });

  it("refuses an invalid retention period", async () => {
    await expect(deleteExpiredAnalyticsEvents(api.prisma, 0)).rejects.toThrow();
    await expect(deleteExpiredAnalyticsEvents(api.prisma, 1.5)).rejects.toThrow();
  });
});
