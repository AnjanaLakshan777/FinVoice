import { z } from "zod";

import { booleanFlagSchema, optionalSecretSchema } from "./env.js";

/**
 * Authentication settings: guest accounts, JWT access tokens and rotating refresh sessions.
 * See docs/architecture/authentication-authorization.md.
 */

/**
 * Minimum length of AUTH_JWT_SECRET: 43 characters is 32 random bytes in base64url (256 bits).
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 */
export const AUTH_SECRET_MIN_LENGTH = 43;

export const DEFAULT_AUTH = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  guestSessionLimit: 30,
  guestSessionWindowSeconds: 60,
  refreshCookieName: "finvoice_refresh",
} as const;

const authSecretSchema = optionalSecretSchema.refine(
  (value) => value === null || value.length >= AUTH_SECRET_MIN_LENGTH,
  {
    error: `Must be at least ${String(AUTH_SECRET_MIN_LENGTH)} characters (32 random bytes, base64url)`,
  },
);

const whole = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

export const authEnvShape = {
  /** HS256 signing key for access tokens. Server-side only; required in production. */
  AUTH_JWT_SECRET: authSecretSchema,
  AUTH_ACCESS_TOKEN_TTL_SECONDS: whole(60, 3600, DEFAULT_AUTH.accessTokenTtlSeconds),
  AUTH_REFRESH_TOKEN_TTL_DAYS: whole(1, 90, DEFAULT_AUTH.refreshTokenTtlDays),
  /**
   * At most this many guest accounts may be created per AUTH_GUEST_SESSION_WINDOW_SECONDS, by all
   * clients together (there are no phone numbers or IP addresses to limit by).
   */
  AUTH_GUEST_SESSION_LIMIT: whole(1, 10_000, DEFAULT_AUTH.guestSessionLimit),
  AUTH_GUEST_SESSION_WINDOW_SECONDS: whole(10, 3600, DEFAULT_AUTH.guestSessionWindowSeconds),
  AUTH_REFRESH_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, { error: "Must be 1-64 letters, digits, _ or -" })
    .default(DEFAULT_AUTH.refreshCookieName),
  /**
   * Secure cookie attribute. Unset or empty: true in production, false otherwise. false is
   * rejected in production.
   */
  AUTH_REFRESH_COOKIE_SECURE: z
    .literal("")
    .transform(() => undefined)
    .or(booleanFlagSchema)
    .optional(),
};

type AuthEnv = {
  NODE_ENV: "development" | "test" | "production";
  AUTH_JWT_SECRET: string | null;
  AUTH_REFRESH_COOKIE_SECURE?: boolean | undefined;
  INTERNAL_API_TOKEN: string | null;
};

/**
 * Cross-field rules. Errors name the variable only, never its value.
 * - Production: the JWT secret is required; the refresh cookie must be Secure.
 * - Always: the JWT secret and the internal service token must be different (separate trust
 *   domains).
 */
export function checkAuthEnv(env: AuthEnv, context: z.RefinementCtx): void {
  const issue = (path: string, message: string): void => {
    context.addIssue({ code: "custom", path: [path], message });
  };
  if (env.NODE_ENV === "production") {
    if (env.AUTH_JWT_SECRET === null) {
      issue("AUTH_JWT_SECRET", "Required in production");
    }
    if (env.AUTH_REFRESH_COOKIE_SECURE === false) {
      issue("AUTH_REFRESH_COOKIE_SECURE", "Must be true in production");
    }
  }
  if (env.AUTH_JWT_SECRET !== null && env.AUTH_JWT_SECRET === env.INTERNAL_API_TOKEN) {
    issue("INTERNAL_API_TOKEN", "Must be different from AUTH_JWT_SECRET");
  }
}

export type AuthConfig = {
  /** False when the JWT secret is missing: sign-in and protected routes then answer 503. */
  enabled: boolean;
  /** HS256 key. Null when not configured. Never log. */
  jwtSecret: string | null;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  guest: {
    /** Guest accounts that may be created per window, by all clients together. */
    limit: number;
    windowSeconds: number;
  };
  refreshCookie: { name: string; secure: boolean };
};

export function toAuthConfig(
  env: AuthEnv & {
    AUTH_ACCESS_TOKEN_TTL_SECONDS: number;
    AUTH_REFRESH_TOKEN_TTL_DAYS: number;
    AUTH_GUEST_SESSION_LIMIT: number;
    AUTH_GUEST_SESSION_WINDOW_SECONDS: number;
    AUTH_REFRESH_COOKIE_NAME: string;
  },
): AuthConfig {
  return {
    enabled: env.AUTH_JWT_SECRET !== null,
    jwtSecret: env.AUTH_JWT_SECRET,
    accessTokenTtlSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: env.AUTH_REFRESH_TOKEN_TTL_DAYS,
    guest: {
      limit: env.AUTH_GUEST_SESSION_LIMIT,
      windowSeconds: env.AUTH_GUEST_SESSION_WINDOW_SECONDS,
    },
    refreshCookie: {
      name: env.AUTH_REFRESH_COOKIE_NAME,
      secure: env.AUTH_REFRESH_COOKIE_SECURE ?? env.NODE_ENV === "production",
    },
  };
}
