import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { ApiConfig } from "@finvoice/config";
import { INTERNAL_TOKEN_HEADER } from "@finvoice/contracts";
import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

import { API_CONFIG } from "../config/api-config.module.js";
import { ApiException, apiError } from "./api.exception.js";

/**
 * Protects internal service-to-service endpoints (used by the voice gateway) with the shared
 * INTERNAL_API_TOKEN. Runs before validation, so unauthenticated callers learn nothing about the
 * endpoint's inputs.
 *
 * - Token not configured on the API: 503, the internal endpoints are disabled.
 * - Header missing or wrong: 401.
 *
 * Tokens are compared as SHA-256 digests with a constant-time comparison, so neither the length
 * nor the content of the expected token leaks through timing. The token is never logged.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly expectedDigest: Buffer | null;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.expectedDigest = config.internal.token === null ? null : digest(config.internal.token);
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.expectedDigest === null) {
      throw new ApiException(
        apiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          "SERVICE_UNAVAILABLE",
          "Internal endpoints are not configured",
        ),
      );
    }
    const header = context.switchToHttp().getRequest<IncomingMessage>().headers[
      INTERNAL_TOKEN_HEADER
    ];
    const provided = typeof header === "string" ? header : "";
    if (!timingSafeEqual(digest(provided), this.expectedDigest)) {
      throw new ApiException(
        apiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Missing or invalid internal token"),
      );
    }
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
