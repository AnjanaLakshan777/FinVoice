import { z } from "zod";

import { AGENT_TOOL_NAMES } from "./agent.js";
import { API_ERROR_CODES, calendarDateSchema, uuidSchema } from "./common.js";
import { USER_CONTEXT_TOOL_NAMES } from "./financial-context.js";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory } from "./knowledge.js";
import type { LiteracyLevel } from "./literacy.js";
import {
  SCAM_SHIELD_RISK_LEVELS,
  SCAM_SOURCE_TYPES,
  type ScamShieldRiskLevel,
  type ScamSourceType,
} from "./scam-shield.js";
import { LANGUAGES, type Language } from "./users.js";
import { VOICE_ERROR_CODES } from "./voice.js";

/**
 * Contracts of FinVoice's privacy-safe operational analytics (Step 10): the event model, the
 * internal ingestion endpoint and the internal, token-protected admin read API. See
 * docs/architecture/analytics.md.
 *
 * An event holds operational metadata only: what kind of operation, language, knowledge category,
 * tool name, ScamShield level and content type, success, duration and a controlled error code.
 * Every schema is strict, so fields such as a message, transcript, amount, phone number, OTP,
 * search query, tool arguments or ScamShield evidence are rejected, not stripped.
 */

export const ANALYTICS_EVENT_TYPES = [
  "AGENT_REQUEST",
  "AGENT_TOOL_CALL",
  "VOICE_SESSION",
  "VOICE_TOOL_CALL",
  "KNOWLEDGE_SEARCH",
  "KNOWLEDGE_ARTICLE_VIEW",
  "SCAM_ANALYSIS",
  "LITERACY_TOPIC_STARTED",
  "LITERACY_TOPIC_COMPLETED",
  "CALCULATION",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const ANALYTICS_EVENT_SOURCES = ["WEB", "VOICE", "API", "INTERNAL"] as const;
export type AnalyticsEventSource = (typeof ANALYTICS_EVENT_SOURCES)[number];

/** The tools and calculators whose use is counted: names only, never arguments or results. */
export const ANALYTICS_TOOL_NAMES = [...AGENT_TOOL_NAMES, ...USER_CONTEXT_TOOL_NAMES] as const;
export type AnalyticsToolName = (typeof ANALYTICS_TOOL_NAMES)[number];

/** Controlled failure codes: the API and voice error codes plus the tool-execution failures. */
export const ANALYTICS_ERROR_CODES = [
  ...API_ERROR_CODES,
  ...VOICE_ERROR_CODES,
  "UNKNOWN_TOOL",
  "INVALID_ARGUMENTS",
  "TOOL_FAILED",
  "TOOL_LIMIT_REACHED",
] as const;
export type AnalyticsErrorCode = (typeof ANALYTICS_ERROR_CODES)[number];

/** Durations are integer milliseconds from 0 to 24 hours; anything else is rejected. */
export const ANALYTICS_MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/** Dashboard days are calendar days in this time zone (events are stored in UTC). */
export const ANALYTICS_TIMEZONE = "Asia/Colombo";
/** Longest date range the read API accepts, in calendar days (inclusive). */
export const ANALYTICS_MAX_RANGE_DAYS = 366;
/** Range used when the request gives no dates: the 30 calendar days ending today. */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;
/** Percentiles need at least this many observations; with fewer they are null. */
export const ANALYTICS_MIN_PERCENTILE_SAMPLES = 5;

/**
 * Event types other FinVoice services may send to POST /internal/analytics/events. Everything
 * else is recorded by the API itself where the operation runs, so it cannot be counted twice or
 * forged by a caller. Today only the voice gateway sends events: whole voice sessions.
 */
export const INGESTIBLE_ANALYTICS_EVENT_TYPES = ["VOICE_SESSION"] as const;
export type IngestibleAnalyticsEventType = (typeof INGESTIBLE_ANALYTICS_EVENT_TYPES)[number];

const TOOL_EVENT_TYPES: readonly AnalyticsEventType[] = [
  "AGENT_TOOL_CALL",
  "VOICE_TOOL_CALL",
  "CALCULATION",
];
const CATEGORY_EVENT_TYPES: readonly AnalyticsEventType[] = [
  "KNOWLEDGE_SEARCH",
  "KNOWLEDGE_ARTICLE_VIEW",
  "LITERACY_TOPIC_STARTED",
  "LITERACY_TOPIC_COMPLETED",
];
const VOICE_EVENT_TYPES: readonly AnalyticsEventType[] = ["VOICE_SESSION", "VOICE_TOOL_CALL"];

const eventFieldsSchema = z.strictObject({
  eventType: z.enum(ANALYTICS_EVENT_TYPES),
  source: z.enum(ANALYTICS_EVENT_SOURCES),
  language: z.enum(LANGUAGES).optional(),
  knowledgeCategory: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  toolName: z.enum(ANALYTICS_TOOL_NAMES).optional(),
  scamRiskLevel: z.enum(SCAM_SHIELD_RISK_LEVELS).optional(),
  scamSourceType: z.enum(SCAM_SOURCE_TYPES).optional(),
  success: z.boolean(),
  durationMs: z
    .number()
    .int({ error: "Must be whole milliseconds" })
    .min(0, { error: "Must not be negative" })
    .max(ANALYTICS_MAX_DURATION_MS, { error: "Must be at most 24 hours" })
    .optional(),
  errorCode: z.enum(ANALYTICS_ERROR_CODES).optional(),
  sessionId: uuidSchema.optional(),
});

/**
 * One analytics event, as recorded by FinVoice services. The rules mirror the database CHECK
 * constraints: each optional field only where it has a meaning.
 */
export const analyticsEventSchema = eventFieldsSchema.superRefine((event, context) => {
  const problem = (path: string, message: string): void => {
    context.addIssue({ code: "custom", path: [path], message });
  };
  if (event.errorCode !== undefined && event.success) {
    problem("errorCode", "Only a failed event can have an error code");
  }
  const isScam = event.eventType === "SCAM_ANALYSIS";
  if (isScam && event.scamSourceType === undefined) {
    problem("scamSourceType", "Required for SCAM_ANALYSIS");
  }
  if (!isScam && (event.scamSourceType !== undefined || event.scamRiskLevel !== undefined)) {
    problem("scamRiskLevel", "Only SCAM_ANALYSIS events have ScamShield fields");
  }
  if (event.eventType === "CALCULATION" && event.toolName === undefined) {
    problem("toolName", "Required for CALCULATION");
  }
  if (!TOOL_EVENT_TYPES.includes(event.eventType) && event.toolName !== undefined) {
    problem("toolName", "Only tool calls and calculations have a tool name");
  }
  const isLiteracy =
    event.eventType === "LITERACY_TOPIC_STARTED" || event.eventType === "LITERACY_TOPIC_COMPLETED";
  if (isLiteracy && event.knowledgeCategory === undefined) {
    problem("knowledgeCategory", "Required for literacy events");
  }
  if (!CATEGORY_EVENT_TYPES.includes(event.eventType) && event.knowledgeCategory !== undefined) {
    problem("knowledgeCategory", "Only knowledge and literacy events have a category");
  }
  if (event.eventType !== "VOICE_SESSION" && event.sessionId !== undefined) {
    problem("sessionId", "Only VOICE_SESSION events have a session id");
  }
  if (VOICE_EVENT_TYPES.includes(event.eventType) !== (event.source === "VOICE")) {
    problem("source", "Voice events, and only voice events, have the source VOICE");
  }
});
export type AnalyticsEvent = z.output<typeof analyticsEventSchema>;

/**
 * Body of POST /internal/analytics/events (token-protected; used by the voice gateway). Only
 * event types the API cannot observe itself are accepted. There is no timestamp field: the API
 * sets occurredAt when it receives the event.
 */
export const analyticsEventRequestSchema = analyticsEventSchema.refine(
  (event) => (INGESTIBLE_ANALYTICS_EVENT_TYPES as readonly string[]).includes(event.eventType),
  {
    path: ["eventType"],
    error: `Must be one of: ${INGESTIBLE_ANALYTICS_EVENT_TYPES.join(", ")}`,
  },
);
export type AnalyticsEventRequest = z.output<typeof analyticsEventRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Admin read API: GET /internal/admin/analytics/* (token-protected, aggregates only)
// ---------------------------------------------------------------------------------------------

/**
 * Calendar dates (YYYY-MM-DD) in ANALYTICS_TIMEZONE, both inclusive. Omitted dates default to the
 * ANALYTICS_DEFAULT_RANGE_DAYS days ending today (only `from`: up to today; only `to`: the 30 days
 * ending then). At most ANALYTICS_MAX_RANGE_DAYS days.
 */
export const analyticsRangeQuerySchema = z
  .strictObject({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ["from"],
    error: "Must not be after to",
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      daysBetween(query.from, query.to) + 1 <= ANALYTICS_MAX_RANGE_DAYS,
    { path: ["to"], error: `The range must be at most ${String(ANALYTICS_MAX_RANGE_DAYS)} days` },
  );
export type AnalyticsRangeQuery = z.output<typeof analyticsRangeQuerySchema>;

/** Whole days from one calendar date to another (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type AnalyticsRange = {
  from: string;
  to: string;
  /** The time zone that defines the calendar days. */
  timezone: typeof ANALYTICS_TIMEZONE;
  days: number;
};

/**
 * A share of a total with exactly two decimals, e.g. "40.32". Null when the total is zero.
 * Analytics arithmetic on counts; unrelated to money.
 */
export type AnalyticsPercentage = string | null;

export type AnalyticsLatency = {
  /** Number of observations with a duration. */
  sampleSize: number;
  /** Null when there are no observations. */
  averageMs: number | null;
  /** Null with fewer than ANALYTICS_MIN_PERCENTILE_SAMPLES observations. */
  p50Ms: number | null;
  /** Null with fewer than ANALYTICS_MIN_PERCENTILE_SAMPLES observations. */
  p95Ms: number | null;
};

export type AnalyticsLanguageCount = {
  language: Language;
  count: number;
  percentage: AnalyticsPercentage;
};

export type AnalyticsCategoryCount = {
  category: KnowledgeCategory;
  count: number;
  percentage: AnalyticsPercentage;
};

export type AnalyticsOverviewResponse = {
  range: AnalyticsRange;
  /** User-facing operations. Tool calls and literacy updates are not interactions. */
  interactions: {
    total: number;
    agent: number;
    voice: number;
    scamshield: number;
    calculations: number;
    knowledge: number;
  };
  /** Share of successful interactions. */
  successRate: AnalyticsPercentage;
  /** Response time of request/response interactions (not voice sessions). */
  averageResponseMs: number | null;
  p95ResponseMs: number | null;
  responseSampleSize: number;
};

export type AnalyticsTrendDay = {
  /** Calendar date in ANALYTICS_TIMEZONE. */
  date: string;
  agentRequests: number;
  voiceSessions: number;
  scamAnalyses: number;
  calculations: number;
  knowledgeRequests: number;
  total: number;
};

export type AnalyticsTrendResponse = {
  range: AnalyticsRange;
  /** One entry per calendar day of the range, in order; days without events have zeros. */
  data: AnalyticsTrendDay[];
};

export type AnalyticsLanguageResponse = {
  range: AnalyticsRange;
  /** Events that carry a language. */
  total: number;
  /** Every language, in LANGUAGES order. */
  data: AnalyticsLanguageCount[];
};

export type AnalyticsKnowledgeResponse = {
  range: AnalyticsRange;
  searches: number;
  articleViews: number;
  /** Every category, most used first (searches filtered by category and article views). */
  categories: AnalyticsCategoryCount[];
  languages: AnalyticsLanguageCount[];
  /** Current state of the knowledge base (not limited to the range). */
  articles: {
    published: number;
    /** Published articles with at least one Sinhala or Tamil translation. */
    translated: number;
    timeSensitive: number;
    reviewRequired: number;
  };
};

export type AnalyticsScamShieldResponse = {
  range: AnalyticsRange;
  total: number;
  successRate: AnalyticsPercentage;
  /** Every level, in order; only successful analyses have one. */
  riskLevels: { riskLevel: ScamShieldRiskLevel; count: number; percentage: AnalyticsPercentage }[];
  sourceTypes: { sourceType: ScamSourceType; count: number; percentage: AnalyticsPercentage }[];
  languages: AnalyticsLanguageCount[];
};

export type AnalyticsLiteracyResponse = {
  range: AnalyticsRange;
  topicsStarted: number;
  topicsCompleted: number;
  /** Every category, in KNOWLEDGE_CATEGORIES order. */
  byCategory: { category: KnowledgeCategory; started: number; completed: number }[];
  languages: AnalyticsLanguageCount[];
  /** Current literacy profiles (not limited to the range): counts only. */
  profiles: {
    total: number;
    assessed: number;
    unassessed: number;
    levels: { level: LiteracyLevel; count: number }[];
  };
};

export type AnalyticsToolUsage = {
  toolName: AnalyticsToolName;
  calls: number;
  agentCalls: number;
  voiceCalls: number;
  failed: number;
};

export type AnalyticsToolResponse = {
  range: AnalyticsRange;
  total: number;
  /** Only tools with calls in the range, most used first. */
  data: AnalyticsToolUsage[];
};

export type AnalyticsHealthResponse = {
  range: AnalyticsRange;
  totalEvents: number;
  failedEvents: number;
  failureRate: AnalyticsPercentage;
  /** Events this API process could not store since it started (not persisted). */
  recordingFailuresSinceStart: number;
  /** Every event type, in ANALYTICS_EVENT_TYPES order. */
  byEventType: {
    eventType: AnalyticsEventType;
    total: number;
    failed: number;
    latency: AnalyticsLatency;
  }[];
  /** Error codes that occurred, most frequent first. */
  errorCodes: { errorCode: AnalyticsErrorCode; count: number }[];
};

export const KNOWLEDGE_REVIEW_BUCKETS = [
  "OVERDUE",
  "DUE_WITHIN_7_DAYS",
  "DUE_WITHIN_30_DAYS",
  "LATER",
] as const;
export type KnowledgeReviewBucket = (typeof KNOWLEDGE_REVIEW_BUCKETS)[number];

export type AnalyticsReviewQueueArticle = {
  slug: string;
  /** English title. */
  title: string;
  category: KnowledgeCategory;
  isTimeSensitive: boolean;
  /** Time-sensitive and past its review date. */
  reviewRequired: boolean;
  nextReviewAt: string | null;
  bucket: KnowledgeReviewBucket;
};

export type AnalyticsReviewQueueResponse = {
  /** When the queue was computed (ISO 8601). */
  generatedAt: string;
  publishedArticles: number;
  timeSensitiveArticles: number;
  reviewRequired: number;
  buckets: Record<KnowledgeReviewBucket, number>;
  /** Published articles with a review date, soonest first. */
  articles: AnalyticsReviewQueueArticle[];
};
