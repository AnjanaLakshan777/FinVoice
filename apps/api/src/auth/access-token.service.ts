import { randomUUID } from "node:crypto";

import type { ApiConfig } from "@finvoice/config";
import { USER_ROLES, uuidSchema, type UserRole } from "@finvoice/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";

import { API_CONFIG } from "../config/api-config.module.js";
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, type AuthenticatedUser } from "./auth.types.js";

/**
 * Short-lived JWT access tokens (HS256, AUTH_JWT_SECRET). Claims: sub (user id), role, sid (auth
 * session id), iss, aud, jti, iat, exp. Nothing personal: no phone number, profile or financial
 * data.
 *
 * Verification always checks the signature with the fixed algorithm (jwtVerify with
 * algorithms: ["HS256"]; "none" and every other algorithm are rejected), the issuer, the audience,
 * the expiry and the claim types. Tokens are never merely decoded.
 */
@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array | null;
  readonly ttlSeconds: number;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    // Authentication is all-or-nothing: without both secrets no token is issued or accepted.
    this.key =
      config.auth.enabled && config.auth.jwtSecret !== null
        ? new TextEncoder().encode(config.auth.jwtSecret)
        : null;
    this.ttlSeconds = config.auth.accessTokenTtlSeconds;
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  async issue(identity: AuthenticatedUser): Promise<string> {
    return new SignJWT({ role: identity.role, sid: identity.sessionId })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setSubject(identity.userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${String(this.ttlSeconds)}s`)
      .sign(this.requireKey());
  }

  /** The verified identity, or null for any invalid, expired or malformed token. Never throws. */
  async verify(token: string): Promise<AuthenticatedUser | null> {
    if (this.key === null) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        requiredClaims: ["sub", "sid", "role", "jti", "iat", "exp"],
      });
      const sub = uuidSchema.safeParse(payload.sub);
      const sid = uuidSchema.safeParse(payload.sid);
      const { role } = payload;
      if (!sub.success || !sid.success || !isUserRole(role)) {
        return null;
      }
      return { userId: sub.data, role, sessionId: sid.data };
    } catch {
      return null;
    }
  }

  private requireKey(): Uint8Array {
    if (this.key === null) {
      throw new Error("AUTH_JWT_SECRET is not configured");
    }
    return this.key;
  }
}

function isUserRole(value: unknown): value is UserRole {
  return (USER_ROLES as readonly unknown[]).includes(value);
}
