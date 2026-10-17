import { randomUUID } from "node:crypto";

import type { ApiConfig } from "@finvoice/config";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { API_CONFIG } from "../config/api-config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { generateRefreshToken, hashRefreshToken, isRefreshTokenShaped } from "./auth-crypto.js";

const DAY_MS = 86_400_000;

/**
 * How long, after a rotation, the immediately previous refresh token may be presented ONCE more.
 * Fixed and deliberately tiny: it only covers browser lifecycle races (a page reloaded or closed
 * while its refresh request is in flight sends the same token again). Not configurable.
 */
export const REFRESH_GRACE_MS = 5_000;

export type IssuedSession = {
  sessionId: string;
  /** The raw refresh token: goes into the HttpOnly cookie only. Never logged or stored. */
  refreshToken: string;
  expiresAt: Date;
};

/** Why a refresh was refused. Internal only: every reason answers the same 401. */
export type RefreshFailure = "invalid" | "expired" | "reused" | "inactive";

export type RefreshResult =
  | { ok: true; session: IssuedSession; user: User; grace: boolean }
  | { ok: false; reason: RefreshFailure };

type Tx = Prisma.TransactionClient;

/**
 * Refresh sessions (auth_sessions): one row per refresh token. Only the SHA-256 of a token is
 * stored.
 *
 * Rotation: every refresh revokes the presented session and creates its successor in the same
 * token family, so each refresh token works once. Presenting a token whose session is already
 * revoked means it was copied: the whole family is revoked and the caller, legitimate or not, must
 * sign in again.
 *
 * The one exception is a narrow grace for browser lifecycle races. The immediately previous token,
 * rotated at most REFRESH_GRACE_MS ago, whose replacement is still active, may be presented ONE
 * more time: it then gets a new sibling session in the same family instead of revoking it. Both
 * the replacement and the sibling stay valid, so whichever cookie the browser ends up keeping
 * works; the next normal rotation in the family revokes the other one. Any other use of a revoked
 * token (after the grace period, a second grace use, a token revoked by logout or by a sibling's
 * rotation) is still reuse.
 *
 * Concurrency: every change to a family (rotation, grace, revocation, logout) runs in one
 * transaction holding a per-family advisory lock, and re-reads the session under that lock, so
 * concurrent requests are decided one after the other on current data.
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
    const found = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      select: { id: true, tokenFamilyId: true },
    });
    if (found === null) {
      return { ok: false, reason: "invalid" };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockFamily(tx, found.tokenFamilyId);
      // Re-read under the lock: another request for this family may just have changed it.
      const current = await tx.authSession.findUniqueOrThrow({
        where: { id: found.id },
        include: { user: true },
      });

      if (current.revokedAt === null) {
        if (current.expiresAt <= now) {
          return { ok: false, reason: "expired" } as const;
        }
        if (current.user.status !== "ACTIVE") {
          await revokeFamily(tx, current.tokenFamilyId, now);
          return { ok: false, reason: "inactive" } as const;
        }
        return {
          ok: true,
          session: await this.rotate(tx, current, now),
          user: current.user,
          grace: false,
        } as const;
      }

      const sibling = await this.graceReuse(tx, current, now);
      if (sibling !== null) {
        return { ok: true, session: sibling, user: current.user, grace: true } as const;
      }
      await revokeFamily(tx, current.tokenFamilyId, now);
      return { ok: false, reason: "reused" } as const;
    });

    if (result.ok && result.grace) {
      this.logger.log("Refresh grace reuse: overlapping refresh of the previous token accepted");
    } else if (!result.ok && result.reason === "reused") {
      this.logger.warn("Refresh token reuse detected: token family revoked");
    }
    return result;
  }

  /**
   * Logout: revokes the session's whole token family (this device's sign-in, including any
   * rotated successors and grace siblings). Other devices' sessions stay valid. Idempotent.
   */
  async revokeSessionFamily(sessionId: string, now: Date = new Date()): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { tokenFamilyId: true },
    });
    if (session !== null) {
      await this.prisma.$transaction(async (tx) => {
        await lockFamily(tx, session.tokenFamilyId);
        await revokeFamily(tx, session.tokenFamilyId, now);
      });
    }
  }

  /**
   * Normal rotation: the successor becomes the family's only active session. The presented
   * session is revoked with its replacement recorded, and any other active session of the family
   * (the unused half of an earlier grace overlap) is closed too.
   */
  private async rotate(
    tx: Tx,
    current: { id: string; userId: string; tokenFamilyId: string },
    now: Date,
  ): Promise<IssuedSession> {
    const successor = await this.create(tx, current.userId, current.tokenFamilyId, now);
    await tx.authSession.update({
      where: { id: current.id },
      data: { revokedAt: now, lastUsedAt: now, replacedBySessionId: successor.sessionId },
    });
    await tx.authSession.updateMany({
      where: {
        tokenFamilyId: current.tokenFamilyId,
        revokedAt: null,
        id: { not: successor.sessionId },
      },
      data: { revokedAt: now },
    });
    return successor;
  }

  /**
   * The controlled grace reuse of the immediately previous token, or null if it does not qualify:
   * - it was revoked by a rotation (its replacement is known), at most REFRESH_GRACE_MS ago;
   * - it has not been grace-reused before (claimed atomically: at most once, ever);
   * - its replacement is still active (not logged out, not rotated on, not revoked as reuse);
   * - it has not expired, and the user is still active.
   * The result is a new sibling session; the replacement stays valid as well.
   */
  private async graceReuse(
    tx: Tx,
    current: {
      id: string;
      userId: string;
      tokenFamilyId: string;
      revokedAt: Date | null;
      replacedBySessionId: string | null;
      graceReusedAt: Date | null;
      expiresAt: Date;
      user: User;
    },
    now: Date,
  ): Promise<IssuedSession | null> {
    const graceStart = new Date(now.getTime() - REFRESH_GRACE_MS);
    if (
      current.replacedBySessionId === null ||
      current.revokedAt === null ||
      current.revokedAt < graceStart ||
      current.graceReusedAt !== null ||
      current.expiresAt <= now ||
      current.user.status !== "ACTIVE"
    ) {
      return null;
    }
    const replacementActive = await tx.authSession.count({
      where: { id: current.replacedBySessionId, revokedAt: null },
    });
    if (replacementActive === 0) {
      return null;
    }
    // Conditional claim (defence in depth beside the family lock): only one grace reuse, ever.
    const { count } = await tx.authSession.updateMany({
      where: { id: current.id, graceReusedAt: null, replacedBySessionId: { not: null } },
      data: { graceReusedAt: now, lastUsedAt: now },
    });
    if (count !== 1) {
      return null;
    }
    return this.create(tx, current.userId, current.tokenFamilyId, now);
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

/**
 * Serialises every change to one token family for the rest of the transaction. Keys are
 * namespaced ("auth-family:"), separate from the guest-creation lock ("auth-guest-create").
 */
async function lockFamily(tx: Tx, tokenFamilyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-family:${tokenFamilyId}`}, 0))`;
}

async function revokeFamily(tx: Tx, tokenFamilyId: string, now: Date): Promise<void> {
  await tx.authSession.updateMany({
    where: { tokenFamilyId, revokedAt: null },
    data: { revokedAt: now },
  });
}
