import { createHash, randomBytes } from "node:crypto";

/**
 * Cryptographic building blocks of authentication. Everything here uses Node's CSPRNG
 * (crypto.randomBytes), never Math.random.
 */

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
