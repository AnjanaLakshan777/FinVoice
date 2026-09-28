import type { ServerResponse } from "node:http";

import type { UserRole } from "@finvoice/contracts";
import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ApiException, apiError } from "../common/api.exception.js";
import { AccessTokenService } from "./access-token.service.js";
import { AUTH_POLICY, ROLES, type AuthPolicy } from "./auth.decorators.js";
import { AUTH_CONTEXT, type AuthenticatedRequest } from "./auth.types.js";

/** Bearer token syntax (RFC 6750); the scheme is case-insensitive, the token is a compact JWT. */
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/i;

/**
 * Global guard: every route needs `Authorization: Bearer <access token>` unless it is marked
 * @Public() or @InternalOnly(). Runs before validation, so unauthenticated callers learn nothing
 * about a route's inputs.
 *
 * - Authentication not configured (AUTH_JWT_SECRET / AUTH_OTP_PEPPER missing): 503.
 * - Header missing, not Bearer, or token invalid, expired, wrongly signed or with the wrong
 *   algorithm, issuer or audience: 401, always with the same message.
 *
 * On success only {userId, role, sessionId} is attached to the request: no database query, no
 * user row, no financial data. The header and the token are never logged.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AuthPolicy | undefined>(AUTH_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (policy === "public" || policy === "internal") {
      return true;
    }
    if (!this.tokens.enabled) {
      throw authenticationNotConfigured();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match = typeof header === "string" ? BEARER.exec(header) : null;
    const identity = match?.[1] === undefined ? null : await this.tokens.verify(match[1]);
    if (identity === null) {
      http.getResponse<ServerResponse>().setHeader("WWW-Authenticate", "Bearer");
      throw new ApiException(
        apiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Missing or invalid access token"),
      );
    }
    request[AUTH_CONTEXT] = identity;
    return true;
  }
}

/**
 * Global guard for @Roles(...): the role comes from the verified token only (it was read from the
 * database when the token was issued), never from the request. A missing role answers 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) {
      return true;
    }
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>()[AUTH_CONTEXT];
    if (auth === undefined) {
      // A role-restricted route that is not authenticated is a programming error: fail closed.
      throw new ApiException(
        apiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Missing or invalid access token"),
      );
    }
    if (!roles.includes(auth.role)) {
      throw new ApiException(
        apiError(
          HttpStatus.FORBIDDEN,
          "FORBIDDEN",
          "You do not have permission to perform this action",
        ),
      );
    }
    return true;
  }
}

export function authenticationNotConfigured(): ApiException {
  return new ApiException(
    apiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      "SERVICE_UNAVAILABLE",
      "Authentication is not configured",
    ),
  );
}
