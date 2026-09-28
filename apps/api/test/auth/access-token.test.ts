import { randomBytes, randomUUID } from "node:crypto";

import type { ApiConfig } from "@finvoice/config";
import { decodeJwt, decodeProtectedHeader, SignJWT, UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";

import { AccessTokenService } from "../../src/auth/access-token.service.js";
import { disabledAuthConfig, testAuthConfig } from "../support/auth.js";

function serviceWith(auth = testAuthConfig()): AccessTokenService {
  return new AccessTokenService({ auth } as ApiConfig);
}

const auth = testAuthConfig();
const tokens = serviceWith(auth);
const key = new TextEncoder().encode(auth.jwtSecret ?? "");
const identity = { userId: randomUUID(), role: "USER" as const, sessionId: randomUUID() };

type CraftOptions = {
  secret?: Uint8Array;
  alg?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  issuedAt?: number;
  claims?: Record<string, unknown>;
  /** null: no sub claim. */
  subject?: string | null;
};

/** A token like the real ones, with one thing changed. */
function craft({
  secret = key,
  alg = "HS256",
  issuer = "finvoice-api",
  audience = "finvoice",
  expiresIn = "15m",
  issuedAt = Math.floor(Date.now() / 1000),
  claims = { role: "USER", sid: identity.sessionId },
  subject = identity.userId,
}: CraftOptions = {}): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresIn);
  if (subject !== null) {
    jwt = jwt.setSubject(subject);
  }
  return jwt.sign(secret);
}

describe("access tokens", () => {
  it("round-trips a valid token to the minimal identity", async () => {
    const token = await tokens.issue(identity);

    await expect(tokens.verify(token)).resolves.toEqual(identity);
  });

  it("contains only the intended claims, signed with HS256 (checked after verification)", async () => {
    const token = await tokens.issue({ ...identity, role: "ADMIN" });
    expect(await tokens.verify(token)).not.toBeNull();

    // Decoding here only inspects a token that was just verified above.
    const claims = decodeJwt(token);
    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "jti", "role", "sid", "sub"].sort(),
    );
    expect(claims).toMatchObject({
      sub: identity.userId,
      sid: identity.sessionId,
      role: "ADMIN",
      iss: "finvoice-api",
      aud: "finvoice",
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(900);
    expect(decodeProtectedHeader(token)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(token.length).toBeLessThan(400);
  });

  it("issues a unique jti per token", async () => {
    const first = decodeJwt(await tokens.issue(identity)).jti;
    const second = decodeJwt(await tokens.issue(identity)).jti;

    expect(first).not.toBe(second);
  });

  it("accepts a token crafted exactly like the real ones (test sanity check)", async () => {
    expect(await tokens.verify(await craft())).toEqual(identity);
  });

  it.each([
    ["an expired token", { expiresIn: "-1s" }],
    ["an invalid signature (another secret)", { secret: randomBytes(32) }],
    ["the wrong issuer", { issuer: "someone-else" }],
    ["the wrong audience", { audience: "another-app" }],
    ["another HMAC algorithm (HS512)", { alg: "HS512" }],
    ["a missing sub claim", { subject: null }],
    ["a sub that is not a UUID", { subject: "admin" }],
    ["an unknown role", { claims: { role: "SUPERUSER", sid: identity.sessionId } }],
    ["a missing role", { claims: { sid: identity.sessionId } }],
    ["a missing session id", { claims: { role: "USER" } }],
  ])("rejects %s", async (_case, changes) => {
    expect(await tokens.verify(await craft(changes))).toBeNull();
  });

  it('rejects an unsigned token (alg "none")', async () => {
    const unsecured = new UnsecuredJWT({ role: "ADMIN", sid: identity.sessionId })
      .setSubject(identity.userId)
      .setIssuer("finvoice-api")
      .setAudience("finvoice")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime("15m")
      .encode();

    expect(await tokens.verify(unsecured)).toBeNull();
  });

  it("rejects a valid token whose payload was altered (role escalation)", async () => {
    const [header, payload, signature] = (await tokens.issue(identity)).split(".");
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as object;
    const forged = Buffer.from(JSON.stringify({ ...claims, role: "ADMIN" })).toString("base64url");

    expect(await tokens.verify(`${header ?? ""}.${forged}.${signature ?? ""}`)).toBeNull();
  });

  it.each(["", "not-a-jwt", "a.b.c", "a.b", "....", "Bearer x"])(
    "rejects the malformed token %j without throwing",
    async (token) => {
      expect(await tokens.verify(token)).toBeNull();
    },
  );

  it("accepts no token at all when authentication is not configured", async () => {
    const disabled = serviceWith(disabledAuthConfig());

    expect(disabled.enabled).toBe(false);
    expect(await disabled.verify(await craft())).toBeNull();
    await expect(disabled.issue(identity)).rejects.toThrow("AUTH_JWT_SECRET is not configured");
  });

  it("does not accept tokens of another deployment (different secret)", async () => {
    const other = serviceWith(testAuthConfig());

    expect(await other.verify(await tokens.issue(identity))).toBeNull();
  });
});
