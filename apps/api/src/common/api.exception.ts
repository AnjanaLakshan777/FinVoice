import type { ApiErrorCode, ApiErrorDetail, ApiErrorResponse } from "@finvoice/contracts";
import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * An expected, client-facing error. Its body is sent to the client as-is, so messages must be
 * written for API consumers and must never contain internal details.
 */
export class ApiException extends HttpException {
  constructor(readonly body: ApiErrorResponse) {
    super(body, body.statusCode);
  }

  static validation(details: ApiErrorDetail[]): ApiException {
    return new ApiException({
      statusCode: HttpStatus.BAD_REQUEST,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details,
    });
  }

  static notFound(message: string): ApiException {
    return new ApiException({ statusCode: HttpStatus.NOT_FOUND, code: "NOT_FOUND", message });
  }

  static conflict(message: string, details?: ApiErrorDetail[]): ApiException {
    return new ApiException({
      statusCode: HttpStatus.CONFLICT,
      code: "CONFLICT",
      message,
      ...(details ? { details } : {}),
    });
  }
}

export function apiError(
  statusCode: number,
  code: ApiErrorCode,
  message: string,
): ApiErrorResponse {
  return { statusCode, code, message };
}
