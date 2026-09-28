import { z } from "zod";

import { booleanFlagSchema, optionalSecretSchema, type RawEnv } from "./env.js";

/**
 * Authentication settings (Step 11): phone OTP, JWT access tokens and rotating refresh sessions.
 * See docs/architecture/authentication-authorization.md.
 */

/**
 * Minimum length of AUTH_JWT_SECRET and AUTH_OTP_PEPPER: 43 characters is 32 random bytes in
 * base64url (256 bits). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 */
export const AUTH_SECRET_MIN_LENGTH = 43;

export const DEFAULT_AUTH = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  otpTtlSeconds: 300,
  otpMaxAttempts: 5,
  otpRequestLimit: 3,
  otpRequestWindowSeconds: 900,
  refreshCookieName: "finvoice_refresh",
} as const;

/** OTP delivery providers. Only the local development provider exists; a real SMS one is future work. */
export const OTP_PROVIDERS = ["dev"] as const;
export type OtpProviderName = (typeof OTP_PROVIDERS)[number];

/**
 * The ONLY values of NODE_ENV under which the development OTP provider (and its fixed code) may
 * be used. An allowlist, not a denylist: production, staging, preview, an unset NODE_ENV and any
 * other value are all refused.
 */
export const DEV_OTP_PROVIDER_ENVIRONMENTS = ["development", "test"] as const;

/** True only for an exact allowed NODE_ENV value (no trimming, no case folding, no default). */
export function isDevOtpProviderEnvironment(nodeEnv: unknown): boolean {
  return (
    typeof nodeEnv === "string" &&
    (DEV_OTP_PROVIDER_ENVIRONMENTS as readonly string[]).includes(nodeEnv)
  );
}

const DEV_ONLY_MESSAGE = `Allowed only when NODE_ENV is explicitly ${DEV_OTP_PROVIDER_ENVIRONMENTS.join(" or ")}`;

/**
 * Checks the RAW environment, before parsing, so the rule cannot be bypassed by NODE_ENV being
 * unset (which the schema would default to "development") or by a value the schema rejects for
 * another reason. Returns issues in the same format as the schema errors, naming variables only,
 * never values.
 */
export function devOtpProviderEnvIssues(env: RawEnv): string[] {
  if (isDevOtpProviderEnvironment(env.NODE_ENV)) {
    return [];
  }
  const issues: string[] = [];
  // Any spelling of "dev" counts as an attempt to use it.
  if (env.AUTH_OTP_PROVIDER?.trim().toLowerCase() === "dev") {
    issues.push(`✖ ${DEV_ONLY_MESSAGE}\n  → at AUTH_OTP_PROVIDER`);
  }
  if ((env.AUTH_OTP_DEV_CODE?.trim() ?? "") !== "") {
    issues.push(`✖ ${DEV_ONLY_MESSAGE}\n  → at AUTH_OTP_DEV_CODE`);
  }
  return issues;
}

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
  /** Secret pepper for OTP hashes. Server-side only; required in production. */
  AUTH_OTP_PEPPER: authSecretSchema,
  AUTH_ACCESS_TOKEN_TTL_SECONDS: whole(60, 3600, DEFAULT_AUTH.accessTokenTtlSeconds),
  AUTH_REFRESH_TOKEN_TTL_DAYS: whole(1, 90, DEFAULT_AUTH.refreshTokenTtlDays),
  AUTH_OTP_TTL_SECONDS: whole(60, 1800, DEFAULT_AUTH.otpTtlSeconds),
  AUTH_OTP_MAX_ATTEMPTS: whole(1, 10, DEFAULT_AUTH.otpMaxAttempts),
  AUTH_OTP_REQUEST_LIMIT: whole(1, 20, DEFAULT_AUTH.otpRequestLimit),
  AUTH_OTP_REQUEST_WINDOW_SECONDS: whole(60, 86_400, DEFAULT_AUTH.otpRequestWindowSeconds),
  /**
   * Empty or unset: no OTP delivery (sign-in answers 503). "dev": development and test only (see
   * DEV_OTP_PROVIDER_ENVIRONMENTS).
   */
  AUTH_OTP_PROVIDER: z
    .enum([...OTP_PROVIDERS, ""], { error: `Must be one of: ${OTP_PROVIDERS.join(", ")}` })
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value)),
  /** The fixed 8-digit code of the development provider. Development and test only. */
  AUTH_OTP_DEV_CODE: optionalSecretSchema.refine(
    (value) => value === null || /^\d{8}$/.test(value),
    {
      error: "Must be exactly 8 digits",
    },
  ),
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
  AUTH_OTP_PEPPER: string | null;
  AUTH_OTP_PROVIDER: OtpProviderName | null;
  AUTH_OTP_DEV_CODE: string | null;
  AUTH_REFRESH_COOKIE_SECURE?: boolean | undefined;
  INTERNAL_API_TOKEN: string | null;
};

/**
 * Cross-field rules. Errors name the variable only, never its value.
 * - Production: both secrets required; the refresh cookie must be Secure.
 * - Outside development and test (allowlist): the development OTP provider and code rejected.
 *   {@link devOtpProviderEnvIssues} applies the same rule to the raw environment first.
 * - Always: the development provider needs its code; the JWT secret, the OTP pepper and the
 *   internal service token must all be different (separate trust domains).
 */
export function checkAuthEnv(env: AuthEnv, context: z.RefinementCtx): void {
  const issue = (path: string, message: string): void => {
    context.addIssue({ code: "custom", path: [path], message });
  };
  if (!isDevOtpProviderEnvironment(env.NODE_ENV)) {
    if (env.AUTH_OTP_PROVIDER === "dev") {
      issue("AUTH_OTP_PROVIDER", DEV_ONLY_MESSAGE);
    }
    if (env.AUTH_OTP_DEV_CODE !== null) {
      issue("AUTH_OTP_DEV_CODE", DEV_ONLY_MESSAGE);
    }
  }
  if (env.NODE_ENV === "production") {
    if (env.AUTH_JWT_SECRET === null) {
      issue("AUTH_JWT_SECRET", "Required in production");
    }
    if (env.AUTH_OTP_PEPPER === null) {
      issue("AUTH_OTP_PEPPER", "Required in production");
    }
    if (env.AUTH_REFRESH_COOKIE_SECURE === false) {
      issue("AUTH_REFRESH_COOKIE_SECURE", "Must be true in production");
    }
  }
  if (env.AUTH_OTP_PROVIDER === "dev" && env.AUTH_OTP_DEV_CODE === null) {
    issue("AUTH_OTP_DEV_CODE", "Required when AUTH_OTP_PROVIDER is dev");
  }
  const secrets = [
    ["AUTH_JWT_SECRET", env.AUTH_JWT_SECRET],
    ["AUTH_OTP_PEPPER", env.AUTH_OTP_PEPPER],
    ["INTERNAL_API_TOKEN", env.INTERNAL_API_TOKEN],
  ] as const;
  for (const [index, [name, value]] of secrets.entries()) {
    const earlier = secrets.slice(0, index).find(([, other]) => value !== null && other === value);
    if (earlier) {
      issue(name, `Must be different from ${earlier[0]}`);
    }
  }
}

export type AuthConfig = {
  /** False when either secret is missing: sign-in and protected routes then answer 503. */
  enabled: boolean;
  /** HS256 key. Null when not configured. Never log. */
  jwtSecret: string | null;
  /** OTP hash pepper. Null when not configured. Never log. */
  otpPepper: string | null;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  otp: {
    ttlSeconds: number;
    maxAttempts: number;
    requestLimit: number;
    requestWindowSeconds: number;
    /** Null: no delivery provider configured. */
    provider: OtpProviderName | null;
    /** The development provider's fixed code. Never log. */
    devCode: string | null;
  };
  refreshCookie: { name: string; secure: boolean };
};

export function toAuthConfig(
  env: AuthEnv & {
    AUTH_ACCESS_TOKEN_TTL_SECONDS: number;
    AUTH_REFRESH_TOKEN_TTL_DAYS: number;
    AUTH_OTP_TTL_SECONDS: number;
    AUTH_OTP_MAX_ATTEMPTS: number;
    AUTH_OTP_REQUEST_LIMIT: number;
    AUTH_OTP_REQUEST_WINDOW_SECONDS: number;
    AUTH_REFRESH_COOKIE_NAME: string;
  },
): AuthConfig {
  return {
    enabled: env.AUTH_JWT_SECRET !== null && env.AUTH_OTP_PEPPER !== null,
    jwtSecret: env.AUTH_JWT_SECRET,
    otpPepper: env.AUTH_OTP_PEPPER,
    accessTokenTtlSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: env.AUTH_REFRESH_TOKEN_TTL_DAYS,
    otp: {
      ttlSeconds: env.AUTH_OTP_TTL_SECONDS,
      maxAttempts: env.AUTH_OTP_MAX_ATTEMPTS,
      requestLimit: env.AUTH_OTP_REQUEST_LIMIT,
      requestWindowSeconds: env.AUTH_OTP_REQUEST_WINDOW_SECONDS,
      provider: env.AUTH_OTP_PROVIDER,
      devCode: env.AUTH_OTP_DEV_CODE,
    },
    refreshCookie: {
      name: env.AUTH_REFRESH_COOKIE_NAME,
      secure: env.AUTH_REFRESH_COOKIE_SECURE ?? env.NODE_ENV === "production",
    },
  };
}
