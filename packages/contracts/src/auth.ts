import { z } from "zod";

import { uuidSchema } from "./common.js";
import {
  displayNameSchema,
  languageSchema,
  phoneNumberSchema,
  type Language,
  type UserStatus,
} from "./users.js";

/**
 * Contracts of phone-OTP authentication (Step 11): /api/v1/auth/*. See
 * docs/architecture/authentication-authorization.md.
 *
 * The client never chooses its identity, role, status or session: every schema is strict, so
 * fields such as `role`, `status`, `userId`, `sessionId`, `accessToken` or `refreshToken` are
 * rejected (400), not ignored.
 */

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** OTP codes are exactly 8 digits. */
export const OTP_CODE_LENGTH = 8;

export const requestOtpRequestSchema = z.strictObject({ phoneNumber: phoneNumberSchema });
export type RequestOtpRequest = z.output<typeof requestOtpRequestSchema>;

/** The same answer whether or not the number has an account (no account enumeration). */
export const REQUEST_OTP_MESSAGE =
  "If this number can be authenticated, a verification code has been requested.";

export type RequestOtpResponse = {
  /** Identifies the challenge to verify. Not a secret, and not a credential on its own. */
  challengeId: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  message: typeof REQUEST_OTP_MESSAGE;
};

export const verifyOtpRequestSchema = z.strictObject({
  challengeId: uuidSchema,
  code: z.string({ error: "Must be a string" }).regex(/^[0-9]{8}$/, {
    error: "Must be exactly 8 digits",
  }),
  /** Used only when this sign-in creates the account; ignored for an existing user. */
  displayName: displayNameSchema.optional(),
  /** Used only when this sign-in creates the account (default EN); ignored for an existing user. */
  preferredLanguage: languageSchema.optional(),
});
export type VerifyOtpRequest = z.input<typeof verifyOtpRequestSchema>;
export type VerifyOtpCommand = z.output<typeof verifyOtpRequestSchema>;

/** Minimal identity of the signed-in user: no phone number, no financial data. */
export type AuthUser = {
  id: string;
  preferredLanguage: Language;
  timezone: string;
  role: UserRole;
};

/**
 * Returned by verify-otp and refresh. The refresh token is NOT in the body: it is set as an
 * HttpOnly cookie (AUTH_REFRESH_COOKIE_NAME, Path=/api/v1/auth).
 */
export type AuthTokenResponse = {
  accessToken: string;
  tokenType: "Bearer";
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUser;
};

export type AuthMeResponse = AuthUser & { status: UserStatus };
