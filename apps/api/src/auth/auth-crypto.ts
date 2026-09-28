import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { OTP_CODE_LENGTH } from "@finvoice/contracts";

/**
 * Cryptographic building blocks of authentication. Everything here uses Node's CSPRNG
 * (crypto.randomInt / randomBytes), never Math.random.
 */

const OTP_SPACE = 10 ** OTP_CODE_LENGTH;

/**
 * A uniformly random 8-digit code (00000000–99999999). crypto.randomInt draws without modulo
 * bias, so every code is equally likely: 10^8 possibilities, with at most AUTH_OTP_MAX_ATTEMPTS
 * guesses per challenge.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, OTP_SPACE)).padStart(OTP_CODE_LENGTH, "0");
}

/**
 * The stored form of an OTP: HMAC-SHA-256 keyed with the server-side pepper, over
 * "<challengeId>:<code>". With only 10^8 codes a plain hash could be brute-forced offline from a
 * database copy; the pepper (not in the database) prevents that, and the challenge id makes every
 * hash unique.
 */
export function hashOtp(pepper: string, challengeId: string, code: string): string {
  return createHmac("sha256", pepper).update(`${challengeId}:${code}`, "utf8").digest("hex");
}

/** Constant-time comparison of a submitted code with the stored hash. */
export function otpMatches(
  pepper: string,
  challengeId: string,
  code: string,
  storedHash: string,
): boolean {
  const submitted = Buffer.from(hashOtp(pepper, challengeId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return submitted.length === stored.length && timingSafeEqual(submitted, stored);
}

/** A refresh token: 32 random bytes (256 bits), base64url (43 characters). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The stored form of a refresh token: SHA-256. A 256-bit random token cannot be guessed or
 * brute-forced, so no pepper is needed; the database never holds a usable token.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A syntactically plausible refresh token (base64url of 32 bytes); anything else is rejected early. */
export function isRefreshTokenShaped(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
