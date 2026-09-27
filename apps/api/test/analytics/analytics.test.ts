import type { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  calendarDateIn,
  resolveRange,
  zonedMidnight,
} from "../../src/analytics/analytics-range.js";
import {
  elapsedMs,
  errorCodeOf,
  PrismaAnalyticsRecorder,
  toolExecutionErrorCode,
} from "../../src/analytics/analytics-recorder.js";
import {
  percentage,
  reviewBucket,
  toLatency,
  toReviewQueue,
} from "../../src/analytics/analytics.mapper.js";
import { ApiException } from "../../src/common/api.exception.js";
import type { PrismaService } from "../../src/database/prisma.service.js";

describe("date ranges (Asia/Colombo)", () => {
  // 20:00 UTC on 27 September is 01:30 on 28 September in Colombo (UTC+05:30).
  const NOW = new Date("2026-09-27T20:00:00Z");

  it("uses calendar days in Asia/Colombo", () => {
    expect(calendarDateIn("Asia/Colombo", NOW)).toBe("2026-09-28");
    expect(zonedMidnight("2026-09-28", "Asia/Colombo").toISOString()).toBe(
      "2026-09-27T18:30:00.000Z",
    );
  });

  it("defaults to the 30 days ending today", () => {
    const range = resolveRange({}, NOW);
    expect(range.range).toEqual({
      from: "2026-08-30",
      to: "2026-09-28",
      timezone: "Asia/Colombo",
      days: 30,
    });
    expect(range.start.toISOString()).toBe("2026-08-29T18:30:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-28T18:30:00.000Z");
    expect(range.dates).toHaveLength(30);
  });

  it("completes a one-sided range", () => {
    expect(resolveRange({ from: "2026-09-20" }, NOW).range).toMatchObject({
      from: "2026-09-20",
      to: "2026-09-28",
    });
    expect(resolveRange({ to: "2026-01-31" }, NOW).range).toMatchObject({
      from: "2026-01-02",
      to: "2026-01-31",
    });
  });

  it("rejects ranges that are reversed or longer than 366 days", () => {
    expect(() => resolveRange({ from: "2026-09-10", to: "2026-09-01" }, NOW)).toThrow(ApiException);
    expect(() => resolveRange({ from: "2020-01-01" }, NOW)).toThrow(ApiException);
    expect(resolveRange({ from: "2025-09-28", to: "2026-09-28" }, NOW).range.days).toBe(366);
  });
});

describe("analytics arithmetic", () => {
  it.each([
    [1, 3, "33.33"],
    [2, 3, "66.67"],
    [1, 8, "12.50"],
    [7, 8, "87.50"],
    [0, 5, "0.00"],
    [5, 5, "100.00"],
    [1, 200_000, "0.00"],
    [1, 20_000, "0.01"],
    [0, 0, null],
  ])("%i of %i → %s", (count, total, expected) => {
    expect(percentage(count, total)).toBe(expected);
  });

  it("withholds percentiles below five samples", () => {
    expect(toLatency({ sampleSize: 4, average: 120.4, p50: 100, p95: 180 })).toEqual({
      sampleSize: 4,
      averageMs: 120,
      p50Ms: null,
      p95Ms: null,
    });
    expect(toLatency({ sampleSize: 5, average: 120.6, p50: 100.5, p95: 180.2 })).toEqual({
      sampleSize: 5,
      averageMs: 121,
      p50Ms: 101,
      p95Ms: 180,
    });
    expect(toLatency(undefined)).toEqual({
      sampleSize: 0,
      averageMs: null,
      p50Ms: null,
      p95Ms: null,
    });
  });

  it("clamps measured durations to the stored range", () => {
    expect(elapsedMs(performance.now() + 10_000)).toBe(0);
    expect(elapsedMs(performance.now() - 100 * 86_400_000)).toBe(86_400_000);
  });
});

describe("knowledge review buckets", () => {
  const NOW = new Date("2026-09-27T12:00:00Z");
  const day = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

  it.each([
    [day(-1), "OVERDUE"],
    [day(0.5), "DUE_WITHIN_7_DAYS"],
    [day(7), "DUE_WITHIN_7_DAYS"],
    [day(8), "DUE_WITHIN_30_DAYS"],
    [day(30), "DUE_WITHIN_30_DAYS"],
    [day(31), "LATER"],
    [null, "LATER"],
  ])("%s → %s", (nextReviewAt, bucket) => {
    expect(reviewBucket(nextReviewAt, NOW)).toBe(bucket);
  });

  it("flags only overdue time-sensitive articles as requiring review", () => {
    const queue = toReviewQueue(
      [
        {
          slug: "a",
          title: "A",
          category: "SAVING",
          isTimeSensitive: true,
          nextReviewAt: day(-2),
          translated: false,
        },
        {
          slug: "b",
          title: "B",
          category: "SAVING",
          isTimeSensitive: false,
          nextReviewAt: day(-1),
          translated: true,
        },
        {
          slug: "c",
          title: "C",
          category: "SCAMS",
          isTimeSensitive: true,
          nextReviewAt: day(90),
          translated: false,
        },
      ],
      NOW,
    );
    expect(queue).toMatchObject({
      publishedArticles: 3,
      timeSensitiveArticles: 2,
      reviewRequired: 1,
      buckets: { OVERDUE: 2, DUE_WITHIN_7_DAYS: 0, DUE_WITHIN_30_DAYS: 0, LATER: 1 },
    });
    expect(queue.articles.map((article) => [article.slug, article.reviewRequired])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });
});

describe("PrismaAnalyticsRecorder", () => {
  function recorderWith(createImpl: () => Promise<unknown>) {
    const create = vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(() =>
      createImpl(),
    );
    const prisma = { analyticsEvent: { create } } as unknown as PrismaService;
    const recorder = new PrismaAnalyticsRecorder(prisma);
    const warn = vi.fn();
    (recorder as unknown as { logger: Pick<Logger, "warn"> }).logger = { warn };
    return { recorder, create, warn };
  }

  const EVENT = {
    eventType: "CALCULATION",
    source: "API",
    toolName: "calculate_loan",
    success: true,
  } as const;

  it("stores a valid event with a server timestamp, without blocking the caller", async () => {
    const { recorder, create } = recorderWith(() => Promise.resolve({}));
    const before = Date.now();
    recorder.record(EVENT);
    await recorder.flush();
    const data = create.mock.calls[0]?.[0].data ?? {};
    expect(data).toMatchObject({
      eventType: "CALCULATION",
      toolName: "calculate_loan",
      language: null,
    });
    expect((data.occurredAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("never throws when storage fails, and logs a safe category only", async () => {
    const { recorder, warn } = recorderWith(() =>
      Promise.reject(new Error("connect ECONNREFUSED postgresql://user:secret@db:5432/finvoice")),
    );
    expect(() => {
      recorder.record(EVENT);
    }).not.toThrow();
    await recorder.flush();
    expect(recorder.failuresSinceStart).toBe(1);
    expect(warn).toHaveBeenCalledWith("Analytics recording failed (Error)");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|ECONNREFUSED|postgresql/u);
  });

  it("never throws when the database client throws synchronously", () => {
    const { recorder } = recorderWith(() => {
      throw new TypeError("boom");
    });
    expect(() => {
      recorder.record(EVENT);
    }).not.toThrow();
    expect(recorder.failuresSinceStart).toBe(1);
  });

  it("drops an invalid event instead of storing it", async () => {
    const { recorder, create, warn } = recorderWith(() => Promise.resolve({}));
    recorder.record({ ...EVENT, message: "Send me your OTP" } as unknown as typeof EVENT);
    await recorder.flush();
    expect(create).not.toHaveBeenCalled();
    expect(recorder.failuresSinceStart).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("OTP");
  });
});

describe("controlled error codes", () => {
  it("maps errors by type, never by message", () => {
    expect(errorCodeOf(ApiException.notFound("x"))).toBe("NOT_FOUND");
    expect(errorCodeOf(new Error("BAD_GATEWAY"))).toBe("INTERNAL_ERROR");
    expect(errorCodeOf("VALIDATION_ERROR")).toBe("INTERNAL_ERROR");
  });

  it("reads a tool failure's code from its structured result", () => {
    expect(toolExecutionErrorCode({ isError: false, result: {} })).toBeUndefined();
    expect(
      toolExecutionErrorCode({
        isError: true,
        result: { error: { code: "INVALID_ARGUMENTS", issues: [] } },
      }),
    ).toBe("INVALID_ARGUMENTS");
    expect(toolExecutionErrorCode({ isError: true, result: { error: { code: "made up" } } })).toBe(
      "INTERNAL_ERROR",
    );
  });
});
