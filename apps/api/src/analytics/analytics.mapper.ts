import {
  ANALYTICS_MIN_PERCENTILE_SAMPLES,
  type AnalyticsLatency,
  type AnalyticsPercentage,
  type AnalyticsReviewQueueArticle,
  type AnalyticsReviewQueueResponse,
  type KnowledgeReviewBucket,
} from "@finvoice/contracts";

import type { KnowledgeReviewItem } from "../knowledge/knowledge.service.js";

/**
 * A count's share of a total as a string with exactly two decimals ("40.32"), rounded half up.
 * Integer arithmetic on counts (analytics, not money); null when the total is zero.
 */
export function percentage(count: number, total: number): AnalyticsPercentage {
  if (total <= 0) {
    return null;
  }
  const hundredths = Math.floor((count * 20_000 + total) / (2 * total));
  return `${String(Math.floor(hundredths / 100))}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** Raw latency figures from PostgreSQL. */
export type LatencyRow = {
  sampleSize: number;
  average: number | null;
  p50: number | null;
  p95: number | null;
};

/**
 * Whole milliseconds. Percentiles are withheld (null) below ANALYTICS_MIN_PERCENTILE_SAMPLES
 * observations: a "95th percentile" of three requests is not meaningful.
 */
export function toLatency(row: LatencyRow | undefined): AnalyticsLatency {
  const sampleSize = row?.sampleSize ?? 0;
  const enough = sampleSize >= ANALYTICS_MIN_PERCENTILE_SAMPLES;
  return {
    sampleSize,
    averageMs: sampleSize > 0 && row?.average != null ? Math.round(row.average) : null,
    p50Ms: enough && row?.p50 != null ? Math.round(row.p50) : null,
    p95Ms: enough && row?.p95 != null ? Math.round(row.p95) : null,
  };
}

const DAY_MS = 86_400_000;

export function reviewBucket(nextReviewAt: Date | null, now: Date): KnowledgeReviewBucket {
  if (nextReviewAt === null) {
    return "LATER";
  }
  const remaining = nextReviewAt.getTime() - now.getTime();
  if (remaining < 0) {
    return "OVERDUE";
  }
  if (remaining <= 7 * DAY_MS) {
    return "DUE_WITHIN_7_DAYS";
  }
  if (remaining <= 30 * DAY_MS) {
    return "DUE_WITHIN_30_DAYS";
  }
  return "LATER";
}

/** The read-only review queue, computed from the current knowledge tables. */
export function toReviewQueue(
  items: readonly KnowledgeReviewItem[],
  now: Date,
): AnalyticsReviewQueueResponse {
  const articles: AnalyticsReviewQueueArticle[] = items
    .map((item) => {
      const bucket = reviewBucket(item.nextReviewAt, now);
      return {
        slug: item.slug,
        title: item.title,
        category: item.category,
        isTimeSensitive: item.isTimeSensitive,
        reviewRequired: item.isTimeSensitive && bucket === "OVERDUE",
        nextReviewAt: item.nextReviewAt?.toISOString() ?? null,
        bucket,
      };
    })
    .sort(
      (a, b) =>
        (a.nextReviewAt ?? "9999").localeCompare(b.nextReviewAt ?? "9999") ||
        a.slug.localeCompare(b.slug),
    );
  const buckets: Record<KnowledgeReviewBucket, number> = {
    OVERDUE: 0,
    DUE_WITHIN_7_DAYS: 0,
    DUE_WITHIN_30_DAYS: 0,
    LATER: 0,
  };
  for (const article of articles) {
    buckets[article.bucket] += 1;
  }
  return {
    generatedAt: now.toISOString(),
    publishedArticles: articles.length,
    timeSensitiveArticles: articles.filter((article) => article.isTimeSensitive).length,
    reviewRequired: articles.filter((article) => article.reviewRequired).length,
    buckets,
    articles,
  };
}
