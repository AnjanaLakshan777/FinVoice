import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  generateOtpCode,
  generateRefreshToken,
  hashOtp,
  hashRefreshToken,
  isRefreshTokenShaped,
  otpMatches,
} from "../../src/auth/auth-crypto.js";
import {
  DevOtpDeliveryProvider,
  SmsOtpDeliveryProvider,
  type OtpDelivery,
  type OtpDeliveryProvider,
} from "../../src/auth/otp-delivery.js";

const PEPPER = randomBytes(32).toString("base64url");

describe("OTP codes", () => {
  it("are exactly 8 digits, including leading zeros", () => {
    const codes = Array.from({ length: 2000 }, generateOtpCode);

    for (const code of codes) {
      expect(code).toMatch(/^[0-9]{8}$/u);
    }
    // 2000 draws from 10^8: collisions are practically impossible for a uniform generator.
    expect(new Set(codes).size).toBeGreaterThan(1990);
  });

  it("use every digit in every position (no fixed or predictable positions)", () => {
    const seen = Array.from({ length: 8 }, () => new Set<string>());
    for (let index = 0; index < 3000; index += 1) {
      generateOtpCode()
        .split("")
        .forEach((digit, position) => seen[position]?.add(digit));
    }
    for (const digits of seen) {
      expect(digits.size).toBe(10);
    }
  });

  it("are never generated with Math.random anywhere in the auth module", () => {
    const directory = fileURLToPath(new URL("../../src/auth", import.meta.url));
    for (const file of readdirSync(directory)) {
      expect(readFileSync(join(directory, file), "utf8"), file).not.toMatch(/Math\.random\s*\(/u);
    }
  });
});

describe("OTP hashes", () => {
  const challengeId = randomUUID();

  it("are HMAC-SHA-256 hex digests that never contain the code", () => {
    const hash = hashOtp(PEPPER, challengeId, "01234567");

    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(hash).not.toContain("01234567");
    expect(hashOtp(PEPPER, challengeId, "01234567")).toBe(hash);
  });

  it("depend on the pepper, the challenge and the code", () => {
    const hash = hashOtp(PEPPER, challengeId, "01234567");

    expect(hashOtp(randomBytes(32).toString("base64url"), challengeId, "01234567")).not.toBe(hash);
    expect(hashOtp(PEPPER, randomUUID(), "01234567")).not.toBe(hash);
    expect(hashOtp(PEPPER, challengeId, "01234568")).not.toBe(hash);
  });

  it("match only the right code for the right challenge", () => {
    const hash = hashOtp(PEPPER, challengeId, "76543210");

    expect(otpMatches(PEPPER, challengeId, "76543210", hash)).toBe(true);
    expect(otpMatches(PEPPER, challengeId, "76543211", hash)).toBe(false);
    expect(otpMatches(PEPPER, randomUUID(), "76543210", hash)).toBe(false);
    expect(otpMatches(PEPPER, challengeId, "76543210", "not-a-hash")).toBe(false);
  });
});

describe("refresh tokens", () => {
  it("are 256 random bits in base64url, unique, and stored only as SHA-256", () => {
    const tokens = Array.from({ length: 200 }, generateRefreshToken);

    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(isRefreshTokenShaped(token)).toBe(true);
      expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(new Set(tokens).size).toBe(200);
    expect(new Set(tokens.map(hashRefreshToken)).size).toBe(200);
  });

  it.each(["", "short", "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}+`])(
    "rejects the malformed token %j before any database lookup",
    (value) => {
      expect(isRefreshTokenShaped(value)).toBe(false);
    },
  );
});

describe("OTP delivery providers", () => {
  it("the development provider uses the configured code and sends nothing", async () => {
    const provider: OtpDeliveryProvider = new DevOtpDeliveryProvider("24681357");

    expect(provider.createCode()).toBe("24681357");
    await expect(
      provider.deliver({ phoneNumber: "+94000000001", code: "24681357", expiresAt: new Date() }),
    ).resolves.toBeUndefined();
  });

  it("a future SMS provider gets a random code from the shared generator", () => {
    class NullSms extends SmsOtpDeliveryProvider {
      readonly name = "null-sms";
      deliver(delivery: OtpDelivery): Promise<void> {
        expect(delivery.code).toMatch(/^[0-9]{8}$/u);
        return Promise.resolve();
      }
    }
    const provider = new NullSms();
    const codes = new Set(Array.from({ length: 50 }, () => provider.createCode()));

    expect(codes.size).toBeGreaterThan(45);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9]{8}$/u);
    }
  });
});
