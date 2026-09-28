import type { IncomingMessage } from "node:http";

import type { UserRole } from "@finvoice/contracts";

/**
 * The verified identity of the caller, from a valid access token. Deliberately minimal: no user
 * row, no phone number, no financial data. Never built from request input.
 */
export type AuthenticatedUser = {
  readonly userId: string;
  readonly role: UserRole;
  readonly sessionId: string;
};

/** Where the access-token guard puts the verified identity on the request. */
export const AUTH_CONTEXT = Symbol("finvoice.auth");

export type AuthenticatedRequest = IncomingMessage & {
  [AUTH_CONTEXT]?: AuthenticatedUser;
  params?: Record<string, string | undefined>;
};

/** JWT issuer and audience (fixed, not configurable). */
export const JWT_ISSUER = "finvoice-api";
export const JWT_AUDIENCE = "finvoice";
/** The only accepted signing algorithm. Clients cannot choose another one. */
export const JWT_ALGORITHM = "HS256";
