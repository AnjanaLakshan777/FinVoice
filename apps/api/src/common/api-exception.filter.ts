import type { ApiErrorCode, ApiErrorResponse } from "@finvoice/contracts";
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";

import { Prisma } from "../generated/prisma/client.js";
import { ApiException, apiError } from "./api.exception.js";

/** Fixed, client-safe messages for errors raised by the framework rather than by our code. */
const FRAMEWORK_ERRORS: Partial<Record<number, { code: ApiErrorCode; message: string }>> = {
  400: { code: "BAD_REQUEST", message: "The request could not be processed" },
  404: { code: "NOT_FOUND", message: "Route not found" },
  405: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
  413: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported content type" },
};

const INTERNAL_ERROR = apiError(500, "INTERNAL_ERROR", "An unexpected error occurred");

/**
 * Turns every error into the API error format (see docs/api/domain-api.md):
 *
 * - `ApiException`: expected domain errors, sent as-is.
 * - Other 4xx `HttpException`s and HTTP errors from the body parser: fixed, safe messages.
 * - Known Prisma errors that can still happen after the services' own checks (for example when
 *   two requests race): conflicts become 409, missing records 404, database connectivity 503.
 * - Anything else: 500 with a generic message. The error is logged, never sent to the client.
 *
 * Messages from Prisma, PostgreSQL or the framework never reach the client, so SQL, constraint
 * names, stack traces and connection details cannot leak.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.toErrorResponse(exception);
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), body, body.statusCode);
  }

  private toErrorResponse(exception: unknown): ApiErrorResponse {
    if (exception instanceof ApiException) {
      return exception.body;
    }

    const httpStatus = getClientErrorStatus(exception);
    if (httpStatus !== undefined) {
      const known = FRAMEWORK_ERRORS[httpStatus] ?? {
        code: "BAD_REQUEST",
        message: "The request could not be processed",
      };
      return apiError(httpStatus, known.code, known.message);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      if (mapped) {
        this.logger.warn(
          `Database error ${exception.code} returned as HTTP ${String(mapped.statusCode)}`,
        );
        return mapped;
      }
    }

    this.logger.error(redactSecrets(describe(exception)));
    return INTERNAL_ERROR;
  }
}

/** The status of a 4xx error raised by Nest or by middleware such as the JSON body parser. */
function getClientErrorStatus(exception: unknown): number | undefined {
  let status: number | undefined;
  if (exception instanceof HttpException) {
    status = exception.getStatus();
  } else if (
    exception instanceof Error &&
    "status" in exception &&
    typeof exception.status === "number"
  ) {
    status = exception.status;
  }
  return status !== undefined && status >= 400 && status < 500 ? status : undefined;
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): ApiErrorResponse | undefined {
  switch (error.code) {
    case "P2002":
      return apiError(409, "CONFLICT", "A resource with the same unique value already exists");
    case "P2003":
      return apiError(409, "CONFLICT", "The request refers to a resource that does not exist");
    case "P2025":
      return apiError(404, "NOT_FOUND", "Resource not found");
    default:
      if (isCheckViolation(error)) {
        // The request passed validation but the database rejected the row, so the stored data
        // changed concurrently (e.g. two updates to the same goal). Retrying may succeed.
        return apiError(
          409,
          "CONFLICT",
          "The request conflicts with the current state of the resource",
        );
      }
      if (error.code.startsWith("P1")) {
        return apiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          "SERVICE_UNAVAILABLE",
          "The database is unavailable",
        );
      }
      return undefined;
  }
}

/** PostgreSQL CHECK violation (SQLSTATE 23514), surfaced by Prisma as P2039. */
function isCheckViolation(error: Prisma.PrismaClientKnownRequestError): boolean {
  const adapterError = error.meta?.driverAdapterError as
    { cause?: { originalCode?: unknown } } | undefined;
  return error.code === "P2039" && adapterError?.cause?.originalCode === "23514";
}

function describe(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.stack ?? `${exception.name}: ${exception.message}`;
  }
  return `Non-error value thrown (${typeof exception})`;
}

/** Defence in depth: a connection string must never reach the logs. */
export function redactSecrets(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}
