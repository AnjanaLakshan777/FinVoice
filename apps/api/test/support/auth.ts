import { randomBytes, randomInt } from "node:crypto";

import { DEFAULT_AUTH, type AuthConfig } from "@finvoice/config";

/**
 * Authentication settings for tests. The secrets and the development OTP code are generated
 * randomly in the test process every time: nothing is committed, and nothing is ever printed.
 */
export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    enabled: true,
    jwtSecret: randomBytes(32).toString("base64url"),
    otpPepper: randomBytes(32).toString("base64url"),
    accessTokenTtlSeconds: DEFAULT_AUTH.accessTokenTtlSeconds,
    refreshTokenTtlDays: DEFAULT_AUTH.refreshTokenTtlDays,
    otp: {
      ttlSeconds: DEFAULT_AUTH.otpTtlSeconds,
      maxAttempts: DEFAULT_AUTH.otpMaxAttempts,
      requestLimit: DEFAULT_AUTH.otpRequestLimit,
      requestWindowSeconds: DEFAULT_AUTH.otpRequestWindowSeconds,
      provider: "dev",
      devCode: randomOtpCode(),
    },
    refreshCookie: { name: DEFAULT_AUTH.refreshCookieName, secure: false },
    ...overrides,
  };
}

/** Authentication switched off (no secrets): sign-in and protected routes answer 503. */
export function disabledAuthConfig(): AuthConfig {
  return testAuthConfig({
    enabled: false,
    jwtSecret: null,
    otpPepper: null,
    otp: { ...testAuthConfig().otp, provider: null, devCode: null },
  });
}

export function randomOtpCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

/** A different valid 8-digit code. */
export function wrongOtpCode(code: string): string {
  return String((Number(code) + 1) % 100_000_000).padStart(8, "0");
}
