import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  generateRefreshToken,
  hashRefreshToken,
  isRefreshTokenShaped,
} from "../../src/auth/auth-crypto.js";

describe("randomness", () => {
  it("never uses Math.random anywhere in the auth module", () => {
    const directory = fileURLToPath(new URL("../../src/auth", import.meta.url));
    for (const file of readdirSync(directory)) {
      expect(readFileSync(join(directory, file), "utf8"), file).not.toMatch(/Math\.random\s*\(/u);
    }
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
