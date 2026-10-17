import { randomBytes } from "node:crypto";

import { DEFAULT_AUTH, type AuthConfig } from "@finvoice/config";

/**
 * Authentication settings for tests. The JWT secret is generated randomly in the test process
 * every time: nothing is committed, and nothing is ever printed.
 */
export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    enabled: true,
    jwtSecret: randomBytes(32).toString("base64url"),
    accessTokenTtlSeconds: DEFAULT_AUTH.accessTokenTtlSeconds,
    refreshTokenTtlDays: DEFAULT_AUTH.refreshTokenTtlDays,
    // High enough that ordinary tests never hit it; the rate-limit tests set their own.
    guest: { limit: 10_000, windowSeconds: DEFAULT_AUTH.guestSessionWindowSeconds },
    refreshCookie: { name: DEFAULT_AUTH.refreshCookieName, secure: false },
    ...overrides,
  };
}

/** Authentication switched off (no secret): sign-in and protected routes answer 503. */
export function disabledAuthConfig(): AuthConfig {
  return testAuthConfig({ enabled: false, jwtSecret: null });
}
