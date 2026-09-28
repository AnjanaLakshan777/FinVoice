import { uuidSchema } from "@finvoice/contracts";
import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";

import { ApiException } from "../common/api.exception.js";
import { AUTH_CONTEXT, type AuthenticatedRequest } from "./auth.types.js";

/**
 * Owner check for /users/:userId/... routes: the route's user id must be the caller's own (JWT
 * sub). Otherwise 404 "User not found", the same answer as for a user that does not exist, so a
 * caller cannot tell another account's id from a random one. Malformed ids are left to the
 * validation pipe (400), which reveals nothing either.
 *
 * Runs after the global access-token guard, so the identity is always the verified one; the route
 * parameter only selects a resource, it never establishes who the caller is.
 */
@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request[AUTH_CONTEXT];
    const routeUserId = request.params?.userId;
    if (auth === undefined) {
      throw ApiException.notFound("User not found");
    }
    if (routeUserId === undefined || !uuidSchema.safeParse(routeUserId).success) {
      // No user id in the route (e.g. POST /users), or a malformed one: validation decides.
      return true;
    }
    // UUIDs are case-insensitive (PostgreSQL compares them as values).
    if (routeUserId.toLowerCase() !== auth.userId.toLowerCase()) {
      throw ApiException.notFound("User not found");
    }
    return true;
  }
}
