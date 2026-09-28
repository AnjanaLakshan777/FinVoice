import type { UserRole } from "@finvoice/contracts";
import {
  applyDecorators,
  createParamDecorator,
  HttpStatus,
  SetMetadata,
  UseGuards,
  type ExecutionContext,
} from "@nestjs/common";

import { ApiException, apiError } from "../common/api.exception.js";
import { InternalTokenGuard } from "../common/internal-token.guard.js";
import { AUTH_CONTEXT, type AuthenticatedRequest, type AuthenticatedUser } from "./auth.types.js";
import { OwnerGuard } from "./owner.guard.js";

/**
 * Every route requires a valid access token unless it says otherwise (secure by default: a new
 * controller cannot be public by accident). The two exceptions:
 * - "public": no credentials at all (health, calculations, knowledge, the general agent,
 *   ScamShield, sign-in and refresh).
 * - "internal": no end-user token, but the service-to-service INTERNAL_API_TOKEN instead.
 */
export const AUTH_POLICY = "finvoice:auth-policy";
export type AuthPolicy = "public" | "internal";

/** Route or controller reachable without credentials. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_POLICY, "public" satisfies AuthPolicy);

/**
 * Route or controller for trusted FinVoice services only (the voice gateway, the web server):
 * protected by INTERNAL_API_TOKEN, never by an end-user token. The two trust domains stay
 * separate: an access token does not open internal routes, and the internal token is not a user.
 */
export const InternalOnly = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(AUTH_POLICY, "internal" satisfies AuthPolicy),
    UseGuards(InternalTokenGuard),
  );

export const ROLES = "finvoice:roles";

/** Only callers with one of these roles (from the verified token) may use the route; others get 403. */
export const Roles = (...roles: [UserRole, ...UserRole[]]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES, roles);

/**
 * For routes under /users/:userId: the caller may only use their own user id. Another user's id
 * answers 404 "User not found", exactly like a user that does not exist, so ids of other accounts
 * cannot be probed. There is no role exception: ADMIN has no access to other users' data here.
 */
export const OwnUserOnly = (): MethodDecorator & ClassDecorator => UseGuards(OwnerGuard);

/** The verified identity of the caller (set by the access-token guard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>()[AUTH_CONTEXT];
    if (auth === undefined) {
      // Only reachable if a public route asks for the current user: fail closed.
      throw new ApiException(
        apiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required"),
      );
    }
    return auth;
  },
);
