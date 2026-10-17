import { z } from "zod";

import { displayNameSchema, languageSchema, type Language, type UserStatus } from "./users.js";

/**
 * Contracts of guest authentication: /api/v1/auth/*. See
 * docs/architecture/authentication-authorization.md.
 *
 * There are no phone numbers, codes or passwords. Starting a guest session creates a new account
 * from a preferred language (and an optional name) and signs it in; the account is reachable only
 * through that browser's refresh cookie, and logging out deletes it.
 *
 * The client never chooses its identity, role, status or session: every schema is strict, so
 * fields such as `role`, `status`, `userId`, `sessionId`, `accessToken` or `refreshToken` are
 * rejected (400), not ignored.
 */

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const startGuestSessionRequestSchema = z.strictObject({
  preferredLanguage: languageSchema,
  displayName: displayNameSchema.optional(),
});
export type StartGuestSessionRequest = z.input<typeof startGuestSessionRequestSchema>;
export type StartGuestSessionCommand = z.output<typeof startGuestSessionRequestSchema>;

/** Minimal identity of the signed-in user: no financial data. */
export type AuthUser = {
  id: string;
  preferredLanguage: Language;
  timezone: string;
  role: UserRole;
};

/**
 * Returned by guest and refresh. The refresh token is NOT in the body: it is set as an HttpOnly
 * cookie (AUTH_REFRESH_COOKIE_NAME, Path=/api/v1/auth).
 */
export type AuthTokenResponse = {
  accessToken: string;
  tokenType: "Bearer";
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUser;
};

export type AuthMeResponse = AuthUser & { status: UserStatus };

/**
 * The exact `message` of each authentication error, shared so clients can react to them without
 * copying strings.
 */
export const AUTH_ERROR_MESSAGES = {
  /** 401 from /auth/me: the account no longer exists or may not sign in. */
  authenticationFailed: "Authentication failed",
  /** 401 from refresh: missing, unknown, expired, reused or revoked refresh token. */
  invalidRefreshToken: "Invalid or expired refresh token",
  /** 401 from any protected route: missing or invalid access token. */
  invalidAccessToken: "Missing or invalid access token",
  /** 429 from guest: too many accounts were created recently (all clients together). */
  tooManyGuestSessions: "FinVoice is busy. Try again in a minute.",
  /** 503 from sign-in and protected routes: the auth secret is not configured. */
  notConfigured: "Authentication is not configured",
} as const;
