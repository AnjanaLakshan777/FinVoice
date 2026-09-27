import {
  LITERACY_TOPICS,
  type LiteracyTopic,
  type LiteracyTopicProgressResponse,
} from "@finvoice/contracts";
import { Injectable } from "@nestjs/common";

import { AnalyticsRecorder } from "../analytics/analytics-recorder.js";
import { ApiException } from "../common/api.exception.js";
import { isPrismaError } from "../common/prisma-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import type { FinancialLiteracyTopicProgress } from "../generated/prisma/client.js";
import { userNotFound, UsersService } from "../users/users.service.js";

/**
 * The user's progress per literacy topic.
 *
 * Lifecycle (all timestamps are set here, from the server clock; clients never send them):
 *
 *   NOT_STARTED (no row) ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
 *   NOT_STARTED (no row) ──────────complete──────────────────▶ COMPLETED
 *
 * - start on IN_PROGRESS records activity (lastActivityAt) and is otherwise a no-op.
 * - complete on COMPLETED returns the stored progress unchanged.
 * - start on COMPLETED is rejected (409): progress never moves back; a reset would be a separate,
 *   explicit feature.
 *
 * Nothing here marks a topic started or completed by itself (for example because an article was
 * read); callers must ask explicitly. The database CHECK constraints guard the status/timestamp
 * combinations as a second line of defence.
 *
 * A real change of status is counted as a LITERACY_TOPIC_STARTED or LITERACY_TOPIC_COMPLETED
 * analytics event with the topic only: no user id, so analytics cannot follow a person.
 */
@Injectable()
export class FinancialLiteracyProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly analytics: AnalyticsRecorder,
  ) {}

  /** All recorded progress, in topic order. 404 for an unknown user. */
  async getProgress(userId: string): Promise<LiteracyTopicProgressResponse[]> {
    await this.users.assertExists(userId);
    return this.find(userId);
  }

  /** Like getProgress, for callers that have already checked the user exists. One query. */
  async find(userId: string): Promise<LiteracyTopicProgressResponse[]> {
    const rows = await this.prisma.financialLiteracyTopicProgress.findMany({ where: { userId } });
    return rows
      .sort((a, b) => LITERACY_TOPICS.indexOf(a.topic) - LITERACY_TOPICS.indexOf(b.topic))
      .map(toTopicProgressResponse);
  }

  /** Progress on one topic; a topic without a record is NOT_STARTED. */
  async getTopicProgress(
    userId: string,
    topic: LiteracyTopic,
  ): Promise<LiteracyTopicProgressResponse> {
    await this.users.assertExists(userId);
    const row = await this.findRow(userId, topic);
    return row ? toTopicProgressResponse(row) : notStarted(topic);
  }

  async startTopic(userId: string, topic: LiteracyTopic): Promise<LiteracyTopicProgressResponse> {
    await this.users.assertExists(userId);
    const now = new Date();
    const row = await this.findRow(userId, topic);
    if (row === null) {
      const created = await this.createRow(userId, topic, {
        status: "IN_PROGRESS",
        startedAt: now,
        lastActivityAt: now,
      });
      this.track("LITERACY_TOPIC_STARTED", topic);
      return created;
    }
    switch (row.status) {
      case "NOT_STARTED": {
        const started = await this.transition(row, {
          status: "IN_PROGRESS",
          startedAt: now,
          lastActivityAt: now,
        });
        this.track("LITERACY_TOPIC_STARTED", topic);
        return started;
      }
      case "IN_PROGRESS":
        return this.transition(row, { lastActivityAt: now });
      case "COMPLETED":
        throw ApiException.conflict("This topic is already completed");
    }
  }

  async completeTopic(
    userId: string,
    topic: LiteracyTopic,
  ): Promise<LiteracyTopicProgressResponse> {
    await this.users.assertExists(userId);
    const now = new Date();
    const row = await this.findRow(userId, topic);
    let completed: LiteracyTopicProgressResponse;
    if (row === null) {
      completed = await this.createRow(userId, topic, {
        status: "COMPLETED",
        startedAt: now,
        completedAt: now,
        lastActivityAt: now,
      });
    } else {
      switch (row.status) {
        case "NOT_STARTED":
          completed = await this.transition(row, {
            status: "COMPLETED",
            startedAt: now,
            completedAt: now,
            lastActivityAt: now,
          });
          break;
        case "IN_PROGRESS":
          // Never before startedAt, even if the server clock stepped back since the start.
          completed = await this.transition(row, {
            status: "COMPLETED",
            completedAt: row.startedAt && row.startedAt > now ? row.startedAt : now,
            lastActivityAt: now,
          });
          break;
        case "COMPLETED":
          return toTopicProgressResponse(row);
      }
    }
    this.track("LITERACY_TOPIC_COMPLETED", topic);
    return completed;
  }

  private track(
    eventType: "LITERACY_TOPIC_STARTED" | "LITERACY_TOPIC_COMPLETED",
    topic: LiteracyTopic,
  ): void {
    this.analytics.record({
      eventType,
      source: "INTERNAL",
      knowledgeCategory: topic,
      success: true,
    });
  }

  private findRow(
    userId: string,
    topic: LiteracyTopic,
  ): Promise<FinancialLiteracyTopicProgress | null> {
    return this.prisma.financialLiteracyTopicProgress.findUnique({
      where: { userId_topic: { userId, topic } },
    });
  }

  private async createRow(
    userId: string,
    topic: LiteracyTopic,
    values: Pick<FinancialLiteracyTopicProgress, "status" | "startedAt" | "lastActivityAt"> & {
      completedAt?: Date;
    },
  ): Promise<LiteracyTopicProgressResponse> {
    try {
      return toTopicProgressResponse(
        await this.prisma.financialLiteracyTopicProgress.create({
          data: { userId, topic, ...values },
        }),
      );
    } catch (error) {
      if (isPrismaError(error, "P2003")) {
        throw userNotFound();
      }
      if (isPrismaError(error, "P2002")) {
        throw concurrentChange();
      }
      throw error;
    }
  }

  /**
   * Updates the row only if it is still in the status that was read, so two concurrent
   * transitions cannot both apply (the loser gets 409 and can retry).
   */
  private async transition(
    row: FinancialLiteracyTopicProgress,
    values: Partial<
      Pick<
        FinancialLiteracyTopicProgress,
        "status" | "startedAt" | "completedAt" | "lastActivityAt"
      >
    >,
  ): Promise<LiteracyTopicProgressResponse> {
    const updated = await this.prisma.financialLiteracyTopicProgress.updateManyAndReturn({
      where: { id: row.id, status: row.status },
      data: values,
    });
    const [result] = updated;
    if (result === undefined) {
      throw concurrentChange();
    }
    return toTopicProgressResponse(result);
  }
}

function concurrentChange(): ApiException {
  return ApiException.conflict("The topic progress changed concurrently; retry the request");
}

function notStarted(topic: LiteracyTopic): LiteracyTopicProgressResponse {
  return { topic, status: "NOT_STARTED", startedAt: null, completedAt: null, lastActivityAt: null };
}

export function toTopicProgressResponse(
  row: FinancialLiteracyTopicProgress,
): LiteracyTopicProgressResponse {
  return {
    topic: row.topic,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    lastActivityAt: row.lastActivityAt ? row.lastActivityAt.toISOString() : null,
  };
}
