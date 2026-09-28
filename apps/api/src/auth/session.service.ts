import { randomUUID } from "node:crypto";

import type { ApiConfig } from "@finvoice/config";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { API_CONFIG } from "../config/api-config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { User } from "../generated/prisma/client.js";
import { generateRefreshToken, hashRefreshToken, isRefreshTokenShaped } from "./auth-crypto.js";

const DAY_MS = 86_400_000;

export type IssuedSession = {
  sessionId: string;
  /** The raw refresh token: goes into the HttpOnly cookie only. Never logged or stored. */
  refreshToken: string;
  expiresAt: Date;
};

/** Why a refresh was refused. Internal only: every reason answers the same 401. */
export type RefreshFailure = "invalid" | "expired" | "reused" | "inactive";

export type RefreshResult =
  { ok: true; session: IssuedSession; user: User } | { ok: false; reason: RefreshFailure };

/**
 * Refresh sessions (auth_sessions): one row per refresh token. Only the SHA-256 of a token is
 * stored.
 *
 * Rotation: every refresh revokes the presented session and creates its successor in the same
 * token family, so each refresh token works exactly once. Presenting a token whose session is
 * already revoked (rotated, or logged out) means it was copied: the whole family is revoked and
 * the caller, legitimate or not, must sign in again.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.ttlMs = config.auth.refreshTokenTtlDays * DAY_MS;
  }

  get ttlSeconds(): number {
    return this.ttlMs / 1000;
  }

  /** A new session in a new token family (a sign-in). Other sessions of the user are untouched. */
  async start(userId: string, now: Date = new Date()): Promise<IssuedSession> {
    return this.create(this.prisma, userId, randomUUID(), now);
  }

  /** Rotates a refresh token. Never throws for bad input: every failure is a RefreshResult. */
  async refresh(refreshToken: string, now: Date = new Date()): Promise<RefreshResult> {
    if (!isRefreshTokenShaped(refreshToken)) {
      return { ok: false, reason: "invalid" };
    }
    const current = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (current === null) {
      return { ok: false, reason: "invalid" };
    }
    if (current.revokedAt !== null) {
      await this.revokeFamily(current.tokenFamilyId, now);
      this.logger.warn("Refresh token reuse detected: token family revoked");
      return { ok: false, reason: "reused" };
    }
    if (current.expiresAt <= now) {
      return { ok: false, reason: "expired" };
    }
    if (current.user.status !== "ACTIVE") {
      await this.revokeFamily(current.tokenFamilyId, now);
      return { ok: false, reason: "inactive" };
    }

    const next = await this.prisma.$transaction(async (tx) => {
      const successor = await this.create(tx, current.userId, current.tokenFamilyId, now);
      // Conditional: of two concurrent refreshes with the same token only one can revoke it; the
      // other matches nothing (PostgreSQL re-checks the row after the first commits).
      const { count } = await tx.authSession.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now, replacedBySessionId: successor.sessionId },
      });
      // Rolls the successor back.
      return count === 1 ? successor : null;
    });
    if (next === null) {
      // The token was used twice at the same moment: treated as reuse.
      await this.revokeFamily(current.tokenFamilyId, now);
      this.logger.warn("Concurrent refresh token use detected: token family revoked");
      return { ok: false, reason: "reused" };
    }
    return { ok: true, session: next, user: current.user };
  }

  /**
   * Logout: revokes the session's whole token family (this device's sign-in, including any
   * rotated successors). Other devices' sessions stay valid. Idempotent.
   */
  async revokeSessionFamily(sessionId: string, now: Date = new Date()): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { tokenFamilyId: true },
    });
    if (session !== null) {
      await this.revokeFamily(session.tokenFamilyId, now);
    }
  }

  private async revokeFamily(tokenFamilyId: string, now: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { tokenFamilyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private async create(
    client: Pick<PrismaService, "authSession">,
    userId: string,
    tokenFamilyId: string,
    now: Date,
  ): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const session = await client.authSession.create({
      data: {
        userId,
        tokenFamilyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        createdAt: now,
      },
      select: { id: true },
    });
    return { sessionId: session.id, refreshToken, expiresAt };
  }
}
