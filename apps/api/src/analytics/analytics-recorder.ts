import {
  ANALYTICS_ERROR_CODES,
  ANALYTICS_MAX_DURATION_MS,
  analyticsEventSchema,
  type AnalyticsErrorCode,
  type AnalyticsEvent,
} from "@finvoice/contracts";
import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Records operational analytics events. Feature services depend on this abstract class only, so
 * analytics never depends on them (no circular modules) and tests can substitute a fake.
 *
 * `record` never throws and never delays the caller: analytics must not break or slow down the
 * operation it describes.
 */
export abstract class AnalyticsRecorder {
  abstract record(event: AnalyticsEvent): void;
  /** Events that could not be stored since this process started (invalid or failed writes). */
  abstract get failuresSinceStart(): number;
}

/**
 * Stores events in PostgreSQL (analytics_events), fire-and-forget. Each event is validated again
 * against the strict contract before it is written; an invalid event is dropped and counted. A
 * failed write is logged with a safe category only (never the event or the database error text)
 * and not retried.
 */
@Injectable()
export class PrismaAnalyticsRecorder extends AnalyticsRecorder implements OnApplicationShutdown {
  private readonly logger = new Logger("Analytics");
  private readonly pending = new Set<Promise<void>>();
  private failures = 0;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  get failuresSinceStart(): number {
    return this.failures;
  }

  record(event: AnalyticsEvent): void {
    try {
      const parsed = analyticsEventSchema.safeParse(event);
      if (!parsed.success) {
        this.failed("invalid event");
        return;
      }
      const write = this.prisma.analyticsEvent
        .create({ data: toRow(parsed.data, new Date()) })
        .then(
          () => undefined,
          (error: unknown) => {
            this.failed(errorCategory(error));
          },
        );
      this.pending.add(write);
      void write.finally(() => this.pending.delete(write));
    } catch (error) {
      this.failed(errorCategory(error));
    }
  }

  /** Waits for writes in progress (tests and shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  private failed(category: string): void {
    this.failures += 1;
    this.logger.warn(`Analytics recording failed (${category})`);
  }
}

/** The stored row: explicit fields only, with the server's timestamp (clients never set it). */
function toRow(event: AnalyticsEvent, occurredAt: Date): Prisma.AnalyticsEventCreateInput {
  return {
    eventType: event.eventType,
    source: event.source,
    occurredAt,
    language: event.language ?? null,
    knowledgeCategory: event.knowledgeCategory ?? null,
    toolName: event.toolName ?? null,
    scamRiskLevel: event.scamRiskLevel ?? null,
    scamSourceType: event.scamSourceType ?? null,
    success: event.success,
    durationMs: event.durationMs ?? null,
    errorCode: event.errorCode ?? null,
    sessionId: event.sessionId ?? null,
  };
}

/** A safe description of a failure: a Prisma error code or an error class name, never a message. */
function errorCategory(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `database error ${error.code}`;
  }
  return error instanceof Error ? error.name : "unknown error";
}

/** Milliseconds since `started` (a performance.now() value), clamped to the stored range. */
export function elapsedMs(started: number): number {
  return Math.min(ANALYTICS_MAX_DURATION_MS, Math.max(0, Math.round(performance.now() - started)));
}

/**
 * The controlled analytics code for an error, from its type only (never its message): the code of
 * an API error, SERVICE_UNAVAILABLE for database connectivity, otherwise INTERNAL_ERROR.
 */
export function errorCodeOf(error: unknown): AnalyticsErrorCode {
  if (error instanceof ApiException) {
    return toAnalyticsErrorCode(error.body.code);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code.startsWith("P1")) {
    return "SERVICE_UNAVAILABLE";
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return "SERVICE_UNAVAILABLE";
  }
  return "INTERNAL_ERROR";
}

/**
 * The controlled code of a failed tool execution (UNKNOWN_TOOL, INVALID_ARGUMENTS, TOOL_FAILED),
 * read from its structured error result; undefined for a successful one. Never the arguments,
 * issues or result.
 */
export function toolExecutionErrorCode(execution: {
  isError: boolean;
  result: Readonly<Record<string, unknown>>;
}): AnalyticsErrorCode | undefined {
  if (!execution.isError) {
    return undefined;
  }
  const error = execution.result.error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return toAnalyticsErrorCode(code);
}

/** The controlled analytics code for an API error code, or INTERNAL_ERROR. */
export function toAnalyticsErrorCode(code: unknown): AnalyticsErrorCode {
  return (ANALYTICS_ERROR_CODES as readonly unknown[]).includes(code)
    ? (code as AnalyticsErrorCode)
    : "INTERNAL_ERROR";
}
